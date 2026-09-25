import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { CompanySummary, MarketStatus } from '@warren/home-contract';
import { assetsResponseSchema, homeApiErrorSchema, homeResponseSchema } from '@warren/home-contract';
import { buildApp } from '../src/server.js';
import type { Config } from '../src/config.js';
import { HomeService } from '../src/home/service.js';
import {
  FixtureSupplementSource,
  TokensCatalogSource,
  TokensNewsSource,
  type CatalogSource,
  type IndexSource,
  type MarketSource,
  type NewsSource,
} from '../src/home/sources.js';

class TestCatalog implements CatalogSource {
  calls = 0;
  fail = false;
  constructor(public companies: CompanySummary[]) {}
  async load() {
    this.calls += 1;
    if (this.fail) throw new Error('catalog raw failure');
    return structuredClone(this.companies);
  }
}

function company(overrides: Partial<CompanySummary> = {}): CompanySummary {
  return {
    assetId: 'nvidia',
    companyName: 'NVIDIA',
    ticker: 'NVDA',
    logoUrl: null,
    referencePrice: 220.56,
    currency: 'USD',
    changePercent: 2.38,
    changePeriod: '1d',
    priceAsOf: '2026-09-18T09:59:00.000Z',
    priceDataState: 'live',
    changeAsOf: '2026-09-18T09:59:00.000Z',
    changeDataState: 'live',
    earningsAt: null,
    instrumentHints: ['NVDAx'],
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

function setup(options: { companies?: CompanySummary[]; market?: MarketSource; indices?: IndexSource; news?: NewsSource; now?: () => Date; config?: Partial<Config>; cacheTtlMs?: number; staleTtlMs?: number } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'warren-home-api-'));
  const catalog = new TestCatalog(options.companies ?? [company()]);
  const now = options.now ?? (() => new Date('2026-09-18T10:00:00.000Z'));
  const fixtureSupplement = new FixtureSupplementSource(now);
  const service = new HomeService({
    catalog,
    market: options.market ?? fixtureSupplement,
    indices: options.indices ?? fixtureSupplement,
    news: options.news ?? fixtureSupplement,
    cacheTtlMs: options.cacheTtlMs ?? 60_000,
    staleTtlMs: options.staleTtlMs ?? 900_000,
    now,
  });
  const app = buildApp({ config: config(join(directory, 'test.db'), options.config), homeService: service });
  return { app, catalog, service, close: async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); } };
}

async function get(app: FastifyInstance, url: string, headers: Record<string, string> = {}) {
  const response = await app.inject({ method: 'GET', url, headers });
  return { response, body: response.payload ? response.json() as Record<string, any> : {} };
}

test('home bootstrap is public, schema-valid, cacheable, and conditionally revalidates', async () => {
  const market: MarketStatus = { region: 'US', session: 'open', label: 'US market open', asOf: '2026-09-18T10:00:00.000Z', nextOpenAt: null, nextCloseAt: '2026-09-18T20:00:00.000Z', dataState: 'live' };
  const env = setup({
    companies: Array.from({ length: 30 }, (_, index) => company({ assetId: `company-${index}`, companyName: `Company ${index}`, ticker: `C${index}`, instrumentHints: [`C${index}x`] })),
    market: { async loadMarket() { return market; } },
  });
  try {
    const first = await get(env.app, '/v1/home');
    assert.equal(first.response.statusCode, 200);
    const parsed = homeResponseSchema.parse(first.body);
    assert.equal(parsed.companies.length, 24);
    assert.equal(parsed.pageInfo.hasNextPage, true);
    assert.equal(parsed.market.session, 'open');
    assert.match(String(first.response.headers['cache-control']), /public, max-age=15/);
    assert.ok(first.response.headers.etag);
    const second = await get(env.app, '/v1/home', { 'if-none-match': String(first.response.headers.etag) });
    assert.equal(second.response.statusCode, 304);
    assert.equal(second.response.payload, '');
  } finally { await env.close(); }
});

test('Home and mover queries rank the full catalogue by 24-hour percentage change without a volume filter', async () => {
  const env = setup({ companies: [
    company({ assetId: 'gain-five', companyName: 'Gain Five', changePercent: 5 }),
    company({ assetId: 'loss-twenty', companyName: 'Loss Twenty', changePercent: -20 }),
    company({ assetId: 'gain-ten', companyName: 'Gain Ten', changePercent: 10 }),
    company({ assetId: 'loss-two', companyName: 'Loss Two', changePercent: -2 }),
    company({ assetId: 'missing-change', companyName: 'Missing Change', changePercent: null, changeAsOf: null, changeDataState: 'unavailable' }),
  ] });
  try {
    const home = await get(env.app, '/v1/home');
    assert.deepEqual(home.body.companies.map((item: CompanySummary) => item.assetId), [
      'gain-ten', 'gain-five', 'loss-two', 'loss-twenty',
    ]);

    const losers = await get(env.app, '/v1/assets?sort=change_asc&limit=24');
    const parsed = assetsResponseSchema.parse(losers.body);
    assert.equal(parsed.query.sort, 'change_asc');
    assert.deepEqual(parsed.items.map((item) => item.assetId), [
      'loss-twenty', 'loss-two', 'gain-five', 'gain-ten',
    ]);
  } finally { await env.close(); }
});

test('sample US market status does not claim weekends are open', async () => {
  const env = setup({ now: () => new Date('2026-09-19T12:00:00.000Z') });
  try {
    const result = await get(env.app, '/v1/home');
    assert.equal(result.response.statusCode, 200);
    assert.equal(result.body.market.session, 'closed');
    assert.equal(result.body.market.label, 'US market closed');
    assert.equal(result.body.market.dataState, 'sample');
  } finally { await env.close(); }
});

test('assets search matches company, ticker, and token hints while deduplicating companies', async () => {
  const env = setup({ companies: [
    company({ instrumentHints: ['NVDAx'] }),
    company({ referencePrice: null, priceAsOf: null, priceDataState: 'unavailable', instrumentHints: ['NVDABackpack'] }),
    company({ assetId: 'microsoft', companyName: 'Microsoft', ticker: 'MSFT', instrumentHints: ['MSFTx'] }),
  ] });
  try {
    for (const query of ['nvidia', 'NvDa', 'nvdax', 'nvdabackpack']) {
      const result = await get(env.app, `/v1/assets?q=${encodeURIComponent(`  ${query}  `)}`);
      assert.equal(result.response.statusCode, 200);
      const parsed = assetsResponseSchema.parse(result.body);
      assert.equal(parsed.items.length, 1);
      assert.equal(parsed.items[0].assetId, 'nvidia');
      assert.deepEqual(parsed.items[0].instrumentHints, ['NVDAx', 'NVDABackpack']);
    }
    const empty = await get(env.app, '/v1/assets?q=unknown-company');
    assert.equal(empty.response.statusCode, 200);
    assert.deepEqual(empty.body.items, []);
  } finally { await env.close(); }
});

test('assets pagination uses a validated opaque cursor without duplicates', async () => {
  const env = setup({ companies: Array.from({ length: 7 }, (_, index) => company({ assetId: `asset-${index}`, companyName: `Asset ${index}`, ticker: `A${index}` })) });
  try {
    const first = await get(env.app, '/v1/assets?limit=3');
    assert.equal(first.response.statusCode, 200);
    assert.equal(first.body.items.length, 3);
    assert.equal(first.body.pageInfo.hasNextPage, true);
    const second = await get(env.app, `/v1/assets?limit=3&cursor=${first.body.pageInfo.nextCursor}`);
    assert.equal(second.response.statusCode, 200);
    assert.deepEqual(second.body.items.map((item: CompanySummary) => item.assetId), ['asset-3', 'asset-4', 'asset-5']);
    const allIds = [...first.body.items, ...second.body.items].map((item: CompanySummary) => item.assetId);
    assert.equal(new Set(allIds).size, allIds.length);
    const invalid = await get(env.app, '/v1/assets?cursor=bm90LWEtY3Vyc29y');
    assert.equal(invalid.response.statusCode, 400);
    assert.equal(homeApiErrorSchema.parse(invalid.body).error.code, 'INVALID_REQUEST');
    const mismatchedSort = await get(env.app, `/v1/assets?sort=change_desc&cursor=${first.body.pageInfo.nextCursor}`);
    assert.equal(mismatchedSort.response.statusCode, 400);
  } finally { await env.close(); }
});

test('watchlist resolution preserves requested order and reports unknown IDs without mutation', async () => {
  const env = setup({ companies: [company(), company({ assetId: 'apple', companyName: 'Apple', ticker: 'AAPL', instrumentHints: ['AAPLx'] })] });
  try {
    const result = await get(env.app, '/v1/assets?ids=apple,missing,nvidia,apple');
    assert.equal(result.response.statusCode, 200);
    assert.deepEqual(result.body.items.map((item: CompanySummary) => item.assetId), ['apple', 'nvidia']);
    assert.deepEqual(result.body.warnings[0].assetIds, ['missing']);
    assert.deepEqual(result.body.query.ids, ['apple', 'missing', 'nvidia']);
  } finally { await env.close(); }
});

test('earnings view is ordered and returns an explicit empty success when dates are unavailable', async () => {
  const env = setup({ companies: [
    company({ assetId: 'later', earningsAt: '2026-09-28T20:00:00.000Z' }),
    company({ assetId: 'none', earningsAt: null }),
    company({ assetId: 'sooner', earningsAt: '2026-09-20T20:00:00.000Z' }),
    company({ assetId: 'outside-window', earningsAt: '2026-10-19T20:00:00.000Z' }),
  ] });
  try {
    const result = await get(env.app, '/v1/assets?view=earnings');
    assert.deepEqual(result.body.items.map((item: CompanySummary) => item.assetId), ['sooner', 'later']);
  } finally { await env.close(); }

  const emptyEnv = setup({ companies: [company()] });
  try {
    const empty = await get(emptyEnv.app, '/v1/assets?view=earnings');
    assert.equal(empty.response.statusCode, 200);
    assert.deepEqual(empty.body.items, []);
    assert.equal(empty.body.warnings[0].code, 'EARNINGS_DATA_UNAVAILABLE');
  } finally { await emptyEnv.close(); }
});

test('invalid catalogue query combinations return the shared error shape', async () => {
  const env = setup();
  try {
    const tooManyIds = Array.from({ length: 51 }, (_, index) => `asset-${index}`).join(',');
    for (const url of [
      '/v1/assets?limit=0',
      '/v1/assets?limit=37',
      '/v1/assets?view=bad',
      '/v1/assets?sort=bad',
      '/v1/assets?ids=bad%20id',
      `/v1/assets?ids=${tooManyIds}`,
      '/v1/assets?q=nvda&ids=nvidia',
      '/v1/assets?ids=nvidia&cursor=eyJ2IjoxLCJvZmZzZXQiOjF9',
      '/v1/assets?ids=nvidia&sort=change_desc',
      '/v1/assets?view=earnings&sort=change_asc',
    ]) {
      const result = await get(env.app, url);
      assert.equal(result.response.statusCode, 400);
      assert.equal(homeApiErrorSchema.parse(result.body).error.code, 'INVALID_REQUEST');
      assert.equal(result.body.error.retryable, false);
      assert.ok(result.body.error.requestId);
    }
  } finally { await env.close(); }
});

test('Tokens catalogue price and daily change remain the authoritative Home values', async () => {
  const env = setup({
    companies: [company({
      changeAsOf: '2026-09-18T08:00:00.000Z',
      changeDataState: 'stale',
    })],
  });
  try {
    const result = await get(env.app, '/v1/assets?q=nvda');
    assert.equal(result.response.statusCode, 200);
    assert.equal(result.body.items[0].referencePrice, 220.56);
    assert.equal(result.body.items[0].priceAsOf, '2026-09-18T09:59:00.000Z');
    assert.equal(result.body.items[0].priceDataState, 'live');
    assert.equal(result.body.items[0].changePercent, 2.38);
    assert.equal(result.body.items[0].changeAsOf, '2026-09-18T08:00:00.000Z');
    assert.equal(result.body.items[0].changeDataState, 'stale');
  } finally { await env.close(); }
});

test('an optional news outage preserves companies and healthy optional sections', async () => {
  const news: NewsSource = { async loadNews() { throw new Error('news raw failure'); } };
  const env = setup({ news });
  try {
    const result = await get(env.app, '/v1/home');
    assert.equal(result.response.statusCode, 200);
    assert.equal(result.body.companies.length, 1);
    assert.equal(result.body.market.dataState, 'sample');
    assert.ok(result.body.indices.length > 0);
    assert.deepEqual(result.body.news, []);
    assert.deepEqual(result.body.warnings.map((warning: { code: string }) => warning.code), ['NEWS_UNAVAILABLE']);
    assert.doesNotMatch(JSON.stringify(result.body), /raw failure/);
  } finally { await env.close(); }
});

test('malformed optional data is rejected and isolated before reaching the client', async () => {
  const market = { async loadMarket() { return { bad: true }; } } as unknown as MarketSource;
  const env = setup({ market });
  try {
    const result = await get(env.app, '/v1/home');
    assert.equal(result.response.statusCode, 200);
    assert.equal(result.body.companies.length, 1);
    assert.equal(result.body.market.dataState, 'unavailable');
    assert.equal(result.body.warnings[0].code, 'MARKET_STATUS_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(result.body), /"bad"/);
  } finally { await env.close(); }
});

test('catalogue cache serves stale data after refresh failure and fails safely without a cache', async () => {
  let current = new Date('2026-09-18T10:00:00.000Z');
  const env = setup({ now: () => current, cacheTtlMs: 1_000, staleTtlMs: 10_000 });
  try {
    assert.equal((await get(env.app, '/v1/home')).response.statusCode, 200);
    assert.equal((await get(env.app, '/v1/assets?q=nvda')).response.statusCode, 200);
    assert.equal(env.catalog.calls, 1, 'fresh catalogue reads should reuse the normalized cache');
    current = new Date('2026-09-18T10:00:02.000Z'); env.catalog.fail = true;
    const stale = await get(env.app, '/v1/home');
    assert.equal(stale.response.statusCode, 200);
    assert.equal(stale.body.warnings[0].code, 'CATALOG_STALE');
    assert.equal(stale.body.companies[0].priceDataState, 'stale');
    assert.equal(stale.body.companies[0].changeDataState, 'stale');
  } finally { await env.close(); }

  const failed = setup(); failed.catalog.fail = true;
  try {
    const unavailable = await get(failed.app, '/v1/home');
    assert.equal(unavailable.response.statusCode, 503);
    assert.equal(homeApiErrorSchema.parse(unavailable.body).error.code, 'CATALOG_UNAVAILABLE');
    assert.equal(unavailable.body.error.retryable, true);
    assert.doesNotMatch(unavailable.body.error.message, /raw failure/);
  } finally { await failed.close(); }

  const empty = setup({ companies: [] });
  try {
    const unavailable = await get(empty.app, '/v1/home');
    assert.equal(unavailable.response.statusCode, 503);
    assert.equal(homeApiErrorSchema.parse(unavailable.body).error.code, 'CATALOG_UNAVAILABLE');
  } finally { await empty.close(); }

  const malformed = setup({ companies: [company({ priceAsOf: null })] });
  try {
    const unavailable = await get(malformed.app, '/v1/home');
    assert.equal(unavailable.response.statusCode, 503);
    assert.equal(homeApiErrorSchema.parse(unavailable.body).error.code, 'CATALOG_UNAVAILABLE');
  } finally { await malformed.close(); }
});

test('public market reads are rate limited without affecting health', async () => {
  const env = setup({ config: { RATE_LIMIT_MAX: 1 } });
  try {
    assert.equal((await get(env.app, '/v1/home')).response.statusCode, 200);
    const limited = await get(env.app, '/v1/home');
    assert.equal(limited.response.statusCode, 429);
    assert.equal(homeApiErrorSchema.parse(limited.body).error.code, 'RATE_LIMITED');
    assert.equal((await get(env.app, '/v1/health')).response.statusCode, 200);
  } finally { await env.close(); }
});

test('Tokens source maps provider variants into one safe company summary', async () => {
  let requestHeaders: Headers | undefined;
  const source = new TokensCatalogSource({
    apiKey: 'server-secret-token-key',
    baseUrl: 'https://tokens.test',
    timeoutMs: 1_000,
    now: () => new Date('2026-09-18T10:00:00.000Z'),
    fetch: async (_input, init) => {
      requestHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ assets: [
        {
          assetId: 'nvidia', name: 'NVIDIA', symbol: 'NVDA', category: 'equity', imageUrl: 'https://images.test/nvda.png',
          stats: { price: 220.56, priceChange24hPercent: 2.38 }, advisories: [],
          primaryVariant: { symbol: 'NVDAx', advisory: null, market: { lastFetchedAt: Date.parse('2026-09-18T09:59:00.000Z') } },
          variants: [
            { symbol: 'NVDAx', advisory: null, market: null },
            { symbol: 'NVDAB', advisory: { status: 'blocked' }, market: null },
            { symbol: 'NVDAON', advisory: { status: 'caution' }, market: null },
          ],
        },
        {
          assetId: 'apple', name: 'Apple', symbol: 'AAPL', category: 'equity', imageUrl: 'javascript:alert(1)',
          stats: { price: null, priceChange24hPercent: -1.25 }, advisories: [],
          primaryVariant: { symbol: 'AAPLx', advisory: null, market: { lastFetchedAt: Date.parse('2026-09-18T08:00:00.000Z') } },
          variants: [],
        },
        {
          assetId: 'alphabet', name: 'Alphabet', symbol: 'GOOGL', category: 'equity', imageUrl: null,
          stats: { price: 250, priceChange24hPercent: 1.5 }, advisories: [],
          primaryVariant: { symbol: 'GOOGLx', advisory: null, market: null },
          variants: [],
        },
      ] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const result = await source.load();
  assert.equal(requestHeaders?.get('x-api-key'), 'server-secret-token-key');
  assert.deepEqual(result[0].instrumentHints, ['NVDAx', 'NVDAON']);
  assert.equal(result[0].priceDataState, 'live');
  assert.equal(result[0].changeDataState, 'live');
  assert.equal(result[0].priceAsOf, '2026-09-18T09:59:00.000Z');
  assert.equal(result[0].changeAsOf, '2026-09-18T09:59:00.000Z');
  assert.equal(result[1].referencePrice, null);
  assert.equal(result[1].changePercent, -1.25);
  assert.equal(result[1].logoUrl, null);
  assert.equal(result[1].priceDataState, 'unavailable');
  assert.equal(result[1].changeDataState, 'stale');
  assert.equal(result[2].referencePrice, null);
  assert.equal(result[2].priceAsOf, null);
  assert.equal(result[2].priceDataState, 'unavailable');
  assert.equal(result[2].changePercent, null);
  assert.equal(result[2].changeAsOf, null);
  assert.equal(result[2].changeDataState, 'unavailable');
});

test('Tokens news source returns the latest provider articles without topic filtering', async () => {
  let requestedUrl = '';
  let requestHeaders: Headers | undefined;
  const source = new TokensNewsSource({
    apiKey: 'server-secret-token-key',
    baseUrl: 'https://tokens.test',
    timeoutMs: 1_000,
    now: () => new Date('2026-09-18T12:00:00.000Z'),
    fetch: async (input, init) => {
      requestedUrl = String(input);
      requestHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ items: [
        { title: 'NVIDIA shares rise after stronger data-center earnings', url: 'https://news.test/nvidia-earnings', image: 'https://images.test/nvidia.jpg', posted_at: '2026-09-18T11:30:00Z', source_name: 'Market Wire', related_coin_ids: [] },
        { title: 'S&P 500 closes higher as investors assess the Federal Reserve', url: 'https://news.test/market-close', posted_at: '2026-09-18T10:30:00Z', source_name: 'Business Desk', related_coin_ids: [] },
        { title: 'Bitcoin market cap overtakes Tesla after crypto rally', url: 'https://crypto.test/bitcoin-tesla', posted_at: '2026-09-18T11:45:00Z', source_name: 'Digital Assets Daily', related_coin_ids: ['bitcoin'] },
        { title: 'Solana token gains after blockchain upgrade', url: 'https://news.test/solana', posted_at: '2026-09-18T11:40:00Z', source_name: 'Wire Service', related_coin_ids: ['solana'] },
        { title: 'Coinbase shares move after regulatory update', url: 'https://news.test/coinbase', posted_at: '2026-09-18T11:35:00Z', source_name: 'COINTURK NEWS', related_coin_ids: [] },
        { title: 'City council approves a new public park', url: 'https://news.test/local', posted_at: '2026-09-18T11:00:00Z', source_name: 'Local Desk', related_coin_ids: [] },
      ] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const result = await source.loadNews([company()]);
  assert.equal(new URL(requestedUrl).pathname, '/v1/news/feed');
  assert.equal(new URL(requestedUrl).searchParams.get('source'), 'news');
  assert.equal(new URL(requestedUrl).searchParams.get('limit'), '12');
  assert.equal(requestHeaders?.get('x-api-key'), 'server-secret-token-key');
  assert.deepEqual(result.map((item) => item.headline), [
    'Bitcoin market cap overtakes Tesla after crypto rally',
    'Solana token gains after blockchain upgrade',
    'Coinbase shares move after regulatory update',
    'NVIDIA shares rise after stronger data-center earnings',
    'City council approves a new public park',
    'S&P 500 closes higher as investors assess the Federal Reserve',
  ]);
  assert.deepEqual(result[3].relatedAssetIds, ['nvidia']);
  assert.equal(result[3].category, 'Company');
  assert.equal(result[3].imageUrl, 'https://images.test/nvidia.jpg');
  assert.equal(result[0].category, 'Markets');
});

test('an empty provider news result is explicit', async () => {
  const news: NewsSource = { async loadNews() { return []; } };
  const env = setup({ news });
  try {
    const result = await get(env.app, '/v1/home');
    assert.equal(result.response.statusCode, 200);
    assert.deepEqual(result.body.news, []);
    assert.ok(result.body.warnings.some((warning: { code: string }) => warning.code === 'NEWS_EMPTY'));
  } finally { await env.close(); }
});
