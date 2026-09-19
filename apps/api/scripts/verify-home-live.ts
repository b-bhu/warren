import assert from 'node:assert/strict';
import { assetsResponseSchema, homeResponseSchema } from '@warren/home-contract';
import { readConfig } from '../src/config.js';
import { buildApp } from '../src/server.js';

if (!process.env.TOKENS_API_KEY) throw new Error('TOKENS_API_KEY is required for live Home verification.');

const config = readConfig({ ...process.env, NODE_ENV: 'test', DATABASE_URL: ':memory:' });
const app = buildApp({ config });

try {
  const homeResponse = await app.inject({ method: 'GET', url: '/v1/home' });
  assert.equal(homeResponse.statusCode, 200, homeResponse.payload);
  const home = homeResponseSchema.parse(homeResponse.json());
  assert.ok(home.companies.length > 0, 'Home must contain at least one live catalogue company.');

  const searchResponse = await app.inject({ method: 'GET', url: '/v1/assets?q=nvda&limit=8' });
  assert.equal(searchResponse.statusCode, 200, searchResponse.payload);
  const search = assetsResponseSchema.parse(searchResponse.json());
  assert.equal(search.items.length, 1, 'NVDA search must resolve to one canonical company.');
  assert.equal(search.items[0].assetId, 'nvidia');
  assert.ok(search.items[0].instrumentHints.some((hint) => /^NVDA/i.test(hint)), 'NVIDIA must expose a supported token hint.');

  const watchlistResponse = await app.inject({ method: 'GET', url: '/v1/assets?ids=microsoft,nvidia,missing-live-check' });
  assert.equal(watchlistResponse.statusCode, 200, watchlistResponse.payload);
  const watchlist = assetsResponseSchema.parse(watchlistResponse.json());
  assert.deepEqual(watchlist.items.map((item) => item.assetId), ['microsoft', 'nvidia']);
  assert.ok(watchlist.warnings.some((warning) => warning.code === 'UNKNOWN_ASSET_IDS'));

  const earningsResponse = await app.inject({ method: 'GET', url: '/v1/assets?view=earnings&limit=24' });
  assert.equal(earningsResponse.statusCode, 200, earningsResponse.payload);
  const earnings = assetsResponseSchema.parse(earningsResponse.json());

  assert.ok(search.items[0].referencePrice !== null, 'Tokens.xyz must supply NVIDIA reference pricing.');
  assert.ok(search.items[0].priceAsOf, 'Tokens.xyz pricing must include source freshness.');
  assert.ok(home.news.length <= 12, 'Home must return no more than the latest 12 news items.');

  console.log(JSON.stringify({
    home: {
      status: homeResponse.statusCode,
      companyCount: home.companies.length,
      hasNextPage: home.pageInfo.hasNextPage,
      market: home.market,
      indexStates: home.indices.map((item) => ({ id: item.id, dataState: item.dataState })),
      newsStates: home.news.map((item) => ({ id: item.id, dataState: item.dataState })),
    },
    nvidiaSearch: {
      status: searchResponse.statusCode,
      item: search.items[0],
      warnings: search.warnings,
    },
    watchlist: {
      status: watchlistResponse.statusCode,
      assetIds: watchlist.items.map((item) => item.assetId),
      warnings: watchlist.warnings,
    },
    earnings: {
      status: earningsResponse.statusCode,
      count: earnings.items.length,
      warnings: earnings.warnings,
    },
    tokensApiKeyConfigured: Boolean(process.env.TOKENS_API_KEY),
  }, null, 2));
} finally {
  await app.close();
}
