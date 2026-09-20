import assert from 'node:assert/strict';
import {
  marketCompanyResponseSchema,
  marketSearchResponseSchema,
  marketsResponseSchema,
  type MarketProduct,
} from '@warren/markets-contract';
import { readConfig } from '../src/config.js';
import { buildApp } from '../src/server.js';

if (!process.env.TOKENS_API_KEY) throw new Error('TOKENS_API_KEY is required for live Markets verification.');

const config = readConfig({ ...process.env, NODE_ENV: 'test', DATABASE_URL: ':memory:' });
const app = buildApp({ config });

try {
  const products: MarketProduct[] = ['spot', 'prestock', 'perpetual'];
  const productResults = [];
  for (const product of products) {
    const response = await app.inject({ method: 'GET', url: `/v1/markets?product=${product}&limit=5` });
    assert.equal(response.statusCode, 200, response.payload);
    const body = marketsResponseSchema.parse(response.json());
    assert.ok(body.counts[product] > 0, `${product} must contain at least one live provider record.`);
    assert.ok(body.items.every((item) => item.productType === product));
    productResults.push({
      product,
      status: response.statusCode,
      total: body.counts[product],
      firstPage: body.items.map((item) => ({
        company: item.companyName,
        symbol: item.symbol,
        provider: item.provider,
        availability: item.availability,
        dataState: item.marketValue.dataState,
      })),
      warnings: body.warnings,
    });
  }

  const searchResponse = await app.inject({ method: 'GET', url: '/v1/markets/search?q=nvda&limit=12' });
  assert.equal(searchResponse.statusCode, 200, searchResponse.payload);
  const search = marketSearchResponseSchema.parse(searchResponse.json());
  assert.equal(search.items.length, 1, 'NVDA search must resolve to one canonical company.');
  assert.ok(search.items[0].capabilities.some((capability) => capability.productType === 'spot'));
  assert.ok(search.items[0].capabilities.some((capability) => capability.productType === 'perpetual'));

  const companyResponse = await app.inject({ method: 'GET', url: `/v1/markets/companies/${search.items[0].assetId}` });
  assert.equal(companyResponse.statusCode, 200, companyResponse.payload);
  const company = marketCompanyResponseSchema.parse(companyResponse.json());

  const privateSearchResponse = await app.inject({ method: 'GET', url: '/v1/markets/search?q=anthropic&limit=12' });
  assert.equal(privateSearchResponse.statusCode, 200, privateSearchResponse.payload);
  const privateSearch = marketSearchResponseSchema.parse(privateSearchResponse.json());
  assert.ok(privateSearch.items.some((item) => item.companyName === 'Anthropic'));

  console.log(JSON.stringify({
    products: productResults,
    nvidia: {
      assetId: company.company.assetId,
      capabilities: company.instruments.map((item) => ({ product: item.productType, symbol: item.symbol, provider: item.provider })),
    },
    anthropic: privateSearch.items.map((item) => ({ assetId: item.assetId, capabilities: item.capabilities })),
    tokensApiKeyConfigured: Boolean(process.env.TOKENS_API_KEY),
  }, null, 2));
} finally {
  await app.close();
}
