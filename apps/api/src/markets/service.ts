import {
  marketCompanyNewsResponseSchema,
  marketCompanyResponseSchema,
  marketHistoryResponseSchema,
  marketInstrumentSchema,
  marketSearchResponseSchema,
  marketsResponseSchema,
  type MarketAvailability,
  type MarketCompanyNewsResponse,
  type MarketCompanyResponse,
  type MarketCompanySummary,
  type MarketHistoryQuery,
  type MarketHistoryResponse,
  type MarketInstrument,
  type MarketProduct,
  type MarketsQuery,
  type MarketsResponse,
  type MarketsWarning,
  type MarketSearchQuery,
  type MarketSearchResponse,
  type MarketSort,
} from '@warren/markets-contract';
import { FreshStaleCache } from '../home/cache.js';
import type {
  MarketCompanyNewsSource,
  MarketHistoryResult,
  MarketHistorySource,
} from './details-sources.js';
import type { MarketsSource } from './sources.js';

export class MarketsServiceFault extends Error {
  constructor(
    readonly code: 'REGISTRY_UNAVAILABLE' | 'INVALID_CURSOR' | 'NOT_FOUND' | 'CONTRACT_INVALID',
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

type MarketsServiceOptions = {
  sources: readonly MarketsSource[];
  historySource?: MarketHistorySource;
  newsSource?: MarketCompanyNewsSource;
  cacheTtlMs: number;
  staleTtlMs: number;
  now?: () => Date;
};

export type RegistrySnapshot = {
  instruments: MarketInstrument[];
  warnings: MarketsWarning[];
};

const productOrder: readonly MarketProduct[] = ['spot', 'prestock', 'perpetual'];
const availabilityRank: Record<MarketAvailability, number> = {
  available: 4,
  preview: 3,
  paused: 2,
  unavailable: 1,
};

export class MarketsService {
  private readonly now: () => Date;
  private readonly caches = new Map<string, FreshStaleCache<MarketInstrument[]>>();
  private readonly historyCaches = new Map<string, FreshStaleCache<MarketHistoryResult>>();
  private readonly newsCaches = new Map<string, FreshStaleCache<MarketCompanyNewsResponse['items']>>();

  constructor(private readonly options: MarketsServiceOptions) {
    this.now = options.now ?? (() => new Date());
    for (const source of options.sources) {
      if (this.caches.has(source.id)) throw new Error(`Duplicate Markets source id: ${source.id}`);
      this.caches.set(source.id, new FreshStaleCache(
        options.cacheTtlMs,
        options.staleTtlMs,
        () => this.now().getTime(),
      ));
    }
  }

  async getMarkets(query: MarketsQuery): Promise<MarketsResponse> {
    const generatedAt = this.now().toISOString();
    const snapshot = await this.readRegistry();
    const sort = resolveSort(query.product, query.sort);
    let matches = snapshot.instruments.filter((instrument) => instrument.productType === query.product);
    if (query.availability === 'available') {
      matches = matches.filter((instrument) => instrument.availability === 'available');
    }
    matches = sortInstruments(matches, sort);

    const offset = decodeCursor(query.cursor, { product: query.product, availability: query.availability, sort });
    const page = matches.slice(offset, offset + query.limit);
    const nextOffset = offset + page.length;
    const hasNextPage = nextOffset < matches.length;

    try {
      return marketsResponseSchema.parse({
        generatedAt,
        query: { product: query.product, availability: query.availability, sort },
        counts: countProducts(snapshot.instruments),
        items: page,
        pageInfo: {
          nextCursor: hasNextPage
            ? encodeCursor(nextOffset, { product: query.product, availability: query.availability, sort })
            : null,
          hasNextPage,
        },
        warnings: snapshot.warnings,
      });
    } catch {
      throw new MarketsServiceFault('CONTRACT_INVALID', 'The Markets response could not be prepared.', true);
    }
  }

  async search(query: MarketSearchQuery): Promise<MarketSearchResponse> {
    const snapshot = await this.readRegistry();
    const needle = query.q.toLocaleLowerCase();
    const companies = groupCompanies(snapshot.instruments)
      .filter((company) => companySearchValues(company, snapshot.instruments)
        .some((value) => value.toLocaleLowerCase().includes(needle)))
      .sort((left, right) => {
        const rankDifference = companyMatchRank(right, needle, snapshot.instruments)
          - companyMatchRank(left, needle, snapshot.instruments);
        return rankDifference || left.companyName.localeCompare(right.companyName);
      })
      .slice(0, query.limit);

    try {
      return marketSearchResponseSchema.parse({
        generatedAt: this.now().toISOString(),
        query: query.q,
        items: companies,
        warnings: snapshot.warnings,
      });
    } catch {
      throw new MarketsServiceFault('CONTRACT_INVALID', 'The market search response could not be prepared.', true);
    }
  }

  async getCompany(assetId: string): Promise<MarketCompanyResponse> {
    const snapshot = await this.readRegistry();
    const instruments = companyInstruments(snapshot, assetId);
    const representative = chooseRepresentative(instruments);
    const primaryInstrument = choosePrimaryInstrument(instruments);
    const history = primaryInstrument
      ? this.options.historySource?.capability(primaryInstrument) ?? null
      : null;

    try {
      return marketCompanyResponseSchema.parse({
        generatedAt: this.now().toISOString(),
        company: {
          assetId,
          companyName: representative.companyName,
          ticker: representative.ticker,
          logoUrl: representative.logoUrl,
          description: chooseCompanyDescription(instruments, primaryInstrument),
        },
        primaryInstrumentId: primaryInstrument?.instrumentId ?? null,
        hero: primaryInstrument ? {
          instrumentId: primaryInstrument.instrumentId,
          productType: primaryInstrument.productType,
          provider: primaryInstrument.provider,
          value: primaryInstrument.marketValue,
        } : null,
        history,
        availableNow: instruments.filter((instrument) => instrument.availability === 'available').length,
        instruments,
        warnings: snapshot.warnings,
      });
    } catch {
      throw new MarketsServiceFault('CONTRACT_INVALID', 'The company Markets response could not be prepared.', true);
    }
  }

  /** Internal read model used by authenticated portfolio aggregation. */
  async getPortfolioRegistry(): Promise<RegistrySnapshot> {
    const snapshot = await this.readRegistry();
    return {
      instruments: snapshot.instruments.filter((instrument) =>
        instrument.verificationState === 'verified'
        && instrument.availability === 'available'),
      warnings: snapshot.warnings,
    };
  }

  async getCompanyHistory(assetId: string, query: MarketHistoryQuery): Promise<MarketHistoryResponse> {
    const snapshot = await this.readRegistry();
    const instruments = companyInstruments(snapshot, assetId);
    const instrument = instruments.find((candidate) => candidate.instrumentId === query.instrumentId);
    if (!instrument) throw new MarketsServiceFault('NOT_FOUND', 'This instrument is not available for the company.', false);
    const source = this.options.historySource;
    const capability = source?.capability(instrument) ?? null;
    if (!source || !capability || !capability.supportedRanges.includes(query.range)) {
      return this.unavailableHistory(assetId, instrument, query, snapshot.warnings, false);
    }

    const cacheKey = `${instrument.instrumentId}:${query.range}`;
    let cache = this.historyCaches.get(cacheKey);
    if (!cache) {
      cache = new FreshStaleCache(
        this.options.cacheTtlMs,
        this.options.staleTtlMs,
        () => this.now().getTime(),
      );
      this.historyCaches.set(cacheKey, cache);
    }

    try {
      const result = await cache.read(() => source.loadHistory(instrument, query.range));
      const history = result.value;
      const warnings = [...snapshot.warnings];
      const dataState = history.points.length === 0
        ? 'unavailable' as const
        : result.state === 'stale' ? 'stale' as const : history.dataState;
      if (result.state === 'stale') warnings.push({
        section: 'history',
        provider: source.id,
        product: instrument.productType,
        code: 'HISTORY_STALE',
        message: 'The latest chart refresh failed, so Warren is showing cached history.',
        retryable: true,
      });
      if (history.points.length === 0) warnings.push({
        section: 'history',
        provider: source.id,
        product: instrument.productType,
        code: 'HISTORY_UNAVAILABLE',
        message: 'Matching history is not available for this instrument and range.',
        retryable: false,
      });
      return marketHistoryResponseSchema.parse({
        generatedAt: this.now().toISOString(),
        assetId,
        instrumentId: instrument.instrumentId,
        range: query.range,
        interval: history.points.length ? history.interval : null,
        valueLabel: instrument.marketValue.label,
        currency: instrument.marketValue.currency,
        provider: history.points.length ? source.id : null,
        asOf: history.points.length ? history.asOf : null,
        dataState,
        points: history.points,
        warnings,
      });
    } catch {
      return this.unavailableHistory(assetId, instrument, query, snapshot.warnings, true);
    }
  }

  async getCompanyNews(assetId: string): Promise<MarketCompanyNewsResponse> {
    const snapshot = await this.readRegistry();
    const instruments = companyInstruments(snapshot, assetId);
    const representative = chooseRepresentative(instruments);
    const source = this.options.newsSource;
    if (!source) return marketCompanyNewsResponseSchema.parse({
      generatedAt: this.now().toISOString(),
      assetId,
      items: [],
      warnings: [...snapshot.warnings, {
        section: 'news',
        provider: 'Warren',
        product: null,
        code: 'NEWS_UNAVAILABLE',
        message: 'Company news is not configured for this environment.',
        retryable: false,
      }],
    });

    let cache = this.newsCaches.get(assetId);
    if (!cache) {
      cache = new FreshStaleCache(
        this.options.cacheTtlMs,
        this.options.staleTtlMs,
        () => this.now().getTime(),
      );
      this.newsCaches.set(assetId, cache);
    }
    try {
      const result = await cache.read(() => source.loadCompanyNews({
        assetId,
        companyName: representative.companyName,
        ticker: representative.ticker,
      }));
      const items = result.state === 'stale'
        ? result.value.map((item) => ({ ...item, dataState: item.dataState === 'sample' ? 'sample' as const : 'stale' as const }))
        : result.value;
      const warnings = [...snapshot.warnings];
      if (result.state === 'stale') warnings.push({
        section: 'news',
        provider: source.id,
        product: null,
        code: 'NEWS_STALE',
        message: 'The latest news refresh failed, so Warren is showing cached company news.',
        retryable: true,
      });
      return marketCompanyNewsResponseSchema.parse({
        generatedAt: this.now().toISOString(),
        assetId,
        items,
        warnings,
      });
    } catch {
      return marketCompanyNewsResponseSchema.parse({
        generatedAt: this.now().toISOString(),
        assetId,
        items: [],
        warnings: [...snapshot.warnings, {
          section: 'news',
          provider: source.id,
          product: null,
          code: 'NEWS_UNAVAILABLE',
          message: 'Company news could not be refreshed.',
          retryable: true,
        }],
      });
    }
  }

  clearCache() {
    for (const cache of this.caches.values()) cache.clear();
    for (const cache of this.historyCaches.values()) cache.clear();
    for (const cache of this.newsCaches.values()) cache.clear();
  }

  private unavailableHistory(
    assetId: string,
    instrument: MarketInstrument,
    query: MarketHistoryQuery,
    registryWarnings: MarketsWarning[],
    retryable: boolean,
  ): MarketHistoryResponse {
    return marketHistoryResponseSchema.parse({
      generatedAt: this.now().toISOString(),
      assetId,
      instrumentId: instrument.instrumentId,
      range: query.range,
      interval: null,
      valueLabel: instrument.marketValue.label,
      currency: instrument.marketValue.currency,
      provider: null,
      asOf: null,
      dataState: 'unavailable',
      points: [],
      warnings: [...registryWarnings, {
        section: 'history',
        provider: this.options.historySource?.id ?? 'Warren',
        product: instrument.productType,
        code: 'HISTORY_UNAVAILABLE',
        message: retryable
          ? 'Matching history could not be refreshed.'
          : 'Matching history is not available for this instrument and range.',
        retryable,
      }],
    });
  }

  private async readRegistry(): Promise<RegistrySnapshot> {
    const results = await Promise.all(this.options.sources.map(async (source) => {
      const cache = this.caches.get(source.id)!;
      try {
        const result = await cache.read(async () => {
          const loaded = await source.load();
          return loaded.map((instrument) => marketInstrumentSchema.parse(instrument));
        });
        return { source, instruments: result.state === 'stale' ? result.value.map(markInstrumentStale) : result.value, state: result.state };
      } catch {
        return { source, error: true as const };
      }
    }));

    const warnings: MarketsWarning[] = [];
    const instruments: MarketInstrument[] = [];
    let healthySources = 0;
    for (const result of results) {
      if ('error' in result) {
        warnings.push({
          section: 'registry',
          provider: result.source.id,
          product: null,
          code: 'PROVIDER_UNAVAILABLE',
          message: `${result.source.id} market data could not be refreshed.`,
          retryable: true,
        });
        continue;
      }
      healthySources += 1;
      if (result.state === 'stale') {
        warnings.push({
          section: 'registry',
          provider: result.source.id,
          product: null,
          code: 'PROVIDER_STALE',
          message: `${result.source.id} could not refresh, so Warren is showing cached registry data.`,
          retryable: true,
        });
      }
      instruments.push(...result.instruments);
    }
    if (healthySources === 0) {
      throw new MarketsServiceFault('REGISTRY_UNAVAILABLE', 'The Markets registry could not be refreshed.', true);
    }

    return {
      instruments: normalizeRegistry(instruments),
      warnings,
    };
  }
}

function normalizeRegistry(candidates: readonly MarketInstrument[]): MarketInstrument[] {
  const deduplicated: MarketInstrument[] = [];
  const seen = new Set<string>();
  for (const instrument of candidates) {
    if (seen.has(instrument.instrumentId)) continue;
    seen.add(instrument.instrumentId);
    deduplicated.push(structuredClone(instrument));
  }

  const spotByTicker = new Map<string, MarketInstrument>();
  const identityByName = new Map<string, MarketInstrument>();
  for (const instrument of deduplicated) {
    if (instrument.productType === 'spot' && instrument.ticker) {
      spotByTicker.set(instrument.ticker.toUpperCase(), instrument);
      spotByTicker.set(instrument.symbol.toUpperCase(), instrument);
    }
    const key = normalizeCompanyName(instrument.companyName);
    const current = identityByName.get(key);
    if (!current || identityPriority(instrument) > identityPriority(current)) identityByName.set(key, instrument);
  }

  for (const instrument of deduplicated) {
    if (instrument.productType === 'spot') continue;
    const canonical = (instrument.ticker ? spotByTicker.get(instrument.ticker.toUpperCase()) : undefined)
      ?? spotByTicker.get(instrument.symbol.toUpperCase())
      ?? identityByName.get(normalizeCompanyName(instrument.companyName));
    if (!canonical) continue;
    instrument.assetId = canonical.assetId;
    instrument.companyName = canonical.companyName;
    instrument.logoUrl ??= canonical.logoUrl;
  }

  return deduplicated;
}

function groupCompanies(instruments: readonly MarketInstrument[]): MarketCompanySummary[] {
  const byAsset = new Map<string, MarketInstrument[]>();
  for (const instrument of instruments) {
    const group = byAsset.get(instrument.assetId) ?? [];
    group.push(instrument);
    byAsset.set(instrument.assetId, group);
  }
  return [...byAsset.entries()].map(([assetId, group]) => {
    const representative = chooseRepresentative(group);
    const capabilities = productOrder.flatMap((productType) => {
      const matching = group.filter((instrument) => instrument.productType === productType);
      if (matching.length === 0) return [];
      return [{
        productType,
        instrumentCount: matching.length,
        availability: matching.reduce((best, instrument) => availabilityRank[instrument.availability] > availabilityRank[best]
          ? instrument.availability
          : best, matching[0].availability),
      }];
    });
    return {
      assetId,
      companyName: representative.companyName,
      ticker: representative.ticker,
      logoUrl: representative.logoUrl,
      capabilities,
    };
  });
}

function chooseRepresentative(instruments: readonly MarketInstrument[]) {
  return [...instruments].sort((left, right) => identityPriority(right) - identityPriority(left)
    || Number(Boolean(right.logoUrl)) - Number(Boolean(left.logoUrl)))[0];
}

function companyInstruments(snapshot: RegistrySnapshot, assetId: string) {
  const instruments = snapshot.instruments
    .filter((instrument) => instrument.assetId === assetId)
    .sort((left, right) => productOrder.indexOf(left.productType) - productOrder.indexOf(right.productType)
      || availabilityRank[right.availability] - availabilityRank[left.availability]
      || left.provider.localeCompare(right.provider)
      || left.instrumentId.localeCompare(right.instrumentId));
  if (instruments.length === 0) {
    throw new MarketsServiceFault('NOT_FOUND', 'This company is not in the Markets registry.', false);
  }
  return instruments;
}

function choosePrimaryInstrument(instruments: readonly MarketInstrument[]): MarketInstrument | undefined {
  const known = instruments.filter((instrument) => instrument.marketValue.amount !== null);
  const priorities = [
    (instrument: MarketInstrument) => instrument.verificationState === 'verified'
      && instrument.availability === 'available' && instrument.productType === 'spot',
    (instrument: MarketInstrument) => instrument.verificationState === 'verified'
      && instrument.availability === 'available' && instrument.productType === 'prestock',
    (instrument: MarketInstrument) => instrument.verificationState === 'verified'
      && instrument.availability === 'available' && instrument.productType === 'perpetual',
    (instrument: MarketInstrument) => instrument.verificationState === 'verified'
      && ['preview', 'paused'].includes(instrument.availability),
  ];
  for (const matches of priorities) {
    const candidates = known.filter(matches).sort(compareHeroCandidates);
    if (candidates[0]) return candidates[0];
  }
  return undefined;
}

function compareHeroCandidates(left: MarketInstrument, right: MarketInstrument) {
  if (left.productType === 'spot' && right.productType === 'spot') {
    const tierRank = { share_redeemable: 4, cash_redeemable: 3, not_redeemable: 2, unknown: 1 } as const;
    const tierDifference = tierRank[right.stockVariantTier] - tierRank[left.stockVariantTier];
    if (tierDifference) return tierDifference;
    const liquidityDifference = (right.liquidityUsd ?? -1) - (left.liquidityUsd ?? -1);
    if (liquidityDifference) return liquidityDifference;
  }
  return productOrder.indexOf(left.productType) - productOrder.indexOf(right.productType)
    || left.provider.localeCompare(right.provider)
    || left.instrumentId.localeCompare(right.instrumentId);
}

function chooseCompanyDescription(
  instruments: readonly MarketInstrument[],
  primaryInstrument: MarketInstrument | undefined,
) {
  const candidates = [primaryInstrument, ...instruments]
    .filter((instrument): instrument is MarketInstrument => Boolean(instrument))
    .filter((instrument, index, all) => all.findIndex((candidate) => candidate.instrumentId === instrument.instrumentId) === index)
    .filter((instrument) => instrument.verificationState === 'verified' && Boolean(instrument.description));
  const selected = candidates[0];
  return selected?.description ? {
    text: selected.description,
    source: selected.provider,
    sourceUrl: selected.providerUrl,
  } : null;
}

function identityPriority(instrument: MarketInstrument) {
  return instrument.productType === 'spot' ? 3 : instrument.productType === 'perpetual' ? 2 : 1;
}

function companySearchValues(company: MarketCompanySummary, instruments: readonly MarketInstrument[]) {
  return [
    company.companyName,
    company.ticker ?? '',
    ...instruments.filter((instrument) => instrument.assetId === company.assetId)
      .flatMap((instrument) => [instrument.symbol, instrument.provider]),
  ].filter(Boolean);
}

function companyMatchRank(company: MarketCompanySummary, needle: string, instruments: readonly MarketInstrument[]) {
  const values = companySearchValues(company, instruments).map((value) => value.toLocaleLowerCase());
  if (values.some((value) => value === needle)) return 3;
  if (values.some((value) => value.startsWith(needle))) return 2;
  return 1;
}

function resolveSort(product: MarketProduct, requested: MarketSort | undefined): MarketSort {
  if (requested) return requested;
  return product === 'prestock' ? 'alphabetical' : 'activity';
}

function sortInstruments(instruments: readonly MarketInstrument[], sort: MarketSort) {
  return [...instruments].sort((left, right) => {
    if (sort === 'alphabetical') return left.companyName.localeCompare(right.companyName) || left.provider.localeCompare(right.provider);
    if (sort === 'change') {
      const leftChange = left.productType === 'spot' ? left.changePercent.value ?? Number.NEGATIVE_INFINITY : Number.NEGATIVE_INFINITY;
      const rightChange = right.productType === 'spot' ? right.changePercent.value ?? Number.NEGATIVE_INFINITY : Number.NEGATIVE_INFINITY;
      return rightChange - leftChange || left.companyName.localeCompare(right.companyName);
    }
    const leftActivity = activityScore(left);
    const rightActivity = activityScore(right);
    return rightActivity - leftActivity || left.companyName.localeCompare(right.companyName);
  });
}

function activityScore(instrument: MarketInstrument) {
  if (instrument.productType === 'spot') return instrument.volume24hUsd.value ?? -1;
  if (instrument.productType === 'perpetual') return instrument.openInterestBase ?? -1;
  return -1;
}

function countProducts(instruments: readonly MarketInstrument[]) {
  return {
    spot: instruments.filter((instrument) => instrument.productType === 'spot').length,
    prestock: instruments.filter((instrument) => instrument.productType === 'prestock').length,
    perpetual: instruments.filter((instrument) => instrument.productType === 'perpetual').length,
  };
}

function markInstrumentStale(instrument: MarketInstrument): MarketInstrument {
  const copy = structuredClone(instrument);
  if (copy.marketValue.amount !== null && !['sample', 'unavailable'].includes(copy.marketValue.dataState)) {
    copy.marketValue.dataState = 'stale';
  }
  if (copy.productType === 'spot') {
    if (copy.changePercent.value !== null && !['sample', 'unavailable'].includes(copy.changePercent.dataState)) copy.changePercent.dataState = 'stale';
    if (copy.volume24hUsd.value !== null && !['sample', 'unavailable'].includes(copy.volume24hUsd.dataState)) copy.volume24hUsd.dataState = 'stale';
  }
  if (copy.productType === 'perpetual' && copy.fundingRatePercent.value !== null
    && !['sample', 'unavailable'].includes(copy.fundingRatePercent.dataState)) {
    copy.fundingRatePercent.dataState = 'stale';
  }
  return copy;
}

function normalizeCompanyName(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
}

function encodeCursor(offset: number, scope: { product: MarketProduct; availability: 'all' | 'available'; sort: MarketSort }) {
  return Buffer.from(JSON.stringify({ v: 1, offset, ...scope }), 'utf8').toString('base64url');
}

function decodeCursor(
  cursor: string | undefined,
  scope: { product: MarketProduct; availability: 'all' | 'available'; sort: MarketSort },
) {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (parsed.v !== 1 || !Number.isSafeInteger(parsed.offset) || Number(parsed.offset) < 0
      || parsed.product !== scope.product || parsed.availability !== scope.availability || parsed.sort !== scope.sort) throw new Error();
    return Number(parsed.offset);
  } catch {
    throw new MarketsServiceFault('INVALID_CURSOR', 'The Markets cursor is not valid for this view.', false);
  }
}
