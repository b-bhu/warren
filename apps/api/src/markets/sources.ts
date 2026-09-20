import { z } from 'zod';
import {
  marketInstrumentSchema,
  type MarketDataState,
  type MarketInstrument,
  type PerpetualInstrument,
  type PrestockInstrument,
  type SpotInstrument,
} from '@warren/markets-contract';

type FetchLike = typeof fetch;

export interface MarketsSource {
  readonly id: string;
  load(): Promise<MarketInstrument[]>;
}

const advisorySchema = z.object({ status: z.enum(['caution', 'compromised', 'blocked']) }).passthrough();
const tokensMarketSchema = z.object({
  price: z.number().finite().nonnegative().nullable().optional(),
  liquidity: z.number().finite().nonnegative().nullable().optional(),
  volume24hUSD: z.number().finite().nonnegative().nullable().optional(),
  priceChange24hPercent: z.number().finite().nullable().optional(),
  asOf: z.number().finite().nullable().optional(),
  lastFetchedAt: z.number().finite().nullable().optional(),
}).passthrough();
const tokensVariantSchema = z.object({
  variantId: z.string().min(1),
  mint: z.string().min(1),
  issuer: z.string().min(1).optional(),
  issuerUrl: z.string().nullable().optional(),
  label: z.string().min(1).optional(),
  symbol: z.string().min(1),
  advisory: advisorySchema.nullable().optional(),
  stockVariantTier: z.enum(['share_redeemable', 'cash_redeemable', 'not_redeemable']).nullable().optional(),
  market: tokensMarketSchema.nullable().optional(),
}).passthrough();
const tokensAssetSchema = z.object({
  assetId: z.string().min(1),
  name: z.string().min(1),
  symbol: z.string().min(1),
  category: z.string(),
  imageUrl: z.string().nullable().optional(),
  primaryVariant: tokensVariantSchema.nullable().optional(),
  variants: z.array(tokensVariantSchema).optional(),
}).passthrough();
const tokensEnvelopeSchema = z.object({ assets: z.array(tokensAssetSchema) }).passthrough();

export class TokensSpotSource implements MarketsSource {
  readonly id = 'Tokens.xyz';

  constructor(private readonly options: {
    apiKey: string;
    baseUrl: string;
    timeoutMs: number;
    fetch?: FetchLike;
    now?: () => Date;
  }) {}

  async load(): Promise<SpotInstrument[]> {
    const url = new URL('/v1/assets/curated', this.options.baseUrl);
    url.searchParams.set('list', 'stocks');
    url.searchParams.set('groupBy', 'asset');
    url.searchParams.set('variants', 'all');
    url.searchParams.set('limit', '500');
    url.searchParams.set('primaryVariantStrategy', 'stock_redeemability');
    const response = await (this.options.fetch ?? fetch)(url, {
      headers: { 'x-api-key': this.options.apiKey },
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });
    if (!response.ok) throw new Error(`Tokens spot registry request failed with ${response.status}`);
    const payload = tokensEnvelopeSchema.parse(await response.json());
    const observedAt = (this.options.now ?? (() => new Date()))();

    return payload.assets.flatMap((asset) => {
      if (asset.category !== 'equity') return [];
      const variants = [asset.primaryVariant, ...(asset.variants ?? [])]
        .filter((variant): variant is z.infer<typeof tokensVariantSchema> => Boolean(variant))
        .filter((variant) => !isDedicatedPrestockVariant(variant));
      const primary = variants.find((variant) => variant.variantId === asset.primaryVariant?.variantId
        && isDiscoverableAdvisory(variant.advisory?.status))
        ?? variants.find((variant) => isDiscoverableAdvisory(variant.advisory?.status));
      if (!primary || !isSolanaAddress(primary.mint)) return [];

      const sourceAsOf = latestEpochIso(primary.market?.asOf, primary.market?.lastFetchedAt);
      const marketValue = timedValue('Token price', primary.market?.price, sourceAsOf, observedAt);
      const changePercent = timedMetric(primary.market?.priceChange24hPercent, sourceAsOf, observedAt);
      const volume24hUsd = timedMetric(primary.market?.volume24hUSD, sourceAsOf, observedAt);
      const issuer = primary.issuer?.trim() || primary.label?.trim() || 'Token issuer';
      const availability = primary.advisory?.status === 'caution'
        ? 'paused' as const
        : primary.market?.liquidity && primary.market.liquidity > 0
          ? 'available' as const
          : 'preview' as const;

      const candidate = {
        instrumentId: safeIdentifier(`spot:${primary.variantId}`),
        assetId: safeAssetId(asset.assetId),
        companyName: asset.name.trim(),
        ticker: asset.symbol.trim().toUpperCase(),
        logoUrl: safeUrl(asset.imageUrl),
        symbol: primary.symbol.trim(),
        provider: issuer,
        providerUrl: safeUrl(primary.issuerUrl),
        exactIdentifier: primary.mint,
        verificationState: 'verified',
        availability,
        description: `${asset.name.trim()} tokenized stock exposure issued by ${issuer}.`,
        marketValue,
        productType: 'spot',
        network: 'Solana',
        issuer,
        mint: primary.mint,
        stockVariantTier: primary.stockVariantTier ?? 'unknown',
        changePercent,
        volume24hUsd,
        liquidityUsd: primary.market?.liquidity ?? null,
      } satisfies SpotInstrument;
      const parsed = marketInstrumentSchema.safeParse(candidate);
      return parsed.success ? [parsed.data as SpotInstrument] : [];
    });
  }
}

const prestocksItemSchema = z.object({
  name: z.string().min(1),
  symbol: z.string().min(1),
  description: z.string().min(1),
  image: z.string().nullable().optional(),
  external_url: z.string().nullable().optional(),
  contract_address: z.string().min(1),
  markPrice: z.number().finite().nonnegative().nullable().optional(),
  markValuation: z.number().finite().nonnegative().nullable().optional(),
  tokenPrice: z.number().finite().nonnegative().nullable().optional(),
  impliedValuation: z.number().finite().nonnegative().nullable().optional(),
  supply: z.number().finite().nonnegative().nullable().optional(),
}).passthrough();

export class PreStocksSource implements MarketsSource {
  readonly id = 'PreStocks';

  constructor(private readonly options: { url: string; timeoutMs: number; fetch?: FetchLike }) {}

  async load(): Promise<PrestockInstrument[]> {
    const response = await (this.options.fetch ?? fetch)(this.options.url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });
    if (!response.ok) throw new Error(`PreStocks registry request failed with ${response.status}`);
    const payload = z.array(prestocksItemSchema).parse(await response.json());

    return payload.flatMap((item) => {
      if (!isSolanaAddress(item.contract_address)) return [];
      const companyName = item.name.replace(/\s+PreStocks$/i, '').trim();
      const candidate = {
        instrumentId: safeIdentifier(`prestock:prestocks:${item.symbol.toLowerCase()}`),
        assetId: safeAssetId(companyName),
        companyName,
        ticker: null,
        logoUrl: safeUrl(item.image),
        symbol: item.symbol.trim().toUpperCase(),
        provider: 'PreStocks',
        providerUrl: safeUrl(item.external_url) ?? 'https://prestocks.com',
        exactIdentifier: item.contract_address,
        verificationState: 'verified',
        availability: 'available',
        description: item.description.trim().slice(0, 1_000),
        marketValue: {
          label: 'Provider token price',
          amount: item.tokenPrice ?? null,
          currency: 'USD',
          asOf: null,
          dataState: 'unavailable',
        },
        productType: 'prestock',
        network: 'Solana',
        mint: item.contract_address,
        exposureType: 'spv_exposure',
        structureLabel: 'Token backed by provider-described 1:1 SPV exposure',
        markPrice: item.markPrice ?? null,
        tokenPrice: item.tokenPrice ?? null,
        impliedValuation: item.impliedValuation ?? null,
        markValuation: item.markValuation ?? null,
        supply: item.supply ?? null,
        transferFeeBps: null,
        detailsUrl: safeUrl(item.external_url),
      } satisfies PrestockInstrument;
      const parsed = marketInstrumentSchema.safeParse(candidate);
      return parsed.success ? [parsed.data as PrestockInstrument] : [];
    });
  }
}

const tesseraTokens = [
  { assetId: 'spacex', companyName: 'SpaceX', symbol: 'tSpaceX', mint: 'TSPXcLV76s6V2zDiZQ18kBfcbnjaE2ZzNT3ga2Pd99v' },
  { assetId: 'kalshi', companyName: 'Kalshi', symbol: 'tKalshi', mint: 'TKLSidmLVt3cqGaaodG8tyRzoANfQwoh67AccjmubeZ' },
  { assetId: 'openai', companyName: 'OpenAI', symbol: 'tOpenAI', mint: 'oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ' },
] as const;

export class TesseraSource implements MarketsSource {
  readonly id = 'Tessera';

  async load(): Promise<PrestockInstrument[]> {
    return tesseraTokens.map((token) => prestockInstrumentSchemaFromTessera(token));
  }
}

function prestockInstrumentSchemaFromTessera(token: typeof tesseraTokens[number]): PrestockInstrument {
  return marketInstrumentSchema.parse({
    instrumentId: `prestock:tessera:${token.symbol.toLowerCase()}`,
    assetId: token.assetId,
    companyName: token.companyName,
    ticker: null,
    logoUrl: null,
    symbol: token.symbol,
    provider: 'Tessera',
    providerUrl: 'https://tessera.pe',
    exactIdentifier: token.mint,
    verificationState: 'verified',
    availability: 'available',
    description: `${token.symbol} is a Tessera loan-participation token linked to private-company exposure.`,
    marketValue: { label: 'Market value', amount: null, currency: 'USD', asOf: null, dataState: 'unavailable' },
    productType: 'prestock',
    network: 'Solana',
    mint: token.mint,
    exposureType: 'loan_participation',
    structureLabel: 'Unsecured loan participation linked to liquidity-event proceeds',
    markPrice: null,
    tokenPrice: null,
    impliedValuation: null,
    markValuation: null,
    supply: null,
    transferFeeBps: 20,
    detailsUrl: 'https://docs.tessera.pe/overview/how-do-tessera-token-work',
  }) as PrestockInstrument;
}

const phoenixMarketSchema = z.object({
  symbol: z.string().min(1),
  marketStatus: z.string(),
  marketPubkey: z.string().min(1),
  baseLotsDecimals: z.number().int().min(-18).max(18),
  leverageTiers: z.array(z.object({ maxLeverage: z.number().finite().positive() }).passthrough()),
  fundingIntervalSeconds: z.number().int().positive(),
  openInterestCapBaseLots: z.union([z.string(), z.number()]).optional(),
  isolatedOnly: z.boolean(),
  statsSnapshot: z.object({ openInterestBaseLots: z.union([z.string(), z.number()]) }).passthrough().nullable().optional(),
  metadata: z.object({
    name: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    logoUri: z.string().nullable().optional(),
    calendar: z.object({ id: z.string() }).passthrough().nullable().optional(),
  }).passthrough().nullable().optional(),
}).passthrough();
const phoenixFundingSchema = z.object({
  series: z.array(z.object({
    symbol: z.string(),
    points: z.array(z.object({
      timestamp: z.number().finite().positive(),
      markPrice: z.string(),
      fundingRate: z.string(),
    }).passthrough()),
  }).passthrough()),
}).passthrough();

const NON_STOCK_EQUITY_CALENDAR_SYMBOLS = new Set(['SPY', 'QQQ']);
const PRIVATE_PERP_SYMBOLS = new Set(['SPCX', 'CBRS']);

export class PhoenixPerpetualSource implements MarketsSource {
  readonly id = 'Phoenix';

  constructor(private readonly options: {
    baseUrl: string;
    timeoutMs: number;
    fetch?: FetchLike;
    now?: () => Date;
  }) {}

  async load(): Promise<PerpetualInstrument[]> {
    const fetcher = this.options.fetch ?? fetch;
    const [marketsResponse, fundingResponse] = await Promise.all([
      fetcher(new URL('/v1/view/exchange/markets', this.options.baseUrl), {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.options.timeoutMs),
      }),
      fetcher(new URL('/v1/funding/overview', this.options.baseUrl), {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.options.timeoutMs),
      }),
    ]);
    if (!marketsResponse.ok) throw new Error(`Phoenix markets request failed with ${marketsResponse.status}`);
    if (!fundingResponse.ok) throw new Error(`Phoenix funding request failed with ${fundingResponse.status}`);
    const markets = z.array(phoenixMarketSchema).parse(await marketsResponse.json());
    const funding = phoenixFundingSchema.parse(await fundingResponse.json());
    const fundingBySymbol = new Map(funding.series.map((series) => [series.symbol.toUpperCase(), series.points]));
    const observedAt = (this.options.now ?? (() => new Date()))();

    return markets.flatMap((market) => {
      const symbol = market.symbol.trim().toUpperCase();
      if (market.metadata?.calendar?.id !== 'us_equities_extended' || NON_STOCK_EQUITY_CALENDAR_SYMBOLS.has(symbol)) return [];
      const latest = [...(fundingBySymbol.get(symbol) ?? [])].sort((left, right) => right.timestamp - left.timestamp)[0];
      const sourceAsOf = latest ? epochIso(latest.timestamp) : null;
      const markPrice = finiteNumber(latest?.markPrice);
      const fundingRate = finiteNumber(latest?.fundingRate);
      const openInterestLots = finiteNumber(market.statsSnapshot?.openInterestBaseLots);
      const openInterestBase = openInterestLots === null ? null : openInterestLots / (10 ** market.baseLotsDecimals);
      const companyName = market.metadata?.name?.trim() || symbol;
      const maxLeverage = Math.max(...market.leverageTiers.map((tier) => tier.maxLeverage));
      const candidate = {
        instrumentId: safeIdentifier(`perpetual:phoenix:${symbol.toLowerCase()}`),
        assetId: safeAssetId(companyName),
        companyName,
        ticker: PRIVATE_PERP_SYMBOLS.has(symbol) ? null : symbol,
        logoUrl: safeUrl(market.metadata?.logoUri),
        symbol,
        provider: 'Phoenix',
        providerUrl: 'https://phoenix.trade',
        exactIdentifier: market.marketPubkey,
        verificationState: 'verified',
        availability: market.marketStatus === 'active' ? 'available' : 'paused',
        description: market.metadata?.description?.trim().slice(0, 1_000) || `${symbol} equity perpetual on Phoenix.`,
        marketValue: timedValue('Mark price', markPrice, sourceAsOf, observedAt, 2 * 3_600_000, 12 * 3_600_000),
        productType: 'perpetual',
        venue: 'Phoenix',
        marketPubkey: market.marketPubkey,
        marginMode: market.isolatedOnly ? 'isolated' : 'cross',
        maxLeverage,
        fundingRatePercent: timedMetric(fundingRate === null ? null : fundingRate * 100, sourceAsOf, observedAt, 2 * 3_600_000, 12 * 3_600_000),
        nextFundingAt: sourceAsOf ? new Date(new Date(sourceAsOf).getTime() + market.fundingIntervalSeconds * 1_000).toISOString() : null,
        openInterestBase,
        oracleLabel: `${symbol}/USD index`,
      } satisfies PerpetualInstrument;
      const parsed = marketInstrumentSchema.safeParse(candidate);
      return parsed.success ? [parsed.data as PerpetualInstrument] : [];
    });
  }
}

export class FixtureSpotSource implements MarketsSource {
  readonly id = 'Warren fixtures';

  constructor(private readonly now: () => Date = () => new Date()) {}

  async load(): Promise<SpotInstrument[]> {
    const asOf = this.now().toISOString();
    return [
      fixtureSpot({ assetId: 'nvidia', companyName: 'NVIDIA', ticker: 'NVDA', symbol: 'NVDAx', price: 185, change: 2.34, asOf }),
      fixtureSpot({ assetId: 'apple', companyName: 'Apple', ticker: 'AAPL', symbol: 'AAPLx', price: 225, change: -0.64, asOf }),
    ];
  }
}

function fixtureSpot(input: { assetId: string; companyName: string; ticker: string; symbol: string; price: number; change: number; asOf: string }): SpotInstrument {
  const mint = input.assetId === 'nvidia' ? 'NVDAx1111111111111111111111111111111111111' : 'AAPLx1111111111111111111111111111111111111';
  return marketInstrumentSchema.parse({
    instrumentId: `spot:fixture:${input.assetId}`,
    assetId: input.assetId,
    companyName: input.companyName,
    ticker: input.ticker,
    logoUrl: null,
    symbol: input.symbol,
    provider: 'Warren fixtures',
    providerUrl: null,
    exactIdentifier: mint,
    verificationState: 'unverified',
    availability: 'preview',
    description: 'Controlled development fixture.',
    marketValue: { label: 'Sample token price', amount: input.price, currency: 'USD', asOf: input.asOf, dataState: 'sample' },
    productType: 'spot',
    network: 'Solana',
    issuer: 'Warren fixtures',
    mint,
    stockVariantTier: 'unknown',
    changePercent: { value: input.change, asOf: input.asOf, dataState: 'sample' },
    volume24hUsd: { value: null, asOf: null, dataState: 'unavailable' },
    liquidityUsd: null,
  }) as SpotInstrument;
}

function timedValue(
  label: string,
  amount: number | null | undefined,
  asOf: string | null,
  observedAt: Date,
  liveWindowMs = 5 * 60_000,
  delayedWindowMs = 30 * 60_000,
) {
  const safeAmount = typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 ? amount : null;
  return {
    label,
    amount: safeAmount,
    currency: 'USD' as const,
    asOf: safeAmount === null ? null : asOf,
    dataState: safeAmount === null ? 'unavailable' as const : stateFromTimestamp(asOf, observedAt, liveWindowMs, delayedWindowMs),
  };
}

function timedMetric(
  value: number | null | undefined,
  asOf: string | null,
  observedAt: Date,
  liveWindowMs = 5 * 60_000,
  delayedWindowMs = 30 * 60_000,
) {
  const safeValue = typeof value === 'number' && Number.isFinite(value) ? value : null;
  return {
    value: safeValue,
    asOf: safeValue === null ? null : asOf,
    dataState: safeValue === null ? 'unavailable' as const : stateFromTimestamp(asOf, observedAt, liveWindowMs, delayedWindowMs),
  };
}

function stateFromTimestamp(asOf: string | null, observedAt: Date, liveWindowMs: number, delayedWindowMs: number): MarketDataState {
  if (!asOf) return 'unavailable';
  const age = Math.max(0, observedAt.getTime() - new Date(asOf).getTime());
  if (age <= liveWindowMs) return 'live';
  if (age <= delayedWindowMs) return 'delayed';
  return 'stale';
}

function latestEpochIso(...values: Array<number | null | undefined>) {
  const timestamps = values.map(epochIso).filter((value): value is string => Boolean(value));
  return timestamps.sort().at(-1) ?? null;
}

function epochIso(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const milliseconds = value < 1_000_000_000_000 ? value * 1_000 : value;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function finiteNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch { return null; }
}

function safeAssetId(value: string) {
  const slug = value.trim().toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, 128) || 'unknown-asset';
}

function safeIdentifier(value: string) {
  return value.replace(/[^a-zA-Z0-9:_-]/g, '-').slice(0, 160);
}

function isSolanaAddress(value: string) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(value);
}

function isDiscoverableAdvisory(status: 'caution' | 'compromised' | 'blocked' | undefined) {
  return status !== 'compromised' && status !== 'blocked';
}

function isDedicatedPrestockVariant(variant: z.infer<typeof tokensVariantSchema>) {
  const identity = `${variant.variantId} ${variant.issuer ?? ''} ${variant.label ?? ''}`.toLocaleLowerCase();
  return identity.includes('tessera') || identity.includes('prestocks');
}
