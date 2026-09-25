import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Keypair } from '@solana/web3.js';
import {
  portfolioActivityResponseSchema,
  portfolioOverviewResponseSchema,
  portfolioPositionsResponseSchema,
} from '@warren/portfolio-contract';
import type { MarketInstrument, MarketsWarning, PerpetualInstrument, PrestockInstrument, SpotInstrument } from '@warren/markets-contract';

import { readConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { MemoryExecutionIntentStore, type ExecutionIntent, type ExecutionIntentStore } from '../src/execution/store.js';
import type { ExecutionIdentity, ExecutionIdentityVerifier } from '../src/execution/types.js';
import type { MarketsService } from '../src/markets/service.js';
import { MemoryPortfolioSnapshotStore } from '../src/portfolio/snapshots.js';
import { PortfolioService } from '../src/portfolio/service.js';
import { HeliusPortfolioSource, PhoenixPortfolioSource } from '../src/portfolio/sources.js';
import { PortfolioProviderError } from '../src/portfolio/types.js';
import type {
  PhoenixFundingActivity,
  PhoenixPortfolioSnapshot,
  PhoenixPortfolioSourceContract,
  PhoenixTradeActivity,
  SignatureState,
  WalletPortfolioSource,
  WalletSnapshot,
  WalletTransfer,
} from '../src/portfolio/types.js';
import { buildApp } from '../src/server.js';

const NOW = '2026-09-23T10:00:00.000Z';
const WALLET = Keypair.generate().publicKey.toBase58();
const OTHER_WALLET = Keypair.generate().publicKey.toBase58();
const NVDA_MINT = Keypair.generate().publicKey.toBase58();
const ANTHROPIC_MINT = Keypair.generate().publicKey.toBase58();
const UNKNOWN_MINT = Keypair.generate().publicKey.toBase58();
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111111';

class FakeWalletSource implements WalletPortfolioSource {
  failWallet = false;
  failTransfers = false;
  snapshot: WalletSnapshot = {
    address: WALLET,
    solLamports: '1000000000',
    solPriceUsd: 150,
    observedAt: NOW,
    tokens: [
      { mint: NVDA_MINT, rawAmount: '123456789', decimals: 6 },
      { mint: ANTHROPIC_MINT, rawAmount: '2500000', decimals: 6 },
      { mint: UNKNOWN_MINT, rawAmount: '999999999', decimals: 6 },
      { mint: USDC_MINT, rawAmount: '25000000', decimals: 6 },
    ],
  };
  transfers: WalletTransfer[] = [];
  signatureStates = new Map<string, SignatureState>();

  async loadWallet(address: string) {
    if (this.failWallet) throw new Error('raw Helius failure');
    return { ...structuredClone(this.snapshot), address };
  }

  async loadTransfers() {
    if (this.failTransfers) throw new Error('raw transfer failure');
    return { items: structuredClone(this.transfers), exhausted: true };
  }

  async getSignatureStates(signatures: readonly string[]) {
    return new Map(signatures.flatMap((signature) => {
      const value = this.signatureStates.get(signature);
      return value ? [[signature, value] as const] : [];
    }));
  }
}

class FakePhoenixSource implements PhoenixPortfolioSourceContract {
  accountError: unknown = undefined;
  failAccount = false;
  failActivity = false;
  snapshot: PhoenixPortfolioSnapshot = phoenixSnapshot();
  trades: PhoenixTradeActivity[] = [];
  funding: PhoenixFundingActivity[] = [];

  async loadAccount() {
    if (this.accountError) throw this.accountError;
    if (this.failAccount) throw new Error('raw Phoenix failure');
    return structuredClone(this.snapshot);
  }

  async loadActivity() {
    if (this.failActivity) throw new Error('raw Phoenix history failure');
    return { trades: structuredClone(this.trades), funding: structuredClone(this.funding), exhausted: true };
  }
}

function portfolioService(options: {
  wallet?: FakeWalletSource;
  phoenix?: FakePhoenixSource;
  executions?: ExecutionIntentStore;
  phoenixRegistrationMode?: 'non_referral' | 'referral';
  registryFailure?: boolean;
  registryWarnings?: MarketsWarning[];
} = {}) {
  const wallet = options.wallet ?? new FakeWalletSource();
  const phoenix = options.phoenix ?? new FakePhoenixSource();
  const markets = {
    async getPortfolioRegistry() {
      if (options.registryFailure) throw new Error('raw registry failure');
      return { instruments: registry(), warnings: options.registryWarnings ?? [] };
    },
  } as unknown as MarketsService;
  return {
    service: new PortfolioService({
      markets,
      wallet,
      phoenix,
      phoenixRegistrationMode: options.phoenixRegistrationMode,
      executions: options.executions ?? new MemoryExecutionIntentStore(),
      snapshots: new MemoryPortfolioSnapshotStore(),
      now: () => new Date(NOW),
    }),
    wallet,
    phoenix,
  };
}

const identity = (userId = 'did:privy:owner', walletAddresses: readonly string[] = [WALLET]): ExecutionIdentity => ({
  userId,
  rawToken: 'privy-access-token',
  walletAddresses,
});

test('overview exactly allowlists supported mints, preserves decimals, and never counts perp notional as equity', async () => {
  const { service } = portfolioService();
  const parsed = portfolioOverviewResponseSchema.parse(await service.getOverview(identity()));
  assert.equal(parsed.wallet.supportedAssetState, 'funded');
  assert.equal(parsed.holdings.length, 2);
  assert.deepEqual(parsed.holdings.map((holding) => holding.companyName), ['NVIDIA', 'Anthropic']);
  const nvidia = parsed.holdings.find((holding) => holding.assetId === 'nvidia');
  const anthropic = parsed.holdings.find((holding) => holding.assetId === 'anthropic');
  assert.equal(nvidia?.quantity, '123.456789');
  assert.equal(nvidia?.marketValueUsd.amount, 246.913578);
  assert.equal(nvidia?.valuationIncluded, true);
  assert.equal(anthropic?.quantity, '2.5');
  assert.equal(anthropic?.marketValueUsd.amount, null);
  assert.equal(anthropic?.valuationIncluded, false);
  assert.equal(parsed.counts.unpricedHoldings, 1);
  assert.equal(parsed.equity.pricedHoldings.amount, 246.913578);
  assert.equal(parsed.equity.cash.amount, 175);
  assert.equal(parsed.equity.perpetualEquity.amount, 1_050);
  assert.equal(parsed.equity.grossPerpetualExposure.amount, 5_000);
  assert.ok(Math.abs((parsed.equity.netAccountEquity.amount ?? 0) - 1_471.913578) < 1e-9);
  assert.equal(parsed.equity.todayChangeUsd.amount, null);
  assert.equal(parsed.openOrders.length, 1);
  assert.equal(parsed.openPositions.length, 1);
  assert.ok(parsed.warnings.some((warning) => warning.code === 'HOLDING_UNPRICED'));
});

test('positions keep open orders, perpetual positions, and owned holdings as separate collections', async () => {
  const { service } = portfolioService();
  const parsed = portfolioPositionsResponseSchema.parse(await service.getPositions(identity()));
  assert.equal(parsed.openOrders.length, 1);
  assert.equal(parsed.openPositions.length, 1);
  assert.equal(parsed.holdings.length, 2);
  assert.equal(parsed.openPositions[0]?.positionId, 'phoenix:0:2:NVDA');
  assert.equal(parsed.openPositions[0]?.direction, 'long');
  assert.equal(parsed.openPositions[0]?.dataState, 'live');
  assert.equal(parsed.openOrders[0]?.orderId, 'phoenix-order:0:2:7');
});

test('partial provider failures preserve healthy sections but withhold incomplete net equity', async () => {
  const walletFailure = new FakeWalletSource();
  walletFailure.failWallet = true;
  const first = portfolioOverviewResponseSchema.parse(await portfolioService({ wallet: walletFailure }).service.getOverview(identity()));
  assert.equal(first.holdings.length, 0);
  assert.equal(first.wallet.supportedAssetState, 'unavailable');
  assert.equal(first.openPositions.length, 1);
  assert.equal(first.equity.netAccountEquity.amount, null);
  assert.ok(first.warnings.some((warning) => warning.code === 'WALLET_BALANCES_UNAVAILABLE'));

  const phoenixFailure = new FakePhoenixSource();
  phoenixFailure.failAccount = true;
  const second = portfolioOverviewResponseSchema.parse(await portfolioService({ phoenix: phoenixFailure }).service.getOverview(identity()));
  assert.equal(second.holdings.length, 2);
  assert.equal(second.openPositions.length, 0);
  assert.equal(second.equity.netAccountEquity.amount, null);
  assert.equal(second.perpetuals.accountState, 'unavailable');
  assert.equal(second.perpetuals.registration, null);
  assert.ok(second.warnings.some((warning) => warning.code === 'PHOENIX_ACCOUNT_UNAVAILABLE'));
  assert.equal(second.warnings.find((warning) => warning.code === 'PHOENIX_ACCOUNT_UNAVAILABLE')?.retryable, true);

  const third = portfolioOverviewResponseSchema.parse(await portfolioService({ registryFailure: true }).service.getOverview(identity()));
  assert.equal(third.equity.netAccountEquity.amount, null);
  assert.ok(third.warnings.some((warning) => warning.code === 'MARKET_REGISTRY_UNAVAILABLE'));

  const partialRegistry = portfolioOverviewResponseSchema.parse(await portfolioService({
    registryWarnings: [{
      section: 'registry', provider: 'prestocks', product: null, code: 'PROVIDER_UNAVAILABLE',
      message: 'PreStocks registry is unavailable.', retryable: true,
    }],
  }).service.getOverview(identity()));
  assert.equal(partialRegistry.equity.netAccountEquity.amount, null);
});

test('Phoenix public account lookup failure preserves wallet balances without invalidating Warren auth', async () => {
  const phoenix = new FakePhoenixSource();
  phoenix.accountError = new PortfolioProviderError('phoenix', 'Phoenix rejected the public account lookup.', 401, false);
  const parsed = portfolioOverviewResponseSchema.parse(await portfolioService({ phoenix }).service.getOverview(identity()));
  assert.equal(parsed.perpetuals.accountState, 'unavailable');
  assert.equal(parsed.holdings.length, 2);
  assert.equal(parsed.equity.pricedHoldings.amount, 246.913578);
  assert.equal(parsed.equity.perpetualEquity.amount, null);
  assert.equal(parsed.equity.netAccountEquity.amount, null);
  assert.deepEqual(parsed.warnings.find((warning) => warning.section === 'perpetuals'), {
    section: 'perpetuals',
    code: 'PHOENIX_ACCOUNT_UNAVAILABLE',
    message: 'Phoenix data could not be loaded. Your wallet balances are still available.',
    retryable: false,
  });
});

test('missing SOL or Phoenix marks remain visible but withhold affected totals', async () => {
  const wallet = new FakeWalletSource();
  wallet.snapshot.solPriceUsd = null;
  const missingSol = portfolioOverviewResponseSchema.parse(await portfolioService({ wallet }).service.getOverview(identity()));
  assert.equal(missingSol.cashBalances.find((balance) => balance.symbol === 'SOL')?.marketValueUsd.amount, null);
  assert.equal(missingSol.equity.cash.amount, null);
  assert.equal(missingSol.equity.netAccountEquity.amount, null);
  assert.ok(missingSol.warnings.some((warning) => warning.code === 'SOL_PRICE_UNAVAILABLE'));

  const phoenix = new FakePhoenixSource();
  phoenix.snapshot = phoenixSnapshot({
    valuationComplete: false,
    accountEquityUsd: null,
    grossExposureUsd: null,
    unrealizedPnlUsd: null,
    positions: [{ ...phoenixSnapshot().positions[0]!, markPriceUsd: null, notionalUsd: null, unrealizedPnlUsd: null }],
  });
  const missingMark = portfolioPositionsResponseSchema.parse(await portfolioService({ phoenix }).service.getPositions(identity()));
  assert.equal(missingMark.summary.unrealizedPnlUsd.amount, null);
  assert.equal(missingMark.summary.grossExposureUsd.amount, null);
  assert.equal(missingMark.openPositions[0]?.dataState, 'unavailable');
  assert.ok(missingMark.warnings.some((warning) => warning.code === 'PHOENIX_MARKS_UNAVAILABLE'));
});

test('an uninitialized Phoenix account preserves wallet equity and exposes onboarding', async () => {
  const phoenix = new FakePhoenixSource();
  phoenix.snapshot = phoenixSnapshot({
    accountState: 'not_initialized', accountEquityUsd: 0, collateralUsd: 0,
    grossExposureUsd: 0, unrealizedPnlUsd: 0, positions: [], orders: [],
  });
  const service = portfolioService({ phoenix }).service;
  const overview = portfolioOverviewResponseSchema.parse(await service.getOverview(identity()));
  const positions = portfolioPositionsResponseSchema.parse(await service.getPositions(identity()));
  assert.equal(overview.perpetuals.accountState, 'not_initialized');
  assert.deepEqual(overview.perpetuals.registration, { feePayer: 'user_wallet', mode: 'non_referral' });
  assert.equal(overview.equity.perpetualEquity.amount, 0);
  assert.ok(Math.abs((overview.equity.netAccountEquity.amount ?? 0) - 421.913578) < 1e-9);
  assert.equal(positions.summary.unrealizedPnlUsd.amount, 0);
  assert.equal(positions.summary.grossExposureUsd.amount, 0);
  assert.deepEqual(positions.openPositions, []);
  assert.deepEqual(positions.openOrders, []);
  assert.ok(!overview.warnings.some((warning) => warning.section === 'perpetuals'));

  const emptyWallet = new FakeWalletSource();
  emptyWallet.snapshot = { ...emptyWallet.snapshot, solLamports: '0', tokens: [] };
  const newWallet = portfolioOverviewResponseSchema.parse(await portfolioService({ phoenix, wallet: emptyWallet }).service.getOverview(identity()));
  assert.equal(newWallet.wallet.supportedAssetState, 'empty');
  assert.equal(newWallet.perpetuals.accountState, 'not_initialized');
  assert.deepEqual(newWallet.perpetuals.registration, { feePayer: 'user_wallet', mode: 'non_referral' });
  assert.equal(newWallet.equity.netAccountEquity.amount, 0);
  assert.ok(!newWallet.warnings.some((warning) => warning.section === 'perpetuals'));
});

test('Portfolio distinguishes empty, unsupported-only, and unclassified wallet balances', async () => {
  const emptyWallet = new FakeWalletSource();
  emptyWallet.snapshot = { ...emptyWallet.snapshot, solLamports: '0', tokens: [] };
  const empty = portfolioOverviewResponseSchema.parse(await portfolioService({ wallet: emptyWallet }).service.getOverview(identity()));
  assert.equal(empty.wallet.supportedAssetState, 'empty');

  const unsupportedWallet = new FakeWalletSource();
  unsupportedWallet.snapshot = {
    ...unsupportedWallet.snapshot,
    solLamports: '0',
    tokens: [{ mint: UNKNOWN_MINT, rawAmount: '1', decimals: 0 }],
  };
  const unsupported = portfolioOverviewResponseSchema.parse(await portfolioService({ wallet: unsupportedWallet }).service.getOverview(identity()));
  assert.equal(unsupported.wallet.supportedAssetState, 'unsupported_only');

  const unclassified = portfolioOverviewResponseSchema.parse(await portfolioService({
    registryFailure: true,
    wallet: unsupportedWallet,
  }).service.getOverview(identity()));
  assert.equal(unclassified.wallet.supportedAssetState, 'unavailable');
});

test('Phoenix registration metadata selects referral mode without changing account state', async () => {
  const phoenix = new FakePhoenixSource();
  phoenix.snapshot = phoenixSnapshot({
    accountState: 'not_initialized', accountEquityUsd: 0, collateralUsd: 0,
    grossExposureUsd: 0, unrealizedPnlUsd: 0, positions: [], orders: [],
  });
  const parsed = portfolioOverviewResponseSchema.parse(await portfolioService({
    phoenix,
    phoenixRegistrationMode: 'referral',
  }).service.getOverview(identity()));
  assert.deepEqual(parsed.perpetuals.registration, { feePayer: 'user_wallet', mode: 'referral' });
});

test('an initialized but empty Phoenix account remains valid zero data without onboarding', async () => {
  const phoenix = new FakePhoenixSource();
  phoenix.snapshot = phoenixSnapshot({ accountEquityUsd: 0, collateralUsd: 0, grossExposureUsd: 0, unrealizedPnlUsd: 0, positions: [], orders: [] });
  const parsed = portfolioPositionsResponseSchema.parse(await portfolioService({ phoenix }).service.getPositions(identity()));
  assert.equal(parsed.perpetuals.accountState, 'ready');
  assert.equal(parsed.perpetuals.registration, null);
  assert.equal(parsed.summary.unrealizedPnlUsd.amount, 0);
  assert.equal(parsed.summary.grossExposureUsd.amount, 0);
  assert.ok(!parsed.warnings.some((warning) => warning.section === 'perpetuals'));
});

test('activity merges Warren, Helius, and Phoenix records with dedupe, filters, cursor boundaries, and user isolation', async () => {
  const executions = new MemoryExecutionIntentStore();
  const sameSignature = '5'.repeat(88);
  executions.save(spotIntent({ executionId: '11111111-1111-4111-8111-111111111111', signature: sameSignature }));
  executions.save(spotIntent({
    executionId: '22222222-2222-4222-8222-222222222222',
    userId: 'did:privy:other',
    walletAddress: OTHER_WALLET,
    signature: '6'.repeat(88),
  }));
  const env = portfolioService({ executions });
  env.wallet.transfers = [
    transfer({ signature: sameSignature, mint: NVDA_MINT, blockTime: '2026-09-23T09:59:00.000Z' }),
    transfer({ signature: '7'.repeat(88), mint: NVDA_MINT, blockTime: '2026-09-23T09:58:00.000Z' }),
    transfer({ signature: '2'.repeat(88), mint: NVDA_MINT, blockTime: '2026-09-23T09:58:00.000Z', confirmationStatus: 'unknown' }),
    transfer({ signature: '8'.repeat(88), mint: UNKNOWN_MINT, blockTime: '2026-09-23T09:57:00.000Z' }),
  ];
  env.phoenix.trades = [{
    activityId: 'phoenix-trade:10:0:0', marketSymbol: 'NVDA', occurredAt: '2026-09-23T09:56:00.000Z',
    quantity: '0.25', priceUsd: 200, realizedPnlUsd: 0, signature: '9'.repeat(88), instructionType: 'fill',
    baseLotsBefore: '0', baseLotsAfter: '250000',
  }, {
    activityId: 'phoenix-trade:10:0:1', marketSymbol: 'NVDA', occurredAt: '2026-09-23T09:55:30.000Z',
    quantity: '-0.0002', priceUsd: 201, realizedPnlUsd: 1, signature: '1'.repeat(88), instructionType: 'fill',
    baseLotsBefore: '100', baseLotsAfter: '-100',
  }, {
    activityId: 'phoenix-trade:11:0:0', marketSymbol: 'BTC', occurredAt: '2026-09-23T09:54:00.000Z',
    quantity: '1', priceUsd: 50_000, realizedPnlUsd: 0, signature: '3'.repeat(88), instructionType: 'fill',
    baseLotsBefore: '0', baseLotsAfter: '1',
  }];
  env.phoenix.funding = [{
    activityId: 'phoenix-funding:1', marketSymbol: 'NVDA', occurredAt: '2026-09-23T09:55:00.000Z',
    paymentUsd: -1.25, ratePercent: 0.01, positionSide: 'long',
  }];

  const first = portfolioActivityResponseSchema.parse(await env.service.getActivity(identity(), {
    walletAddress: undefined, limit: 2, kind: 'all', status: 'all', query: undefined, cursor: undefined,
  }));
  assert.equal(first.items.length, 2);
  assert.equal(first.items[0]?.activityId, 'warren:11111111-1111-4111-8111-111111111111');
  assert.equal(first.items.filter((item) => item.signature === sameSignature).length, 1);
  assert.ok(!first.items.some((item) => item.executionId === '22222222-2222-4222-8222-222222222222'));
  assert.ok(first.pageInfo.nextCursor);

  const second = portfolioActivityResponseSchema.parse(await env.service.getActivity(identity(), {
    walletAddress: undefined, limit: 10, kind: 'all', status: 'all', query: undefined, cursor: first.pageInfo.nextCursor ?? undefined,
  }));
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.activityId)).size, first.items.length + second.items.length);
  assert.ok(second.items.some((item) => item.kind === 'perpetual'));
  assert.ok(second.items.some((item) => item.kind === 'funding'));
  assert.ok(second.items.some((item) => item.title === 'Reversed NVIDIA position'));
  assert.ok(![...first.items, ...second.items].some((item) => item.signature === '8'.repeat(88)));
  assert.ok(![...first.items, ...second.items].some((item) => item.symbol === 'BTC'));
  assert.equal([...first.items, ...second.items].find((item) => item.signature === '2'.repeat(88))?.status, 'unknown');

  const filtered = portfolioActivityResponseSchema.parse(await env.service.getActivity(identity(), {
    walletAddress: undefined, limit: 20, kind: 'transfers', status: 'confirmed', query: 'NVDA', cursor: undefined,
  }));
  assert.equal(filtered.items.length, 1);
  assert.equal(filtered.items[0]?.action, 'received');

  await assert.rejects(
    env.service.getActivity(identity(), { walletAddress: undefined, limit: 20, kind: 'all', status: 'all', query: undefined, cursor: 'not-a-cursor' }),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'INVALID_CURSOR',
  );
});

test('native SOL transfers remain visible while an inaccessible Phoenix history degrades silently', async () => {
  const phoenix = new FakePhoenixSource();
  phoenix.failActivity = true;
  const env = portfolioService({ phoenix });
  env.wallet.transfers = [transfer({
    signature: '4'.repeat(88),
    mint: NATIVE_SOL_MINT,
    rawAmount: '125000000',
    decimals: 9,
    quantity: '0.125',
  })];

  const parsed = portfolioActivityResponseSchema.parse(await env.service.getActivity(identity(), {
    walletAddress: undefined, limit: 20, kind: 'all', status: 'all', query: undefined, cursor: undefined,
  }));

  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0]?.title, 'SOL received');
  assert.equal(parsed.items[0]?.symbol, 'SOL');
  assert.equal(parsed.items[0]?.productType, 'cash');
  assert.equal(parsed.items[0]?.quantity, '0.125');
  assert.equal(parsed.warnings.some((warning) => warning.code === 'PERPETUAL_ACTIVITY_UNAVAILABLE'), false);
});

test('portfolio HTTP routes require Privy auth and return contract-shaped private responses', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'warren-portfolio-api-'));
  const config = readConfig({
    NODE_ENV: 'test',
    DATABASE_URL: `file:${join(directory, 'test.db')}`,
    AUTH_DOMAIN: 'warren.test',
    AUTH_URI: 'https://warren.test',
  });
  const db = openDatabase(config.DATABASE_URL);
  const { service } = portfolioService();
  const verifier: ExecutionIdentityVerifier = {
    async verify(token: string) {
      if (token !== 'valid-privy-token') throw new Error('invalid token');
      return { userId: 'did:privy:owner', walletAddresses: [WALLET] };
    },
  };
  const app = buildApp({ config, db, portfolioService: service, executionIdentityVerifier: verifier });
  try {
    const unauthorized = await app.inject({ method: 'GET', url: '/v1/portfolio/overview' });
    assert.equal(unauthorized.statusCode, 401);
    assert.equal(unauthorized.json().error.code, 'AUTH_REQUIRED');

    const authorized = await app.inject({
      method: 'GET', url: '/v1/portfolio/overview', headers: { authorization: 'Bearer valid-privy-token' },
    });
    assert.equal(authorized.statusCode, 200);
    portfolioOverviewResponseSchema.parse(authorized.json());
    assert.equal(authorized.headers['cache-control'], 'no-store');

    const positions = await app.inject({
      method: 'GET', url: '/v1/portfolio/positions', headers: { authorization: 'Bearer valid-privy-token' },
    });
    assert.equal(positions.statusCode, 200);
    portfolioPositionsResponseSchema.parse(positions.json());

    const wrongWallet = await app.inject({
      method: 'GET',
      url: `/v1/portfolio/overview?walletAddress=${encodeURIComponent(OTHER_WALLET)}`,
      headers: { authorization: 'Bearer valid-privy-token' },
    });
    assert.equal(wrongWallet.statusCode, 403);
    assert.equal(wrongWallet.json().error.code, 'WALLET_MISMATCH');

    const activity = await app.inject({
      method: 'GET', url: '/v1/portfolio/activity?limit=0', headers: { authorization: 'Bearer valid-privy-token' },
    });
    assert.equal(activity.statusCode, 400);
    assert.equal(activity.json().error.code, 'INVALID_REQUEST');
  } finally {
    await app.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Helius adapter aggregates token accounts with integer precision and parses wallet balances', async () => {
  const source = new HeliusPortfolioSource({
    rpcUrl: 'https://helius.test',
    timeoutMs: 1_000,
    fetch: async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
      if (request.method === 'getBalance') return rpc({ value: 42 });
      if (request.method === 'getAsset') return rpc({ token_info: { price_info: { price_per_token: 151.25 } } });
      const program = (request.params[1] as { programId: string }).programId;
      const rows = program.startsWith('Tokenkeg')
        ? [tokenAccount(NVDA_MINT, '9007199254740993', 6), tokenAccount(NVDA_MINT, '7', 6)]
        : [tokenAccount(ANTHROPIC_MINT, '123', 2)];
      return rpc({ value: rows });
    },
  });
  const result = await source.loadWallet(WALLET);
  assert.equal(result.solLamports, '42');
  assert.equal(result.solPriceUsd, 151.25);
  assert.equal(result.tokens.find((token) => token.mint === NVDA_MINT)?.rawAmount, '9007199254741000');
  assert.equal(result.tokens.find((token) => token.mint === ANTHROPIC_MINT)?.rawAmount, '123');
});

test('Helius adapter rejects native balances that cannot be represented exactly', async () => {
  const source = new HeliusPortfolioSource({
    rpcUrl: 'https://helius.test',
    timeoutMs: 1_000,
    fetch: async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { method: string };
      if (request.method === 'getBalance') return rpc({ value: Number.MAX_SAFE_INTEGER + 1 });
      if (request.method === 'getAsset') return rpc({});
      return rpc({ value: [] });
    },
  });
  await assert.rejects(source.loadWallet(WALLET));
});

test('Helius transfer history preserves cursor state and exact supported-token amounts', async () => {
  const source = new HeliusPortfolioSource({
    rpcUrl: 'https://helius.test',
    timeoutMs: 1_000,
    fetch: async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { method: string };
      assert.equal(request.method, 'getTransfersByAddress');
      return rpc({
        data: [{
          signature: '7'.repeat(88), blockTime: 1_790_168_000, fromUserAccount: OTHER_WALLET,
          toUserAccount: WALLET, mint: NVDA_MINT, amount: '1234567', decimals: 6,
          uiAmount: '999.999', confirmationStatus: 'finalized',
        }],
        paginationToken: null,
      });
    },
  });
  const result = await source.loadTransfers({ address: WALLET, limit: 20, maxPages: 2 });
  assert.equal(result.exhausted, true);
  assert.equal(result.items[0]?.rawAmount, '1234567');
  assert.equal(result.items[0]?.quantity, '1.234567');
  assert.equal(result.items[0]?.confirmationStatus, 'finalized');
});

test('Helius pagination continues past unrelated tokens and signature-status reads are safely batched', async () => {
  let transferCalls = 0;
  let statusCalls = 0;
  const source = new HeliusPortfolioSource({
    rpcUrl: 'https://helius.test',
    timeoutMs: 1_000,
    fetch: async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
      if (request.method === 'getSignatureStatuses') {
        statusCalls += 1;
        const signatures = request.params[0] as string[];
        assert.ok(signatures.length <= 256);
        return rpc({ value: signatures.map(() => ({ err: null, confirmationStatus: 'confirmed' })) });
      }
      transferCalls += 1;
      if (transferCalls === 1) return rpc({
        data: [{
          signature: '3'.repeat(88), blockTime: 1_790_168_000, fromUserAccount: OTHER_WALLET,
          toUserAccount: WALLET, mint: UNKNOWN_MINT, amount: '1', decimals: 0, uiAmount: '1', confirmationStatus: 'finalized',
        }],
        paginationToken: 'next-page',
      });
      return rpc({
        data: [{
          signature: '4'.repeat(88), blockTime: 1_790_167_999, fromUserAccount: OTHER_WALLET,
          toUserAccount: WALLET, mint: NVDA_MINT, amount: '1000000', decimals: 6, uiAmount: '1', confirmationStatus: 'finalized',
        }],
        paginationToken: null,
      });
    },
  });
  const transfers = await source.loadTransfers({
    address: WALLET, limit: 1, maxPages: 2, mintAllowlist: [NVDA_MINT],
  });
  assert.equal(transferCalls, 2);
  assert.equal(transfers.items[0]?.mint, NVDA_MINT);

  const signatures = Array.from({ length: 300 }, (_, index) => `signature-${index}`);
  const states = await source.getSignatureStates(signatures);
  assert.equal(statusCalls, 2);
  assert.equal(states.size, 300);
});

test('Phoenix activity scales base lots into asset quantity before reaching Portfolio', async () => {
  const source = new PhoenixPortfolioSource({
    baseUrl: 'https://phoenix.test',
    timeoutMs: 1_000,
    fetch: async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/auth/login/privy')) return json({ access_token: 'phoenix-session' });
      if (url.includes('/v1/trader/state/')) return json(readyTraderState());
      if (url.endsWith('/v1/view/exchange/markets')) return json([{ symbol: 'NVDA', baseLotsDecimals: 6 }]);
      if (url.includes('/trades-history')) return json({
        data: [{
          marketSymbol: 'NVDA', timestamp: '2026-09-23T09:56:00.000Z', slot: 10, slotIndex: 0, eventIndex: 0,
          instructionType: 'fill', baseLotsBefore: '0', baseLotsAfter: '250000', baseLotsDelta: '250000',
          price: '200', realizedPnl: '0', signature: '9'.repeat(88),
        }],
        hasMore: false,
        nextCursor: null,
      });
      return json({ events: [], hasMore: false, nextCursor: null });
    },
  });
  const result = await source.loadActivity({ privyToken: 'privy-token', walletAddress: WALLET, limit: 20, maxPages: 2 });
  assert.equal(result.trades[0]?.quantity, '0.25');
});

test('Phoenix funding activity IDs stay stable when the provider page shape changes', async () => {
  const older = {
    timestamp: '2026-09-23T09:55:00.000Z', symbol: 'NVDA', fundingPayment: '-1.25',
    fundingRatePercentage: '0.01', positionSize: '5', positionSide: 'long',
  };
  const newer = { ...older, timestamp: '2026-09-23T09:56:00.000Z', fundingPayment: '0.25' };
  const source = new PhoenixPortfolioSource({
    baseUrl: 'https://phoenix.test',
    timeoutMs: 1_000,
    fetch: async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/auth/login/privy')) return json({ access_token: 'phoenix-session' });
      if (url.includes('/v1/trader/state/')) return json(readyTraderState());
      if (url.endsWith('/v1/view/exchange/markets')) return json([{ symbol: 'NVDA', baseLotsDecimals: 6 }]);
      if (url.includes('/trades-history')) return json({ data: [], hasMore: false, nextCursor: null });
      return json({
        events: url.includes('endTime=') ? [older] : [newer, older],
        hasMore: false,
        nextCursor: null,
      });
    },
  });

  const full = await source.loadActivity({ privyToken: 'privy-token', walletAddress: WALLET, limit: 20, maxPages: 2 });
  const bounded = await source.loadActivity({
    privyToken: 'privy-token', walletAddress: WALLET, before: older.timestamp, limit: 20, maxPages: 2,
  });
  assert.equal(full.funding.find((event) => event.occurredAt === older.timestamp)?.activityId, bounded.funding[0]?.activityId);
});

test('Phoenix adapter maps an explicit uninitialized capability without attempting login', async () => {
  let loginRequests = 0;
  const source = new PhoenixPortfolioSource({
    baseUrl: 'https://phoenix.test',
    timeoutMs: 1_000,
    fetch: async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/auth/login/privy')) {
        loginRequests += 1;
        return new Response(JSON.stringify({ error: 'must not authenticate' }), { status: 401 });
      }
      if (url.includes('/v1/trader/state/')) return json(uninitializedTraderState());
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const result = await source.loadAccount(WALLET);
  assert.equal(result.accountState, 'not_initialized');
  assert.equal(loginRequests, 0);
  assert.equal(result.accountEquityUsd, 0);
  assert.deepEqual(result.positions, []);
  assert.deepEqual(result.orders, []);
});

test('Phoenix adapter treats a public trader-state 404 as a confirmed missing account', async () => {
  const source = new PhoenixPortfolioSource({
    baseUrl: 'https://phoenix.test',
    timeoutMs: 1_000,
    fetch: async () => new Response(JSON.stringify({ error: 'account missing' }), { status: 404, headers: { 'content-type': 'application/json' } }),
  });
  const result = await source.loadAccount(WALLET);
  assert.equal(result.accountState, 'not_initialized');
  assert.equal(result.accountEquityUsd, 0);
});

test('Phoenix activity returns a clean empty history for an uninitialized account without attempting login', async () => {
  const requests: string[] = [];
  const source = new PhoenixPortfolioSource({
    baseUrl: 'https://phoenix.test',
    timeoutMs: 1_000,
    fetch: async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.includes('/v1/trader/state/')) {
        return new Response(JSON.stringify({ error: 'account missing' }), { status: 404, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: 'must not authenticate' }), { status: 401 });
    },
  });
  const result = await source.loadActivity({ privyToken: 'privy-token', walletAddress: WALLET, limit: 20, maxPages: 2 });
  assert.deepEqual(result, { trades: [], funding: [], exhausted: true });
  assert.equal(requests.length, 1);
  assert.match(requests[0]!, /\/v1\/trader\/state\//);
});

test('Phoenix adapter keeps an initialized empty account ready rather than onboarding it', async () => {
  const source = new PhoenixPortfolioSource({
    baseUrl: 'https://phoenix.test',
    timeoutMs: 1_000,
    fetch: async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/auth/login/privy')) return json({ access_token: 'phoenix-session' });
      if (url.includes('/v1/trader/state/')) return json(readyTraderState());
      if (url.endsWith('/v1/view/exchange/markets')) return json([]);
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const result = await source.loadAccount(WALLET);
  assert.equal(result.accountState, 'ready');
  assert.equal(result.accountEquityUsd, 0);
  assert.deepEqual(result.positions, []);
  assert.deepEqual(result.orders, []);
});

test('Phoenix adapter accepts a slot-indexed snapshot without a top-level trader PDA index', async () => {
  const source = new PhoenixPortfolioSource({
    baseUrl: 'https://phoenix.test',
    timeoutMs: 1_000,
    fetch: async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/auth/login/privy')) return json({ access_token: 'phoenix-session' });
      if (url.includes('/v1/trader/state/')) return json({
        authority: WALLET,
        slot: 123,
        slotIndex: 4,
        snapshot: {
          capabilities: { state: 'active' },
          subaccounts: [{
            subaccountIndex: 0,
            collateral: '100',
            positions: [{ symbol: 'NVDA', positionSequenceNumber: '1', basePositionLots: '1000000' }],
            orders: [],
          }],
        },
      });
      if (url.endsWith('/v1/view/exchange/markets')) return json([{ symbol: 'NVDA', baseLotsDecimals: 6 }]);
      if (url.includes('/mark-price')) return json({ markPrice: { price: 200 } });
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const result = await source.loadAccount(WALLET);
  assert.equal(result.accountState, 'ready');
  assert.equal(result.positions[0]?.traderPdaIndex, 0);
  assert.equal(result.positions[0]?.entryPriceUsd, null);
  assert.equal(result.positions[0]?.markPriceUsd, 200);
  assert.equal(result.valuationComplete, false);
  assert.equal(result.accountEquityUsd, null);
});

test('Phoenix authorization errors and malformed financial values fail closed', async () => {
  const forbidden = new PhoenixPortfolioSource({
    baseUrl: 'https://phoenix.test', timeoutMs: 1_000,
    fetch: async () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
  });
  await assert.rejects(forbidden.loadAccount(WALLET), /\/v1\/trader\/state\//);

  let loginRequests = 0;
  const publicAccount = new PhoenixPortfolioSource({
    baseUrl: 'https://phoenix.test', timeoutMs: 1_000,
    fetch: async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/auth/login/privy')) {
        loginRequests += 1;
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
      }
      if (url.includes('/v1/trader/state/')) return json(readyTraderState());
      if (url.endsWith('/v1/view/exchange/markets')) return json([]);
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  assert.equal((await publicAccount.loadAccount(WALLET)).accountState, 'ready');
  assert.equal(loginRequests, 0);

  const unreachable = new PhoenixPortfolioSource({
    baseUrl: 'https://phoenix.test', timeoutMs: 1_000,
    fetch: async () => { throw new Error('network down'); },
  });
  await assert.rejects(unreachable.loadAccount(WALLET));

  const malformedAccount = new PhoenixPortfolioSource({
    baseUrl: 'https://phoenix.test', timeoutMs: 1_000,
    fetch: async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/auth/login/privy')) return json({ access_token: 'phoenix-session' });
      if (url.includes('/v1/trader/state/')) return json({
        traderPdaIndex: 0,
        snapshot: { subaccounts: [{ subaccountIndex: 0, collateral: 'not-a-number', positions: [], orders: [] }] },
      });
      if (url.endsWith('/v1/view/exchange/markets')) return json([{ symbol: 'NVDA', baseLotsDecimals: 6 }]);
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  await assert.rejects(malformedAccount.loadAccount(WALLET));

  const malformedFunding = new PhoenixPortfolioSource({
    baseUrl: 'https://phoenix.test', timeoutMs: 1_000,
    fetch: async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/auth/login/privy')) return json({ access_token: 'phoenix-session' });
      if (url.includes('/v1/trader/state/')) return json(readyTraderState());
      if (url.endsWith('/v1/view/exchange/markets')) return json([{ symbol: 'NVDA', baseLotsDecimals: 6 }]);
      if (url.includes('/trades-history')) return json({ data: [], hasMore: false, nextCursor: null });
      return json({
        events: [{ timestamp: NOW, symbol: 'NVDA', fundingPayment: 'bad', fundingRatePercentage: '0.01', positionSize: '1', positionSide: 'long' }],
        hasMore: false,
        nextCursor: null,
      });
    },
  });
  await assert.rejects(malformedFunding.loadActivity({ privyToken: 'privy-token', walletAddress: WALLET, limit: 20, maxPages: 2 }));
});

test('Phoenix mark outages preserve positions but withhold aggregate valuation', async () => {
  const source = new PhoenixPortfolioSource({
    baseUrl: 'https://phoenix.test', timeoutMs: 1_000,
    fetch: async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/auth/login/privy')) return json({ access_token: 'phoenix-session' });
      if (url.endsWith('/v1/view/exchange/markets')) return json([{ symbol: 'NVDA', baseLotsDecimals: 6 }]);
      if (url.includes('/mark-price')) return new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 });
      return json({
        traderPdaIndex: 0,
        snapshot: { subaccounts: [{
          subaccountIndex: 1, collateral: '100', orders: [],
          positions: [{ symbol: 'NVDA', positionSequenceNumber: '1', basePositionLots: '1000000', entryPriceUsd: '200' }],
        }] },
      });
    },
  });
  const result = await source.loadAccount(WALLET);
  assert.equal(result.positions.length, 1);
  assert.equal(result.positions[0]?.markPriceUsd, null);
  assert.equal(result.valuationComplete, false);
  assert.equal(result.accountEquityUsd, null);
  assert.equal(result.grossExposureUsd, null);
});

function registry(): MarketInstrument[] {
  return [spot(), prestock(), perpetual()];
}

function spot(): SpotInstrument {
  return {
    instrumentId: 'spot:xstocks:nvidia', assetId: 'nvidia', companyName: 'NVIDIA', ticker: 'NVDA', logoUrl: null,
    symbol: 'NVDAx', provider: 'xStocks', providerUrl: 'https://xstocks.test', exactIdentifier: NVDA_MINT,
    verificationState: 'verified', availability: 'available', description: 'NVIDIA tokenized stock',
    marketValue: moneyValue(2), productType: 'spot', network: 'Solana', issuer: 'xStocks', mint: NVDA_MINT,
    stockVariantTier: 'share_redeemable', changePercent: metric(3.5), volume24hUsd: metric(100_000), liquidityUsd: 50_000,
  };
}

function prestock(): PrestockInstrument {
  return {
    instrumentId: 'prestock:prestocks:anthropic', assetId: 'anthropic', companyName: 'Anthropic', ticker: null, logoUrl: null,
    symbol: 'ANTHROPIC', provider: 'PreStocks', providerUrl: 'https://prestocks.test', exactIdentifier: ANTHROPIC_MINT,
    verificationState: 'verified', availability: 'available', description: 'Anthropic private exposure',
    marketValue: { label: 'Provider value', amount: 10, currency: 'USD', asOf: null, dataState: 'unavailable' },
    productType: 'prestock', network: 'Solana', mint: ANTHROPIC_MINT, exposureType: 'spv_exposure',
    structureLabel: 'Provider-described SPV exposure', markPrice: 10, tokenPrice: 10,
    impliedValuation: null, markValuation: null, supply: null, transferFeeBps: null,
    detailsUrl: 'https://prestocks.test/anthropic',
  };
}

function perpetual(): PerpetualInstrument {
  return {
    instrumentId: 'perpetual:phoenix:nvda', assetId: 'nvidia', companyName: 'NVIDIA', ticker: 'NVDA', logoUrl: null,
    symbol: 'NVDA', provider: 'Phoenix', providerUrl: 'https://phoenix.test', exactIdentifier: Keypair.generate().publicKey.toBase58(),
    verificationState: 'verified', availability: 'available', description: 'NVIDIA perpetual', marketValue: moneyValue(200),
    productType: 'perpetual', venue: 'Phoenix', marketPubkey: Keypair.generate().publicKey.toBase58(), marginMode: 'isolated',
    maxLeverage: 20, fundingRatePercent: metric(0.01), nextFundingAt: '2026-09-23T11:00:00.000Z', openInterestBase: 1_000,
    oracleLabel: 'NVDA/USD',
  };
}

function phoenixSnapshot(overrides: Partial<PhoenixPortfolioSnapshot> = {}): PhoenixPortfolioSnapshot {
  return {
    accountState: 'ready',
    observedAt: NOW,
    valuationComplete: true,
    collateralUsd: 1_000,
    accountEquityUsd: 1_050,
    grossExposureUsd: 5_000,
    unrealizedPnlUsd: 50,
    positions: [{
      marketSymbol: 'NVDA', traderPdaIndex: 0, subaccountIndex: 2, positionSequenceNumber: '3', quantity: '25',
      entryPriceUsd: 198, markPriceUsd: 200, collateralUsd: 1_000, notionalUsd: 5_000, unrealizedPnlUsd: 50, leverage: 5,
    }],
    orders: [{
      marketSymbol: 'NVDA', traderPdaIndex: 0, subaccountIndex: 2, orderSequenceNumber: '7', side: 'bid', orderType: 'limit',
      priceUsd: 190, quantity: '2', reduceOnly: false, status: 'open',
    }],
    ...overrides,
  };
}

function readyTraderState() {
  return {
    traderPdaIndex: 0,
    snapshot: {
      capabilities: { state: 'initialized' },
      subaccounts: [],
    },
  };
}

function uninitializedTraderState() {
  return {
    traderPdaIndex: 0,
    snapshot: {
      capabilities: { state: 'uninitialized' },
      subaccounts: [],
    },
  };
}

function spotIntent(overrides: Partial<ExecutionIntent> = {}): ExecutionIntent {
  return {
    kind: 'spot', executionId: '11111111-1111-4111-8111-111111111111', userId: 'did:privy:owner', walletAddress: WALLET,
    assetId: 'nvidia', instrumentId: 'spot:xstocks:nvidia', companyName: 'NVIDIA', symbol: 'NVDAx', direction: 'buy',
    unsignedTransaction: 'unsigned', providerRequestId: 'provider-request', lastValidBlockHeight: 1,
    expiresAt: '2026-09-23T10:01:00.000Z', createdAt: '2026-09-23T09:58:30.000Z', updatedAt: '2026-09-23T09:59:00.000Z',
    state: 'confirmed', signature: '5'.repeat(88), valueUsd: 100, quantity: '0.5',
    ...overrides,
  } as ExecutionIntent;
}

function transfer(overrides: Partial<WalletTransfer> = {}): WalletTransfer {
  return {
    signature: '7'.repeat(88), blockTime: '2026-09-23T09:58:00.000Z', from: OTHER_WALLET, to: WALLET,
    mint: NVDA_MINT, rawAmount: '1000000', decimals: 6, quantity: '1', confirmationStatus: 'finalized', ...overrides,
  };
}

function moneyValue(amount: number) {
  return { label: 'Token price', amount, currency: 'USD' as const, asOf: NOW, dataState: 'live' as const };
}

function metric(value: number) {
  return { value, asOf: NOW, dataState: 'live' as const };
}

function tokenAccount(mint: string, amount: string, decimals: number) {
  return { account: { data: { parsed: { info: { mint, tokenAmount: { amount, decimals } } } } } };
}

function rpc(result: unknown) {
  return Promise.resolve(new Response(JSON.stringify({ jsonrpc: '2.0', id: 'test', result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
}

function json(result: unknown) {
  return Promise.resolve(new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
}
