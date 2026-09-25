import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { KAMINO_MARKET_ADDRESS, KAMINO_PROGRAM_ADDRESS, USDC_MINT_ADDRESS, USDC_RESERVE_ADDRESS } from '@warren/lending-contract';
import { KAMINO_XSTOCK_ASSETS, KaminoMarketCatalog } from '../src/lending/market.js';
import { LendingService, LendingServiceFault } from '../src/lending/service.js';
import { MemoryLendingActionStore, SqliteLendingActionStore, type LendingActionStore } from '../src/lending/store.js';
import { openDatabase } from '../src/db.js';
import { readConfig } from '../src/config.js';
import { buildApp } from '../src/server.js';
import type { ExecutionIdentityVerifier } from '../src/execution/types.js';

const asset = KAMINO_XSTOCK_ASSETS[0]!;
const owner = Keypair.generate();
const identity = { userId: 'profile-1', rawToken: 'test', walletAddresses: [owner.publicKey.toBase58()] };
const key = 'lending-idempotency-key-001';

function catalogFixture() {
  return {
    marketId: 'kamino:xstocks:mainnet', network: 'solana-mainnet', protocol: 'Kamino',
    lendingMarketAddress: KAMINO_MARKET_ADDRESS, programAddress: KAMINO_PROGRAM_ADDRESS,
    debtSymbol: 'USDC', actionsEnabled: true, newRiskEnabled: true, generatedAt: new Date().toISOString(),
    assets: KAMINO_XSTOCK_ASSETS.map((item) => ({
      assetId: item.assetId, symbol: item.symbol, name: item.name, mintAddress: item.mint, reserveAddress: item.reserve,
      lendingMarketAddress: KAMINO_MARKET_ADDRESS, debtMintAddress: USDC_MINT_ADDRESS, debtReserveAddress: USDC_RESERVE_ADDRESS,
      marketStatus: 'Active', routeAvailable: true, dataAsOf: new Date().toISOString(), supplyApy: '0.02', borrowApy: '0.05',
      availableLiquidity: '100000', maxLtv: '0.7', liquidationLtv: '0.8', actionsPaused: false, actionPauseReason: null,
    })),
  };
}

function fakeSdk(options: { onSend?: (transaction: string) => Promise<string>; signatureState?: () => Promise<'confirmed' | 'failed' | 'pending' | 'unknown'> } = {}) {
  const tx = unsignedTransaction(owner);
  const unsignedBase64 = Buffer.from(tx.serialize()).toString('base64');
  return {
    prepareCalls: 0,
    async readWallet(walletAddress: string) {
      return {
        walletAddress, network: 'solana-mainnet', observedAt: new Date().toISOString(),
        holdings: KAMINO_XSTOCK_ASSETS.map((item) => ({
          assetId: item.assetId, symbol: item.symbol, mintAddress: item.mint, rawAmount: '100000000', spendableRawAmount: '100000000',
          decimals: 8, displayAmount: '1', scaledUiMultiplier: '1', sourceAccountAddress: owner.publicKey.toBase58(),
          accountCount: 1, frozenAccountCount: 0, tokenProgram: 'token-2022', extensionState: 'verified', eligibility: 'supported-balance',
        })),
        obligations: [],
        usdcBalance: { mintAddress: USDC_MINT_ADDRESS, rawAmount: '100000000', spendableRawAmount: '100000000', decimals: 6, displayAmount: '100', sourceAccountAddress: owner.publicKey.toBase58() },
      };
    },
    async preview(input: { action: string; walletAddress: string; asset: typeof asset; amountRaw: string }) {
      return {
        walletAddress: input.walletAddress, assetId: input.asset.assetId, action: input.action, observedAt: new Date().toISOString(),
        obligationAddress: null, collateralRawBefore: '0', collateralRawAfter: input.amountRaw === 'ALL' ? '100000000' : input.amountRaw,
        debtRawBefore: '0', debtRawAfter: '0', maxBorrowRaw: '50000000', maxWithdrawRaw: '0', currentLtv: '0', projectedLtv: '0',
        liquidationLtv: '0.8', liquidationHeadroomUsd: '500', supplyApy: null, borrowApy: null, availableLiquidity: null,
        healthBufferBps: 5000, approvalCount: 1, newRiskPaused: false, actionAvailable: true, blockReason: null,
      };
    },
    async prepare(input: { amountRaw: string; kind: string }) {
      this.prepareCalls += 1;
      return { unsignedTransaction: unsignedBase64, lastValidBlockHeight: 100, expiresAt: new Date(Date.now() + 60_000).toISOString(), amountRaw: input.amountRaw,
        amount: '1', displayAmount: '1', decimals: 8, feeEstimateLamports: '5000', rentEstimateLamports: '0',
        simulation: { ok: true, unitsConsumed: 50_000, logs: ['fixture simulation only'], error: null } };
    },
    async send(signed: string) { return options.onSend ? options.onSend(signed) : 'unused'; },
    async isBlockhashExpired() { return false; },
    async getSignatureState() { return options.signatureState ? options.signatureState() : 'unknown'; },
  };
}

function unsignedTransaction(payer: Keypair) {
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })],
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

function makeService(options: { newRiskEnabled?: boolean; sdk?: ReturnType<typeof fakeSdk>; store?: LendingActionStore } = {}) {
  const sdk = options.sdk ?? fakeSdk();
  const store = options.store ?? new MemoryLendingActionStore();
  const service = new LendingService({
    catalog: { load: async () => catalogFixture() } as unknown as KaminoMarketCatalog,
    sdk: sdk as never,
    store,
    flags: { catalogEnabled: true, newRiskEnabled: options.newRiskEnabled ?? true, repayEnabled: false, withdrawEnabled: false, borrowHeadroomBps: 5000 },
    send: sdk.send.bind(sdk), signatureState: sdk.getSignatureState.bind(sdk),
  });
  return { service, store, sdk };
}

async function createReview(service: LendingService, idem = key) {
  return service.create(identity, { action: 'supply', walletAddress: owner.publicKey.toBase58(), assetId: asset.assetId, amountRaw: '100000000' }, idem);
}

test('private lending rejects wallets outside the authenticated Privy identity', async () => {
  const { service } = makeService();
  await assert.rejects(service.wallet(identity, Keypair.generate().publicKey.toBase58()), (error: unknown) => error instanceof LendingServiceFault && error.code === 'WALLET_MISMATCH');
});

test('lending HTTP positions require Privy auth, scope the selected wallet, and disable caching', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'warren-lending-routes-'));
  const config = readConfig({ NODE_ENV: 'test', DATABASE_URL: `file:${join(directory, 'test.db')}`, AUTH_DOMAIN: 'warren.test', AUTH_URI: 'https://warren.test' });
  const db = openDatabase(config.DATABASE_URL);
  const { service } = makeService();
  await createReview(service, 'lending-history-idempotency-01');
  const verifier: ExecutionIdentityVerifier = { async verify(token) {
    if (token !== 'valid-privy-token') throw new Error('invalid token');
    return { userId: 'profile-1', walletAddresses: [owner.publicKey.toBase58()] };
  } };
  const catalog = new KaminoMarketCatalog({ baseUrl: 'https://kamino.test', timeoutMs: 1000, enabled: false, newRiskEnabled: false });
  const app = buildApp({ config, db, lendingService: service, kaminoMarketCatalog: catalog, executionIdentityVerifier: verifier });
  try {
    const unauthorized = await app.inject({ method: 'GET', url: `/v1/lending/kamino/xstocks/positions?walletAddress=${owner.publicKey.toBase58()}` });
    assert.equal(unauthorized.statusCode, 401);
    const authorized = await app.inject({ method: 'GET', url: `/v1/lending/kamino/xstocks/positions?walletAddress=${owner.publicKey.toBase58()}`, headers: { authorization: 'Bearer valid-privy-token' } });
    assert.equal(authorized.statusCode, 200);
    assert.equal(authorized.headers['cache-control'], 'no-store');
    assert.equal(authorized.json().walletAddress, owner.publicKey.toBase58());
    const activity = await app.inject({ method: 'GET', url: `/v1/lending/kamino/xstocks/actions?walletAddress=${owner.publicKey.toBase58()}`, headers: { authorization: 'Bearer valid-privy-token' } });
    assert.equal(activity.statusCode, 200);
    assert.equal(activity.json().items.length, 1);
    assert.equal(activity.json().items[0].action, 'supply');
    const wrongWallet = await app.inject({ method: 'GET', url: `/v1/lending/kamino/xstocks/positions?walletAddress=${Keypair.generate().publicKey.toBase58()}`, headers: { authorization: 'Bearer valid-privy-token' } });
    assert.equal(wrongWallet.statusCode, 403);
    assert.equal(wrongWallet.json().error.code, 'WALLET_MISMATCH');
  } finally { await app.close(); db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('new-risk gate is independent and blocks review before the SDK builds a transaction', async () => {
  const { service, sdk } = makeService({ newRiskEnabled: false });
  await assert.rejects(createReview(service), (error: unknown) => error instanceof LendingServiceFault && error.code === 'LENDING_ACTION_PAUSED');
  assert.equal(sdk.prepareCalls, 0);
});

test('repay and withdraw retain independent recovery gates while new risk is paused', async () => {
  const { service } = makeService({ newRiskEnabled: false });
  const repay = await service.preview(identity, { action: 'repay', walletAddress: owner.publicKey.toBase58(), assetId: asset.assetId, amountRaw: '100' });
  assert.equal(repay.actionAvailable, false);
  assert.match(repay.blockReason ?? '', /repayment is paused/i);
  await assert.rejects(service.create(identity, { action: 'repay', walletAddress: owner.publicKey.toBase58(), assetId: asset.assetId, amountRaw: '100' }, 'lending-repay-idempotency-001'),
    (error: unknown) => error instanceof LendingServiceFault && error.code === 'LENDING_ACTION_PAUSED');
});

test('review idempotency returns the original review and rejects key reuse for different amounts', async () => {
  const { service, sdk } = makeService();
  const first = await createReview(service);
  const second = await createReview(service);
  assert.equal(first.actionId, second.actionId);
  assert.equal(sdk.prepareCalls, 1);
  await assert.rejects(service.create(identity, { action: 'supply', walletAddress: owner.publicKey.toBase58(), assetId: asset.assetId, amountRaw: '2' }, key),
    (error: unknown) => error instanceof LendingServiceFault && error.code === 'LENDING_STATE_CONFLICT');
});

test('SQLite lending journal survives store reconstruction and scopes idempotency to a user', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'warren-lending-store-'));
  const db = openDatabase(`file:${join(directory, 'lending.db')}`);
  try {
    const store = new SqliteLendingActionStore(db);
    const { service } = makeService({ store });
    const review = await createReview(service, 'lending-sqlite-idempotency-001');
    const restarted = new SqliteLendingActionStore(db);
    const action = restarted.get(review.actionId);
    assert.equal(action?.state, 'review');
    assert.equal(restarted.getByIdempotency('profile-1', 'lending-sqlite-idempotency-001')?.actionId, review.actionId);
    assert.equal(restarted.getByIdempotency('other-user', 'lending-sqlite-idempotency-001'), undefined);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('signed transaction must preserve the reviewed message and exact wallet signature', async () => {
  const { service } = makeService();
  const review = await createReview(service);
  const step = review.steps[0]!;
  const wrong = unsignedTransaction(owner); wrong.sign([owner]);
  await assert.rejects(service.submit(identity, review.actionId, step.stepId, Buffer.from(wrong.serialize()).toString('base64'), key),
    (error: unknown) => error instanceof LendingServiceFault && error.code === 'INVALID_REQUEST');
  const signed = VersionedTransaction.deserialize(Buffer.from(step.unsignedTransaction, 'base64'));
  signed.sign([owner]);
  const signedBase64 = Buffer.from(signed.serialize()).toString('base64');
  let sendCount = 0;
  const durableStore = new MemoryLendingActionStore();
  let ownReview: Awaited<ReturnType<typeof createReview>>;
  const sendingSdk = fakeSdk({ onSend: async (transaction) => {
    sendCount += 1;
    const persisted = durableStore.get(ownReview.actionId)!;
    assert.equal(persisted.steps[0]?.state, 'unknown');
    assert.ok(persisted.steps[0]?.signature, 'signature journal is persisted before the network send');
    const submitted = VersionedTransaction.deserialize(Buffer.from(transaction, 'base64'));
    return bs58.encode(submitted.signatures[0]!);
  }, signatureState: async () => 'confirmed' });
  const confirmedService = makeService({ sdk: sendingSdk, store: durableStore }).service;
  ownReview = await createReview(confirmedService, 'lending-idempotency-key-003');
  const ownTx = VersionedTransaction.deserialize(Buffer.from(ownReview.steps[0]!.unsignedTransaction, 'base64')); ownTx.sign([owner]);
  const ownSignedBase64 = Buffer.from(ownTx.serialize()).toString('base64');
  const confirmed = await confirmedService.submit(identity, ownReview.actionId, ownReview.steps[0]!.stepId, ownSignedBase64, 'lending-submit-idempotency-key-01');
  assert.equal(confirmed.state, 'confirmed');
  assert.equal(sendCount, 1);
  await confirmedService.submit(identity, ownReview.actionId, ownReview.steps[0]!.stepId, ownSignedBase64, 'lending-submit-idempotency-key-01');
  assert.equal(sendCount, 1, 'replayed submit reconciles the recorded signature without a second send');
  assert.ok(signedBase64.length > 0);
});

test('ambiguous submission persists the signature and never sends a second time', async () => {
  const store = new MemoryLendingActionStore();
  let review: Awaited<ReturnType<typeof createReview>>;
  let sends = 0;
  const sdk = fakeSdk({ onSend: async () => {
    sends += 1;
    const saved = store.get(review.actionId)!;
    assert.equal(saved.steps[0]?.state, 'unknown');
    assert.ok(saved.steps[0]?.signature);
    throw new Error('simulated RPC response loss after possible broadcast');
  }, signatureState: async () => 'unknown' });
  const service = makeService({ sdk, store }).service;
  review = await createReview(service, 'lending-ambiguous-idempotency-01');
  const unsigned = VersionedTransaction.deserialize(Buffer.from(review.steps[0]!.unsignedTransaction, 'base64'));
  unsigned.sign([owner]);
  const signed = Buffer.from(unsigned.serialize()).toString('base64');
  const submitKey = 'lending-ambiguous-submit-key-001';
  const first = await service.submit(identity, review.actionId, review.steps[0]!.stepId, signed, submitKey);
  assert.equal(first.state, 'unknown');
  const repeated = await service.submit(identity, review.actionId, review.steps[0]!.stepId, signed, submitKey);
  assert.equal(repeated.state, 'unknown');
  assert.equal(sends, 1);
});

test('combined supply and borrow waits for the supply signature before preparing the second approval', async () => {
  let sends = 0;
  const sdk = fakeSdk({ onSend: async (transaction) => {
    sends += 1;
    return bs58.encode(VersionedTransaction.deserialize(Buffer.from(transaction, 'base64')).signatures[0]!);
  }, signatureState: async () => 'confirmed' });
  const service = makeService({ sdk }).service;
  const review = await service.create(identity, {
    action: 'supply-borrow', walletAddress: owner.publicKey.toBase58(), assetId: asset.assetId,
    amountRaw: '100000000', secondaryAmountRaw: '10000000',
  }, 'lending-combined-idempotency-01');
  assert.equal(review.steps.length, 1);
  assert.equal(review.steps[0]?.kind, 'supply');
  const transaction = VersionedTransaction.deserialize(Buffer.from(review.steps[0]!.unsignedTransaction, 'base64'));
  transaction.sign([owner]);
  const result = await service.submit(identity, review.actionId, review.steps[0]!.stepId,
    Buffer.from(transaction.serialize()).toString('base64'), 'lending-combined-submit-key-001');
  assert.equal(result.state, 'confirmed');
  const next = await service.nextStep(identity, review.actionId);
  assert.equal(next.steps.length, 2);
  assert.equal(next.steps[1]?.kind, 'borrow');
  assert.equal(next.steps[1]?.sequence, 2);
  assert.equal(sends, 1, 'the borrow step remains an unsigned, separately approved review');
});
