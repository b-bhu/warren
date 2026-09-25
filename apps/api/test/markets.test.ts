import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { FastifyInstance } from 'fastify';
import {
  marketCompanyNewsResponseSchema,
  marketCompanyResponseSchema,
  marketHistoryResponseSchema,
  marketSearchResponseSchema,
  marketsApiErrorSchema,
  marketsResponseSchema,
  type MarketCompanyNewsItem,
  type MarketHistoryCapability,
  type MarketHistoryRange,
  type MarketInstrument,
  type PerpetualInstrument,
  type PrestockInstrument,
  type SpotInstrument,
} from '@warren/markets-contract';
import type { Config } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { MarketsService } from '../src/markets/service.js';
import {
  TokensMarketDetailsSource,
  type MarketCompanyIdentity,
  type MarketCompanyNewsSource,
  type MarketHistorySource,
} from '../src/markets/details-sources.js';
import {
  PhoenixPerpetualSource,
  PreStocksSource,
  TesseraSource,
  TokensSpotSource,
  type MarketsSource,
} from '../src/markets/sources.js';
import { buildApp } from '../src/server.js';

class TestSource implements MarketsSource {
  calls = 0;
  fail = false;

  constructor(readonly id: string, private readonly instruments: MarketInstrument[]) {}

  async load() {
    this.calls += 1;
    if (this.fail) throw new Error(`${this.id} raw failure`);
    return structuredClone(this.instruments);
  }
}

class TestDetailsSource implements MarketHistorySource, MarketCompanyNewsSource {
  readonly id = 'detail-test';
  historyCalls = 0;
  newsCalls = 0;
  failHistory = false;
  failNews = false;

  capability(instrument: MarketInstrument): MarketHistoryCapability | null {
    return instrument.productType === 'spot' && instrument.verificationState === 'verified'
      ? {
        instrumentId: instrument.instrumentId,
        valueLabel: instrument.marketValue.label,
        currency: 'USD',
        source: this.id,
        supportedRanges: ['1d', '1w', '1m'],
        defaultRange: '1m',
      }
      : null;
  }

  async loadHistory(_instrument: MarketInstrument, _range: MarketHistoryRange) {
    this.historyCalls += 1;
    if (this.failHistory) throw new Error('raw history failure');
    return {
      interval: '1H' as const,
      asOf: '2026-09-19T09:00:00.000Z',
      dataState: 'live' as const,
      points: [{
        time: '2026-09-19T09:00:00.000Z',
        open: 218,
        high: 223,
        low: 217,
        close: 220.56,
        volume: 10_000,
      }],
    };
  }

  async loadCompanyNews(company: MarketCompanyIdentity): Promise<MarketCompanyNewsItem[]> {
    this.newsCalls += 1;
    if (this.failNews) throw new Error('raw news failure');
    return [{
      id: `news:${company.assetId}`,
      assetId: company.assetId,
      headline: `${company.companyName} company update`,
      source: 'Test Wire',
      publishedAt: '2026-09-19T09:30:00.000Z',
      imageUrl: 'https://images.test/news.png',
      summary: null,
      url: `https://news.test/${company.assetId}`,
      dataState: 'live',
    }];
  }
}

function metric(value: number | null, asOf = '2026-09-19T09:59:00.000Z') {
  return value === null
    ? { value: null, asOf: null, dataState: 'unavailable' as const }
    : { value, asOf, dataState: 'live' as const };
}

function spot(overrides: Partial<SpotInstrument> = {}): SpotInstrument {
  return {
    instrumentId: 'spot:xstocks:nvidia',
    assetId: 'nvidia',
    companyName: 'NVIDIA',
    ticker: 'NVDA',
    logoUrl: 'https://images.test/nvidia.png',
    symbol: 'NVDAx',
    provider: 'xStocks',
    providerUrl: 'https://xstocks.test',
    exactIdentifier: 'NVDAx1111111111111111111111111111111111111',
    verificationState: 'verified',
    availability: 'available',
    description: 'NVIDIA tokenized stock exposure.',
    marketValue: { label: 'Token price', amount: 220.56, currency: 'USD', asOf: '2026-09-19T09:59:00.000Z', dataState: 'live' },
    productType: 'spot',
    network: 'Solana',
    issuer: 'xStocks',
    mint: 'NVDAx1111111111111111111111111111111111111',
    stockVariantTier: 'share_redeemable',
    changePercent: metric(2.38),
    volume24hUsd: metric(1_000_000),
    liquidityUsd: 500_000,
    ...overrides,
  };
}

function prestock(overrides: Partial<PrestockInstrument> = {}): PrestockInstrument {
  return {
    instrumentId: 'prestock:prestocks:anthropic',
    assetId: 'anthropic',
    companyName: 'Anthropic',
    ticker: null,
    logoUrl: 'https://images.test/anthropic.png',
    symbol: 'ANTHROPIC',
    provider: 'PreStocks',
    providerUrl: 'https://prestocks.test/anthropic',
    exactIdentifier: 'Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw',
    verificationState: 'verified',
    availability: 'available',
    description: 'Anthropic private-company exposure.',
    marketValue: { label: 'Provider token price', amount: 999.12, currency: 'USD', asOf: null, dataState: 'unavailable' },
    productType: 'prestock',
    network: 'Solana',
    mint: 'Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw',
    exposureType: 'spv_exposure',
    structureLabel: 'Provider-described SPV exposure',
    markPrice: 1_021.04,
    tokenPrice: 999.12,
    impliedValuation: 1_636_000_000_000,
    markValuation: 1_672_000_000_000,
    supply: 7_381,
    transferFeeBps: null,
    detailsUrl: 'https://prestocks.test/anthropic',
    ...overrides,
  };
}

function perpetual(overrides: Partial<PerpetualInstrument> = {}): PerpetualInstrument {
  return {
    instrumentId: 'perpetual:phoenix:nvda',
    assetId: 'nvidia-corporation',
    companyName: 'NVIDIA',
    ticker: 'NVDA',
    logoUrl: null,
    symbol: 'NVDA',
    provider: 'Phoenix',
    providerUrl: 'https://phoenix.trade',
    exactIdentifier: 'AzySnZQCNjkQMtm5ZDd2FjKYTjBoNb5Bv5Dsm3WyRkbj',
    verificationState: 'verified',
    availability: 'available',
    description: 'NVIDIA equity perpetual.',
    marketValue: { label: 'Mark price', amount: 222.22, currency: 'USD', asOf: '2026-09-19T09:00:00.000Z', dataState: 'live' },
    productType: 'perpetual',
    venue: 'Phoenix',
    marketPubkey: 'AzySnZQCNjkQMtm5ZDd2FjKYTjBoNb5Bv5Dsm3WyRkbj',
    marginMode: 'cross',
    maxLeverage: 20,
    fundingRatePercent: metric(-0.09, '2026-09-19T09:00:00.000Z'),
    nextFundingAt: '2026-09-19T10:00:00.000Z',
    openInterestBase: 480.9,
    oracleLabel: 'NVDA/USD index',
    ...overrides,
  };
}

function config(databaseFile: string, overrides: Partial<Config> = {}): Config {
  return {
    NODE_ENV: 'test', PORT: 0, DATABASE_URL: `file:${databaseFile}`, AUTH_DOMAIN: 'warren.test', AUTH_URI: 'https://warren.test',
    CHALLENGE_TTL_SECONDS: 900, ATTEMPT_TTL_SECONDS: 1200, ACCESS_TTL_SECONDS: 900, REFRESH_TTL_SECONDS: 2_592_000,
    SESSION_HMAC_PEPPER: 'test-only-pepper-with-at-least-24-characters', SESSION_RESULT_ENCRYPTION_KEY: 'test-only-result-encryption-key-at-least-32-chars',
    EVM_SUPPORTED_CHAIN_IDS: '1', SOLANA_SUPPORTED_CLUSTERS: 'devnet', CORS_ORIGINS: 'https://warren.test', RATE_LIMIT_MAX: 60, RATE_LIMIT_WINDOW_SECONDS: 60,
    TOKENS_API_BASE_URL: 'https://tokens.test', HOME_PROVIDER_TIMEOUT_MS: 5_000,
    HOME_CATALOG_CACHE_SECONDS: 60, HOME_CATALOG_STALE_SECONDS: 900, HOME_HTTP_CACHE_SECONDS: 15, HOME_HTTP_STALE_SECONDS: 60,
    PRESTOCKS_API_URL: 'https://prestocks.test/api/prestocks', PHOENIX_API_BASE_URL: 'https://phoenix.test',
    PRIVY_APP_ID: undefined, PRIVY_APP_SECRET: undefined, JUPITER_API_BASE_URL: 'https://api.jup.test', JUPITER_API_KEY: undefined,
    SOLANA_RPC_URL: 'https://rpc.solana.test', EXECUTION_PROVIDER_TIMEOUT_MS: 12_000, EXECUTION_INTENT_TTL_SECONDS: 90,
    MARKETS_PROVIDER_TIMEOUT_MS: 8_000, MARKETS_REGISTRY_CACHE_SECONDS: 60, MARKETS_REGISTRY_STALE_SECONDS: 900,
    MARKETS_HTTP_CACHE_SECONDS: 15, MARKETS_HTTP_STALE_SECONDS: 60,
    KAMINO_API_BASE_URL: 'https://kamino.test', KAMINO_MARKET_TIMEOUT_MS: 8_000, KAMINO_LENDING_ENABLED: 'false', KAMINO_LENDING_NEW_RISK_ENABLED: 'false',
    KAMINO_LENDING_REPAY_ENABLED: 'false', KAMINO_LENDING_WITHDRAW_ENABLED: 'false', KAMINO_BORROW_HEADROOM_BPS: 5_000,
    ...overrides,
  };
}

function setup(options: {
  sources?: MarketsSource[];
  detailsSource?: TestDetailsSource | null;
  now?: () => Date;
  config?: Partial<Config>;
  cacheTtlMs?: number;
  staleTtlMs?: number;
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'warren-markets-api-'));
  const sources = options.sources ?? [
    new TestSource('spot-test', [spot()]),
    new TestSource('prestock-test', [prestock()]),
    new TestSource('perp-test', [perpetual()]),
  ];
  const detailsSource = options.detailsSource === undefined ? new TestDetailsSource() : options.detailsSource;
  const service = new MarketsService({
    sources,
    historySource: detailsSource ?? undefined,
    newsSource: detailsSource ?? undefined,
    cacheTtlMs: options.cacheTtlMs ?? 60_000,
    staleTtlMs: options.staleTtlMs ?? 900_000,
    now: options.now ?? (() => new Date('2026-09-19T10:00:00.000Z')),
  });
  const apiConfig = config(join(directory, 'test.db'), options.config);
  const db = openDatabase(apiConfig.DATABASE_URL);
  const app = buildApp({ config: apiConfig, db, marketsService: service });
  return { app, service, sources, detailsSource, close: async () => { await app.close(); db.close(); rmSync(directory, { recursive: true, force: true }); } };
}

async function get(app: FastifyInstance, url: string, headers: Record<string, string> = {}) {
  const response = await app.inject({ method: 'GET', url, headers });
  return { response, body: response.payload ? response.json() as Record<string, any> : {} };
}

test('Markets list is public, schema-valid, grouped by product, cacheable, and conditionally revalidates', async () => {
  const env = setup();
  try {
    const first = await get(env.app, '/v1/markets?product=spot');
    assert.equal(first.response.statusCode, 200);
    const parsed = marketsResponseSchema.parse(first.body);
    assert.equal(parsed.query.product, 'spot');
    assert.equal(parsed.query.sort, 'activity');
    assert.deepEqual(parsed.counts, { spot: 1, prestock: 1, perpetual: 1 });
    assert.equal(parsed.items[0].productType, 'spot');
    assert.match(String(first.response.headers['cache-control']), /public, max-age=15/);
    const second = await get(env.app, '/v1/markets?product=spot', { 'if-none-match': String(first.response.headers.etag) });
    assert.equal(second.response.statusCode, 304);
  } finally { await env.close(); }
});

test('product filters and product-valid sorts are enforced', async () => {
  const sources = [new TestSource('all-products', [
    spot({ instrumentId: 'spot:nvda', volume24hUsd: metric(100) }),
    spot({ instrumentId: 'spot:apple', assetId: 'apple', companyName: 'Apple', ticker: 'AAPL', symbol: 'AAPLx', availability: 'preview', volume24hUsd: metric(500), changePercent: metric(-2) }),
    prestock(),
    perpetual(),
  ])];
  const env = setup({ sources });
  try {
    const available = await get(env.app, '/v1/markets?product=spot&availability=available');
    assert.deepEqual(available.body.items.map((item: MarketInstrument) => item.assetId), ['nvidia']);
    const change = await get(env.app, '/v1/markets?product=spot&sort=change');
    assert.deepEqual(change.body.items.map((item: MarketInstrument) => item.assetId), ['nvidia', 'apple']);
    for (const url of [
      '/v1/markets?product=prestock&sort=activity',
      '/v1/markets?product=perpetual&sort=change',
      '/v1/markets?product=crypto',
      '/v1/markets?limit=51',
    ]) {
      const invalid = await get(env.app, url);
      assert.equal(invalid.response.statusCode, 400);
      assert.equal(marketsApiErrorSchema.parse(invalid.body).error.code, 'INVALID_REQUEST');
    }
  } finally { await env.close(); }
});

test('global search returns one canonical company with grouped capabilities', async () => {
  const env = setup();
  try {
    const result = await get(env.app, '/v1/markets/search?q=nvda');
    const parsed = marketSearchResponseSchema.parse(result.body);
    assert.equal(parsed.items.length, 1);
    assert.equal(parsed.items[0].assetId, 'nvidia');
    assert.deepEqual(parsed.items[0].capabilities.map((capability) => capability.productType), ['spot', 'perpetual']);
    const symbol = await get(env.app, '/v1/markets/search?q=NVDAx');
    assert.equal(symbol.body.items[0].assetId, 'nvidia');
    const empty = await get(env.app, '/v1/markets/search?q=missing-company');
    assert.deepEqual(empty.body.items, []);
  } finally { await env.close(); }
});

test('company capability lookup groups instruments and returns a normalized 404', async () => {
  const env = setup();
  try {
    const result = await get(env.app, '/v1/markets/companies/nvidia');
    const parsed = marketCompanyResponseSchema.parse(result.body);
    assert.equal(parsed.company.companyName, 'NVIDIA');
    assert.equal(parsed.company.description?.source, 'xStocks');
    assert.equal(parsed.primaryInstrumentId, 'spot:xstocks:nvidia');
    assert.equal(parsed.hero?.value.label, 'Token price');
    assert.equal(parsed.hero?.provider, 'xStocks');
    assert.equal(parsed.history?.instrumentId, parsed.primaryInstrumentId);
    assert.equal(parsed.availableNow, 2);
    assert.deepEqual(parsed.instruments.map((instrument) => instrument.productType), ['spot', 'perpetual']);
    const signedInShape = marketCompanyResponseSchema.parse((await get(
      env.app,
      '/v1/markets/companies/nvidia',
      { authorization: 'Bearer intentionally-ignored-for-public-read' },
    )).body);
    assert.deepEqual(signedInShape, parsed);
    const missing = await get(env.app, '/v1/markets/companies/missing');
    assert.equal(missing.response.statusCode, 404);
    assert.equal(marketsApiErrorSchema.parse(missing.body).error.code, 'NOT_FOUND');
  } finally { await env.close(); }
});

test('company response contract rejects hero, history, ownership, and availability drift', async () => {
  const env = setup();
  try {
    const parsed = marketCompanyResponseSchema.parse((await get(env.app, '/v1/markets/companies/nvidia')).body);
    assert.equal(marketCompanyResponseSchema.safeParse({
      ...parsed,
      hero: parsed.hero ? { ...parsed.hero, value: { ...parsed.hero.value, label: 'Reference price' } } : null,
    }).success, false);
    assert.equal(marketCompanyResponseSchema.safeParse({
      ...parsed,
      history: parsed.history ? { ...parsed.history, instrumentId: 'spot:wrong:instrument' } : null,
    }).success, false);
    assert.equal(marketCompanyResponseSchema.safeParse({
      ...parsed,
      instruments: parsed.instruments.map((instrument, index) => index === 0
        ? { ...instrument, assetId: 'another-company' }
        : instrument),
    }).success, false);
    assert.equal(marketCompanyResponseSchema.safeParse({ ...parsed, availableNow: 0 }).success, false);
  } finally { await env.close(); }
});

test('hero selection is deterministic across Spot, PreStock-only, Perpetual-only, and missing values', async () => {
  const cases = [
    {
      name: 'Spot wins over every other available product',
      instruments: [perpetual(), prestock({ assetId: 'nvidia', companyName: 'NVIDIA' }), spot()],
      assetId: 'nvidia',
      expected: 'spot:xstocks:nvidia',
    },
    {
      name: 'PreStock value is used for a private company',
      instruments: [prestock()],
      assetId: 'anthropic',
      expected: 'prestock:prestocks:anthropic',
    },
    {
      name: 'Perpetual mark is used when it is the only value',
      instruments: [perpetual()],
      assetId: 'nvidia-corporation',
      expected: 'perpetual:phoenix:nvda',
    },
    {
      name: 'No value produces no primary hero',
      instruments: [prestock({
        marketValue: { label: 'Provider token price', amount: null, currency: 'USD', asOf: null, dataState: 'unavailable' },
      })],
      assetId: 'anthropic',
      expected: null,
    },
  ];

  for (const item of cases) {
    const env = setup({ sources: [new TestSource(item.name, item.instruments)] });
    try {
      const response = await get(env.app, `/v1/markets/companies/${item.assetId}`);
      const parsed = marketCompanyResponseSchema.parse(response.body);
      assert.equal(parsed.primaryInstrumentId, item.expected, item.name);
      assert.equal(parsed.hero?.instrumentId ?? null, item.expected, item.name);
      assert.equal(parsed.history === null, item.expected !== 'spot:xstocks:nvidia', item.name);
    } finally { await env.close(); }
  }
});

test('company history is exact-instrument, independently cacheable, and explicitly unavailable when unsupported', async () => {
  const detailsSource = new TestDetailsSource();
  const env = setup({ detailsSource });
  try {
    const path = '/v1/markets/companies/nvidia/history?instrumentId=spot%3Axstocks%3Anvidia&range=1w';
    const first = await get(env.app, path);
    assert.equal(first.response.statusCode, 200);
    const parsed = marketHistoryResponseSchema.parse(first.body);
    assert.equal(parsed.assetId, 'nvidia');
    assert.equal(parsed.instrumentId, 'spot:xstocks:nvidia');
    assert.equal(parsed.valueLabel, 'Token price');
    assert.equal(parsed.provider, 'detail-test');
    assert.equal(parsed.points.length, 1);
    assert.equal(detailsSource.historyCalls, 1);
    const cached = await get(env.app, path);
    marketHistoryResponseSchema.parse(cached.body);
    assert.equal(detailsSource.historyCalls, 1);

    const unsupported = await get(env.app, '/v1/markets/companies/nvidia/history?instrumentId=perpetual%3Aphoenix%3Anvda&range=1m');
    const unavailable = marketHistoryResponseSchema.parse(unsupported.body);
    assert.equal(unavailable.dataState, 'unavailable');
    assert.deepEqual(unavailable.points, []);
    assert.equal(unavailable.warnings.at(-1)?.section, 'history');
    assert.equal(unavailable.warnings.at(-1)?.retryable, false);

    const wrongInstrument = await get(env.app, '/v1/markets/companies/nvidia/history?instrumentId=spot%3Aunknown&range=1m');
    assert.equal(wrongInstrument.response.statusCode, 404);
    const invalidRange = await get(env.app, '/v1/markets/companies/nvidia/history?instrumentId=spot%3Axstocks%3Anvidia&range=all');
    assert.equal(invalidRange.response.statusCode, 400);
  } finally { await env.close(); }
});

test('company news is provider-associated while history and news failures remain section-local', async () => {
  const detailsSource = new TestDetailsSource();
  const env = setup({ detailsSource });
  try {
    const ready = await get(env.app, '/v1/markets/companies/nvidia/news');
    const parsed = marketCompanyNewsResponseSchema.parse(ready.body);
    assert.equal(parsed.items.length, 1);
    assert.equal(parsed.items[0].assetId, 'nvidia');
    assert.equal(detailsSource.newsCalls, 1);

    detailsSource.failNews = true;
    detailsSource.failHistory = true;
    env.service.clearCache();
    const newsFailure = marketCompanyNewsResponseSchema.parse((await get(env.app, '/v1/markets/companies/nvidia/news')).body);
    assert.deepEqual(newsFailure.items, []);
    assert.equal(newsFailure.warnings.at(-1)?.code, 'NEWS_UNAVAILABLE');
    assert.equal(newsFailure.warnings.at(-1)?.retryable, true);
    const historyFailure = marketHistoryResponseSchema.parse((await get(
      env.app,
      '/v1/markets/companies/nvidia/history?instrumentId=spot%3Axstocks%3Anvidia&range=1m',
    )).body);
    assert.deepEqual(historyFailure.points, []);
    assert.equal(historyFailure.warnings.at(-1)?.code, 'HISTORY_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify({ newsFailure, historyFailure }), /raw (news|history) failure/);

    const companyStillWorks = await get(env.app, '/v1/markets/companies/nvidia');
    assert.equal(companyStillWorks.response.statusCode, 200);
    marketCompanyResponseSchema.parse(companyStillWorks.body);
  } finally { await env.close(); }
});

test('pagination cursors are stable and bound to the selected view', async () => {
  const instruments = Array.from({ length: 5 }, (_, index) => spot({
    instrumentId: `spot:test:${index}`,
    assetId: `asset-${index}`,
    companyName: `Asset ${index}`,
    ticker: `A${index}`,
    symbol: `A${index}x`,
    volume24hUsd: metric(500 - index),
  }));
  const env = setup({ sources: [new TestSource('paging', instruments)] });
  try {
    const first = await get(env.app, '/v1/markets?product=spot&limit=2');
    assert.equal(first.body.items.length, 2);
    const second = await get(env.app, `/v1/markets?product=spot&limit=2&cursor=${first.body.pageInfo.nextCursor}`);
    assert.equal(second.body.items.length, 2);
    const ids = [...first.body.items, ...second.body.items].map((item: MarketInstrument) => item.instrumentId);
    assert.equal(new Set(ids).size, ids.length);
    const wrongScope = await get(env.app, `/v1/markets?product=spot&sort=alphabetical&cursor=${first.body.pageInfo.nextCursor}`);
    assert.equal(wrongScope.response.statusCode, 400);
  } finally { await env.close(); }
});

test('normalization deduplicates instruments while preserving paused, missing-value, and private-company truth', async () => {
  const sources = [new TestSource('normalization', [
    spot(),
    spot({ companyName: 'Duplicate NVIDIA record that must be discarded' }),
    perpetual(),
    perpetual({
      instrumentId: 'perpetual:phoenix:apple',
      assetId: 'apple-perpetual',
      companyName: 'Apple',
      ticker: 'AAPL',
      symbol: 'AAPL',
      availability: 'paused',
      marketValue: { label: 'Mark price', amount: null, currency: 'USD', asOf: null, dataState: 'unavailable' },
      fundingRatePercent: metric(null),
    }),
    prestock({
      instrumentId: 'prestock:tessera:openai',
      assetId: 'openai',
      companyName: 'OpenAI',
      ticker: null,
      symbol: 'tOpenAI',
      marketValue: { label: 'Market value', amount: null, currency: 'USD', asOf: null, dataState: 'unavailable' },
      markPrice: null,
      tokenPrice: null,
    }),
  ])];
  const env = setup({ sources });
  try {
    const spotResult = await get(env.app, '/v1/markets?product=spot');
    assert.equal(spotResult.body.counts.spot, 1);
    assert.equal(spotResult.body.items[0].companyName, 'NVIDIA');

    const nvidia = marketCompanyResponseSchema.parse((await get(env.app, '/v1/markets/companies/nvidia')).body);
    assert.deepEqual(nvidia.instruments.map((instrument) => instrument.productType), ['spot', 'perpetual']);

    const allPerpetuals = await get(env.app, '/v1/markets?product=perpetual');
    assert.ok(allPerpetuals.body.items.some((instrument: MarketInstrument) => instrument.availability === 'paused'));
    const availablePerpetuals = await get(env.app, '/v1/markets?product=perpetual&availability=available');
    assert.ok(availablePerpetuals.body.items.every((instrument: MarketInstrument) => instrument.availability === 'available'));

    const privateCompany = await get(env.app, '/v1/markets/search?q=tOpenAI');
    assert.equal(privateCompany.body.items[0].ticker, null);
    const privateMarkets = await get(env.app, `/v1/markets/companies/${privateCompany.body.items[0].assetId}`);
    const missingValue = privateMarkets.body.instruments.find((instrument: MarketInstrument) => instrument.instrumentId === 'prestock:tessera:openai');
    assert.equal(missingValue.marketValue.amount, null);
    assert.equal(missingValue.marketValue.dataState, 'unavailable');
  } finally { await env.close(); }
});

test('provider failure is isolated, stale cache is explicit, and total outage is safe', async () => {
  let current = new Date('2026-09-19T10:00:00.000Z');
  const spotSource = new TestSource('spot-provider', [spot()]);
  const failedSource = new TestSource('failed-provider', [prestock()]);
  failedSource.fail = true;
  const env = setup({ sources: [spotSource, failedSource], now: () => current, cacheTtlMs: 1_000, staleTtlMs: 10_000 });
  try {
    const partial = await get(env.app, '/v1/markets?product=spot');
    assert.equal(partial.response.statusCode, 200);
    assert.equal(partial.body.warnings[0].code, 'PROVIDER_UNAVAILABLE');
    current = new Date('2026-09-19T10:00:02.000Z');
    spotSource.fail = true;
    const stale = await get(env.app, '/v1/markets?product=spot');
    assert.equal(stale.response.statusCode, 200);
    assert.ok(stale.body.warnings.some((warning: { code: string }) => warning.code === 'PROVIDER_STALE'));
    assert.equal(stale.body.items[0].marketValue.dataState, 'stale');
  } finally { await env.close(); }

  const onlyFailure = new TestSource('only-provider', [spot()]);
  onlyFailure.fail = true;
  const failed = setup({ sources: [onlyFailure] });
  try {
    const result = await get(failed.app, '/v1/markets');
    assert.equal(result.response.statusCode, 503);
    assert.equal(marketsApiErrorSchema.parse(result.body).error.code, 'REGISTRY_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(result.body), /raw failure/);
  } finally { await failed.close(); }
});

test('Tokens source selects a safe primary stock variant and maps source freshness', async () => {
  let headers: Headers | undefined;
  const source = new TokensSpotSource({
    apiKey: 'server-secret-token-key',
    baseUrl: 'https://tokens.test',
    timeoutMs: 1_000,
    now: () => new Date('2026-09-19T10:00:00.000Z'),
    fetch: async (_input, init) => {
      headers = new Headers(init?.headers);
      return new Response(JSON.stringify({ assets: [{
        assetId: 'nvidia', name: 'NVIDIA', symbol: 'NVDA', category: 'equity', imageUrl: 'https://images.test/nvidia.png',
        primaryVariant: {
          variantId: 'nvidia:xstocks', mint: 'NVDAx1111111111111111111111111111111111111', issuer: 'xStocks', issuerUrl: 'https://xstocks.test',
          symbol: 'NVDAx', stockVariantTier: 'share_redeemable', advisory: null,
          market: { price: 220.56, liquidity: 500_000, volume24hUSD: 1_000_000, priceChange24hPercent: 2.38, lastFetchedAt: Date.parse('2026-09-19T09:59:00.000Z') },
        },
        variants: [{
          variantId: 'nvidia:blocked', mint: 'Blocked11111111111111111111111111111111111', symbol: 'NVDAB', advisory: { status: 'blocked' }, market: null,
        }],
      }, {
        assetId: 'openai', name: 'OpenAI', symbol: 'OPENAI', category: 'equity', imageUrl: null,
        primaryVariant: {
          variantId: 'openai:tessera', mint: 'oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ', issuer: 'Tessera',
          label: 'Tessera', symbol: 'tOpenAI', stockVariantTier: 'not_redeemable', advisory: null,
          market: { price: 100, liquidity: 10_000, volume24hUSD: 5_000, priceChange24hPercent: 1, lastFetchedAt: Date.parse('2026-09-19T09:59:00.000Z') },
        },
        variants: [],
      }] }), { status: 200 });
    },
  });
  const result = await source.load();
  assert.equal(headers?.get('x-api-key'), 'server-secret-token-key');
  assert.equal(result.length, 1);
  assert.equal(result[0].instrumentId, 'spot:nvidia:xstocks');
  assert.equal(result[0].marketValue.dataState, 'live');
  assert.equal(result[0].availability, 'available');
});

test('Tokens detail source scopes candles to the exact Spot mint and news to the canonical company', async () => {
  const requested: URL[] = [];
  const headers: Headers[] = [];
  const source = new TokensMarketDetailsSource({
    apiKey: 'server-secret-token-key',
    baseUrl: 'https://tokens.test',
    timeoutMs: 1_000,
    now: () => new Date('2026-09-19T10:00:00.000Z'),
    fetch: async (input, init) => {
      const url = new URL(String(input));
      requested.push(url);
      headers.push(new Headers(init?.headers));
      if (url.pathname.endsWith('/ohlcv')) return new Response(JSON.stringify({
        assetId: 'nvidia',
        mint: 'NVDAx1111111111111111111111111111111111111',
        interval: '1H',
        from: 1,
        to: 2,
        candles: [{ time: Date.parse('2026-09-19T09:00:00.000Z') / 1_000, open: 218, high: 223, low: 217, close: 220.56, volume: 10_000 }],
      }), { status: 200 });
      return new Response(JSON.stringify({ items: [{
        title: 'NVIDIA announces company update',
        url: 'https://news.test/nvidia',
        posted_at: '2026-09-19T09:30:00.000Z',
        source_name: 'Test Wire',
        image: 'https://images.test/nvidia-news.png',
      }] }), { status: 200 });
    },
  });

  const instrument = spot();
  const history = await source.loadHistory(instrument, '1w');
  const news = await source.loadCompanyNews({ assetId: 'nvidia', companyName: 'NVIDIA', ticker: 'NVDA' });
  assert.equal(history.points.length, 1);
  assert.equal(history.interval, '1H');
  assert.equal(requested[0].searchParams.get('mint'), instrument.mint);
  assert.equal(requested[0].searchParams.get('interval'), '1H');
  assert.equal(requested[1].searchParams.get('asset_id'), 'nvidia');
  assert.equal(requested[1].searchParams.get('symbol'), 'NVDA');
  assert.equal(requested[1].searchParams.get('name'), 'NVIDIA');
  assert.equal(news[0].assetId, 'nvidia');
  assert.ok(headers.every((header) => header.get('x-api-key') === 'server-secret-token-key'));
});

test('PreStocks source preserves provider values without inventing a source timestamp', async () => {
  const source = new PreStocksSource({
    url: 'https://prestocks.test/api/prestocks',
    timeoutMs: 1_000,
    fetch: async () => new Response(JSON.stringify([{
      name: 'Anthropic PreStocks', symbol: 'ANTHROPIC', description: 'Private exposure.', image: 'https://images.test/anthropic.png',
      external_url: 'https://prestocks.test/anthropic', contract_address: 'Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw',
      markPrice: 1_021.04, markValuation: 1_672_000_000_000, tokenPrice: 999.12, impliedValuation: 1_636_000_000_000, supply: 7_381,
    }]), { status: 200 }),
  });
  const [result] = await source.load();
  assert.equal(result.assetId, 'anthropic');
  assert.equal(result.ticker, null);
  assert.equal(result.marketValue.amount, 999.12);
  assert.equal(result.marketValue.asOf, null);
  assert.equal(result.marketValue.dataState, 'unavailable');
});

test('Tessera source uses the three official mint records as distinct private-market instruments', async () => {
  const result = await new TesseraSource().load();
  assert.deepEqual(result.map((instrument) => instrument.symbol), ['tSpaceX', 'tKalshi', 'tOpenAI']);
  assert.ok(result.every((instrument) => instrument.exposureType === 'loan_participation'));
  assert.ok(result.every((instrument) => instrument.transferFeeBps === 20));
});

test('Phoenix source keeps equity-calendar markets, excludes ETFs, and maps mark and funding data', async () => {
  const source = new PhoenixPerpetualSource({
    baseUrl: 'https://phoenix.test',
    timeoutMs: 1_000,
    now: () => new Date('2026-09-19T10:00:00.000Z'),
    fetch: async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/v1/view/exchange/markets') return new Response(JSON.stringify([
        {
          symbol: 'NVDA', marketStatus: 'active', marketPubkey: 'AzySnZQCNjkQMtm5ZDd2FjKYTjBoNb5Bv5Dsm3WyRkbj', baseLotsDecimals: 3,
          leverageTiers: [{ maxLeverage: 20 }], fundingIntervalSeconds: 3600, isolatedOnly: false,
          statsSnapshot: { openInterestBaseLots: '480969' },
          metadata: { name: 'NVIDIA', description: 'NVIDIA equity perpetual.', logoUri: 'https://images.test/nvidia.svg', calendar: { id: 'us_equities_extended' } },
        },
        {
          symbol: 'QQQ', marketStatus: 'active', marketPubkey: 'QQQ111111111111111111111111111111111111111', baseLotsDecimals: 3,
          leverageTiers: [{ maxLeverage: 10 }], fundingIntervalSeconds: 3600, isolatedOnly: false,
          metadata: { name: 'QQQ', calendar: { id: 'us_equities_extended' } },
        },
        {
          symbol: 'SOL', marketStatus: 'active', marketPubkey: 'SOL111111111111111111111111111111111111111', baseLotsDecimals: 2,
          leverageTiers: [{ maxLeverage: 25 }], fundingIntervalSeconds: 3600, isolatedOnly: false, metadata: { name: 'Solana' },
        },
      ]), { status: 200 });
      return new Response(JSON.stringify({ series: [{ symbol: 'NVDA', points: [{ timestamp: Date.parse('2026-09-19T09:00:00.000Z') / 1_000, markPrice: '222.22', fundingRate: '-0.0009' }] }] }), { status: 200 });
    },
  });
  const result = await source.load();
  assert.equal(result.length, 1);
  assert.equal(result[0].symbol, 'NVDA');
  assert.equal(result[0].marketValue.amount, 222.22);
  assert.equal(result[0].fundingRatePercent.value, -0.09);
  assert.equal(result[0].openInterestBase, 480.969);
});
