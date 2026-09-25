import {
  executionApiErrorSchema,
  perpetualExecutionResultSchema,
  perpetualOrderResponseSchema,
  spotAssetSearchResponseSchema,
  spotExecutionResultSchema,
  spotOrderReviewSchema,
  type ExecutionErrorCode,
  type PerpetualExecutionResult,
  type PerpetualOrderCreate,
  type PerpetualOrderResponse,
  type SpotAssetSearchResponse,
  type SpotExecutionResult,
  type SpotOrderCreate,
  type SpotOrderReview,
} from '@warren/execution-contract';

import { configuredApiUrl } from '@/lib/api-config';

export class ExecutionRequestError extends Error {
  constructor(
    message: string,
    readonly code: ExecutionErrorCode = 'INTERNAL_ERROR',
    readonly retryable = false,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ExecutionRequestError';
  }
}

export async function searchExecutionAssets(query: string, signal?: AbortSignal): Promise<SpotAssetSearchResponse> {
  return parse(
    await request(`/v1/execution/spot/assets?query=${encodeURIComponent(query)}`, { signal }),
    spotAssetSearchResponseSchema,
  );
}

export async function createSpotOrder(
  accessToken: string,
  input: SpotOrderCreate,
): Promise<SpotOrderReview> {
  return parse(await request('/v1/execution/spot/orders', authenticated(accessToken, {
    method: 'POST',
    body: JSON.stringify(input),
  })), spotOrderReviewSchema);
}

export async function submitSpotOrder(
  accessToken: string,
  executionId: string,
  signedTransaction: string,
  idempotencyKey: string,
): Promise<SpotExecutionResult> {
  return parse(await request(`/v1/execution/spot/orders/${encodeURIComponent(executionId)}/submit`, authenticated(accessToken, {
    method: 'POST',
    body: JSON.stringify({ signedTransaction }),
    headers: { 'idempotency-key': idempotencyKey },
  })), spotExecutionResultSchema);
}

export async function createPerpetualOrder(
  accessToken: string,
  input: PerpetualOrderCreate,
): Promise<PerpetualOrderResponse> {
  return parse(await request('/v1/execution/perpetual/orders', authenticated(accessToken, {
    method: 'POST',
    body: JSON.stringify(input),
  })), perpetualOrderResponseSchema);
}

export async function submitPerpetualOrder(
  accessToken: string,
  executionId: string,
  signedTransaction: string,
  idempotencyKey: string,
): Promise<PerpetualExecutionResult> {
  return parse(await request(`/v1/execution/perpetual/orders/${encodeURIComponent(executionId)}/submit`, authenticated(accessToken, {
    method: 'POST',
    body: JSON.stringify({ signedTransaction }),
    headers: { 'idempotency-key': idempotencyKey },
  })), perpetualExecutionResultSchema);
}

function authenticated(accessToken: string, init: RequestInit): RequestInit {
  return {
    ...init,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {}),
    },
  };
}

async function request(path: string, init: RequestInit = {}) {
  const baseUrl = configuredApiUrl();
  if (!baseUrl) {
    throw new ExecutionRequestError(
      'Trading could not start. Please try again shortly.',
      'PROVIDER_UNAVAILABLE',
      true,
    );
  }
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { accept: 'application/json', ...(init.headers ?? {}) },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ExecutionRequestError('Warren could not reach the execution service.', 'PROVIDER_UNAVAILABLE', true);
  }
  if (!response.ok) {
    const parsed = executionApiErrorSchema.safeParse(await optionalJson(response));
    if (parsed.success) {
      throw new ExecutionRequestError(
        parsed.data.error.message,
        parsed.data.error.code,
        parsed.data.error.retryable,
        response.status,
      );
    }
    throw new ExecutionRequestError('The execution request could not be completed.', 'INTERNAL_ERROR', response.status >= 500, response.status);
  }
  return response;
}

async function parse<T>(response: Response, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }): Promise<T> {
  const parsed = schema.safeParse(await optionalJson(response));
  if (!parsed.success) throw new ExecutionRequestError('Warren returned an unexpected execution response.');
  return parsed.data;
}

async function optionalJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
