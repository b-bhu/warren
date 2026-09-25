import { readConfig } from '../src/config.js';
import { KaminoMarketCatalog } from '../src/lending/market.js';

const config = readConfig();
const catalog = new KaminoMarketCatalog({
  baseUrl: config.KAMINO_API_BASE_URL,
  timeoutMs: config.KAMINO_MARKET_TIMEOUT_MS,
  enabled: true,
  newRiskEnabled: false,
});
const response = await catalog.load();
const unavailable = response.assets.filter((asset) => !asset.routeAvailable);
console.log(`Read-only Kamino xStocks validation at ${response.generatedAt}`);
for (const asset of response.assets) {
  console.log(`${asset.symbol}: ${asset.routeAvailable ? 'USDC route active' : 'route unavailable'}; borrow APY ${asset.borrowApy ?? 'unavailable'}; liquidity ${asset.availableLiquidity ?? 'unavailable'}`);
}
if (unavailable.length) {
  console.error(`Route check failed for: ${unavailable.map((asset) => asset.symbol).join(', ')}`);
  process.exitCode = 1;
}
console.log('Transaction building, simulation, signing, and submission were not attempted.');
