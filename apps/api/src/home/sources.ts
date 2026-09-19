import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CompanySummary, IndexSummary, MarketStatus, NewsSummary } from '@warren/home-contract';
import { companySummarySchema } from '@warren/home-contract';
import { fixtureCompanies, fixtureIndices, fixtureMarket, fixtureNews } from './fixtures.js';

type FetchLike = typeof fetch;

export interface CatalogSource {
  load(): Promise<CompanySummary[]>;
}

export interface MarketSource {
  loadMarket(): Promise<MarketStatus>;
}

export interface IndexSource {
  loadIndices(): Promise<IndexSummary[]>;
}

export interface NewsSource {
  loadNews(companies?: readonly CompanySummary[]): Promise<NewsSummary[]>;
}

export class FixtureCatalogSource implements CatalogSource {
  constructor(private readonly now: () => Date = () => new Date()) {}
  async load() {
    return fixtureCompanies(this.now());
  }
}

export class FixtureSupplementSource implements MarketSource, IndexSource, NewsSource {
  private snapshot?: { market: MarketStatus; indices: IndexSummary[]; news: NewsSummary[] };
  constructor(private readonly now: () => Date = () => new Date()) {}
  async loadMarket(): Promise<MarketStatus> {
    return structuredClone(this.getSnapshot().market);
  }
  async loadIndices(): Promise<IndexSummary[]> {
    return structuredClone(this.getSnapshot().indices);
  }
  async loadNews(): Promise<NewsSummary[]> {
    return structuredClone(this.getSnapshot().news);
  }
  private getSnapshot() {
    if (!this.snapshot) {
      const at = this.now();
      this.snapshot = { market: fixtureMarket(at), indices: fixtureIndices(at), news: fixtureNews(at) };
    }
    return this.snapshot;
  }
}

const advisorySchema = z.object({ status: z.enum(['caution', 'compromised', 'blocked']) }).passthrough();
const marketSchema = z.object({
  lastFetchedAt: z.number().nullable().optional(),
  asOf: z.number().nullable().optional(),
}).passthrough();
const variantSchema = z.object({
  symbol: z.string().optional(),
  advisory: advisorySchema.nullable().optional(),
  market: marketSchema.nullable().optional(),
}).passthrough();
const tokensAssetSchema = z.object({
  assetId: z.string(),
  name: z.string().optional(),
  symbol: z.string().optional(),
  category: z.string(),
  imageUrl: z.string().nullable().optional(),
  stats: z.object({
    price: z.number().nullable().optional(),
    priceChange24hPercent: z.number().nullable().optional(),
  }).passthrough().nullable().optional(),
  advisories: z.array(advisorySchema.passthrough()).default([]),
  primaryVariant: variantSchema.nullable().optional(),
  variants: z.array(variantSchema).optional(),
}).passthrough();
const tokensCuratedSchema = z.object({ assets: z.array(tokensAssetSchema) }).passthrough();

function epochIso(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const milliseconds = value < 1_000_000_000_000 ? value * 1000 : value;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function stateFromTimestamp(timestamp: string | null, at: number): 'live' | 'delayed' | 'stale' | 'unavailable' {
  if (!timestamp) return 'unavailable';
  const age = Math.max(0, at - new Date(timestamp).getTime());
  if (age <= 5 * 60_000) return 'live';
  if (age <= 30 * 60_000) return 'delayed';
  return 'stale';
}

function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch { return null; }
}

export class TokensCatalogSource implements CatalogSource {
  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl: string;
      timeoutMs: number;
      fetch?: FetchLike;
      now?: () => Date;
    },
  ) {}

  async load(): Promise<CompanySummary[]> {
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
    if (!response.ok) throw new Error(`Tokens catalogue request failed with ${response.status}`);
    const payload = tokensCuratedSchema.parse(await response.json());
    const at = (this.options.now ?? (() => new Date()))();

    return payload.assets.flatMap((asset) => {
      if (asset.category !== 'equity' || !asset.name || !asset.symbol) return [];
      const variants = [asset.primaryVariant, ...(asset.variants ?? [])].filter((item): item is z.infer<typeof variantSchema> => Boolean(item));
      const safeVariants = variants.filter((variant) => !variant.advisory || variant.advisory.status === 'caution');
      const instrumentHints = [...new Set(safeVariants.map((variant) => variant.symbol?.trim()).filter((symbol): symbol is string => Boolean(symbol)))];
      const timestamps = safeVariants.flatMap((variant) => [epochIso(variant.market?.asOf), epochIso(variant.market?.lastFetchedAt)]).filter((value): value is string => Boolean(value));
      const priceAsOf = timestamps.sort().at(-1) ?? null;
      const referencePrice = priceAsOf ? asset.stats?.price ?? null : null;
      const changePercent = priceAsOf ? asset.stats?.priceChange24hPercent ?? null : null;
      const sourceState = stateFromTimestamp(priceAsOf, at.getTime());
      const parsed = companySummarySchema.safeParse({
        assetId: asset.assetId,
        companyName: asset.name,
        ticker: asset.symbol.toUpperCase(),
        logoUrl: safeUrl(asset.imageUrl),
        referencePrice,
        currency: 'USD',
        changePercent,
        changePeriod: '1d',
        priceAsOf: referencePrice === null ? null : priceAsOf,
        priceDataState: referencePrice === null ? 'unavailable' : sourceState,
        changeAsOf: changePercent === null ? null : priceAsOf,
        changeDataState: changePercent === null ? 'unavailable' : sourceState,
        earningsAt: null,
        instrumentHints,
      });
      return parsed.success ? [parsed.data] : [];
    });
  }
}

const tokensNewsEnvelopeSchema = z.object({ items: z.array(z.unknown()) }).passthrough();
const tokensNewsItemSchema = z.object({
  title: z.string().min(1),
  url: z.string().min(1),
  posted_at: z.string().min(1),
  source_name: z.string().min(1),
  image: z.string().optional().nullable(),
  related_coin_ids: z.array(z.string()).optional().default([]),
}).passthrough();

export class TokensNewsSource implements NewsSource {
  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl: string;
      timeoutMs: number;
      fetch?: FetchLike;
      now?: () => Date;
      limit?: number;
    },
  ) {}

  async loadNews(companies: readonly CompanySummary[] = []): Promise<NewsSummary[]> {
    const now = (this.options.now ?? (() => new Date()))();
    const url = new URL('/v1/news/feed', this.options.baseUrl);
    url.searchParams.set('source', 'news');
    url.searchParams.set('limit', '12');
    url.searchParams.set('tweet_reserve', '0');
    const response = await (this.options.fetch ?? fetch)(url, {
      headers: { 'x-api-key': this.options.apiKey },
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });
    if (!response.ok) throw new Error(`Tokens news request failed with ${response.status}`);
    const payload = tokensNewsEnvelopeSchema.parse(await response.json());
    const seenUrls = new Set<string>();
    const items = payload.items.flatMap((candidate) => {
      const parsed = tokensNewsItemSchema.safeParse(candidate);
      if (!parsed.success) return [];
      const item = parsed.data;
      const headline = item.title.trim().slice(0, 240);
      const source = item.source_name.trim().slice(0, 120);
      const articleUrl = safeUrl(item.url);
      const published = new Date(item.posted_at);
      if (!headline || !source || !articleUrl || Number.isNaN(published.getTime()) || seenUrls.has(articleUrl)) return [];
      const relatedAssetIds = relatedCompanies(headline, companies);
      seenUrls.add(articleUrl);
      const age = Math.max(0, now.getTime() - published.getTime());
      const dataState = age <= 6 * 3_600_000 ? 'live' as const
        : age <= 48 * 3_600_000 ? 'delayed' as const
          : 'stale' as const;
      return [{
        id: `tokens-news:${createHash('sha256').update(articleUrl).digest('hex').slice(0, 24)}`,
        headline,
        category: relatedAssetIds.length ? 'Company' : 'Markets',
        source,
        publishedAt: published.toISOString(),
        imageUrl: safeUrl(item.image),
        summary: null,
        url: articleUrl,
        relatedAssetIds,
        dataState,
      } satisfies NewsSummary];
    });
    return items
      .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
      .slice(0, Math.min(this.options.limit ?? 12, 20));
  }
}

function relatedCompanies(title: string, companies: readonly CompanySummary[]) {
  return companies.flatMap((company) => {
    const name = company.companyName.toLocaleLowerCase().trim();
    const ticker = company.ticker.toLocaleLowerCase().trim();
    const nameMatch = name.length >= 4 && new RegExp(`(^|[^a-z0-9])${escapeRegex(name)}([^a-z0-9]|$)`, 'i').test(title);
    const tickerMatch = ticker.length >= 3 && new RegExp(`(^|[^a-z0-9])${escapeRegex(ticker)}([^a-z0-9]|$)`, 'i').test(title);
    return nameMatch || tickerMatch ? [company.assetId] : [];
  }).slice(0, 20);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
