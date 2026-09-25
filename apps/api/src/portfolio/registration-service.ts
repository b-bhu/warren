import { randomUUID } from 'node:crypto';

import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import {
  phoenixRegistrationResultSchema,
  phoenixRegistrationReviewSchema,
  type PhoenixRegistrationResult,
  type PhoenixRegistrationReview,
} from '@warren/portfolio-contract';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

import { ProviderResponseError } from '../execution/sources.js';
import type { ExecutionIdentity } from '../execution/types.js';
import { PortfolioServiceFault } from './service.js';
import { PhoenixReferralRegistrationUnavailableError } from './registration-source.js';
import type {
  PhoenixRegistrationIntent,
  PhoenixRegistrationIntentStore,
  PhoenixRegistrationMode,
  PhoenixRegistrationProvider,
  PhoenixRegistrationTransactionGateway,
} from './registration-types.js';

const MAX_POSITIONS = 128;
const TRADER_PDA_INDEX = 0 as const;
const TRADER_SUBACCOUNT_INDEX = 0 as const;

export class PhoenixRegistrationService {
  private readonly now: () => Date;
  private readonly mode: PhoenixRegistrationMode;

  constructor(private readonly options: {
    provider: PhoenixRegistrationProvider;
    solana: PhoenixRegistrationTransactionGateway;
    store: PhoenixRegistrationIntentStore;
    referralCode?: string;
    reviewTtlMs: number;
    now?: () => Date;
  }) {
    this.now = options.now ?? (() => new Date());
    this.mode = options.referralCode ? 'referral' : 'non_referral';
  }

  async createReview(identity: ExecutionIdentity, requestedWallet: string): Promise<PhoenixRegistrationReview> {
    const walletAddress = requireOwnedWallet(identity, requestedWallet);
    try {
      const built = await this.options.provider.build({
        mode: this.mode,
        ...(this.options.referralCode ? { referralCode: this.options.referralCode } : {}),
        privyToken: identity.rawToken,
        traderAuthority: walletAddress,
        txFeePayer: walletAddress,
        maxPositions: MAX_POSITIONS,
      });
      const transaction = built.unsignedTransaction !== undefined
        ? validatePreparedTransaction(walletAddress, built)
        : await this.options.solana.build(walletAddress, built.instructions, {
            allowedExternalSigners: [built.traderOnboarder],
          });
      const wire = VersionedTransaction.deserialize(Buffer.from(transaction.unsignedTransaction, 'base64'));
      const createdAt = this.now().toISOString();
      const expiresAt = new Date(this.now().getTime() + this.options.reviewTtlMs).toISOString();
      const registrationId = randomUUID();
      const intent: PhoenixRegistrationIntent = {
        registrationId,
        userId: identity.userId,
        walletAddress,
        mode: this.mode,
        traderPda: canonicalAddress(built.traderPda),
        maxPositions: built.maxPositions,
        unsignedTransaction: transaction.unsignedTransaction,
        recentBlockhash: wire.message.recentBlockhash,
        lastValidBlockHeight: transaction.lastValidBlockHeight,
        state: 'review',
        createdAt,
        updatedAt: createdAt,
        expiresAt,
      };
      this.options.store.deleteExpired(createdAt);
      this.options.store.save(intent);
      return phoenixRegistrationReviewSchema.parse({
        registrationId,
        state: 'review',
        venue: 'Phoenix',
        mode: this.mode,
        walletAddress,
        traderAuthority: walletAddress,
        feePayer: walletAddress,
        traderPda: intent.traderPda,
        traderPdaIndex: TRADER_PDA_INDEX,
        traderSubaccountIndex: TRADER_SUBACCOUNT_INDEX,
        marginMode: 'cross',
        maxPositions: intent.maxPositions,
        fees: { networkFeePaidBy: 'user_wallet', accountRentPaidBy: 'user_wallet' },
        expiresAt,
        lastValidBlockHeight: intent.lastValidBlockHeight,
        unsignedTransaction: intent.unsignedTransaction,
      });
    } catch (error) {
      throw registrationFault(error, 'Phoenix could not prepare account registration.');
    }
  }

  async submit(
    identity: ExecutionIdentity,
    registrationId: string,
    signedTransaction: string,
    idempotencyKey: string,
  ): Promise<PhoenixRegistrationResult> {
    const intent = this.requireIntent(identity, registrationId, idempotencyKey);
    if (intent.state !== 'review') return this.status(identity, registrationId);
    const transactionSignature = validateSignedTransaction(intent, signedTransaction);
    intent.signature = transactionSignature;
    intent.state = 'unknown';
    intent.submittedAt = this.now().toISOString();
    intent.updatedAt = intent.submittedAt;
    this.options.store.update(intent);
    try {
      const submitted = await this.options.provider.submit({
        mode: intent.mode,
        ...(this.options.referralCode ? { referralCode: this.options.referralCode } : {}),
        privyToken: identity.rawToken,
        transaction: signedTransaction,
        traderAuthority: intent.walletAddress,
        txFeePayer: intent.walletAddress,
        maxPositions: intent.maxPositions,
        traderPdaIndex: TRADER_PDA_INDEX,
        traderSubaccountIndex: TRADER_SUBACCOUNT_INDEX,
        recentBlockhash: intent.recentBlockhash,
      });
      if (canonicalAddress(submitted.traderPda) !== intent.traderPda || submitted.signature !== transactionSignature) {
        throw new Error('Phoenix returned mismatched registration identifiers.');
      }
      intent.state = 'submitted';
      intent.updatedAt = this.now().toISOString();
      this.options.store.update(intent);
      return this.status(identity, registrationId);
    } catch (error) {
      throw registrationFault(error, 'Phoenix could not submit account registration.');
    }
  }

  async status(identity: ExecutionIdentity, registrationId: string): Promise<PhoenixRegistrationResult> {
    const intent = this.requireOwnedIntent(identity, registrationId);
    if (!intent.signature) {
      throw new PortfolioServiceFault('REGISTRATION_STATE_INVALID', 409, 'This Phoenix registration has not been signed yet.');
    }
    if (intent.state !== 'confirmed' && intent.state !== 'failed') {
      try {
        const state = await this.options.solana.getSignatureState(intent.signature);
        if (state === 'confirmed' || state === 'failed') {
          intent.state = state;
          intent.updatedAt = this.now().toISOString();
          this.options.store.update(intent);
        }
      } catch {
        // The signature is already reserved. A transient RPC failure must never trigger resubmission.
      }
    }
    return resultFor(intent);
  }

  private requireIntent(identity: ExecutionIdentity, registrationId: string, idempotencyKey: string) {
    const intent = this.requireOwnedIntent(identity, registrationId);
    if (intent.idempotencyKey && intent.idempotencyKey !== idempotencyKey) {
      throw new PortfolioServiceFault('REGISTRATION_STATE_INVALID', 409, 'This registration was already submitted with a different key.');
    }
    if (intent.state === 'review' && new Date(intent.expiresAt).getTime() <= this.now().getTime()) {
      throw new PortfolioServiceFault('REGISTRATION_EXPIRED', 410, 'This Phoenix registration review expired. Start again.');
    }
    intent.idempotencyKey = idempotencyKey;
    intent.updatedAt = this.now().toISOString();
    this.options.store.update(intent);
    return intent;
  }

  private requireOwnedIntent(identity: ExecutionIdentity, registrationId: string) {
    const intent = this.options.store.get(registrationId);
    if (!intent) throw new PortfolioServiceFault('REGISTRATION_NOT_FOUND', 404, 'This Phoenix registration could not be found.');
    if (
      intent.userId !== identity.userId
      || !identity.walletAddresses.some((address) => canonicalAddress(address) === intent.walletAddress)
    ) {
      throw new PortfolioServiceFault('WALLET_MISMATCH', 403, 'This Phoenix registration belongs to a different wallet.');
    }
    return intent;
  }
}

function resultFor(intent: PhoenixRegistrationIntent): PhoenixRegistrationResult {
  const state = intent.state === 'confirmed' || intent.state === 'failed' ? intent.state : 'submitted';
  return phoenixRegistrationResultSchema.parse({
    registrationId: intent.registrationId,
    state,
    venue: 'Phoenix',
    walletAddress: intent.walletAddress,
    traderPda: intent.traderPda,
    signature: intent.signature,
    explorerUrl: `https://explorer.solana.com/tx/${intent.signature}`,
    message: state === 'confirmed'
      ? 'Phoenix account created. Add USDC collateral before opening a perpetual position.'
      : state === 'failed'
        ? 'Phoenix account creation failed on Solana. You can safely try again.'
        : 'Phoenix account creation was submitted and is waiting for Solana confirmation.',
    nextAction: state === 'confirmed' ? 'add_collateral' : state === 'failed' ? 'retry' : 'wait_for_confirmation',
  });
}

function validateSignedTransaction(intent: PhoenixRegistrationIntent, signedTransaction: string) {
  try {
    const unsigned = VersionedTransaction.deserialize(Buffer.from(intent.unsignedTransaction, 'base64'));
    const signed = VersionedTransaction.deserialize(Buffer.from(signedTransaction, 'base64'));
    const unsignedMessage = Buffer.from(unsigned.message.serialize());
    const signedMessage = Buffer.from(signed.message.serialize());
    if (!unsignedMessage.equals(signedMessage)) throw new Error('message mismatch');
    const signerIndex = signed.message.staticAccountKeys
      .slice(0, signed.message.header.numRequiredSignatures)
      .findIndex((key) => key.toBase58() === intent.walletAddress);
    if (signerIndex < 0) throw new Error('wallet signer missing');
    const signature = signed.signatures[signerIndex];
    if (!signature || signature.every((byte) => byte === 0)) throw new Error('wallet signature missing');
    if (!nacl.sign.detached.verify(signedMessage, signature, new PublicKey(intent.walletAddress).toBytes())) {
      throw new Error('wallet signature invalid');
    }
    const transactionSignature = signed.signatures[0];
    if (!transactionSignature || transactionSignature.every((byte) => byte === 0)) throw new Error('fee-payer signature missing');
    return bs58.encode(transactionSignature);
  } catch {
    throw new PortfolioServiceFault('INVALID_REQUEST', 400, 'The signed transaction does not match this Phoenix registration review.');
  }
}

function validatePreparedTransaction(
  walletAddress: string,
  built: {
    unsignedTransaction?: string;
    lastValidBlockHeight?: number;
    traderOnboarder: string;
  },
) {
  try {
    if (!built.unsignedTransaction || !Number.isSafeInteger(built.lastValidBlockHeight) || built.lastValidBlockHeight! <= 0) {
      throw new Error('missing transaction lifetime');
    }
    const transaction = VersionedTransaction.deserialize(Buffer.from(built.unsignedTransaction, 'base64'));
    const signerKeys = transaction.message.staticAccountKeys
      .slice(0, transaction.message.header.numRequiredSignatures)
      .map((key) => key.toBase58());
    if (
      signerKeys[0] !== walletAddress
      || signerKeys.length !== 2
      || !signerKeys.includes(canonicalAddress(built.traderOnboarder))
    ) {
      throw new Error('unexpected signer set');
    }
    return {
      unsignedTransaction: built.unsignedTransaction,
      lastValidBlockHeight: built.lastValidBlockHeight!,
    };
  } catch {
    throw new ProviderResponseError('phoenix', 'Phoenix returned an unsafe referral transaction.', 422);
  }
}

function requireOwnedWallet(identity: ExecutionIdentity, requestedWallet: string) {
  const walletAddress = canonicalAddress(requestedWallet);
  if (!identity.walletAddresses.some((address) => canonicalAddress(address) === walletAddress)) {
    throw new PortfolioServiceFault('WALLET_MISMATCH', 403, 'This wallet does not belong to the signed-in account.');
  }
  return walletAddress;
}

function canonicalAddress(address: string) {
  try {
    return new PublicKey(address).toBase58();
  } catch {
    throw new PortfolioServiceFault('INVALID_REQUEST', 400, 'The Solana wallet address is not valid.');
  }
}

function registrationFault(error: unknown, fallback: string) {
  if (error instanceof PortfolioServiceFault) return error;
  if (error instanceof PhoenixReferralRegistrationUnavailableError) {
    return new PortfolioServiceFault(
      'REFERRAL_ONBOARDING_UNAVAILABLE',
      503,
      'Phoenix referral onboarding could not be started. Please try again shortly.',
      true,
    );
  }
  if (error instanceof ProviderResponseError && error.status === 422) {
    return new PortfolioServiceFault('REGISTRATION_STATE_INVALID', 422, error.message, false);
  }
  return new PortfolioServiceFault(
    'REGISTRATION_PROVIDER_UNAVAILABLE',
    502,
    fallback,
    true,
  );
}
