import assert from 'node:assert/strict';
import test from 'node:test';
import { KaminoMarketCatalog } from '../src/lending/market.js';
import { KAMINO_MARKET_ADDRESS, USDC_RESERVE_ADDRESS, lendingCatalogResponseSchema } from '@warren/lending-contract';

test('Kamino catalog exposes the nine pinned xStocks and fails closed for actions', async () => {
  const catalog = new KaminoMarketCatalog({
    baseUrl: 'https://kamino.test', timeoutMs: 1_000, enabled: false, newRiskEnabled: true,
  });
  const result = lendingCatalogResponseSchema.parse(await catalog.load());
  assert.deepEqual(result.assets.map((asset) => asset.symbol), ['SPYx', 'QQQx', 'TSLAx', 'GOOGLx', 'NVDAx', 'CRCLx', 'HOODx', 'AAPLx', 'MSTRx']);
  assert.equal(result.programAddress, 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
  assert.equal(result.actionsEnabled, false);
  assert.equal(result.newRiskEnabled, false);
  assert.ok(result.assets.every((asset) => asset.actionsPaused && !asset.routeAvailable));
});

test('Kamino catalog uses only the exact pinned collateral-to-USDC route and reports dynamic terms', async () => {
  const spyMint = 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W';
  const spyReserve = 'UvXjBuC7YZYaGB9Rn1PpBD1GySmjzunXgE8Zev9ua8d';
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    const body = url.includes('collateral-reserves')
      ? { collateralReserves: [{ lendingMarket: KAMINO_MARKET_ADDRESS, collateralMint: spyMint, collateralReserve: spyReserve, borrowReserves: [USDC_RESERVE_ADDRESS], borrowReserveTerms: [{ reserve: USDC_RESERVE_ADDRESS, maxLtv: '0.73', liquidationLtv: '0.75' }] }] }
      : { [spyReserve]: { status: 'Active', supplyApy: { current: '0.01' } }, [USDC_RESERVE_ADDRESS]: { status: 'Active', borrowApy: { current: '0.05' }, actualAvailableLiquidity: '10000' } };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const catalog = new KaminoMarketCatalog({ baseUrl: 'https://kamino.test', timeoutMs: 1_000, enabled: true, newRiskEnabled: true, fetcher });
  const result = await catalog.load();
  const spy = result.assets[0]!;
  const qqq = result.assets[1]!;
  assert.equal(spy.routeAvailable, true);
  assert.equal(spy.maxLtv, '0.73');
  assert.equal(spy.supplyApy, '0.01');
  assert.equal(spy.borrowApy, '0.05');
  assert.equal(spy.availableLiquidity, '10000');
  assert.equal(spy.actionsPaused, false);
  assert.equal(qqq.routeAvailable, false);
  assert.equal(qqq.maxLtv, null);
});

test('Kamino catalog rejects a failed source instead of falling back to old terms', async () => {
  const fetcher: typeof fetch = async () => new Response('unavailable', { status: 503 });
  const catalog = new KaminoMarketCatalog({ baseUrl: 'https://kamino.test', timeoutMs: 1_000, enabled: true, newRiskEnabled: false, fetcher });
  await assert.rejects(catalog.load(), /could not be refreshed/);
});
