import type { AttemptContext, ChainFamily, ChallengePreview, OnboardingPurpose, PersistedOnboardingAttempt, Reconciliation, RestorableOnboardingState, SafeBlockedError, SafeError, WalletContext } from './types';
import { shortenAddress } from './types';

export type BeginConnectionInput = { family: ChainFamily; purpose: OnboardingPurpose; providerId: string };
export type AuthorizationReturn = { returnCode?: string; returnState?: string };
export type SignatureRequest = { requestId: string; handoffUrl?: string; pollAfterMs?: number };

/** Provider-neutral mobile boundary. It never receives a signing key, seed phrase, raw signature, or provider bearer token. */
export interface OnboardingService {
  beginConnection(input: BeginConnectionInput): Promise<AttemptContext>;
  reconcileConnection(attempt: AttemptContext, returned?: AuthorizationReturn): Promise<Reconciliation>;
  /** Requests a fresh, server-issued challenge after expiry/rejection; it never recreates a provider request. */
  createFreshChallenge(input: { attempt: AttemptContext; wallet: WalletContext }): Promise<ChallengePreview>;
  requestSignature(input: { attempt: AttemptContext; wallet: WalletContext; challenge: ChallengePreview }): Promise<SignatureRequest>;
  reconcileSignature(attempt: AttemptContext): Promise<Reconciliation>;
  /** Rehydrates an active state only after server/provider reconciliation; never trust persisted UI data as live state. */
  restorePersistedAttempt?(attempt: PersistedOnboardingAttempt): Promise<RestorableOnboardingState>;
}

export type ApiErrorDto = { error: { code: string; message: string; retryable: boolean; requestId: string; attemptId?: string; details?: { retryAfterSeconds?: number } } };
export type ApiCredentialDto = { credentialRef: string; family: ChainFamily; address: string; network: string };
export type ApiCredentialsDto = { credentials: ApiCredentialDto[] };
export type ApiAttemptDto = { attemptId: string; attemptCapability: string; state: 'connecting'; expiresAt: string; supportedContext: string[]; developmentCredential?: ApiCredentialDto };
export type ApiChallengeDto = { challengeId: string; protocol: 'eip4361-v1' | 'siws-v1'; message: string; issuedAt: string; expiresAt: string; credentialRef: string };
export type ApiSignatureRequestDto = { requestId: string; state: 'awaiting_signature'; pollAfterMs: number };
export type ApiSignaturePollDto =
  | { requestId: string; state: 'awaiting_signature' | 'rejected' | 'expired' }
  | { requestId: string; state: 'complete'; profileId: string; accessToken: string; refreshToken: string; accessExpiresAt: string; alreadyCompleted?: boolean };
export type ApiAttemptStatusDto = { attemptId: string; state: 'connecting' | 'connected_unverified' | 'awaiting_signature' | 'complete' | 'blocked'; expiresAt: string; addressDisplay?: string; chainContext?: string; credentialRef?: string; providerRequestId?: string };

export class OnboardingApiFault extends Error {
  constructor(readonly apiError: ApiErrorDto['error']) { super(apiError.message); }
}

/** The only HTTP bridge for onboarding. Its endpoint mappings intentionally mirror the current API contract. */
export interface OnboardingApiTransport {
  request<T>(input: { method: 'GET' | 'POST'; path: string; attemptCapability?: string; accessToken?: string; idempotencyKey?: string; body?: unknown }): Promise<T>;
}

export function createHttpOnboardingTransport(apiUrl: string): OnboardingApiTransport {
  const baseUrl = apiUrl.replace(/\/$/, '');
  return {
    async request<T>({ method, path, attemptCapability, accessToken, idempotencyKey, body }: { method: 'GET' | 'POST'; path: string; attemptCapability?: string; accessToken?: string; idempotencyKey?: string; body?: unknown }): Promise<T> {
      let response: Response;
      try {
        response = await fetch(`${baseUrl}${path}`, {
          method,
          headers: {
            accept: 'application/json',
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            ...(attemptCapability ? { 'x-attempt-capability': attemptCapability } : {}),
            ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
            ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch {
        throw new OnboardingApiFault({ code: 'OFFLINE', message: 'You appear to be offline. Reconnect, then try again.', retryable: true, requestId: 'network' });
      }
      if (response.status === 204) return undefined as T;
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        const apiError = (payload as ApiErrorDto | undefined)?.error;
        throw new OnboardingApiFault(apiError ?? { code: 'INTERNAL_ERROR', message: 'Warren could not complete that request.', retryable: response.status >= 500, requestId: 'invalid-response' });
      }
      return payload as T;
    },
  };
}

/**
 * Development/test adapter for the API's deterministic test provider. It deliberately has no
 * production provider equivalent. Do not call it from a release build.
 */
export function createDeterministicApiOnboardingService(transport: OnboardingApiTransport, getAccessToken?: () => string | undefined): OnboardingService {
  assertDevelopmentOnly();
  const pending = new Map<string, { wallet: WalletContext; challenge: ChallengePreview }>();

  const createChallenge = async (attempt: AttemptContext, wallet: WalletContext): Promise<ChallengePreview> => {
    const dto = await transport.request<ApiChallengeDto>({ method: 'POST', path: `/v1/auth/attempts/${attempt.attemptId}/challenges`, attemptCapability: attempt.attemptCapability, body: { credentialRef: wallet.credentialRef, address: wallet.address, chainContext: wallet.context } });
    if (dto.credentialRef !== wallet.credentialRef) throw new OnboardingApiFault({ code: 'ADDRESS_MISMATCH', message: 'The selected wallet credential did not match the server challenge.', retryable: false, requestId: attempt.attemptId, attemptId: attempt.attemptId });
    return { challengeId: dto.challengeId, domain: domainFromMessage(dto.message), issuedAt: dto.issuedAt, expiresAt: dto.expiresAt, validityWindow: validityWindow(dto.issuedAt, dto.expiresAt), messagePreview: dto.message };
  };

  const reconcileSignature = async (attempt: AttemptContext): Promise<Reconciliation> => {
    if (!attempt.providerRequestId) throw new Error('Cannot reconcile a signature without an existing provider request ID.');
    const item = pending.get(attempt.attemptId);
    if (!item) return { kind: 'recoverable_error', error: { category: 'unknown', message: 'This signing attempt needs to be resumed with Warren.', diagnosticCategory: 'ATTEMPT_CONTEXT_MISSING', attemptReference: attempt.attemptId } };
    const dto = await transport.request<ApiSignaturePollDto>({ method: 'GET', path: `/v1/auth/attempts/${attempt.attemptId}/signature-requests/${attempt.providerRequestId}`, attemptCapability: attempt.attemptCapability });
    if (dto.state === 'complete') return { kind: 'complete', session: { ...dto, wallet: item.wallet, source: 'server_verified' } };
    if (dto.state === 'awaiting_signature') return { kind: 'awaiting_signature', providerRequestId: attempt.providerRequestId };
    if (dto.state === 'rejected') return { kind: 'recoverable_error', error: { category: 'signature_rejected', message: 'You did not approve the sign-in. Choose your wallet again to create a new request.', diagnosticCategory: 'SIGNATURE_REJECTED', attemptReference: attempt.attemptId } };
    return { kind: 'recoverable_error', error: { category: 'request_expired', message: 'The signing request expired. Choose your wallet again to create a new request.', diagnosticCategory: 'REQUEST_EXPIRED', attemptReference: attempt.attemptId } };
  };

  return {
    async beginConnection(input) {
      if (input.providerId !== 'deterministic') throw unsupportedProvider();
      const attemptDto = await transport.request<ApiAttemptDto>({ method: 'POST', path: '/v1/auth/attempts', accessToken: input.purpose === 'link_wallet' ? getAccessToken?.() : undefined, body: input });
      const credential = attemptDto.developmentCredential;
      if (!credential || credential.family !== input.family) throw new OnboardingApiFault({ code: 'PROVIDER_UNAVAILABLE', message: 'The development wallet credential could not be loaded.', retryable: true, requestId: attemptDto.attemptId, attemptId: attemptDto.attemptId });
      const wallet: WalletContext = { family: credential.family, address: credential.address, addressDisplay: shortenAddress(credential.address), context: credential.network, credentialRef: credential.credentialRef };
      const attempt: AttemptContext = { attemptId: attemptDto.attemptId, attemptCapability: attemptDto.attemptCapability, expiresAt: attemptDto.expiresAt, providerId: 'deterministic' };
      const challenge = await createChallenge(attempt, wallet);
      pending.set(attempt.attemptId, { wallet, challenge });
      return attempt;
    },
    async reconcileConnection(attempt, _returned?: AuthorizationReturn) {
      const item = pending.get(attempt.attemptId);
      if (!item) return { kind: 'recoverable_error', error: { category: 'unknown', message: 'This development attempt could not be resumed. Start again.', diagnosticCategory: 'DETERMINISTIC_ATTEMPT_MISSING', attemptReference: attempt.attemptId } };
      return { kind: 'connected', wallet: item.wallet, challenge: item.challenge };
    },
    async createFreshChallenge({ attempt, wallet }) {
      const challenge = await createChallenge(attempt, wallet);
      pending.set(attempt.attemptId, { wallet, challenge });
      return challenge;
    },
    async requestSignature({ attempt, wallet, challenge }) {
      const dto = await transport.request<ApiSignatureRequestDto>({ method: 'POST', path: `/v1/auth/attempts/${attempt.attemptId}/signature-requests`, attemptCapability: attempt.attemptCapability, idempotencyKey: signatureRequestKey(attempt.attemptId, challenge.challengeId), body: { challengeId: challenge.challengeId, credentialRef: wallet.credentialRef } });
      return dto;
    },
    reconcileSignature,
    async restorePersistedAttempt(restored) {
      const serverAttempt = await transport.request<ApiAttemptStatusDto>({ method: 'GET', path: `/v1/auth/attempts/${restored.attempt.attemptId}`, attemptCapability: restored.attempt.attemptCapability });
      if (serverAttempt.state === 'blocked') throw new OnboardingApiFault({ code: 'PROOF_INVALID', message: 'This wallet attempt can no longer be resumed.', retryable: false, requestId: restored.attempt.attemptId, attemptId: restored.attempt.attemptId });
      if (serverAttempt.state !== 'connecting' && (serverAttempt.credentialRef !== restored.credentialRef || serverAttempt.chainContext !== restored.chainContext)) throw new OnboardingApiFault({ code: 'ADDRESS_MISMATCH', message: 'The saved wallet context did not match the server attempt.', retryable: false, requestId: restored.attempt.attemptId, attemptId: restored.attempt.attemptId });
      const credentials = await transport.request<ApiCredentialsDto>({ method: 'GET', path: `/v1/auth/attempts/${restored.attempt.attemptId}/credentials`, attemptCapability: restored.attempt.attemptCapability });
      const credential = serverAttempt.state === 'connecting'
        ? credentials.credentials.find((item) => item.family === restored.family)
        : credentials.credentials.find((item) => item.credentialRef === restored.credentialRef && item.family === restored.family && item.network === restored.chainContext && shortenAddress(item.address) === restored.addressDisplay);
      if (!credential) throw new OnboardingApiFault({ code: 'ADDRESS_MISMATCH', message: 'The previously selected wallet could not be restored.', retryable: false, requestId: restored.attempt.attemptId, attemptId: restored.attempt.attemptId });
      const wallet: WalletContext = { family: credential.family, address: credential.address, addressDisplay: shortenAddress(credential.address), context: credential.network, credentialRef: credential.credentialRef };
      if (serverAttempt.state === 'connecting') {
        // The deterministic development provider has no redirect state to restore. Re-query its
        // server-owned credential list and create a new server challenge; this never verifies locally.
        const challenge = await createChallenge(restored.attempt, wallet);
        pending.set(restored.attempt.attemptId, { wallet, challenge });
        return { status: 'connected_unverified', purpose: restored.purpose, wallet, challenge, attempt: restored.attempt, view: 'connected' };
      }
      if (serverAttempt.state === 'connected_unverified') {
        // The stored record intentionally has no raw signing bytes. Replace its challenge with a
        // new server-issued message before allowing the user to enter the pre-sign screen.
        const challenge = await createChallenge(restored.attempt, wallet);
        pending.set(restored.attempt.attemptId, { wallet, challenge });
        return { status: 'connected_unverified', purpose: restored.purpose, wallet, challenge, attempt: restored.attempt, view: 'connected' };
      }
      if (!restored.challenge) throw new OnboardingApiFault({ code: 'PROOF_INVALID', message: 'This wallet attempt cannot be safely resumed.', retryable: false, requestId: restored.attempt.attemptId, attemptId: restored.attempt.attemptId });
      const challenge: ChallengePreview = restored.challenge;
      // Awaiting/complete attempts are poll-only: their existing provider request cannot issue a
      // new signature from this preview. A new request always starts a fresh challenge above.
      pending.set(restored.attempt.attemptId, { wallet, challenge });
      if ((serverAttempt.state === 'awaiting_signature' || serverAttempt.state === 'complete') && serverAttempt.providerRequestId) return { status: 'awaiting_signature', purpose: restored.purpose, wallet, challenge, attempt: { ...restored.attempt, providerRequestId: serverAttempt.providerRequestId } };
      throw new OnboardingApiFault({ code: 'PROOF_INVALID', message: 'This wallet attempt can no longer be resumed.', retryable: false, requestId: restored.attempt.attemptId, attemptId: restored.attempt.attemptId });
    },
  };
}

/** Production has no selected wallet provider yet, so new connection attempts fail closed. */
export function createUnsupportedOnboardingService(): OnboardingService {
  const fail = async (): Promise<never> => { throw unsupportedProvider(); };
  return { beginConnection: fail, reconcileConnection: fail, createFreshChallenge: fail, requestSignature: fail, reconcileSignature: fail };
}

export function mapApiError(error: ApiErrorDto['error']): SafeError | SafeBlockedError {
  const attemptReference = error.attemptId ?? error.requestId;
  switch (error.code) {
    case 'WALLET_CONFLICT': return { category: 'wallet_conflict', message: 'This wallet cannot be verified for this account. Choose another wallet.', diagnosticCategory: error.code, attemptReference };
    case 'EVM_CONTRACT_ACCOUNT_UNSUPPORTED': return { category: 'unsupported_wallet', message: 'This wallet is not supported for sign-in. Choose another wallet.', diagnosticCategory: error.code, attemptReference };
    case 'WRONG_NETWORK': return { category: 'unsupported_network', message: 'This network is not supported. Choose another wallet or network.', diagnosticCategory: error.code, attemptReference };
    case 'CHALLENGE_EXPIRED':
    case 'ATTEMPT_EXPIRED': return { category: 'request_expired', message: 'The signing request expired. Choose your wallet again to create a new request.', diagnosticCategory: error.code, attemptReference };
    case 'SIGNATURE_REJECTED': return { category: 'signature_rejected', message: 'You did not approve the sign-in. Choose your wallet again to create a new request.', diagnosticCategory: error.code, attemptReference };
    case 'ADDRESS_MISMATCH': return { category: 'address_mismatch', message: 'The wallet address did not match the sign-in request. Choose a wallet and try again.', diagnosticCategory: error.code, attemptReference };
    case 'PROOF_INVALID': return { category: 'verification_failed', message: 'Warren could not verify that signature. Try again with this wallet.', diagnosticCategory: error.code, attemptReference };
    case 'OFFLINE': return { category: 'offline', message: 'You appear to be offline. Reconnect, then try again.', diagnosticCategory: error.code, attemptReference };
    case 'PROVIDER_DISABLED': return { category: 'provider_unavailable', message: 'Wallet sign-in is not configured for this build.', diagnosticCategory: error.code, attemptReference };
    case 'PROVIDER_UNAVAILABLE': return { category: 'provider_unavailable', message: 'Warren could not reach the wallet provider. Try again shortly.', diagnosticCategory: error.code, attemptReference };
    case 'RATE_LIMITED': return { category: 'rate_limited', message: error.details?.retryAfterSeconds ? `Too many requests. Try again in about ${error.details.retryAfterSeconds} seconds.` : 'Too many requests. Try again shortly.', diagnosticCategory: error.code, attemptReference };
    case 'SESSION_INVALID': return { category: 'session_invalid', message: 'Your session ended. Sign in again to continue.', diagnosticCategory: error.code, attemptReference };
    default: return { category: 'unknown', message: error.message || 'Something interrupted verification. Try again.', diagnosticCategory: error.code, attemptReference };
  }
}

function unsupportedProvider(): OnboardingApiFault {
  return new OnboardingApiFault({ code: 'PROVIDER_DISABLED', message: 'Wallet sign-in is not configured for this build.', retryable: false, requestId: 'provider-disabled' });
}

function domainFromMessage(message: string): string {
  return message.split(' wants you to sign in with ')[0] || 'Warren';
}

function validityWindow(issuedAt: string, expiresAt: string): string | undefined {
  const milliseconds = Date.parse(expiresAt) - Date.parse(issuedAt);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return undefined;
  const minutes = Math.round(milliseconds / 60_000);
  return minutes >= 1 ? `${minutes} minute${minutes === 1 ? '' : 's'}` : `${Math.round(milliseconds / 1000)} seconds`;
}

function signatureRequestKey(attemptId: string, challengeId: string): string {
  return `signature-request:${attemptId}:${challengeId}`;
}

function assertDevelopmentOnly() {
  if (typeof __DEV__ === 'undefined' || !__DEV__) throw unsupportedProvider();
}
