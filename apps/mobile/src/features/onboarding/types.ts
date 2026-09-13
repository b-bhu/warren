/** Runtime-neutral types for the ownership-verification UI. Never put secrets here. */

export type ChainFamily = 'evm' | 'solana';
export type OnboardingPurpose = 'sign_in' | 'link_wallet';

export type WalletContext = {
  family: ChainFamily;
  /** Full address is only rendered through an explicit Details/copy interaction. */
  address: string;
  addressDisplay: string;
  context?: string;
  credentialRef: string;
};

export type AttemptContext = {
  attemptId: string;
  /** Bearer capability: persist in SecureStore only, never render or log it. */
  attemptCapability: string;
  expiresAt: string;
  providerId: string;
  /** Volatile external handoff destination; persist the attempt ID/capability, never rely on this after restoration. */
  authorizationUrl?: string;
  providerRequestId?: string;
  /** Volatile provider UI URL; resume with providerRequestId and reconciliation after restoration. */
  signatureHandoffUrl?: string;
};

/**
 * Secure-storage payload for an unfinished attempt. This is deliberately a display-safe
 * recovery hint: no full address, raw challenge message, provider URL, signature, or token.
 */
export type PersistedOnboardingAttempt = {
  version: 1;
  purpose: OnboardingPurpose;
  phase: 'connecting' | 'connected_unverified' | 'awaiting_signature' | 'verifying';
  family: ChainFamily;
  attempt: Pick<AttemptContext, 'attemptId' | 'attemptCapability' | 'expiresAt' | 'providerId' | 'providerRequestId'>;
  credentialRef?: string;
  addressDisplay?: string;
  chainContext?: string;
  challenge?: Omit<ChallengePreview, 'messagePreview'>;
};

export type RestorableOnboardingState = Extract<OnboardingState, { status: 'connecting' | 'connected_unverified' | 'awaiting_signature' | 'verifying' }>;

export type ChallengePreview = {
  challengeId: string;
  domain: string;
  issuedAt?: string;
  expiresAt?: string;
  validityWindow?: string;
  /** Server-provided display text. The mobile app must not reconstruct the message. */
  messagePreview?: string;
};

export type SessionResult = {
  profileId: string;
  /** Opaque values must be sent directly to the session layer, not rendered or logged. */
  accessToken: string;
  refreshToken: string;
  wallet: WalletContext;
  source: 'server_verified' | 'development_demo';
};

export type ErrorCategory =
  | 'signature_rejected'
  | 'request_expired'
  | 'offline'
  | 'provider_unavailable'
  | 'rate_limited'
  | 'session_invalid'
  | 'wrong_network'
  | 'address_mismatch'
  | 'verification_failed'
  | 'callback_invalid'
  | 'unknown';

export type BlockedCategory = 'unsupported_wallet' | 'unsupported_network' | 'wallet_conflict';

export type SafeError = {
  category: ErrorCategory;
  message: string;
  /** A redacted category suitable for Details/support. */
  diagnosticCategory?: string;
  attemptReference?: string;
};

export type SafeBlockedError = {
  category: BlockedCategory;
  message: string;
  diagnosticCategory?: string;
  attemptReference?: string;
};

export type OnboardingState =
  | { status: 'not_started'; purpose: OnboardingPurpose }
  | { status: 'choosing_chain'; purpose: OnboardingPurpose; selectedFamily?: ChainFamily }
  | { status: 'connecting'; purpose: OnboardingPurpose; family: ChainFamily; attempt: AttemptContext }
  | {
      status: 'connected_unverified';
      purpose: OnboardingPurpose;
      wallet: WalletContext;
      attempt: AttemptContext;
      challenge: ChallengePreview;
      view: 'connected' | 'pre_sign';
    }
  | {
      status: 'awaiting_signature';
      purpose: OnboardingPurpose;
      wallet: WalletContext;
      attempt: AttemptContext;
      challenge: ChallengePreview;
    }
  | {
      status: 'verifying';
      purpose: OnboardingPurpose;
      wallet: WalletContext;
      attempt: AttemptContext;
      challenge: ChallengePreview;
    }
  | { status: 'complete'; purpose: OnboardingPurpose; session: SessionResult; attempt?: AttemptContext }
  | {
      status: 'recoverable_error';
      purpose: OnboardingPurpose;
      error: SafeError;
      retryState: Exclude<OnboardingState, { status: 'recoverable_error' | 'blocked' | 'complete' | 'not_started' }>;
    }
  | { status: 'blocked'; purpose: OnboardingPurpose; error: SafeBlockedError; wallet?: WalletContext; attempt?: AttemptContext };

export type ServiceFailure =
  | { kind: 'recoverable_error'; error: SafeError }
  | { kind: 'blocked'; error: SafeBlockedError };

export type Reconciliation =
  | { kind: 'waiting_for_wallet' }
  | { kind: 'connected'; wallet: WalletContext; challenge: ChallengePreview }
  | { kind: 'awaiting_signature'; providerRequestId?: string }
  | { kind: 'verifying' }
  | { kind: 'complete'; session: SessionResult }
  | ServiceFailure;

export function chainLabel(family: ChainFamily): string {
  return family === 'evm' ? 'EVM wallet' : 'Solana wallet';
}

export function shortenAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
