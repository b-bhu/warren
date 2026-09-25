import {
  KAMINO_MARKET_ADDRESS,
  KAMINO_PROGRAM_ADDRESS,
  LENDING_MARKET_ID,
  USDC_MINT_ADDRESS,
  USDC_RESERVE_ADDRESS,
  lendingCatalogResponseSchema,
  type LendingCatalogResponse,
} from '@warren/lending-contract';

export type AssetIdentity = { assetId: string; symbol: string; name: string; mint: string; reserve: string };
export const KAMINO_XSTOCK_ASSETS: readonly AssetIdentity[] = [
  { assetId: 'xstocks:spyx', symbol: 'SPYx', name: 'SPDR S&P 500 ETF', mint: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W', reserve: 'UvXjBuC7YZYaGB9Rn1PpBD1GySmjzunXgE8Zev9ua8d' },
  { assetId: 'xstocks:qqqx', symbol: 'QQQx', name: 'Invesco QQQ ETF', mint: 'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ', reserve: '2jerdAXR8r2B6z3P7P6VgSiePQX7wqcpbEqdDbm8mgeB' },
  { assetId: 'xstocks:tslax', symbol: 'TSLAx', name: 'Tesla', mint: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB', reserve: '5iTiczqgUegqA3PpoNpotizMbY9n1sRWr3oL6igKvWuf' },
  { assetId: 'xstocks:googlx', symbol: 'GOOGLx', name: 'Alphabet', mint: 'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN', reserve: '4wg6rEkGgHaEuxMduP46C1xFZ24Lnp5YgdNkZAHxFzsN' },
  { assetId: 'xstocks:nvdax', symbol: 'NVDAx', name: 'NVIDIA', mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh', reserve: '7B66Az3tJhAo4bLkX8PzTixQ9ZGyHkkjxfVLhF26sP5q' },
  { assetId: 'xstocks:crclx', symbol: 'CRCLx', name: 'Circle Internet Group', mint: 'XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1', reserve: '57qagnQFuWw1seEqi6Z5JBvkm5xH5svdmq9dtqxG1rYy' },
  { assetId: 'xstocks:hoodx', symbol: 'HOODx', name: 'Robinhood Markets', mint: 'XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg', reserve: '4UBJu5Xp1aziV9frBQBhc1RnKrgXHAWHYejQytkYr8gq' },
  { assetId: 'xstocks:aaplx', symbol: 'AAPLx', name: 'Apple', mint: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp', reserve: 'CKJbqakbPGyhziowm19LPYz636UszuezfkitmpRtcLSH' },
  { assetId: 'xstocks:mstrx', symbol: 'MSTRx', name: 'Strategy', mint: 'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ', reserve: 'Cwy2WJoswCMyfPtWTrmiaDLXC3phz3qwr1TaT4kaSAyD' },
];

export class LendingMarketFault extends Error {
  constructor(message: string, readonly status = 503, readonly retryable = true) { super(message); }
}

export class KaminoMarketCatalog {
  constructor(private readonly options: {
    baseUrl: string; timeoutMs: number; enabled: boolean; newRiskEnabled: boolean; recoveryEnabled?: boolean; fetcher?: typeof fetch;
  }) {}

  async load(): Promise<LendingCatalogResponse> {
    const generatedAt = new Date().toISOString();
    const source = this.options.enabled ? await this.readProvider() : undefined;
    const newRiskEnabled = this.options.enabled && this.options.newRiskEnabled;
    const actionsEnabled = this.options.enabled && (this.options.newRiskEnabled || this.options.recoveryEnabled === true);
    const assetsResponse = KAMINO_XSTOCK_ASSETS.map((asset) => {
      const route = source?.routes.find((candidate) => candidate.collateralMint === asset.mint
        && candidate.collateralReserve === asset.reserve
        && candidate.borrowReserves.includes(USDC_RESERVE_ADDRESS));
      const terms = route?.borrowReserveTerms.find((candidate) => candidate.reserve === USDC_RESERVE_ADDRESS);
      const collateralStats = source?.stats[asset.reserve];
      const debtStats = source?.stats[USDC_RESERVE_ADDRESS];
      const marketStatus = collateralStats?.status ?? null;
      const routeAvailable = Boolean(route && marketStatus === 'Active' && debtStats?.status === 'Active');
      return {
        assetId: asset.assetId, symbol: asset.symbol, name: asset.name,
        mintAddress: asset.mint, reserveAddress: asset.reserve,
        lendingMarketAddress: KAMINO_MARKET_ADDRESS, debtMintAddress: USDC_MINT_ADDRESS,
        debtReserveAddress: USDC_RESERVE_ADDRESS, marketStatus, routeAvailable,
        dataAsOf: source ? generatedAt : null,
        supplyApy: numeric(collateralStats?.supplyApy?.current),
        borrowApy: numeric(debtStats?.borrowApy?.current),
        availableLiquidity: numeric(debtStats?.actualAvailableLiquidity),
        maxLtv: numeric(terms?.maxLtv), liquidationLtv: numeric(terms?.liquidationLtv),
        actionsPaused: !actionsEnabled || !routeAvailable,
        actionPauseReason: !this.options.enabled ? 'Kamino lending data is not enabled.'
          : !routeAvailable ? 'No verified collateral-to-USDC route is active.'
            : !actionsEnabled ? 'Lending actions are paused by Warren’s risk controls.' : null,
      };
    });
    return lendingCatalogResponseSchema.parse({
      marketId: LENDING_MARKET_ID, network: 'solana-mainnet', protocol: 'Kamino',
      lendingMarketAddress: KAMINO_MARKET_ADDRESS, programAddress: KAMINO_PROGRAM_ADDRESS,
      debtSymbol: 'USDC', actionsEnabled, newRiskEnabled,
      generatedAt, assets: assetsResponse,
    });
  }

  private async readProvider() {
    const fetcher = this.options.fetcher ?? fetch;
    const market = encodeURIComponent(KAMINO_MARKET_ADDRESS);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const [routesResponse, statsResponse] = await Promise.all([
        fetcher(`${this.options.baseUrl}/markets/collateral-reserves?market=${market}`, { signal: controller.signal, headers: { accept: 'application/json' } }),
        fetcher(`${this.options.baseUrl}/reserves/batch/stats?market=${market}`, { signal: controller.signal, headers: { accept: 'application/json' } }),
      ]);
      if (!routesResponse.ok || !statsResponse.ok) throw new Error('Kamino responded with an error.');
      const [routes, stats] = await Promise.all([routesResponse.json(), statsResponse.json()]);
      const routeRows = object(routes)?.collateralReserves;
      const statsObject = object(stats);
      if (!Array.isArray(routeRows) || !statsObject) throw new Error('Kamino returned an unexpected response.');
      return { routes: routeRows.map(parseRoute).filter(isRoute), stats: statsObject as Record<string, ReserveStats> };
    } catch {
      throw new LendingMarketFault('Kamino market data could not be refreshed.');
    } finally {
      clearTimeout(timeout);
    }
  }
}

type Route = { collateralMint: string; collateralReserve: string; borrowReserves: string[]; borrowReserveTerms: Array<{ reserve: string; maxLtv?: unknown; liquidationLtv?: unknown }> };
type ReserveStats = { status?: string; supplyApy?: { current?: unknown }; borrowApy?: { current?: unknown }; actualAvailableLiquidity?: unknown };
function object(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function parseRoute(value: unknown): Route | undefined {
  const row = object(value);
  if (!row || row.lendingMarket !== KAMINO_MARKET_ADDRESS || typeof row.collateralMint !== 'string' || typeof row.collateralReserve !== 'string' || !Array.isArray(row.borrowReserves)) return undefined;
  return { collateralMint: row.collateralMint, collateralReserve: row.collateralReserve, borrowReserves: row.borrowReserves.filter((item): item is string => typeof item === 'string'), borrowReserveTerms: Array.isArray(row.borrowReserveTerms) ? row.borrowReserveTerms.flatMap((term) => { const parsed = object(term); return parsed && typeof parsed.reserve === 'string' ? [{ reserve: parsed.reserve, maxLtv: parsed.maxLtv, liquidationLtv: parsed.liquidationLtv }] : []; }) : [] };
}
function isRoute(value: Route | undefined): value is Route { return value !== undefined; }
function numeric(value: unknown): string | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? String(value) : typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) ? value : null; }
