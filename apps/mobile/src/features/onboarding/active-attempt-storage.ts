import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { shortenAddress, type ChallengePreview, type OnboardingPurpose, type OnboardingState, type PersistedOnboardingAttempt, type RestorableOnboardingState } from './types';

const STORAGE_PREFIX = 'com.stocklana.onboarding.v1.';
const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: 'com.stocklana.onboarding.v1',
};

/** Converts live state into the narrow recovery record permitted to leave memory. */
export function persistedAttemptForState(state: OnboardingState): PersistedOnboardingAttempt | undefined {
  const active = activeState(state);
  if (!active) return undefined;
  const attempt = {
    attemptId: active.attempt.attemptId,
    attemptCapability: active.attempt.attemptCapability,
    expiresAt: active.attempt.expiresAt,
    providerId: active.attempt.providerId,
    ...(active.attempt.providerRequestId ? { providerRequestId: active.attempt.providerRequestId } : {}),
  };
  if (active.status === 'connecting') return { version: 1, purpose: active.purpose, phase: active.status, family: active.family, attempt };
  return {
    version: 1,
    purpose: active.purpose,
    phase: active.status,
    family: active.wallet.family,
    attempt,
    credentialRef: active.wallet.credentialRef,
    // Recompute from the in-memory address so a provider cannot accidentally persist a full display value.
    addressDisplay: shortenAddress(active.wallet.address),
    chainContext: active.wallet.context,
    challenge: withoutMessage(active.challenge),
  };
}

export async function readPersistedAttempt(purpose: OnboardingPurpose): Promise<PersistedOnboardingAttempt | undefined> {
  const raw = Platform.OS === 'web'
    ? globalThis.sessionStorage?.getItem(storageKey(purpose)) ?? null
    : await SecureStore.getItemAsync(storageKey(purpose), secureStoreOptions);
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isPersistedAttempt(parsed, purpose)) return parsed;
  } catch {
    // fall through to remove a corrupted/stale schema payload
  }
  await clearPersistedAttempt(purpose).catch(() => undefined);
  return undefined;
}

export async function savePersistedAttempt(record: PersistedOnboardingAttempt): Promise<void> {
  const value = JSON.stringify(record);
  if (Platform.OS === 'web') globalThis.sessionStorage?.setItem(storageKey(record.purpose), value);
  else await SecureStore.setItemAsync(storageKey(record.purpose), value, secureStoreOptions);
}

export async function clearPersistedAttempt(purpose: OnboardingPurpose): Promise<void> {
  if (Platform.OS === 'web') globalThis.sessionStorage?.removeItem(storageKey(purpose));
  else await SecureStore.deleteItemAsync(storageKey(purpose), secureStoreOptions);
}

export function isExpiredAttempt(record: PersistedOnboardingAttempt): boolean {
  const expiresAt = Date.parse(record.attempt.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
}

function activeState(state: OnboardingState): RestorableOnboardingState | undefined {
  if (state.status === 'connecting' || state.status === 'connected_unverified' || state.status === 'awaiting_signature' || state.status === 'verifying') return state;
  if (state.status === 'recoverable_error') {
    if (state.error.category === 'request_expired' || state.error.category === 'signature_rejected' || state.error.category === 'verification_failed') return undefined;
    return activeState(state.retryState);
  }
  return undefined;
}

function isPersistedAttempt(value: unknown, purpose: OnboardingPurpose): value is PersistedOnboardingAttempt {
  if (!isRecord(value) || value.version !== 1 || value.purpose !== purpose || !isPhase(value.phase) || (value.family !== 'evm' && value.family !== 'solana') || !isAttempt(value.attempt)) return false;
  if (value.phase === 'connecting') return true;
  return isString(value.credentialRef) && isString(value.addressDisplay) && (value.chainContext === undefined || isString(value.chainContext)) && isChallenge(value.challenge);
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
function isString(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function isPhase(value: unknown): value is PersistedOnboardingAttempt['phase'] { return value === 'connecting' || value === 'connected_unverified' || value === 'awaiting_signature' || value === 'verifying'; }
function isAttempt(value: unknown): value is PersistedOnboardingAttempt['attempt'] { return isRecord(value) && isString(value.attemptId) && isString(value.attemptCapability) && isString(value.expiresAt) && isString(value.providerId) && (value.providerRequestId === undefined || isString(value.providerRequestId)); }
function isChallenge(value: unknown): value is Omit<ChallengePreview, 'messagePreview'> { return isRecord(value) && isString(value.challengeId) && isString(value.domain) && (value.issuedAt === undefined || isString(value.issuedAt)) && (value.expiresAt === undefined || isString(value.expiresAt)) && (value.validityWindow === undefined || isString(value.validityWindow)) && value.messagePreview === undefined; }

function withoutMessage(challenge: ChallengePreview): Omit<ChallengePreview, 'messagePreview'> {
  return {
    challengeId: challenge.challengeId,
    domain: challenge.domain,
    ...(challenge.issuedAt ? { issuedAt: challenge.issuedAt } : {}),
    ...(challenge.expiresAt ? { expiresAt: challenge.expiresAt } : {}),
    ...(challenge.validityWindow ? { validityWindow: challenge.validityWindow } : {}),
  };
}

function storageKey(purpose: OnboardingPurpose): string { return `${STORAGE_PREFIX}${purpose}`; }
