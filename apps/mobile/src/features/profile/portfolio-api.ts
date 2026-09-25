import {
  phoenixRegistrationResultSchema,
  phoenixRegistrationReviewSchema,
  portfolioActivityResponseSchema,
  portfolioOverviewResponseSchema,
  portfolioPositionsResponseSchema,
  type PortfolioActivityResponse,
  type PortfolioOverviewResponse,
  type PortfolioPositionsResponse,
  type PhoenixRegistrationResult,
  type PhoenixRegistrationReview,
} from '@warren/portfolio-contract';

import { configuredApiUrl } from '@/lib/api-config';

import { activityRequestPath, type ActivityFilters } from './portfolio-activity-view-model';

export type PortfolioRequestFailure = 'session' | 'wallet' | 'service' | 'contract';

export class PortfolioRequestError extends Error {
  constructor(
    message: string,
    readonly failure: PortfolioRequestFailure,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'PortfolioRequestError';
  }
}

export async function loadPortfolioOverview(input: {
  getAccessToken: () => Promise<string>;
  signal?: AbortSignal;
  walletAddress: string;
}): Promise<PortfolioOverviewResponse> {
  let accessToken: string;
  try {
    accessToken = await input.getAccessToken();
  } catch {
    throw new PortfolioRequestError(
      'Your Warren session has expired. Sign in again to restore Portfolio.',
      'session',
      false,
      401,
    );
  }

  const response = await portfolioRequest(
    `/v1/portfolio/overview?walletAddress=${encodeURIComponent(input.walletAddress)}`,
    accessToken,
    input.signal,
  );
  const parsed = portfolioOverviewResponseSchema.safeParse(await optionalJson(response));
  if (!parsed.success) {
    throw new PortfolioRequestError(
      'Warren received an unexpected Portfolio response. Please refresh and try again.',
      'contract',
      true,
      response.status,
    );
  }
  return parsed.data;
}

export async function loadPortfolioPositions(input: {
  getAccessToken: () => Promise<string>;
  signal?: AbortSignal;
  walletAddress: string;
}): Promise<PortfolioPositionsResponse> {
  let accessToken: string;
  try {
    accessToken = await input.getAccessToken();
  } catch {
    throw new PortfolioRequestError(
      'Your Warren session has expired. Sign in again to restore Portfolio.',
      'session',
      false,
      401,
    );
  }

  const response = await portfolioRequest(
    `/v1/portfolio/positions?walletAddress=${encodeURIComponent(input.walletAddress)}`,
    accessToken,
    input.signal,
  );
  const parsed = portfolioPositionsResponseSchema.safeParse(await optionalJson(response));
  if (!parsed.success) {
    throw new PortfolioRequestError(
      'Warren received an unexpected Positions response. Please refresh and try again.',
      'contract',
      true,
      response.status,
    );
  }
  return parsed.data;
}

export async function loadPortfolioActivity(input: {
  cursor?: string | null;
  filters: ActivityFilters;
  getAccessToken: () => Promise<string>;
  limit?: number;
  signal?: AbortSignal;
  walletAddress: string;
}): Promise<PortfolioActivityResponse> {
  let accessToken: string;
  try {
    accessToken = await input.getAccessToken();
  } catch {
    throw new PortfolioRequestError(
      'Your Warren session has expired. Sign in again to restore Portfolio.',
      'session',
      false,
      401,
    );
  }

  const response = await portfolioRequest(activityRequestPath(input), accessToken, input.signal);
  const parsed = portfolioActivityResponseSchema.safeParse(await optionalJson(response));
  if (!parsed.success) {
    throw new PortfolioRequestError(
      'Warren received an unexpected Activity response. Please refresh and try again.',
      'contract',
      true,
      response.status,
    );
  }
  return parsed.data;
}

export async function createPhoenixRegistration(input: {
  getAccessToken: () => Promise<string>;
  signal?: AbortSignal;
  walletAddress: string;
}): Promise<PhoenixRegistrationReview> {
  const accessToken = await portfolioAccessToken(input.getAccessToken);
  const response = await portfolioRequest('/v1/portfolio/phoenix/registrations', accessToken, input.signal, {
    method: 'POST',
    body: JSON.stringify({ walletAddress: input.walletAddress }),
  });
  const parsed = phoenixRegistrationReviewSchema.safeParse(await optionalJson(response));
  if (!parsed.success) throw contractError('Phoenix account review', response.status);
  return parsed.data;
}

export async function submitPhoenixRegistration(input: {
  getAccessToken: () => Promise<string>;
  idempotencyKey: string;
  registrationId: string;
  signedTransaction: string;
  signal?: AbortSignal;
}): Promise<PhoenixRegistrationResult> {
  const accessToken = await portfolioAccessToken(input.getAccessToken);
  const response = await portfolioRequest(
    `/v1/portfolio/phoenix/registrations/${encodeURIComponent(input.registrationId)}/submit`,
    accessToken,
    input.signal,
    {
      method: 'POST',
      body: JSON.stringify({ signedTransaction: input.signedTransaction }),
      headers: { 'idempotency-key': input.idempotencyKey },
    },
  );
  const parsed = phoenixRegistrationResultSchema.safeParse(await optionalJson(response));
  if (!parsed.success) throw contractError('Phoenix account result', response.status);
  return parsed.data;
}

export async function loadPhoenixRegistration(input: {
  getAccessToken: () => Promise<string>;
  registrationId: string;
  signal?: AbortSignal;
}): Promise<PhoenixRegistrationResult> {
  const accessToken = await portfolioAccessToken(input.getAccessToken);
  const response = await portfolioRequest(
    `/v1/portfolio/phoenix/registrations/${encodeURIComponent(input.registrationId)}`,
    accessToken,
    input.signal,
  );
  const parsed = phoenixRegistrationResultSchema.safeParse(await optionalJson(response));
  if (!parsed.success) throw contractError('Phoenix account status', response.status);
  return parsed.data;
}

async function portfolioRequest(
  path: string,
  accessToken: string,
  signal?: AbortSignal,
  init: { method?: 'GET' | 'POST'; body?: string; headers?: Record<string, string> } = {},
) {
  const baseUrl = configuredApiUrl();
  if (!baseUrl) {
    throw new PortfolioRequestError(
      'Warren could not load your portfolio. Please try again shortly.',
      'service',
      true,
    );
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: init.method ?? 'GET',
      body: init.body,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${accessToken}`,
        'cache-control': 'no-store',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new PortfolioRequestError(
      'Warren could not reach Portfolio. Check your connection and try again.',
      'service',
      true,
    );
  }

  if (!response.ok) throw requestError(response.status, await optionalJson(response));
  return response;
}

async function portfolioAccessToken(getAccessToken: () => Promise<string>) {
  try {
    return await getAccessToken();
  } catch {
    throw new PortfolioRequestError(
      'Your Warren session has expired. Sign in again to restore Portfolio.',
      'session',
      false,
      401,
    );
  }
}

function contractError(label: string, status: number) {
  return new PortfolioRequestError(
    `Warren received an unexpected ${label} response. Please try again.`,
    'contract',
    true,
    status,
  );
}

function requestError(status: number, payload: unknown) {
  const code = readErrorCode(payload);
  return portfolioErrorForResponse(status, code, readErrorMessage(payload));
}

export function portfolioErrorForResponse(status: number, code?: string, providerMessage?: string) {
  if (status === 401 || code === 'SESSION_INVALID') {
    return new PortfolioRequestError(
      'Your Warren session has expired. Sign in again to restore Portfolio.',
      'session',
      false,
      status,
    );
  }
  if (code === 'REGISTRATION_STATE_INVALID') {
    const insufficientSol = providerMessage
      && /insufficient (?:funds|lamports|balance)|account rent|rent(?:-| )exempt|attempt to debit an account but found no record of a prior credit/i.test(providerMessage);
    return new PortfolioRequestError(
      insufficientSol
        ? 'This wallet does not have enough SOL to create the Phoenix account. Deposit more SOL to cover account rent and the network fee, then try again.'
        : 'Phoenix could not complete account creation. Review the request and try again.',
      'service',
      false,
      status,
    );
  }
  if (code === 'WALLET_REQUIRED' || code === 'WALLET_MISMATCH' || status === 403) {
    return new PortfolioRequestError(
      'Warren could not verify this Solana wallet. Reconnect your account and try again.',
      'wallet',
      false,
      status,
    );
  }
  if (status === 429) {
    return new PortfolioRequestError(
      'Portfolio is receiving too many requests. Wait a moment, then refresh.',
      'service',
      true,
      status,
    );
  }
  if (code === 'REFERRAL_ONBOARDING_UNAVAILABLE') {
    return new PortfolioRequestError(
      'Phoenix referral onboarding is not enabled in this build.',
      'service',
      false,
      status,
    );
  }
  return new PortfolioRequestError(
    'Warren could not refresh your portfolio. Please try again.',
    'service',
    status >= 500,
    status,
  );
}

function readErrorCode(payload: unknown) {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) return undefined;
  const error = payload.error;
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function readErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) return undefined;
  const error = payload.error;
  if (!error || typeof error !== 'object' || !('message' in error)) return undefined;
  return typeof error.message === 'string' ? error.message : undefined;
}

async function optionalJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
