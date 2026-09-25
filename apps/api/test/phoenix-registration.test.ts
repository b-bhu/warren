import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  Keypair,
  SystemProgram,
  VersionedTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';

import { readConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { SolanaRpcGateway } from '../src/execution/sources.js';
import type { ExecutionIdentity, ExecutionIdentityVerifier } from '../src/execution/types.js';
import { MemoryPhoenixRegistrationIntentStore } from '../src/portfolio/registration-store.js';
import {
  PhoenixRegistrationSource,
} from '../src/portfolio/registration-source.js';
import { PhoenixRegistrationService } from '../src/portfolio/registration-service.js';
import type {
  PhoenixRegistrationProvider,
  PhoenixRegistrationSubmission,
} from '../src/portfolio/registration-types.js';
import { buildApp } from '../src/server.js';

const NOW = '2026-09-24T08:00:00.000Z';
const BLOCKHASH = Keypair.generate().publicKey.toBase58();

class FakePhoenixRegistrationProvider implements PhoenixRegistrationProvider {
  readonly traderPda = Keypair.generate().publicKey.toBase58();
  readonly traderOnboarder = Keypair.generate().publicKey.toBase58();
  buildInput?: Parameters<PhoenixRegistrationProvider['build']>[0];
  submitInput?: Parameters<PhoenixRegistrationProvider['submit']>[0];

  async build(input: Parameters<PhoenixRegistrationProvider['build']>[0]) {
    this.buildInput = input;
    return {
      includeRegisterTrader: true,
      instructions: [{
        programId: SystemProgram.programId.toBase58(),
        keys: [
          { pubkey: input.txFeePayer, isSigner: true, isWritable: true },
          { pubkey: this.traderOnboarder, isSigner: true, isWritable: false },
        ],
        data: [0],
      }],
      maxPositions: input.maxPositions,
      traderOnboarder: this.traderOnboarder,
      traderPda: this.traderPda,
    };
  }

  async submit(input: Parameters<PhoenixRegistrationProvider['submit']>[0]): Promise<PhoenixRegistrationSubmission> {
    this.submitInput = input;
    return {
      includeRegisterTrader: true,
      signature: transactionSignature(input.transaction),
      traderPda: this.traderPda,
    };
  }
}

function harness(options: { referralCode?: string; signatureState?: 'confirmed' | 'failed' | 'pending' | 'unknown' } = {}) {
  const wallet = Keypair.generate();
  const provider = new FakePhoenixRegistrationProvider();
  const signatureState = options.signatureState ?? 'confirmed';
  const solana = new SolanaRpcGateway('https://rpc.test', {
    async getLatestBlockhash() { return { blockhash: BLOCKHASH, lastValidBlockHeight: 99 }; },
    async sendRawTransaction() { throw new Error('Registration is submitted by Phoenix.'); },
    async getSignatureStatuses() {
      return {
        value: signatureState === 'unknown'
          ? [null]
          : [{ err: signatureState === 'failed' ? { custom: 1 } : null, confirmationStatus: signatureState }],
      };
    },
  });
  const service = new PhoenixRegistrationService({
    provider,
    solana,
    store: new MemoryPhoenixRegistrationIntentStore(),
    ...(options.referralCode ? { referralCode: options.referralCode } : {}),
    reviewTtlMs: 90_000,
    now: () => new Date(NOW),
  });
  const identity: ExecutionIdentity = {
    userId: 'did:privy:phoenix-owner',
    rawToken: 'privy-access-token',
    walletAddresses: [wallet.publicKey.toBase58()],
  };
  return { identity, provider, service, wallet };
}

test('non-referral Phoenix registration reviews user-paid costs, verifies the wallet, and confirms safely', async () => {
  const { identity, provider, service, wallet } = harness();
  const review = await service.createReview(identity, wallet.publicKey.toBase58());
  assert.equal(review.mode, 'non_referral');
  assert.equal(review.feePayer, wallet.publicKey.toBase58());
  assert.deepEqual(review.fees, { networkFeePaidBy: 'user_wallet', accountRentPaidBy: 'user_wallet' });
  assert.equal(provider.buildInput?.mode, 'non_referral');
  assert.equal(provider.buildInput?.referralCode, undefined);

  const signed = sign(review.unsignedTransaction, wallet);
  const result = await service.submit(identity, review.registrationId, signed, 'phoenix-registration-key-1');
  assert.equal(result.state, 'confirmed');
  assert.equal(result.nextAction, 'add_collateral');
  assert.equal(provider.submitInput?.txFeePayer, wallet.publicKey.toBase58());
  assert.equal(provider.submitInput?.traderPdaIndex, 0);
  assert.equal(provider.submitInput?.traderSubaccountIndex, 0);

  const replay = await service.submit(identity, review.registrationId, signed, 'phoenix-registration-key-1');
  assert.deepEqual(replay, result);
});

test('Phoenix registration rejects a substituted transaction and a different idempotency key', async () => {
  const { identity, service, wallet } = harness({ signatureState: 'pending' });
  const review = await service.createReview(identity, wallet.publicKey.toBase58());
  const substituted = VersionedTransaction.deserialize(Buffer.from(review.unsignedTransaction, 'base64'));
  substituted.message.recentBlockhash = Keypair.generate().publicKey.toBase58();
  substituted.sign([wallet]);
  await assert.rejects(
    service.submit(
      identity,
      review.registrationId,
      Buffer.from(substituted.serialize()).toString('base64'),
      'phoenix-registration-key-2',
    ),
    /does not match/,
  );
  const signed = sign(review.unsignedTransaction, wallet);
  await service.submit(identity, review.registrationId, signed, 'phoenix-registration-key-2');
  await assert.rejects(
    service.submit(identity, review.registrationId, signed, 'phoenix-registration-key-3'),
    /different key/,
  );
});

test('referral configuration selects the referral strategy without exposing the code in the review', async () => {
  const { identity, provider, service, wallet } = harness({ referralCode: 'WARREN' });
  const review = await service.createReview(identity, wallet.publicKey.toBase58());
  assert.equal(review.mode, 'referral');
  assert.equal(provider.buildInput?.mode, 'referral');
  assert.equal(provider.buildInput?.referralCode, 'WARREN');
  assert.equal(JSON.stringify(review).includes('WARREN'), false);
});

test('referral registration accepts an SDK-prepared transaction with only the wallet and Phoenix onboarder signers', async () => {
  const wallet = Keypair.generate();
  const onboarder = Keypair.generate().publicKey.toBase58();
  const traderPda = Keypair.generate().publicKey.toBase58();
  const solana = new SolanaRpcGateway('https://rpc.test', {
    async getLatestBlockhash() { return { blockhash: BLOCKHASH, lastValidBlockHeight: 99 }; },
    async sendRawTransaction() { throw new Error('Registration is submitted by Phoenix.'); },
    async getSignatureStatuses() { return { value: [{ err: null, confirmationStatus: 'confirmed' }] }; },
  });
  const provider: PhoenixRegistrationProvider = {
    async build(input) {
      const prepared = await solana.build(input.txFeePayer, [{
        programId: SystemProgram.programId.toBase58(),
        keys: [
          { pubkey: input.txFeePayer, isSigner: true, isWritable: true },
          { pubkey: onboarder, isSigner: true, isWritable: false },
        ],
        data: [0],
      }], { allowedExternalSigners: [onboarder] });
      return {
        includeRegisterTrader: true,
        instructions: [],
        ...prepared,
        maxPositions: input.maxPositions,
        traderOnboarder: onboarder,
        traderPda,
      };
    },
    async submit(input) {
      return {
        includeRegisterTrader: true,
        signature: transactionSignature(input.transaction),
        traderPda,
      };
    },
  };
  const service = new PhoenixRegistrationService({
    provider,
    solana,
    store: new MemoryPhoenixRegistrationIntentStore(),
    referralCode: 'WARREN',
    reviewTtlMs: 90_000,
    now: () => new Date(NOW),
  });
  const identity: ExecutionIdentity = {
    userId: 'did:privy:referral-owner',
    rawToken: 'privy-access-token',
    walletAddresses: [wallet.publicKey.toBase58()],
  };
  const review = await service.createReview(identity, wallet.publicKey.toBase58());
  assert.equal(review.mode, 'referral');
  const result = await service.submit(identity, review.registrationId, sign(review.unsignedTransaction, wallet), 'referral-key');
  assert.equal(result.state, 'confirmed');
});

test('Phoenix source uses the documented non-referral and referral transaction endpoints', async () => {
  const walletKeypair = Keypair.generate();
  const wallet = walletKeypair.publicKey.toBase58();
  const traderPda = Keypair.generate().publicKey.toBase58();
  const onboarder = Keypair.generate().publicKey.toBase58();
  const calls: { url: string; init?: RequestInit }[] = [];
  const solana = new SolanaRpcGateway('https://rpc.test', {
    async getLatestBlockhash() { return { blockhash: BLOCKHASH, lastValidBlockHeight: 99 }; },
    async sendRawTransaction() { throw new Error('Registration is submitted by Phoenix.'); },
    async getSignatureStatuses() { return { value: [{ err: null, confirmationStatus: 'confirmed' }] }; },
  });
  const source = new PhoenixRegistrationSource({
    baseUrl: 'https://phoenix.test',
    timeoutMs: 1_000,
    referralBuilder: async (input) => {
      const transaction = await solana.build(input.txFeePayer, [{
        programId: SystemProgram.programId.toBase58(),
        keys: [
          { pubkey: input.txFeePayer, isSigner: true, isWritable: true },
          { pubkey: onboarder, isSigner: true, isWritable: false },
        ],
        data: [0],
      }], { allowedExternalSigners: [onboarder] });
      return {
        includeRegisterTrader: true,
        instructions: [],
        ...transaction,
        maxPositions: input.maxPositions,
        traderOnboarder: onboarder,
        traderPda,
      };
    },
    fetch: async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/activate-tx')) {
        const body = JSON.parse(String(init?.body)) as { referral_code: string; transaction: string };
        return Response.json({
          referral_code: body.referral_code,
          signature: transactionSignature(body.transaction),
          status: 'submitted',
          trader_pda: traderPda,
        });
      }
      return Response.json(url.endsWith('/build-register-ixs') ? {
        includeRegisterTrader: true,
        instructions: [{
          programId: SystemProgram.programId.toBase58(),
          keys: [{ pubkey: wallet, isSigner: true, isWritable: true }],
          data: [0],
        }],
        maxPositions: 128,
        traderOnboarder: onboarder,
        traderPda,
        txFeePayer: wallet,
      } : {
        includeRegisterTrader: true,
        signature: Keypair.generate().publicKey.toBase58(),
        traderOnboarder: onboarder,
        traderPda,
        txFeePayer: wallet,
        maxPositions: 128,
      });
    },
  });
  const common = {
    mode: 'non_referral' as const,
    privyToken: 'must-not-leak',
    traderAuthority: wallet,
    txFeePayer: wallet,
    maxPositions: 128,
  };
  await source.build(common);
  await source.submit({
    ...common,
    transaction: 'signed-transaction',
    traderPdaIndex: 0,
    traderSubaccountIndex: 0,
    recentBlockhash: BLOCKHASH,
  });
  const referralBuild = await source.build({ ...common, mode: 'referral', referralCode: 'WARREN' });
  assert.equal(referralBuild.instructions.length, 0);
  assert.equal(referralBuild.lastValidBlockHeight, 99);
  const referralTransaction = sign(referralBuild.unsignedTransaction!, walletKeypair);
  await source.submit({
    ...common,
    mode: 'referral',
    referralCode: 'WARREN',
    transaction: referralTransaction,
    traderPdaIndex: 0,
    traderSubaccountIndex: 0,
    recentBlockhash: BLOCKHASH,
  });
  assert.deepEqual(calls.map((call) => call.url), [
    'https://phoenix.test/v1/exchange/build-register-ixs',
    'https://phoenix.test/v1/exchange/send-register-ixs',
    'https://phoenix.test/v1/referral/activate-tx',
  ]);
  assert.equal(JSON.stringify(calls).includes('must-not-leak'), false);
  assert.equal(JSON.stringify(calls).includes('WARREN'), true);
});

test('private Phoenix registration routes enforce auth and preserve the review-sign-submit boundary', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'warren-phoenix-registration-'));
  const databaseUrl = `file:${join(directory, 'test.db')}`;
  const { identity, service, wallet } = harness();
  const verifier: ExecutionIdentityVerifier = {
    async verify() { return { userId: identity.userId, walletAddresses: identity.walletAddresses }; },
  };
  const config = readConfig({ NODE_ENV: 'test', DATABASE_URL: databaseUrl });
  const db = openDatabase(databaseUrl);
  const app = buildApp({ config, db, executionIdentityVerifier: verifier, phoenixRegistrationService: service });
  try {
    const unauthorized = await app.inject({
      method: 'POST',
      url: '/v1/portfolio/phoenix/registrations',
      payload: { walletAddress: wallet.publicKey.toBase58() },
    });
    assert.equal(unauthorized.statusCode, 401);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/portfolio/phoenix/registrations',
      headers: { authorization: 'Bearer privy-token' },
      payload: { walletAddress: wallet.publicKey.toBase58() },
    });
    assert.equal(created.statusCode, 201);
    const review = created.json();
    const submitted = await app.inject({
      method: 'POST',
      url: `/v1/portfolio/phoenix/registrations/${review.registrationId}/submit`,
      headers: {
        authorization: 'Bearer privy-token',
        'idempotency-key': 'phoenix-registration-http-key',
      },
      payload: { signedTransaction: sign(review.unsignedTransaction, wallet) },
    });
    assert.equal(submitted.statusCode, 200);
    assert.equal(submitted.json().state, 'confirmed');
  } finally {
    await app.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

function sign(unsignedTransaction: string, wallet: Keypair) {
  const transaction = VersionedTransaction.deserialize(Buffer.from(unsignedTransaction, 'base64'));
  transaction.sign([wallet]);
  return Buffer.from(transaction.serialize()).toString('base64');
}

function transactionSignature(signedTransaction: string) {
  const transaction = VersionedTransaction.deserialize(Buffer.from(signedTransaction, 'base64'));
  return bs58.encode(transaction.signatures[0]!);
}
