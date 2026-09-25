import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import type { SessionResult } from '@/features/onboarding';
import { configuredApiUrl } from '@/lib/api-config';

const ACCESS_TOKEN_STORAGE_KEY = 'com.warren.session.v1.access';
const REFRESH_TOKEN_STORAGE_KEY = 'com.warren.session.v1.refresh';
const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: 'com.warren.session.v1',
};

type StoredTokens = { accessToken: string; refreshToken: string };
export type VerifiedWallet = { family: 'evm' | 'solana'; addressDisplay: string; context?: string; verifiedAt: string };
export type SessionProfile = { profileId: string; wallets: VerifiedWallet[] };
type SessionStatus = 'hydrating' | 'anonymous' | 'authenticated' | 'recoverable' | 'unavailable';

export type SessionContextValue = {
  status: SessionStatus;
  profile?: SessionProfile;
  /** Opaque bearer token for the feature's typed API service only; never render or log it. */
  accessToken?: string;
  apiUrl?: string;
  recoverableMessage?: string;
  completeOnboarding: (result: SessionResult) => Promise<void>;
  refresh: () => Promise<void>;
  /** Checks the active session and rotates only when the API authoritatively rejects its access token. */
  ensureActiveSession: () => Promise<boolean>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const apiUrl = configuredApiUrl();
  const [status, setStatus] = useState<SessionStatus>('hydrating');
  const [tokens, setTokens] = useState<StoredTokens>();
  const [profile, setProfile] = useState<SessionProfile>();
  const [recoverableMessage, setRecoverableMessage] = useState<string>();

  const clear = useCallback(async () => {
    await deleteTokens();
    setTokens(undefined);
    setProfile(undefined);
    setRecoverableMessage(undefined);
  }, []);

  const fetchProfile = useCallback(async (accessToken: string): Promise<SessionProfile> => {
    if (!apiUrl) throw new Error('API_URL_UNAVAILABLE');
    return requestJson<SessionProfile>(apiUrl, '/v1/me', { method: 'GET', accessToken });
  }, [apiUrl]);

  const preserveForRetry = useCallback((stored: StoredTokens, error: unknown) => {
    setTokens(stored);
    setRecoverableMessage(recoverableMessageFor(error));
    setStatus('recoverable');
  }, []);

  const rotateSession = useCallback(async (stored: StoredTokens): Promise<SessionProfile> => {
    if (!apiUrl) throw new Error('API_URL_UNAVAILABLE');
    const next = await requestJson<StoredTokens>(apiUrl, '/v1/sessions/refresh', {
      method: 'POST',
      idempotencyKey: refreshIdempotencyKey(stored.refreshToken),
      body: { refreshToken: stored.refreshToken },
    });
    // Persist before loading the profile. If the response was delivered but the next
    // request fails, the rotated token remains available for a safe retry.
    await writeTokens(next);
    setTokens(next);
    return fetchProfile(next.accessToken);
  }, [apiUrl, fetchProfile]);

  const refresh = useCallback(async () => {
    if (!apiUrl || !tokens) {
      setStatus(apiUrl ? 'anonymous' : isDevelopmentBuild() ? 'anonymous' : 'unavailable');
      return;
    }
    try {
      const nextProfile = await rotateSession(tokens);
      setProfile(nextProfile);
      setRecoverableMessage(undefined);
      setStatus('authenticated');
    } catch (error) {
      if (isAuthoritativeSessionRejection(error)) {
        await clear();
        setStatus('anonymous');
        return;
      }
      preserveForRetry(tokens, error);
    }
  }, [apiUrl, clear, preserveForRetry, rotateSession, tokens]);

  const ensureActiveSession = useCallback(async (): Promise<boolean> => {
    if (!apiUrl || !tokens) return false;
    try {
      const activeProfile = await fetchProfile(tokens.accessToken);
      setProfile(activeProfile);
      setRecoverableMessage(undefined);
      setStatus('authenticated');
      return true;
    } catch (error) {
      if (!isAuthoritativeSessionRejection(error)) {
        preserveForRetry(tokens, error);
        return false;
      }
    }

    try {
      const refreshedProfile = await rotateSession(tokens);
      setProfile(refreshedProfile);
      setRecoverableMessage(undefined);
      setStatus('authenticated');
      return true;
    } catch (error) {
      if (isAuthoritativeSessionRejection(error)) {
        await clear();
        setStatus('anonymous');
      } else {
        preserveForRetry(tokens, error);
      }
      return false;
    }
  }, [apiUrl, clear, fetchProfile, preserveForRetry, rotateSession, tokens]);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!apiUrl) {
        if (active) setStatus(isDevelopmentBuild() ? 'anonymous' : 'unavailable');
        return;
      }
      let stored: StoredTokens | undefined;
      try {
        stored = await readTokens();
      } catch (error) {
        if (active) {
          setRecoverableMessage(recoverableMessageFor(error));
          setStatus('recoverable');
        }
        return;
      }
      if (!active) return;
      if (!stored) {
        setStatus('anonymous');
        return;
      }
      try {
        const hydratedProfile = await fetchProfile(stored.accessToken);
        if (!active) return;
        setTokens(stored);
        setProfile(hydratedProfile);
        setStatus('authenticated');
      } catch (error) {
        if (!isAuthoritativeSessionRejection(error)) {
          if (active) preserveForRetry(stored, error);
          return;
        }
        // An expired access token is normal; the refresh endpoint is authoritative.
        try {
          const hydratedProfile = await rotateSession(stored);
          if (!active) return;
          setProfile(hydratedProfile);
          setRecoverableMessage(undefined);
          setStatus('authenticated');
        } catch (refreshError) {
          if (!active) return;
          if (isAuthoritativeSessionRejection(refreshError)) {
            await deleteTokens();
            setTokens(undefined);
            setProfile(undefined);
            setStatus('anonymous');
          } else {
            preserveForRetry(stored, refreshError);
          }
        }
      }
    })();
    return () => { active = false; };
  }, [apiUrl, fetchProfile, preserveForRetry, rotateSession]);

  const completeOnboarding = useCallback(async (result: SessionResult) => {
    if (result.source !== 'server_verified') throw new Error('A development demonstration cannot create a Warren session.');
    if (!apiUrl) throw new Error('Warren API is not configured for this build.');
    const next = { accessToken: result.accessToken, refreshToken: result.refreshToken };
    await writeTokens(next);
    setTokens(next);
    try {
      const nextProfile = await fetchProfile(next.accessToken);
      setProfile(nextProfile);
      setRecoverableMessage(undefined);
      setStatus('authenticated');
    } catch (error) {
      if (isAuthoritativeSessionRejection(error)) {
        await clear();
        setStatus('anonymous');
        throw error;
      }
      preserveForRetry(next, error);
    }
  }, [apiUrl, clear, fetchProfile, preserveForRetry]);

  const signOut = useCallback(async () => {
    try {
      if (apiUrl && tokens?.accessToken) await requestJson<void>(apiUrl, '/v1/sessions/revoke', { method: 'POST', accessToken: tokens.accessToken });
    } finally {
      await clear();
      setStatus(apiUrl || isDevelopmentBuild() ? 'anonymous' : 'unavailable');
    }
  }, [apiUrl, clear, tokens?.accessToken]);

  const accessToken = tokens?.accessToken;
  const value = useMemo<SessionContextValue>(() => ({ status, profile, accessToken, apiUrl, recoverableMessage, completeOnboarding, refresh, ensureActiveSession, signOut }), [accessToken, apiUrl, completeOnboarding, ensureActiveSession, profile, recoverableMessage, refresh, signOut, status]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within SessionProvider.');
  return value;
}

function isDevelopmentBuild() {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

async function readTokens(): Promise<StoredTokens | undefined> {
  const [accessToken, refreshToken] = Platform.OS === 'web'
    ? [globalThis.sessionStorage?.getItem(ACCESS_TOKEN_STORAGE_KEY) ?? null, globalThis.sessionStorage?.getItem(REFRESH_TOKEN_STORAGE_KEY) ?? null]
    : await Promise.all([SecureStore.getItemAsync(ACCESS_TOKEN_STORAGE_KEY, secureStoreOptions), SecureStore.getItemAsync(REFRESH_TOKEN_STORAGE_KEY, secureStoreOptions)]);
  return accessToken && refreshToken ? { accessToken, refreshToken } : undefined;
}

async function writeTokens(tokens: StoredTokens) {
  if (Platform.OS === 'web') {
    globalThis.sessionStorage?.setItem(ACCESS_TOKEN_STORAGE_KEY, tokens.accessToken);
    globalThis.sessionStorage?.setItem(REFRESH_TOKEN_STORAGE_KEY, tokens.refreshToken);
  } else await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_STORAGE_KEY, tokens.accessToken, secureStoreOptions),
    SecureStore.setItemAsync(REFRESH_TOKEN_STORAGE_KEY, tokens.refreshToken, secureStoreOptions),
  ]);
}

async function deleteTokens() {
  if (Platform.OS === 'web') {
    globalThis.sessionStorage?.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    globalThis.sessionStorage?.removeItem(REFRESH_TOKEN_STORAGE_KEY);
  } else await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_STORAGE_KEY, secureStoreOptions),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_STORAGE_KEY, secureStoreOptions),
  ]);
}

async function requestJson<T>(baseUrl: string, path: string, options: { method: 'GET' | 'POST'; accessToken?: string; idempotencyKey?: string; body?: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: { accept: 'application/json', ...(options.body === undefined ? {} : { 'content-type': 'application/json' }), ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {}), ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch {
    throw new SessionRequestError();
  }
  if (!response.ok) throw new SessionRequestError(response.status);
  if (response.status === 204) return undefined as T;
  try {
    return await response.json() as T;
  } catch {
    throw new SessionRequestError(response.status);
  }
}

class SessionRequestError extends Error {
  constructor(readonly status?: number) {
    super(status === undefined ? 'Session request could not reach Warren.' : `Session request failed with status ${status}.`);
  }
}

function isAuthoritativeSessionRejection(error: unknown): boolean {
  return error instanceof SessionRequestError && error.status === 401;
}

function recoverableMessageFor(error: unknown): string {
  if (error instanceof SessionRequestError && error.status && error.status >= 500) return 'Warren could not reconnect. Your saved session is still kept on this device.';
  return 'We could not reach Warren. Your saved session is still kept on this device.';
}

/** Stable per refresh-token ID; the bearer secret is never copied into an HTTP header. */
function refreshIdempotencyKey(refreshToken: string): string {
  const match = /^st1\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[A-Za-z0-9_-]+$/i.exec(refreshToken);
  return `session-refresh:${match?.[1] ?? 'invalid-token'}`;
}
