import {
  lendingActionCreateSchema, lendingCatalogResponseSchema, lendingReviewSchema, lendingRiskPreviewSchema,
  lendingActionHistoryResponseSchema, lendingStepResultSchema, lendingWalletResponseSchema,
  type LendingActionCreate, type LendingCatalogResponse, type LendingReview, type LendingRiskPreview,
  type LendingActionHistoryResponse, type LendingStepResult, type LendingWalletResponse,
} from '@warren/lending-contract';
import { configuredApiUrl } from '@/lib/api-config';

export async function loadLendingCatalog(signal?: AbortSignal): Promise<LendingCatalogResponse> {
  const baseUrl = configuredApiUrl();
  if (!baseUrl) throw new Error('Lending market data is not configured in this build.');
  const response = await fetch(`${baseUrl}/v1/lending/kamino/xstocks`, { headers: { accept: 'application/json' }, signal });
  if (!response.ok) throw new Error('Warren could not refresh Kamino market data.');
  const result = lendingCatalogResponseSchema.safeParse(await response.json());
  if (!result.success) throw new Error('Warren returned an unexpected lending market response.');
  return result.data;
}

const lendingBase = () => {
  const baseUrl = configuredApiUrl();
  if (!baseUrl) throw new Error('Lending market data is not configured in this build.');
  return `${baseUrl}/v1/lending/kamino/xstocks`;
};

export async function loadLendingWallet(walletAddress: string, token: string, signal?: AbortSignal): Promise<LendingWalletResponse> {
  const response = await fetch(`${lendingBase()}/positions?walletAddress=${encodeURIComponent(walletAddress)}`, {
    headers: privateHeaders(token), signal, cache: 'no-store',
  });
  const payload = await response.json();
  if (!response.ok) throw apiError(payload, 'Warren could not refresh your lending positions.');
  const result = lendingWalletResponseSchema.safeParse(payload);
  if (!result.success) throw new Error('Warren returned an unexpected lending position response.');
  return result.data;
}

export async function loadLendingHistory(walletAddress: string, token: string): Promise<LendingActionHistoryResponse> {
  const response = await fetch(`${lendingBase()}/actions?walletAddress=${encodeURIComponent(walletAddress)}`, { headers: privateHeaders(token), cache: 'no-store' });
  const payload = await response.json();
  if (!response.ok) throw apiError(payload, 'Warren could not load lending activity.');
  const result = lendingActionHistoryResponseSchema.safeParse(payload);
  if (!result.success) throw new Error('Warren returned an unexpected lending activity response.');
  return result.data;
}

export async function previewLendingAction(input: LendingActionCreate, token: string, signal?: AbortSignal): Promise<LendingRiskPreview> {
  const body = lendingActionCreateSchema.parse(input);
  const response = await fetch(`${lendingBase()}/preview`, {
    method: 'POST', headers: privateHeaders(token), body: JSON.stringify(body), signal, cache: 'no-store',
  });
  const payload = await response.json();
  if (!response.ok) throw apiError(payload, 'Warren could not estimate this lending action.');
  const result = lendingRiskPreviewSchema.safeParse(payload);
  if (!result.success) throw new Error('Warren returned an unexpected lending preview.');
  return result.data;
}

export async function createLendingAction(input: LendingActionCreate, token: string, idempotencyKey: string): Promise<LendingReview> {
  const response = await fetch(`${lendingBase()}/actions`, {
    method: 'POST', headers: { ...privateHeaders(token), 'idempotency-key': idempotencyKey }, body: JSON.stringify(lendingActionCreateSchema.parse(input)), cache: 'no-store',
  });
  return parseReview(response, 'Warren could not prepare this lending review.');
}

export async function getLendingAction(actionId: string, token: string): Promise<LendingReview> {
  const response = await fetch(`${lendingBase()}/actions/${encodeURIComponent(actionId)}`, { headers: privateHeaders(token), cache: 'no-store' });
  return parseReview(response, 'Warren could not refresh this lending action.');
}

export async function nextLendingStep(actionId: string, token: string): Promise<LendingReview> {
  const response = await fetch(`${lendingBase()}/actions/${encodeURIComponent(actionId)}/next-step`, { method: 'POST', headers: privateHeaders(token), cache: 'no-store' });
  return parseReview(response, 'Warren could not prepare the next lending step.');
}

export async function refreshLendingStep(actionId: string, stepId: string, token: string): Promise<LendingReview> {
  const response = await fetch(`${lendingBase()}/actions/${encodeURIComponent(actionId)}/steps/${encodeURIComponent(stepId)}/refresh`, { method: 'POST', headers: privateHeaders(token), cache: 'no-store' });
  return parseReview(response, 'Warren could not refresh this expired review.');
}

export async function submitLendingStep(actionId: string, stepId: string, signedTransaction: string, token: string, idempotencyKey: string): Promise<LendingStepResult> {
  const response = await fetch(`${lendingBase()}/actions/${encodeURIComponent(actionId)}/steps/${encodeURIComponent(stepId)}/submit`, {
    method: 'POST', headers: { ...privateHeaders(token), 'idempotency-key': idempotencyKey }, body: JSON.stringify({ signedTransaction }), cache: 'no-store',
  });
  const payload = await response.json();
  if (!response.ok) throw apiError(payload, 'Warren could not submit this lending transaction.');
  const result = lendingStepResultSchema.safeParse(payload);
  if (!result.success) throw new Error('Warren returned an unexpected lending transaction status.');
  return result.data;
}

async function parseReview(response: Response, fallback: string) {
  const payload = await response.json();
  if (!response.ok) throw apiError(payload, fallback);
  const result = lendingReviewSchema.safeParse(payload);
  if (!result.success) throw new Error('Warren returned an unexpected lending review.');
  return result.data;
}

function privateHeaders(token: string) { return { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${token}` }; }
function apiError(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error?: { message?: unknown } }).error;
    if (typeof error?.message === 'string') return new Error(error.message);
  }
  return new Error(fallback);
}
