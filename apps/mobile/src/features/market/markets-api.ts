import {
  marketCompanyResponseSchema,
  marketSearchResponseSchema,
  marketsApiErrorSchema,
  marketsResponseSchema,
  type MarketCompanyResponse,
  type MarketProduct,
  type MarketSearchResponse,
  type MarketSort,
  type MarketsResponse,
} from '@warren/markets-contract';

const responseCache = new Map<string, { etag?: string; value: MarketsResponse }>();

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
  const response = await request(`/v1/markets/companies/${encodeURIComponent(assetId)}`, {
    headers: { accept: 'application/json' },
    signal,
  });
  const parsed = marketCompanyResponseSchema.safeParse(await readJson(response));
  if (!parsed.success) throw new MarketsRequestError('Warren returned an unexpected company-markets response.');
  return parsed.data;
}

async function request(path: string, init: RequestInit): Promise<Response> {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/$/, '');
  if (!baseUrl) throw new MarketsRequestError('Add EXPO_PUBLIC_API_URL to load Markets.');

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
      parsed.success ? parsed.data.error.message : 'Markets data is temporarily unavailable.',
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
