import {
  assetsResponseSchema,
  companySummarySchema,
  homeResponseSchema,
  indexSummarySchema,
  marketStatusSchema,
  newsSummarySchema,
  type AssetsQuery,
  type AssetsResponse,
  type AssetsSort,
  type CompanySummary,
  type HomeResponse,
  type HomeWarning,
  type MarketStatus,
} from '@warren/home-contract';
import { FreshStaleCache } from './cache.js';
import type { CatalogSource, IndexSource, MarketSource, NewsSource } from './sources.js';

export class HomeServiceFault extends Error {
  constructor(readonly code: 'CATALOG_UNAVAILABLE' | 'INVALID_CURSOR' | 'CONTRACT_INVALID', message: string, readonly retryable: boolean) {
    super(message);
  }
}

const EARNINGS_WINDOW_MS = 30 * 86_400_000;

type HomeServiceOptions = {
  catalog: CatalogSource;
  market: MarketSource;
  indices: IndexSource;
  news: NewsSource;
  cacheTtlMs: number;
  staleTtlMs: number;
  homeLimit?: number;
  now?: () => Date;
};

export class HomeService {
  private readonly now: () => Date;
  private readonly catalogCache: FreshStaleCache<CompanySummary[]>;

  constructor(private readonly options: HomeServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.catalogCache = new FreshStaleCache(options.cacheTtlMs, options.staleTtlMs, () => this.now().getTime());
  }

  async getHome(): Promise<HomeResponse> {
    const generatedAt = this.now();
    const warnings: HomeWarning[] = [];
    const catalog = await this.readCatalog(warnings);
    const sections = await this.readOptionalSections(catalog, warnings);
    const homeLimit = Math.min(this.options.homeLimit ?? 24, 36);
    const ranked = sortByDailyChange(catalog, 'change_desc');
    const selected = ranked.slice(0, homeLimit);
    const hasNextPage = ranked.length > homeLimit;
    const response = {
      generatedAt: generatedAt.toISOString(),
      market: sections.market,
      indices: sections.indices,
      companies: selected,
      pageInfo: { nextCursor: hasNextPage ? encodeCursor(homeLimit, 'change_desc') : null, hasNextPage },
      news: sections.news,
      warnings,
    };
    try { return homeResponseSchema.parse(response); }
    catch { throw new HomeServiceFault('CONTRACT_INVALID', 'The Home response could not be prepared.', true); }
  }

  async getAssets(query: AssetsQuery): Promise<AssetsResponse> {
    const generatedAt = this.now();
    const warnings: HomeWarning[] = [];
    const catalog = await this.readCatalog(warnings);
    let matches: CompanySummary[];

    if (query.ids) {
      const byId = new Map(catalog.map((company) => [company.assetId, company]));
      matches = query.ids.flatMap((assetId) => {
        const company = byId.get(assetId);
        return company ? [company] : [];
      });
      const unknown = query.ids.filter((assetId) => !byId.has(assetId));
      if (unknown.length) warnings.push({
        section: 'companies',
        code: 'UNKNOWN_ASSET_IDS',
        message: 'Some saved companies are no longer available in the current catalogue.',
        retryable: false,
        assetIds: unknown,
      });
    } else {
      matches = catalog;
      if (query.view === 'earnings') {
        const earningsWindowEnd = generatedAt.getTime() + EARNINGS_WINDOW_MS;
        matches = matches
          .filter((company) => {
            if (!company.earningsAt) return false;
            const earningsAt = new Date(company.earningsAt).getTime();
            return earningsAt >= generatedAt.getTime() && earningsAt <= earningsWindowEnd;
          })
          .sort((left, right) => String(left.earningsAt).localeCompare(String(right.earningsAt)));
        if (matches.length === 0) warnings.push({
          section: 'earnings',
          code: 'EARNINGS_DATA_UNAVAILABLE',
          message: 'Upcoming earnings data is not available for the current catalogue.',
          retryable: false,
        });
      }
      if (query.q) {
        const needle = query.q.toLocaleLowerCase();
        matches = matches.filter((company) => [company.companyName, company.ticker, ...company.instrumentHints]
          .some((value) => value.toLocaleLowerCase().includes(needle)));
      }
      if (query.sort !== 'catalog') matches = sortByDailyChange(matches, query.sort);
    }

    const offset = query.ids ? 0 : decodeCursor(query.cursor, query.sort);
    const page = query.ids ? matches : matches.slice(offset, offset + query.limit);
    const nextOffset = offset + page.length;
    const hasNextPage = !query.ids && nextOffset < matches.length;
    try {
      return assetsResponseSchema.parse({
        generatedAt: generatedAt.toISOString(),
        query: { q: query.q ?? null, view: query.view, sort: query.sort, ids: query.ids ?? [] },
        items: page,
        pageInfo: { nextCursor: hasNextPage ? encodeCursor(nextOffset, query.sort) : null, hasNextPage },
        warnings,
      });
    } catch { throw new HomeServiceFault('CONTRACT_INVALID', 'The asset response could not be prepared.', true); }
  }

  clearCache() {
    this.catalogCache.clear();
  }

  private async readCatalog(warnings: HomeWarning[]) {
    try {
      const result = await this.catalogCache.read(async () => {
        const catalog = normalizeCatalog(await this.options.catalog.load());
        if (catalog.length === 0) throw new Error('The normalized catalogue is empty.');
        return catalog;
      });
      if (result.state === 'stale') warnings.push({
        section: 'companies',
        code: 'CATALOG_STALE',
        message: 'The latest catalogue refresh failed, so Warren is showing recently cached data.',
        retryable: true,
      });
      return result.state === 'stale'
        ? result.value.map((company) => ({
          ...company,
          priceDataState: company.referencePrice === null ? 'unavailable' as const : 'stale' as const,
          changeDataState: company.changePercent === null ? 'unavailable' as const : 'stale' as const,
        }))
        : result.value;
    } catch {
      throw new HomeServiceFault('CATALOG_UNAVAILABLE', 'The company catalogue could not be refreshed.', true);
    }
  }

  private async readOptionalSections(companies: readonly CompanySummary[], warnings: HomeWarning[]) {
    const [marketResult, indicesResult, newsResult] = await Promise.allSettled([
      this.options.market.loadMarket(),
      this.options.indices.loadIndices(),
      this.options.news.loadNews(companies),
    ]);

    const marketParsed = marketResult.status === 'fulfilled'
      ? marketStatusSchema.safeParse(marketResult.value)
      : { success: false as const };
    const indicesParsed = indicesResult.status === 'fulfilled'
      ? indexSummarySchema.array().max(20).safeParse(indicesResult.value)
      : { success: false as const };
    const newsParsed = newsResult.status === 'fulfilled'
      ? newsSummarySchema.array().max(20).safeParse(newsResult.value)
      : { success: false as const };

    if (!marketParsed.success) warnings.push({
      section: 'market',
      code: 'MARKET_STATUS_UNAVAILABLE',
      message: 'US market status could not be refreshed.',
      retryable: true,
    });
    if (!indicesParsed.success) warnings.push({
      section: 'indices',
      code: 'INDICES_UNAVAILABLE',
      message: 'Market indices could not be refreshed.',
      retryable: true,
    });
    if (!newsParsed.success) warnings.push({
      section: 'news',
      code: 'NEWS_UNAVAILABLE',
      message: 'Market news could not be refreshed.',
      retryable: true,
    });
    else if (newsParsed.data.length === 0) warnings.push({
      section: 'news',
      code: 'NEWS_EMPTY',
      message: 'No news articles are available right now.',
      retryable: false,
    });

    const market: MarketStatus = marketParsed.success ? marketParsed.data : {
      region: 'US',
      session: 'unavailable',
      label: 'US market status needs a refresh',
      asOf: null,
      nextOpenAt: null,
      nextCloseAt: null,
      dataState: 'unavailable',
    };
    return {
      market,
      indices: indicesParsed.success ? indicesParsed.data : [],
      news: newsParsed.success ? newsParsed.data : [],
    };
  }
}

function normalizeCatalog(companies: CompanySummary[]) {
  const ordered: CompanySummary[] = [];
  const byId = new Map<string, CompanySummary>();
  for (const candidate of companies) {
    const company = companySummarySchema.parse(candidate);
    const existing = byId.get(company.assetId);
    if (!existing) {
      const copy = { ...company, instrumentHints: [...new Set(company.instrumentHints)] };
      byId.set(company.assetId, copy);
      ordered.push(copy);
      continue;
    }
    existing.instrumentHints = [...new Set([...existing.instrumentHints, ...company.instrumentHints])];
    if (existing.referencePrice === null && company.referencePrice !== null) {
      existing.referencePrice = company.referencePrice;
      existing.priceAsOf = company.priceAsOf;
      existing.priceDataState = company.priceDataState;
    }
    if (existing.changePercent === null && company.changePercent !== null) {
      existing.changePercent = company.changePercent;
      existing.changeAsOf = company.changeAsOf;
      existing.changeDataState = company.changeDataState;
    }
  }
  return ordered;
}

function sortByDailyChange(companies: readonly CompanySummary[], sort: Exclude<AssetsSort, 'catalog'>) {
  const direction = sort === 'change_desc' ? -1 : 1;
  return companies
    .filter((company): company is CompanySummary & { changePercent: number } => company.changePercent !== null)
    .sort((left, right) => direction * (left.changePercent - right.changePercent)
      || left.companyName.localeCompare(right.companyName)
      || left.assetId.localeCompare(right.assetId));
}

function encodeCursor(offset: number, sort: AssetsSort) {
  return Buffer.from(JSON.stringify({ v: 1, offset, sort }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined, sort: AssetsSort) {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || (parsed as { v?: unknown }).v !== 1) throw new Error();
    if ((parsed as { sort?: unknown }).sort !== sort) throw new Error();
    const offset = (parsed as { offset?: unknown }).offset;
    if (!Number.isSafeInteger(offset) || Number(offset) < 0) throw new Error();
    return Number(offset);
  } catch {
    throw new HomeServiceFault('INVALID_CURSOR', 'The catalogue cursor is not valid.', false);
  }
}
