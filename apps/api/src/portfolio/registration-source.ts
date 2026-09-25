import type { Authority } from '@ellipsis-labs/rise';
import { Connection, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { z } from 'zod';

import { ProviderResponseError } from '../execution/sources.js';
import type {
  PhoenixRegistrationBuild,
  PhoenixRegistrationProvider,
  PhoenixRegistrationSubmission,
} from './registration-types.js';

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const instructionSchema = z.object({
  programId: z.string().min(32),
  keys: z.array(z.object({
    pubkey: z.string().min(32),
    isSigner: z.boolean(),
    isWritable: z.boolean(),
  }).strict()),
  data: z.array(z.number().int().min(0).max(255)),
}).strict();

const buildResponseSchema = z.object({
  includeRegisterTrader: z.boolean(),
  instructions: z.array(instructionSchema).min(1),
  maxPositions: z.number().int().min(32).max(128),
  traderOnboarder: z.string().min(32),
  traderPda: z.string().min(32),
  txFeePayer: z.string().min(32),
}).passthrough();

const submitResponseSchema = z.object({
  includeRegisterTrader: z.boolean(),
  signature: z.string().min(32),
  traderPda: z.string().min(32),
  traderOnboarder: z.string().min(32),
  txFeePayer: z.string().min(32),
}).passthrough();

const referralSubmitResponseSchema = z.object({
  signature: z.string().min(32),
  trader_pda: z.string().min(32),
  referral_code: z.string().min(1),
  status: z.enum(['activated', 'submitted', 'already_activated']),
}).passthrough();

type ReferralBuildInput = Parameters<PhoenixRegistrationProvider['build']>[0] & { referralCode: string };
type ReferralBuilder = (input: ReferralBuildInput) => Promise<PhoenixRegistrationBuild>;

export class PhoenixReferralRegistrationUnavailableError extends Error {
  constructor(message = 'Phoenix referral onboarding is not available in this build.') {
    super(message);
  }
}

export class PhoenixRegistrationSource implements PhoenixRegistrationProvider {
  private readonly baseUrl: string;

  constructor(private readonly options: {
    baseUrl: string;
    timeoutMs: number;
    rpcUrl?: string;
    fetch?: Fetcher;
    referralBuilder?: ReferralBuilder;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
  }

  async build(input: Parameters<PhoenixRegistrationProvider['build']>[0]): Promise<PhoenixRegistrationBuild> {
    if (input.mode === 'referral') {
      if (!input.referralCode) throw new PhoenixReferralRegistrationUnavailableError('Phoenix referral code is missing.');
      const builder = this.options.referralBuilder ?? this.buildReferral.bind(this);
      try {
        return await builder({ ...input, referralCode: input.referralCode });
      } catch (error) {
        if (error instanceof ProviderResponseError || error instanceof PhoenixReferralRegistrationUnavailableError) throw error;
        throw new ProviderResponseError('phoenix', 'Phoenix could not prepare referral registration.');
      }
    }
    const parsed = buildResponseSchema.safeParse(await this.request('/v1/exchange/build-register-ixs', {
      method: 'POST',
      body: JSON.stringify({
        traderAuthority: input.traderAuthority,
        txFeePayer: input.txFeePayer,
        maxPositions: input.maxPositions,
      }),
    }));
    if (!parsed.success || parsed.data.txFeePayer !== input.txFeePayer || parsed.data.maxPositions !== input.maxPositions) {
      throw new ProviderResponseError('phoenix', 'Phoenix returned unreadable registration instructions.');
    }
    return parsed.data;
  }

  async submit(input: Parameters<PhoenixRegistrationProvider['submit']>[0]): Promise<PhoenixRegistrationSubmission> {
    if (input.mode === 'referral') {
      if (!input.referralCode) throw new PhoenixReferralRegistrationUnavailableError('Phoenix referral code is missing.');
      const parsed = referralSubmitResponseSchema.safeParse(await this.request('/v1/referral/activate-tx', {
        method: 'POST',
        body: JSON.stringify({
          referral_code: input.referralCode,
          trader_authority: input.traderAuthority,
          trader_pda_index: input.traderPdaIndex,
          trader_subaccount_index: input.traderSubaccountIndex,
          recent_blockhash: input.recentBlockhash,
          transaction: input.transaction,
        }),
      }));
      if (
        !parsed.success
        || parsed.data.referral_code !== input.referralCode
        || parsed.data.signature !== transactionSignature(input.transaction)
      ) {
        throw new ProviderResponseError('phoenix', 'Phoenix returned an unreadable referral activation result.');
      }
      return {
        includeRegisterTrader: true,
        signature: parsed.data.signature,
        traderPda: parsed.data.trader_pda,
      };
    }
    const parsed = submitResponseSchema.safeParse(await this.request('/v1/exchange/send-register-ixs', {
      method: 'POST',
      body: JSON.stringify({
        transaction: input.transaction,
        traderAuthority: input.traderAuthority,
        txFeePayer: input.txFeePayer,
        maxPositions: input.maxPositions,
        traderPdaIndex: input.traderPdaIndex,
        traderSubaccountIndex: input.traderSubaccountIndex,
      }),
    }));
    if (!parsed.success || parsed.data.txFeePayer !== input.txFeePayer) {
      throw new ProviderResponseError('phoenix', 'Phoenix returned an unreadable registration result.');
    }
    return parsed.data;
  }

  private async buildReferral(input: ReferralBuildInput): Promise<PhoenixRegistrationBuild> {
    if (!this.options.rpcUrl) {
      throw new PhoenixReferralRegistrationUnavailableError('Phoenix referral onboarding requires a Solana RPC URL.');
    }
    const connection = new Connection(this.options.rpcUrl, 'confirmed');
    const latest = await connection.getLatestBlockhash('confirmed');
    const { createPhoenixClient } = await import('@ellipsis-labs/rise');
    const client = createPhoenixClient({
      apiUrl: this.baseUrl,
      rpcUrl: this.options.rpcUrl,
      exchangeMetadata: { stream: false },
      ws: false,
    });
    try {
      const permission = await client.api.invite().getReferralActivationPermission();
      const built = await client.api.invite().buildActivateReferralTxRequest({
        referralCode: input.referralCode,
        traderAuthority: input.traderAuthority as Authority,
        traderPdaIndex: 0,
        traderSubaccountIndex: 0,
        feePayer: input.txFeePayer as Authority,
        recentBlockhash: latest.blockhash,
        lastValidBlockHeight: BigInt(latest.lastValidBlockHeight),
        registerTraderMaxPositions: BigInt(input.maxPositions),
        permission,
        rpcUrl: this.options.rpcUrl,
        signTransaction: (_transaction, context) => context.unsignedTransactionBase64,
      });
      return {
        includeRegisterTrader: built.includeRegisterTrader,
        instructions: [],
        unsignedTransaction: built.unsignedTransactionBase64,
        lastValidBlockHeight: latest.lastValidBlockHeight,
        maxPositions: input.maxPositions,
        traderOnboarder: permission.trader_onboarder,
        traderPda: built.traderPda,
      };
    } finally {
      client.dispose();
    }
  }

  private async request(path: string, init: RequestInit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await (this.options.fetch ?? fetch)(`${this.baseUrl}${path}`, {
        ...init,
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new ProviderResponseError('phoenix', 'Phoenix registration request failed.', response.status);
      try {
        return await response.json() as unknown;
      } catch {
        throw new ProviderResponseError('phoenix', 'Phoenix returned unreadable registration data.');
      }
    } catch (error) {
      if (error instanceof ProviderResponseError) throw error;
      throw new ProviderResponseError('phoenix', 'Phoenix registration could not be started.');
    } finally {
      clearTimeout(timer);
    }
  }
}

function transactionSignature(signedTransaction: string) {
  try {
    const transaction = VersionedTransaction.deserialize(Buffer.from(signedTransaction, 'base64'));
    const signature = transaction.signatures[0];
    if (!signature || signature.every((byte) => byte === 0)) throw new Error('missing signature');
    return bs58.encode(signature);
  } catch {
    throw new ProviderResponseError('phoenix', 'Phoenix referral transaction is unreadable.', 422);
  }
}
