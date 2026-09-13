import type { AuthorizationReturn, BeginConnectionInput, OnboardingService, SignatureRequest } from './service';
import type { AttemptContext, ChallengePreview, PersistedOnboardingAttempt, Reconciliation, RestorableOnboardingState, WalletContext } from './types';
import { shortenAddress } from './types';

/**
 * Development-only scripted UI adapter. It has no provider connection, makes no network
 * calls, and returns synthetic credentials marked `development_demo`; it is not authentication.
 */
export type DevelopmentDemoScenario = 'evm_happy' | 'solana_happy' | 'signature_rejected' | 'request_expired' | 'provider_error';

type DemoAttempt = { input: BeginConnectionInput; attempt: AttemptContext; wallet: WalletContext; challenge: ChallengePreview; signatureRequested: boolean };

export function createDevelopmentDemoOnboardingService(scenario: DevelopmentDemoScenario = 'evm_happy'): OnboardingService {
  assertDevelopmentOnly();
  let sequence = 0;
  const attempts = new Map<string, DemoAttempt>();

  return {
    async beginConnection(input) {
      const selectedFamily = scenario === 'solana_happy' ? 'solana' : input.family;
      const id = `demo-attempt-${++sequence}`;
      const address = selectedFamily === 'evm' ? '0x12ab34cd56ef789012ab34cd56ef789012ab8F91' : '7M4d6wAaj4c3tZrPq9vA6sWyyTJVv2rSjH6BXKfDpKpK';
      const wallet: WalletContext = { family: selectedFamily, address, addressDisplay: shortenAddress(address), context: selectedFamily === 'evm' ? 'Development EVM network' : 'Development Solana cluster', credentialRef: `demo-credential-${id}` };
      const attempt: AttemptContext = { attemptId: id, attemptCapability: `development-only-${id}`, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), providerId: 'development-demo', authorizationUrl: 'stocklana-demo://wallet-approval' };
      const challenge: ChallengePreview = { challengeId: `demo-challenge-${id}`, domain: 'stocklana.example', validityWindow: '15 minutes', messagePreview: 'Sign in to Stocklana\nThis is a development-only preview.' };
      attempts.set(id, { input: { ...input, family: selectedFamily }, attempt, wallet, challenge, signatureRequested: false });
      return attempt;
    },
    async reconcileConnection(attempt, _returned?: AuthorizationReturn): Promise<Reconciliation> {
      const demo = requireDemoAttempt(attempts, attempt.attemptId);
      if (scenario === 'provider_error') return providerError(demo.attempt.attemptId);
      return { kind: 'connected', wallet: demo.wallet, challenge: demo.challenge };
    },
    async createFreshChallenge({ attempt, wallet }) {
      const demo = requireDemoAttempt(attempts, attempt.attemptId);
      if (wallet.credentialRef !== demo.wallet.credentialRef) throw new Error('The development demo received a wallet for another attempt.');
      demo.challenge = { ...demo.challenge, challengeId: `${demo.challenge.challengeId}-fresh-${Date.now()}`, validityWindow: '15 minutes' };
      demo.signatureRequested = false;
      return demo.challenge;
    },
    async requestSignature({ attempt, wallet, challenge }): Promise<SignatureRequest> {
      const demo = requireDemoAttempt(attempts, attempt.attemptId);
      if (demo.signatureRequested) throw new Error('The development demo refuses duplicate signature requests. Reconcile the existing request instead.');
      if (wallet.credentialRef !== demo.wallet.credentialRef || challenge.challengeId !== demo.challenge.challengeId) throw new Error('The development demo received wallet or challenge data for another attempt.');
      demo.signatureRequested = true;
      return { requestId: `demo-request-${attempt.attemptId}`, handoffUrl: 'stocklana-demo://wallet-approval', pollAfterMs: 0 };
    },
    async reconcileSignature(attempt): Promise<Reconciliation> {
      const demo = requireDemoAttempt(attempts, attempt.attemptId);
      if (!demo.signatureRequested || !attempt.providerRequestId) return { kind: 'awaiting_signature' };
      if (scenario === 'signature_rejected') return { kind: 'recoverable_error', error: { category: 'signature_rejected', message: 'You did not approve the sign-in. Choose your wallet again to create a new request.', diagnosticCategory: 'DEMO_SIGNATURE_REJECTED', attemptReference: demo.attempt.attemptId } };
      if (scenario === 'request_expired') return { kind: 'recoverable_error', error: { category: 'request_expired', message: 'The signing request expired. Choose your wallet again to create a new request.', diagnosticCategory: 'DEMO_REQUEST_EXPIRED', attemptReference: demo.attempt.attemptId } };
      if (scenario === 'provider_error') return providerError(demo.attempt.attemptId);
      return { kind: 'complete', session: { profileId: `development-profile-${demo.attempt.attemptId}`, accessToken: 'not-a-token', refreshToken: 'not-a-token', wallet: demo.wallet, source: 'development_demo' } };
    },
    async restorePersistedAttempt(restored: PersistedOnboardingAttempt): Promise<RestorableOnboardingState> {
      // This adapter is development-only and never creates a real session. It reconstructs its
      // deterministic fixture in memory; the persisted record still contains no raw address/message.
      const address = restored.family === 'evm' ? '0x12ab34cd56ef789012ab34cd56ef789012ab8F91' : '7M4d6wAaj4c3tZrPq9vA6sWyyTJVv2rSjH6BXKfDpKpK';
      const wallet: WalletContext = { family: restored.family, address, addressDisplay: shortenAddress(address), context: restored.family === 'evm' ? 'Development EVM network' : 'Development Solana cluster', credentialRef: `demo-credential-${restored.attempt.attemptId}` };
      if ((restored.addressDisplay && restored.addressDisplay !== wallet.addressDisplay) || (restored.credentialRef && restored.credentialRef !== wallet.credentialRef) || (restored.chainContext && restored.chainContext !== wallet.context)) throw new Error('The development attempt does not match its deterministic credential.');
      const challenge: ChallengePreview = {
        ...(restored.challenge ?? { challengeId: `demo-challenge-${restored.attempt.attemptId}`, domain: 'stocklana.example', validityWindow: '15 minutes' }),
        // Recreated development fixture text is held only in memory; it was never persisted.
        messagePreview: 'Sign in to Stocklana\nThis is a development-only preview.',
      };
      const attempt: AttemptContext = restored.attempt;
      const signatureRequested = Boolean(attempt.providerRequestId);
      attempts.set(attempt.attemptId, { input: { family: restored.family, purpose: restored.purpose, providerId: attempt.providerId }, attempt, wallet, challenge, signatureRequested });
      if (signatureRequested) return { status: 'awaiting_signature', purpose: restored.purpose, wallet, challenge, attempt };
      return { status: 'connected_unverified', purpose: restored.purpose, wallet, challenge, attempt, view: 'connected' };
    },
  };
}

function requireDemoAttempt(attempts: Map<string, DemoAttempt>, attemptId: string): DemoAttempt {
  const attempt = attempts.get(attemptId);
  if (!attempt) throw new Error('Unknown development demo attempt.');
  return attempt;
}

function providerError(attemptReference: string): Reconciliation {
  return { kind: 'recoverable_error', error: { category: 'provider_unavailable', message: 'The wallet provider is unavailable. Try again when it is available.', diagnosticCategory: 'DEMO_PROVIDER_UNAVAILABLE', attemptReference } };
}

function assertDevelopmentOnly() {
  // Metro replaces __DEV__ at bundle time. Refuse use in a release bundle.
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    throw new Error('The development demo service is disabled outside a development build and cannot authenticate a user.');
  }
}
