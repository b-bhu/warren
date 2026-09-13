import type { ChainFamily, ChallengePreview, OnboardingPurpose, OnboardingState, RestorableOnboardingState, SafeBlockedError, SafeError, SessionResult, WalletContext } from './types';

export type OnboardingEvent =
  | { type: 'RESET' }
  | { type: 'START' }
  | { type: 'BACK' }
  | { type: 'SELECT_CHAIN'; family: ChainFamily }
  | { type: 'CONNECT_STARTED'; family: ChainFamily; attempt: Extract<OnboardingState, { status: 'connecting' }>['attempt'] }
  | { type: 'CONNECTION_RESOLVED'; wallet: WalletContext; challenge: ChallengePreview }
  | { type: 'REVIEW_SIGNATURE' }
  | { type: 'SIGNATURE_REQUESTED'; providerRequestId: string; handoffUrl?: string }
  | { type: 'SIGNATURE_STILL_PENDING'; providerRequestId?: string }
  | { type: 'VERIFICATION_STARTED' }
  | { type: 'VERIFIED'; session: SessionResult }
  | { type: 'FAIL'; error: SafeError }
  | { type: 'BLOCK'; error: SafeBlockedError }
  | { type: 'RETRY' }
  | { type: 'RESTART_SIGNATURE'; challenge: ChallengePreview }
  | { type: 'CANCEL' }
  | { type: 'CHANGE_WALLET' }
  | { type: 'RESTORE_ATTEMPT'; state: RestorableOnboardingState };

export function createInitialOnboardingState(purpose: OnboardingPurpose = 'sign_in'): OnboardingState {
  return { status: 'not_started', purpose };
}

/**
 * A pure, closed state machine. Illegal events intentionally leave state untouched;
 * async integrations must reconcile their existing attempt instead of forcing state.
 */
export function onboardingReducer(state: OnboardingState, event: OnboardingEvent): OnboardingState {
  if (event.type === 'RESET') return createInitialOnboardingState(state.purpose);
  if (event.type === 'RESTORE_ATTEMPT') return event.state.purpose === state.purpose ? event.state : state;
  switch (state.status) {
    case 'not_started':
      return event.type === 'START' ? { status: 'choosing_chain', purpose: state.purpose } : state;

    case 'choosing_chain':
      if (event.type === 'SELECT_CHAIN') return { ...state, selectedFamily: event.family };
      if (event.type === 'BACK') return { status: 'not_started', purpose: state.purpose };
      if (event.type === 'CONNECT_STARTED' && state.selectedFamily === event.family) {
        return { status: 'connecting', purpose: state.purpose, family: event.family, attempt: event.attempt };
      }
      return state;

    case 'connecting':
      if (event.type === 'CONNECTION_RESOLVED') {
        return { status: 'connected_unverified', purpose: state.purpose, wallet: event.wallet, attempt: state.attempt, challenge: event.challenge, view: 'connected' };
      }
      if (event.type === 'FAIL') return retryableError(state, event.error);
      if (event.type === 'BLOCK') return { status: 'blocked', purpose: state.purpose, error: event.error, attempt: state.attempt };
      if (event.type === 'CANCEL' || event.type === 'CHANGE_WALLET' || event.type === 'BACK') return { status: 'choosing_chain', purpose: state.purpose, selectedFamily: state.family };
      return state;

    case 'connected_unverified':
      if (event.type === 'REVIEW_SIGNATURE' && state.view === 'connected') return { ...state, view: 'pre_sign' };
      // A request can only be created from the review screen and replaces no existing request.
      if (event.type === 'SIGNATURE_REQUESTED' && state.view === 'pre_sign' && !state.attempt.providerRequestId) {
        return { status: 'awaiting_signature', purpose: state.purpose, wallet: state.wallet, challenge: state.challenge, attempt: { ...state.attempt, providerRequestId: event.providerRequestId, signatureHandoffUrl: event.handoffUrl } };
      }
      if (event.type === 'SIGNATURE_STILL_PENDING' && event.providerRequestId) {
        return { status: 'awaiting_signature', purpose: state.purpose, wallet: state.wallet, challenge: state.challenge, attempt: { ...state.attempt, providerRequestId: event.providerRequestId } };
      }
      if (event.type === 'FAIL') return retryableError(state, event.error);
      if (event.type === 'BLOCK') return { status: 'blocked', purpose: state.purpose, error: event.error, wallet: state.wallet, attempt: state.attempt };
      if (event.type === 'BACK' && state.view === 'pre_sign') return { ...state, view: 'connected' };
      if (event.type === 'CHANGE_WALLET') return { status: 'choosing_chain', purpose: state.purpose, selectedFamily: state.wallet.family };
      return state;

    case 'awaiting_signature':
      if (event.type === 'SIGNATURE_STILL_PENDING') return { ...state, attempt: event.providerRequestId ? { ...state.attempt, providerRequestId: event.providerRequestId } : state.attempt };
      if (event.type === 'VERIFICATION_STARTED') return { status: 'verifying', purpose: state.purpose, wallet: state.wallet, challenge: state.challenge, attempt: state.attempt };
      if (event.type === 'FAIL') return retryableError(state, event.error);
      if (event.type === 'BLOCK') return { status: 'blocked', purpose: state.purpose, error: event.error, wallet: state.wallet, attempt: state.attempt };
      // A submitted provider request remains server-side. Cancellation abandons this attempt;
      // a later choice creates a new attempt instead of issuing a conflicting replacement.
      if (event.type === 'CANCEL') return { status: 'choosing_chain', purpose: state.purpose, selectedFamily: state.wallet.family };
      if (event.type === 'CHANGE_WALLET') return { status: 'choosing_chain', purpose: state.purpose, selectedFamily: state.wallet.family };
      return state;

    case 'verifying':
      if (event.type === 'SIGNATURE_STILL_PENDING') return { status: 'awaiting_signature', purpose: state.purpose, wallet: state.wallet, challenge: state.challenge, attempt: event.providerRequestId ? { ...state.attempt, providerRequestId: event.providerRequestId } : state.attempt };
      if (event.type === 'VERIFIED') return { status: 'complete', purpose: state.purpose, session: event.session, attempt: state.attempt };
      if (event.type === 'FAIL') return retryableError(state, event.error);
      if (event.type === 'BLOCK') return { status: 'blocked', purpose: state.purpose, error: event.error, wallet: state.wallet, attempt: state.attempt };
      return state;

    case 'recoverable_error':
      if (event.type === 'RETRY') return state.retryState;
      if (event.type === 'RESTART_SIGNATURE') {
        const retryState = state.retryState;
        if (retryState.status === 'connected_unverified' || retryState.status === 'awaiting_signature' || retryState.status === 'verifying') {
          return { status: 'connected_unverified', purpose: state.purpose, wallet: retryState.wallet, challenge: event.challenge, attempt: { ...retryState.attempt, providerRequestId: undefined, signatureHandoffUrl: undefined }, view: 'pre_sign' };
        }
      }
      if (event.type === 'CHANGE_WALLET' || event.type === 'BACK') return { status: 'choosing_chain', purpose: state.purpose, selectedFamily: selectedFamily(state.retryState) };
      return state;

    case 'blocked':
      if (event.type === 'CHANGE_WALLET' || event.type === 'BACK') return { status: 'choosing_chain', purpose: state.purpose, selectedFamily: state.wallet?.family };
      return state;

    case 'complete':
      return state;

    default:
      return assertNever(state);
  }
}

function retryableError(retryState: Exclude<OnboardingState, { status: 'recoverable_error' | 'blocked' | 'complete' | 'not_started' }>, error: SafeError): OnboardingState {
  return { status: 'recoverable_error', purpose: retryState.purpose, error, retryState };
}

function selectedFamily(state: OnboardingState): ChainFamily | undefined {
  switch (state.status) {
    case 'choosing_chain': return state.selectedFamily;
    case 'connecting': return state.family;
    case 'connected_unverified':
    case 'awaiting_signature':
    case 'verifying': return state.wallet.family;
    case 'recoverable_error': return selectedFamily(state.retryState);
    case 'complete': return state.session.wallet.family;
    case 'blocked': return state.wallet?.family;
    case 'not_started': return undefined;
    default: return assertNever(state);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled onboarding state: ${JSON.stringify(value)}`);
}
