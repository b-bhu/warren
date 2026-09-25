import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  marketCompanyNewsItemSchema,
  marketHistoryCapabilitySchema,
  marketHistoryPointSchema,
  type MarketCompanyNewsItem,
  type MarketDataState,
  type MarketHistoryCapability,
  type MarketHistoryPoint,
  type MarketHistoryRange,
  type MarketInstrument,
} from '@warren/markets-contract';

type FetchLike = typeof fetch;

export type MarketCompanyIdentity = {
  assetId: string;
  companyName: string;
  ticker: string | null;
};

export type MarketHistoryResult = {
  interval: '5m' | '1H' | '4H' | '1D' | '1W';
  asOf: string | null;
  dataState: MarketDataState;
  points: MarketHistoryPoint[];
};

export interface MarketHistorySource {
  readonly id: string;
  capability(instrument: MarketInstrument): MarketHistoryCapability | null;
  loadHistory(instrument: MarketInstrument, range: MarketHistoryRange): Promise<MarketHistoryResult>;
}

export interface MarketCompanyNewsSource {
  readonly id: string;
  loadCompanyNews(company: MarketCompanyIdentity): Promise<MarketCompanyNewsItem[]>;
}

const historyRangeOptions: Record<MarketHistoryRange, {
  interval: MarketHistoryResult['interval'];
  durationSeconds: number;
}> = {
  '1d': { interval: '5m', durationSeconds: 86_400 },
  '1w': { interval: '1H', durationSeconds: 7 * 86_400 },
  '1m': { interval: '4H', durationSeconds: 30 * 86_400 },
  '3m': { interval: '1D', durationSeconds: 90 * 86_400 },
  '6m': { interval: '1D', durationSeconds: 182 * 86_400 },
  '1y': { interval: '1D', durationSeconds: 365 * 86_400 },
  '5y': { interval: '1W', durationSeconds: 5 * 365 * 86_400 },
};

const historyEnvelopeSchema = z.object({
  assetId: z.string().min(1),
  mint: z.string().min(1),
  interval: z.enum(['1m', '5m', '15m', '1H', '4H', '1D', '1W']),
  from: z.number().finite(),
  to: z.number().finite(),
  candles: z.array(z.object({
    time: z.number().finite().positive(),
    open: z.number().finite().nonnegative(),
    high: z.number().finite().nonnegative(),
    low: z.number().finite().nonnegative(),
    close: z.number().finite().nonnegative(),
    volume: z.number().finite().nonnegative().nullable().optional(),
  }).passthrough()).max(5_000),
}).passthrough();

const newsEnvelopeSchema = z.object({ items: z.array(z.unknown()) }).passthrough();
const newsItemSchema = z.object({
  title: z.string().min(1),
  url: z.string().min(1),
  posted_at: z.string().min(1),
  source_name: z.string().min(1),
  image: z.string().nullable().optional(),
}).passthrough();

export class TokensMarketDetailsSource implements MarketHistorySource, MarketCompanyNewsSource {
  readonly id = 'Tokens.xyz';
  private readonly now: () => Date;

  constructor(private readonly options: {
    apiKey: string;
    baseUrl: string;
    timeoutMs: number;
    fetch?: FetchLike;
    now?: () => Date;
  }) {
    this.now = options.now ?? (() => new Date());
  }

  capability(instrument: MarketInstrument): MarketHistoryCapability | null {
    if (instrument.productType !== 'spot' || instrument.verificationState !== 'verified') return null;
    return marketHistoryCapabilitySchema.parse({
      instrumentId: instrument.instrumentId,
      valueLabel: instrument.marketValue.label,
      currency: instrument.marketValue.currency,
      source: this.id,
      supportedRanges: Object.keys(historyRangeOptions),
      defaultRange: '1m',
    });
  }

  async loadHistory(instrument: MarketInstrument, range: MarketHistoryRange): Promise<MarketHistoryResult> {
    const capability = this.capability(instrument);
    if (!capability || instrument.productType !== 'spot') throw new Error('History is not supported for this instrument.');
    const selected = historyRangeOptions[range];
    const to = Math.floor(this.now().getTime() / 1_000);
    const from = to - selected.durationSeconds;
    const url = new URL(`/v1/assets/${encodeURIComponent(instrument.assetId)}/ohlcv`, this.options.baseUrl);
    url.searchParams.set('mint', instrument.mint);
    url.searchParams.set('interval', selected.interval);
    url.searchParams.set('from', String(from));
    url.searchParams.set('to', String(to));
    const response = await (this.options.fetch ?? fetch)(url, {
      headers: { 'x-api-key': this.options.apiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });
    if (!response.ok) throw new Error(`Tokens history request failed with ${response.status}`);
    const payload = historyEnvelopeSchema.parse(await response.json());
    if (payload.assetId !== instrument.assetId || payload.mint !== instrument.mint || payload.interval !== selected.interval) {
      throw new Error('Tokens history identity did not match the requested instrument.');
    }
    const points = payload.candles
      .map((candle) => marketHistoryPointSchema.safeParse({
        time: new Date(candle.time * 1_000).toISOString(),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume ?? null,
      }))
      .flatMap((parsed) => parsed.success ? [parsed.data] : [])
      .sort((left, right) => left.time.localeCompare(right.time))
      .slice(-2_000);
    const asOf = points.at(-1)?.time ?? null;
    return {
      interval: selected.interval,
      asOf,
      dataState: asOf ? historyState(asOf, selected.interval, this.now()) : 'unavailable',
      points,
    };
  }

  async loadCompanyNews(company: MarketCompanyIdentity): Promise<MarketCompanyNewsItem[]> {
    const url = new URL('/v1/news/feed', this.options.baseUrl);
    url.searchParams.set('source', 'news');
    url.searchParams.set('limit', '12');
    url.searchParams.set('tweet_reserve', '0');
    url.searchParams.set('asset_id', company.assetId);
    url.searchParams.set('name', company.companyName);
    if (company.ticker) url.searchParams.set('symbol', company.ticker);
    const response = await (this.options.fetch ?? fetch)(url, {
      headers: { 'x-api-key': this.options.apiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });
    if (!response.ok) throw new Error(`Tokens company news request failed with ${response.status}`);
    const payload = newsEnvelopeSchema.parse(await response.json());
    const seenUrls = new Set<string>();
    return payload.items.flatMap((candidate) => {
      const parsed = newsItemSchema.safeParse(candidate);
      if (!parsed.success) return [];
      const articleUrl = safeUrl(parsed.data.url);
      const publishedAt = new Date(parsed.data.posted_at);
      if (!articleUrl || Number.isNaN(publishedAt.getTime()) || seenUrls.has(articleUrl)) return [];
      seenUrls.add(articleUrl);
      const headline = parsed.data.title.trim().slice(0, 240);
      const source = parsed.data.source_name.trim().slice(0, 120);
      if (!headline || !source) return [];
      const item = marketCompanyNewsItemSchema.safeParse({
        id: `tokens-news:${createHash('sha256').update(articleUrl).digest('hex').slice(0, 24)}`,
        assetId: company.assetId,
        headline,
        source,
        publishedAt: publishedAt.toISOString(),
        imageUrl: safeUrl(parsed.data.image),
        summary: null,
        url: articleUrl,
        dataState: newsState(publishedAt, this.now()),
      });
      return item.success ? [item.data] : [];
    }).sort((left, right) => right.publishedAt.localeCompare(left.publishedAt)).slice(0, 12);
  }
}

function historyState(asOf: string, interval: MarketHistoryResult['interval'], observedAt: Date): MarketDataState {
  const intervalMs: Record<MarketHistoryResult['interval'], number> = {
    '5m': 5 * 60_000,
    '1H': 3_600_000,
    '4H': 4 * 3_600_000,
    '1D': 86_400_000,
    '1W': 7 * 86_400_000,
  };
  const age = Math.max(0, observedAt.getTime() - new Date(asOf).getTime());
  if (age <= intervalMs[interval] * 2) return 'live';
  if (age <= Math.max(intervalMs[interval] * 4, 3 * 86_400_000)) return 'delayed';
  return 'stale';
}

function newsState(publishedAt: Date, observedAt: Date): MarketDataState {
  const age = Math.max(0, observedAt.getTime() - publishedAt.getTime());
  if (age <= 6 * 3_600_000) return 'live';
  if (age <= 48 * 3_600_000) return 'delayed';
  return 'stale';
}

function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}
