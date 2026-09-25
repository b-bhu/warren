import {
  marketCompanyNewsResponseSchema,
  marketCompanyResponseSchema,
  marketHistoryResponseSchema,
  marketSearchResponseSchema,
  marketsApiErrorSchema,
  marketsResponseSchema,
  type MarketCompanyNewsResponse,
  type MarketCompanyResponse,
  type MarketHistoryRange,
  type MarketHistoryResponse,
  type MarketProduct,
  type MarketSearchResponse,
  type MarketSort,
  type MarketsResponse,
} from '@warren/markets-contract';

import { configuredApiUrl } from '@/lib/api-config';

const responseCache = new Map<string, { etag?: string; value: MarketsResponse }>();
const companyCache = new Map<string, { etag?: string; value: MarketCompanyResponse }>();
const historyCache = new Map<string, { etag?: string; value: MarketHistoryResponse }>();
const newsCache = new Map<string, { etag?: string; value: MarketCompanyNewsResponse }>();

export class MarketsRequestError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'MarketsRequestError';
  }
}

export async function loadMarkets(
  input: {
    product: MarketProduct;
    availableOnly: boolean;
    sort: MarketSort;
    cursor?: string;
    limit?: number;
  },
  signal?: AbortSignal,
): Promise<MarketsResponse> {
  const params = new URLSearchParams({
    product: input.product,
    availability: input.availableOnly ? 'available' : 'all',
    sort: input.sort,
    limit: String(input.limit ?? 24),
  });
  if (input.cursor) params.set('cursor', input.cursor);
  const path = `/v1/markets?${params.toString()}`;
  const cached = responseCache.get(path);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (cached?.etag) headers['if-none-match'] = cached.etag;
  const response = await request(path, { headers, signal });
  if (response.status === 304 && cached) return cached.value;
  const parsed = marketsResponseSchema.safeParse(await readJson(response));
  if (!parsed.success) throw new MarketsRequestError('Warren returned an unexpected Markets response.');
  responseCache.set(path, { value: parsed.data, etag: response.headers.get('etag') ?? undefined });
  return parsed.data;
}

export async function searchMarkets(query: string, signal?: AbortSignal): Promise<MarketSearchResponse> {
  const response = await request(`/v1/markets/search?q=${encodeURIComponent(query)}&limit=12`, {
    headers: { accept: 'application/json' },
    signal,
  });
  const parsed = marketSearchResponseSchema.safeParse(await readJson(response));
  if (!parsed.success) throw new MarketsRequestError('Warren returned an unexpected market-search response.');
  return parsed.data;
}

export async function loadMarketCompany(assetId: string, signal?: AbortSignal): Promise<MarketCompanyResponse> {
  const path = `/v1/markets/companies/${encodeURIComponent(assetId)}`;
  const cached = companyCache.get(path);
  const response = await request(path, {
    headers: conditionalHeaders(cached?.etag),
    signal,
  });
  if (response.status === 304 && cached) return cached.value;
  const parsed = marketCompanyResponseSchema.safeParse(await readJson(response));
  if (!parsed.success) throw new MarketsRequestError('Warren returned an unexpected company-markets response.');
  companyCache.set(path, { value: parsed.data, etag: response.headers.get('etag') ?? undefined });
  return parsed.data;
}

export async function loadMarketHistory(
  input: { assetId: string; instrumentId: string; range: MarketHistoryRange },
  signal?: AbortSignal,
): Promise<MarketHistoryResponse> {
  const params = new URLSearchParams({ instrumentId: input.instrumentId, range: input.range });
  const path = `/v1/markets/companies/${encodeURIComponent(input.assetId)}/history?${params.toString()}`;
  const cached = historyCache.get(path);
  const response = await request(path, { headers: conditionalHeaders(cached?.etag), signal });
  if (response.status === 304 && cached) return cached.value;
  const parsed = marketHistoryResponseSchema.safeParse(await readJson(response));
  if (!parsed.success) throw new MarketsRequestError('Warren returned an unexpected market-history response.');
  historyCache.set(path, { value: parsed.data, etag: response.headers.get('etag') ?? undefined });
  return parsed.data;
}

export async function loadMarketCompanyNews(
  assetId: string,
  signal?: AbortSignal,
): Promise<MarketCompanyNewsResponse> {
  const path = `/v1/markets/companies/${encodeURIComponent(assetId)}/news`;
  const cached = newsCache.get(path);
  const response = await request(path, { headers: conditionalHeaders(cached?.etag), signal });
  if (response.status === 304 && cached) return cached.value;
  const parsed = marketCompanyNewsResponseSchema.safeParse(await readJson(response));
  if (!parsed.success) throw new MarketsRequestError('Warren returned an unexpected company-news response.');
  newsCache.set(path, { value: parsed.data, etag: response.headers.get('etag') ?? undefined });
  return parsed.data;
}

function conditionalHeaders(etag?: string): Record<string, string> {
  return { accept: 'application/json', ...(etag ? { 'if-none-match': etag } : {}) };
}

async function request(path: string, init: RequestInit): Promise<Response> {
  const baseUrl = configuredApiUrl();
  if (!baseUrl) throw new MarketsRequestError('Markets are not configured in this build.');

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, init);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new MarketsRequestError('Warren could not reach the Markets service. Check the API address and try again.');
  }
  if (!response.ok && response.status !== 304) {
    const parsed = marketsApiErrorSchema.safeParse(await readOptionalJson(response));
    throw new MarketsRequestError(
      parsed.success ? parsed.data.error.message : 'Warren could not refresh market data.',
      response.status,
    );
  }
  return response;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new MarketsRequestError('Warren returned an unreadable Markets response.', response.status);
  }
}

async function readOptionalJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
