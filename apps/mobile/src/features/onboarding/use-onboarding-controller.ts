import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import { clearPersistedAttempt, isExpiredAttempt, persistedAttemptForState, readPersistedAttempt, savePersistedAttempt } from './active-attempt-storage';
import { createInitialOnboardingState, onboardingReducer, type OnboardingEvent } from './machine';
import { mapApiError, OnboardingApiFault, type AuthorizationReturn, type OnboardingService } from './service';
import type { OnboardingPurpose, OnboardingState, PersistedOnboardingAttempt, Reconciliation, SafeBlockedError, SafeError, SessionResult } from './types';

export type OnboardingControllerOptions = {
  service: OnboardingService;
  providerId: string;
  purpose?: OnboardingPurpose;
  /** Receives only a server-verified session in production. Persist credentials outside this UI layer. */
  onSessionReady?: (session: SessionResult) => Promise<void> | void;
  /** Opens a provider-owned URL. Route wiring supplies Linking.openURL or an approved browser handoff. */
  openExternalUrl?: (url: string) => Promise<unknown> | unknown;
};

export type OnboardingController = {
  state: OnboardingState;
  restart: () => void;
  start: () => void;
  chooseChain: (family: 'evm' | 'solana') => void;
  continueWithChain: () => Promise<void>;
  reconcile: (returned?: AuthorizationReturn) => Promise<void>;
  reviewSignature: () => void;
  requestSignature: () => Promise<void>;
  openProvider: () => Promise<void>;
  openApproval: () => Promise<void>;
  reconcileSignature: () => Promise<void>;
  retry: () => Promise<void>;
  back: () => void;
  cancel: () => void;
  changeWallet: () => void;
};

export function useOnboardingController({ service, providerId, purpose = 'sign_in', onSessionReady, openExternalUrl }: OnboardingControllerOptions): OnboardingController {
  const [state, dispatch] = useReducer(onboardingReducer, purpose, createInitialOnboardingState);
  const connectionStartInFlight = useRef(false);
  const signatureRequestInFlight = useRef<string | null>(null);
  const attemptStorageReady = useRef(false);
  const persistenceQueue = useRef<Promise<void>>(Promise.resolve());

  // Serializing writes ensures an explicit cancel cannot be overtaken by an older state-effect save.
  const persistAttempt = useCallback((record: PersistedOnboardingAttempt | undefined): Promise<void> => {
    const operation = () => record ? savePersistedAttempt(record) : clearPersistedAttempt(purpose);
    const queued = persistenceQueue.current.then(operation, operation);
    persistenceQueue.current = queued.catch(() => undefined);
    return queued;
  }, [purpose]);

  const apply = useCallback(async (result: Reconciliation) => {
    switch (result.kind) {
      case 'waiting_for_wallet':
        return;
      case 'awaiting_signature': dispatch({ type: 'SIGNATURE_STILL_PENDING', providerRequestId: result.providerRequestId }); return;
      case 'connected': dispatch({ type: 'CONNECTION_RESOLVED', wallet: result.wallet, challenge: result.challenge }); return;
      case 'verifying': dispatch({ type: 'VERIFICATION_STARTED' }); return;
      case 'complete':
        dispatch({ type: 'VERIFIED', session: result.session });
        await onSessionReady?.(result.session);
        return;
      case 'recoverable_error': dispatch({ type: 'FAIL', error: result.error }); return;
      case 'blocked': dispatch({ type: 'BLOCK', error: result.error }); return;
      default: return assertNever(result);
    }
  }, [onSessionReady]);

  useEffect(() => {
    if (!attemptStorageReady.current) return;
    const persisted = persistedAttemptForState(state);
    void persistAttempt(persisted).catch(() => undefined);
  }, [persistAttempt, state]);

  useEffect(() => {
    let active = true;
    void (async () => {
      let stored;
      try {
        stored = await readPersistedAttempt(purpose);
      } catch {
        stored = undefined;
      }
      if (!active) return;
      if (!stored || isExpiredAttempt(stored)) {
        if (stored) await clearPersistedAttempt(purpose).catch(() => undefined);
        attemptStorageReady.current = true;
        return;
      }
      if (!service.restorePersistedAttempt) {
        await clearPersistedAttempt(purpose).catch(() => undefined);
        attemptStorageReady.current = true;
        return;
      }
      attemptStorageReady.current = true;
      try {
        const restored = await service.restorePersistedAttempt(stored);
        if (!active) return;
        // This state was rehydrated from the server/provider, not reconstructed from storage.
        dispatch({ type: 'RESTORE_ATTEMPT', state: restored });
        if (restored.status === 'awaiting_signature' || restored.status === 'verifying') await apply(await service.reconcileSignature(restored.attempt));
      } catch (cause) {
        if (isTerminalRestoreFailure(cause)) await persistAttempt(undefined).catch(() => undefined);
      }
    })();
    return () => { active = false; };
  }, [apply, persistAttempt, purpose, service]);

  const continueWithChain = useCallback(async () => {
    if (state.status !== 'choosing_chain' || !state.selectedFamily || connectionStartInFlight.current) return;
    connectionStartInFlight.current = true;
    try {
      const attempt = await service.beginConnection({ family: state.selectedFamily, purpose: state.purpose, providerId });
      await persistAttempt({
        version: 1,
        purpose: state.purpose,
        phase: 'connecting',
        family: state.selectedFamily,
        attempt: { attemptId: attempt.attemptId, attemptCapability: attempt.attemptCapability, expiresAt: attempt.expiresAt, providerId: attempt.providerId },
      }).catch(() => undefined);
      dispatch({ type: 'CONNECT_STARTED', family: state.selectedFamily, attempt });
    } catch (cause) {
      dispatch(toFailure(cause));
    } finally { connectionStartInFlight.current = false; }
  }, [persistAttempt, providerId, service, state]);

  const reconcile = useCallback(async (returned?: AuthorizationReturn) => {
    if (state.status !== 'connecting') return;
    try { await apply(await service.reconcileConnection(state.attempt, returned)); }
    catch (cause) { dispatch(toFailure(cause, state.attempt.attemptId)); }
  }, [apply, service, state]);

  const requestSignature = useCallback(async () => {
    if (state.status !== 'connected_unverified' || state.view !== 'pre_sign' || state.attempt.providerRequestId) return;
    if (signatureRequestInFlight.current === state.attempt.attemptId) return;
    signatureRequestInFlight.current = state.attempt.attemptId;
    try {
      const request = await service.requestSignature({ attempt: state.attempt, wallet: state.wallet, challenge: state.challenge });
      const persisted = persistedAttemptForState({
        status: 'awaiting_signature',
        purpose: state.purpose,
        wallet: state.wallet,
        challenge: state.challenge,
        attempt: { ...state.attempt, providerRequestId: request.requestId },
      });
      await persistAttempt(persisted).catch(() => undefined);
      dispatch({ type: 'SIGNATURE_REQUESTED', providerRequestId: request.requestId, handoffUrl: request.handoffUrl });
    } catch (cause) { dispatch(toFailure(cause, state.attempt.attemptId)); }
    finally { signatureRequestInFlight.current = null; }
  }, [persistAttempt, service, state]);

  const openProvider = useCallback(async () => {
    if (state.status === 'connecting' && state.attempt.authorizationUrl) await openExternalUrl?.(state.attempt.authorizationUrl);
  }, [openExternalUrl, state]);

  const openApproval = useCallback(async () => {
    if (state.status === 'awaiting_signature' && state.attempt.signatureHandoffUrl) await openExternalUrl?.(state.attempt.signatureHandoffUrl);
  }, [openExternalUrl, state]);

  const reconcileSignature = useCallback(async () => {
    if (state.status !== 'awaiting_signature' && state.status !== 'verifying') return;
    try {
      if (state.status === 'awaiting_signature') dispatch({ type: 'VERIFICATION_STARTED' });
      await apply(await service.reconcileSignature(state.attempt));
    } catch (cause) { dispatch(toFailure(cause, state.attempt.attemptId)); }
  }, [apply, service, state]);

  const retry = useCallback(async () => {
    if (state.status !== 'recoverable_error') return;
    const retryState = state.retryState;
    const reconcileExistingRequest = state.error.category === 'provider_unavailable' || state.error.category === 'offline' || state.error.category === 'rate_limited' || state.error.category === 'session_invalid' || state.error.category === 'unknown';
    if (reconcileExistingRequest) {
      dispatch({ type: 'RETRY' });
      if (retryState.status === 'awaiting_signature' || retryState.status === 'verifying') {
        try { await apply(await service.reconcileSignature(retryState.attempt)); }
        catch (cause) { dispatch(toFailure(cause, retryState.attempt.attemptId)); }
      }
      return;
    }
    const terminalRequestFailure = state.error.category === 'signature_rejected' || state.error.category === 'request_expired' || state.error.category === 'verification_failed';
    if (terminalRequestFailure && (retryState.status === 'awaiting_signature' || retryState.status === 'verifying')) {
      // The provider request belongs to this attempt. Abandon it and begin a fresh attempt
      // instead of invalidating its challenge and leaving a competing pending request behind.
      await persistAttempt(undefined).catch(() => undefined);
      dispatch({ type: 'CHANGE_WALLET' });
      return;
    }
    if (retryState.status === 'connected_unverified' || retryState.status === 'awaiting_signature' || retryState.status === 'verifying') {
      try {
        const challenge = await service.createFreshChallenge({ attempt: retryState.attempt, wallet: retryState.wallet });
        dispatch({ type: 'RESTART_SIGNATURE', challenge });
      } catch (cause) { dispatch(toFailure(cause, retryState.attempt.attemptId)); }
      return;
    }
    dispatch({ type: 'RETRY' });
    if (retryState.status === 'connecting') {
      try { await apply(await service.reconcileConnection(retryState.attempt)); }
      catch (cause) { dispatch(toFailure(cause, retryState.attempt.attemptId)); }
    }
  }, [apply, persistAttempt, service, state]);

  const discardAndDispatch = useCallback((event: Extract<OnboardingEvent, { type: 'RESET' | 'CANCEL' | 'CHANGE_WALLET' }>) => {
    void persistAttempt(undefined).catch(() => undefined);
    dispatch(event);
  }, [persistAttempt]);

  return useMemo(() => ({
    state,
    restart: () => discardAndDispatch({ type: 'RESET' }),
    start: () => dispatch({ type: 'START' }),
    chooseChain: (family) => dispatch({ type: 'SELECT_CHAIN', family }),
    continueWithChain,
    reconcile,
    reviewSignature: () => dispatch({ type: 'REVIEW_SIGNATURE' }),
    requestSignature,
    openProvider,
    openApproval,
    reconcileSignature,
    retry,
    back: () => dispatch({ type: 'BACK' }),
    cancel: () => discardAndDispatch({ type: 'CANCEL' }),
    changeWallet: () => discardAndDispatch({ type: 'CHANGE_WALLET' }),
  }), [continueWithChain, discardAndDispatch, openApproval, openProvider, reconcile, reconcileSignature, requestSignature, retry, state]);
}

function toSafeError(cause: unknown, attemptReference?: string): SafeError {
  if (cause instanceof OnboardingApiFault) {
    const mapped = mapApiError(cause.apiError);
    if (isBlockedError(mapped)) {
      return { category: 'unknown', message: mapped.message, diagnosticCategory: mapped.diagnosticCategory, attemptReference: mapped.attemptReference };
    }
    return mapped;
  }
  return { category: 'unknown' as const, message: 'Something interrupted verification. Try again.', diagnosticCategory: cause instanceof Error ? 'CLIENT_OPERATION_FAILED' : 'CLIENT_UNKNOWN_FAILURE', attemptReference };
}

function toFailure(cause: unknown, attemptReference?: string): Extract<OnboardingEvent, { type: 'FAIL' | 'BLOCK' }> {
  if (cause instanceof OnboardingApiFault) {
    const mapped = mapApiError(cause.apiError);
    if (isBlockedError(mapped)) return { type: 'BLOCK', error: mapped };
  }
  return { type: 'FAIL', error: toSafeError(cause, attemptReference) };
}

function isBlockedError(error: SafeError | SafeBlockedError): error is SafeBlockedError {
  return error.category === 'wallet_conflict' || error.category === 'unsupported_wallet' || error.category === 'unsupported_network';
}

function isTerminalRestoreFailure(cause: unknown): boolean {
  if (!(cause instanceof OnboardingApiFault)) return false;
  const error = mapApiError(cause.apiError);
  return isBlockedError(error) || error.category === 'request_expired' || error.category === 'signature_rejected' || error.category === 'verification_failed' || error.category === 'address_mismatch';
}

function assertNever(value: never): never {
  throw new Error(`Unhandled reconciliation: ${JSON.stringify(value)}`);
}
