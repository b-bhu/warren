import assert from 'node:assert/strict';
import {
  marketCompanyNewsResponseSchema,
  marketCompanyResponseSchema,
  marketHistoryResponseSchema,
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
  assert.equal(company.primaryInstrumentId, company.hero?.instrumentId ?? null);
  assert.equal(company.hero?.productType, 'spot');
  assert.ok(company.company.description);
  assert.ok(company.history, 'NVIDIA Spot must expose exact-instrument chart capability.');

  const historyResponse = await app.inject({
    method: 'GET',
    url: `/v1/markets/companies/${company.company.assetId}/history?instrumentId=${encodeURIComponent(company.history.instrumentId)}&range=${company.history.defaultRange}`,
  });
  assert.equal(historyResponse.statusCode, 200, historyResponse.payload);
  const history = marketHistoryResponseSchema.parse(historyResponse.json());
  assert.equal(history.instrumentId, company.history.instrumentId);
  assert.ok(history.points.length > 0, 'NVIDIA exact-mint chart must contain live provider candles.');

  const newsResponse = await app.inject({ method: 'GET', url: `/v1/markets/companies/${company.company.assetId}/news` });
  assert.equal(newsResponse.statusCode, 200, newsResponse.payload);
  const news = marketCompanyNewsResponseSchema.parse(newsResponse.json());
  assert.ok(news.items.every((item) => item.assetId === company.company.assetId));

  const privateSearchResponse = await app.inject({ method: 'GET', url: '/v1/markets/search?q=anthropic&limit=12' });
  assert.equal(privateSearchResponse.statusCode, 200, privateSearchResponse.payload);
  const privateSearch = marketSearchResponseSchema.parse(privateSearchResponse.json());
  assert.ok(privateSearch.items.some((item) => item.companyName === 'Anthropic'));
  const anthropicResult = privateSearch.items.find((item) => item.companyName === 'Anthropic')!;
  const anthropicResponse = await app.inject({ method: 'GET', url: `/v1/markets/companies/${anthropicResult.assetId}` });
  assert.equal(anthropicResponse.statusCode, 200, anthropicResponse.payload);
  const anthropic = marketCompanyResponseSchema.parse(anthropicResponse.json());
  assert.equal(anthropic.hero?.productType, 'prestock');
  assert.equal(anthropic.history, null, 'PreStock must not reuse unrelated Spot chart semantics.');

  console.log(JSON.stringify({
    products: productResults,
    nvidia: {
      assetId: company.company.assetId,
      hero: company.hero,
      historyPoints: history.points.length,
      companyNews: news.items.length,
      capabilities: company.instruments.map((item) => ({ product: item.productType, symbol: item.symbol, provider: item.provider })),
    },
    anthropic: {
      assetId: anthropic.company.assetId,
      hero: anthropic.hero,
      historyAvailable: Boolean(anthropic.history),
      capabilities: anthropic.instruments.map((item) => ({ product: item.productType, symbol: item.symbol, provider: item.provider })),
    },
    tokensApiKeyConfigured: Boolean(process.env.TOKENS_API_KEY),
  }, null, 2));
} finally {
  await app.close();
}
