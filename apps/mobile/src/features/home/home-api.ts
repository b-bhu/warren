import {
  assetsResponseSchema,
  homeApiErrorSchema,
  homeResponseSchema,
  type AssetsResponse,
  type HomeResponse,
} from '@warren/home-contract';

let cachedHome: HomeResponse | undefined;
let cachedHomeEtag: string | undefined;

export class HomeRequestError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'HomeRequestError';
  }
}

export function getCachedHome(): HomeResponse | undefined {
  return cachedHome;
}

export async function loadHome(signal?: AbortSignal): Promise<HomeResponse> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (cachedHomeEtag) headers['if-none-match'] = cachedHomeEtag;

  const response = await request('/v1/home', { headers, signal });
  if (response.status === 304 && cachedHome) return cachedHome;

  const result = homeResponseSchema.safeParse(await readJson(response));
  if (!result.success) throw new HomeRequestError('Warren returned market data in an unexpected format.');

  cachedHome = result.data;
  cachedHomeEtag = response.headers.get('etag') ?? undefined;
  return result.data;
}

export async function searchAssets(query: string, signal?: AbortSignal): Promise<AssetsResponse> {
  return loadAssets(`/v1/assets?q=${encodeURIComponent(query)}&limit=12`, signal);
}

export async function loadEarnings(signal?: AbortSignal): Promise<AssetsResponse> {
  return loadAssets('/v1/assets?view=earnings&limit=24', signal);
}

export async function loadMovers(direction: 'gainers' | 'losers', signal?: AbortSignal): Promise<AssetsResponse> {
  const sort = direction === 'gainers' ? 'change_desc' : 'change_asc';
  return loadAssets(`/v1/assets?sort=${sort}&limit=24`, signal);
}

export async function loadWatchlist(assetIds: readonly string[], signal?: AbortSignal): Promise<AssetsResponse> {
  const ids = assetIds.map(encodeURIComponent).join(',');
  return loadAssets(`/v1/assets?ids=${ids}`, signal);
}

async function loadAssets(path: string, signal?: AbortSignal): Promise<AssetsResponse> {
  const response = await request(path, { headers: { accept: 'application/json' }, signal });
  const result = assetsResponseSchema.safeParse(await readJson(response));
  if (!result.success) throw new HomeRequestError('Warren returned company data in an unexpected format.');
  return result.data;
}

async function request(path: string, init: RequestInit): Promise<Response> {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/$/, '');
  if (!baseUrl) {
    throw new HomeRequestError('Add EXPO_PUBLIC_API_URL to the mobile environment to load Home.');
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, init);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new HomeRequestError('Warren could not reach the market service. Check the API address and try again.');
  }

  if (!response.ok && response.status !== 304) {
    const payload = await readOptionalJson(response);
    const parsed = homeApiErrorSchema.safeParse(payload);
    throw new HomeRequestError(
      parsed.success ? parsed.data.error.message : 'Market data is temporarily unavailable.',
      response.status,
    );
  }
  return response;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new HomeRequestError('Warren returned an unreadable market-data response.', response.status);
  }
}

async function readOptionalJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
