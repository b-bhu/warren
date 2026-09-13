import {
  hasError,
  isConnected,
  needsRecovery,
  useEmbeddedEthereumWallet,
  useEmbeddedSolanaWallet,
  useLoginWithOAuth,
  usePrivy,
} from '@privy-io/expo';
import { useCallback, useEffect, useState } from 'react';

import { LiquidLedgerScreen } from './LiquidLedgerScreen';
import { usePrivyRuntimeStatus } from './config';

type Provider = 'apple' | 'google';

const CANCELLED_AUTH = /plugin closed|user rejected|user denied|request rejected|cancell?ed/i;
const SESSION_RECONCILIATION_TIMEOUT_MS = 12_000;
const WALLET_PREPARATION_TIMEOUT_MS = 25_000;

export function PrivyEntry() {
  const runtimeStatus = usePrivyRuntimeStatus();

  if (runtimeStatus !== 'configured') {
    return <LiquidLedgerScreen mode="missing-config" />;
  }

  return <ConfiguredPrivyEntry />;
}

function ConfiguredPrivyEntry() {
  const { error: initializationError, isReady, logout, refreshUser, user } = usePrivy();
  const { login } = useLoginWithOAuth();
  const ethereumWallet = useEmbeddedEthereumWallet();
  const solanaWallet = useEmbeddedSolanaWallet();
  const [activeProvider, setActiveProvider] = useState<Provider | null>(null);
  const [awaitingSession, setAwaitingSession] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [sessionTimedOut, setSessionTimedOut] = useState(false);
  const [timedOutUserId, setTimedOutUserId] = useState<string | null>(null);

  const evmAddress = ethereumWallet.wallets[0]?.address ?? null;
  const solanaAddress = isConnected(solanaWallet)
    ? solanaWallet.wallets[0]?.address ?? null
    : null;
  const walletsReady = Boolean(evmAddress && solanaAddress);
  const recordedEvmAddress = findEmbeddedWalletAddress(user?.linked_accounts, 'ethereum');
  const evmNeedsRecovery = Boolean(recordedEvmAddress && !evmAddress);
  const walletTimedOut = Boolean(
    user && !walletsReady && timedOutUserId === user.id,
  );

  useEffect(() => {
    if (!awaitingSession || user) return;

    const timeout = setTimeout(
      () => setSessionTimedOut(true),
      SESSION_RECONCILIATION_TIMEOUT_MS,
    );
    return () => clearTimeout(timeout);
  }, [awaitingSession, user]);

  useEffect(() => {
    if (!user || walletsReady) return;

    const timeout = setTimeout(
      () => setTimedOutUserId(user.id),
      WALLET_PREPARATION_TIMEOUT_MS,
    );
    return () => clearTimeout(timeout);
  }, [user, walletsReady]);

  const loginWithProvider = useCallback(async (provider: Provider) => {
    setLocalError(null);
    setAwaitingSession(false);
    setSessionTimedOut(false);
    setTimedOutUserId(null);
    setActiveProvider(provider);

    try {
      const authenticatedUser = await login({ provider });
      setAwaitingSession(Boolean(authenticatedUser));
    } catch (error) {
      const message = errorMessage(error);
      if (!CANCELLED_AUTH.test(message)) setLocalError(friendlyAuthError(message));
    } finally {
      setActiveProvider(null);
    }
  }, [login]);

  const retry = useCallback(async () => {
    setLocalError(null);
    setAwaitingSession(false);
    setSessionTimedOut(false);
    setTimedOutUserId(null);
    if (!user) return;

    try {
      await refreshUser();
    } catch (error) {
      setLocalError(friendlyAuthError(errorMessage(error)));
    }
  }, [refreshUser, user]);

  const signOut = useCallback(async () => {
    setLocalError(null);
    setAwaitingSession(false);
    setSessionTimedOut(false);
    setTimedOutUserId(null);
    try {
      await logout();
    } catch (error) {
      setLocalError(friendlyAuthError(errorMessage(error)));
    }
  }, [logout]);

  const recoveryRequired = needsRecovery(solanaWallet) || (walletTimedOut && evmNeedsRecovery);
  const walletError = hasError(solanaWallet)
    ? 'Privy could not prepare the Solana wallet. Please try again.'
    : walletTimedOut && !recoveryRequired
        ? 'Your wallets are taking longer than expected. Check your connection and try again.'
        : null;
  const sessionError = sessionTimedOut && !user
    ? 'Sign-in finished, but the Privy session did not return to Stocklana. Please try again.'
    : null;
  const initializationMessage = initializationError
    ? 'Privy could not start in this build. Check the public app and client configuration, then restart the app.'
    : null;
  const visibleError = localError ?? sessionError ?? initializationMessage ?? walletError;

  if (recoveryRequired) {
    return (
      <LiquidLedgerScreen
        evmAddress={evmAddress}
        message="Your existing wallet keys are not available on this device. An approved Privy recovery method must be configured before continuing."
        mode="recovery-required"
        onSignOut={() => void signOut()}
        solanaAddress={solanaAddress}
      />
    );
  }

  if (visibleError) {
    return (
      <LiquidLedgerScreen
        evmAddress={evmAddress}
        message={visibleError}
        mode="error"
        onRetry={initializationError ? undefined : () => void retry()}
        onSignOut={user ? () => void signOut() : undefined}
        solanaAddress={solanaAddress}
      />
    );
  }

  if (!isReady || activeProvider || (!user && awaitingSession) || (user && !walletsReady)) {
    return (
      <LiquidLedgerScreen
        activeProvider={activeProvider}
        evmAddress={evmAddress}
        mode="preparing"
        solanaAddress={solanaAddress}
      />
    );
  }

  if (user && walletsReady) {
    return (
      <LiquidLedgerScreen
        evmAddress={evmAddress}
        mode="ready"
        onSignOut={() => void signOut()}
        solanaAddress={solanaAddress}
      />
    );
  }

  return (
    <LiquidLedgerScreen
      activeProvider={activeProvider}
      message={legalConfigurationMessage()}
      mode="sign-in"
      onLogin={canBeginLogin() ? (provider) => void loginWithProvider(provider) : undefined}
    />
  );
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Unknown Privy error';
}

function friendlyAuthError(message: string) {
  if (/network|fetch|offline|internet/i.test(message)) {
    return 'Stocklana could not reach Privy. Check your connection and try again.';
  }
  return 'Sign-in could not be completed. Please try again.';
}

function findEmbeddedWalletAddress(
  linkedAccounts: readonly unknown[] | undefined,
  chainType: 'ethereum' | 'solana',
) {
  const account = (linkedAccounts ?? []).find((candidate) => {
    const wallet = candidate as { address?: unknown; chain_type?: unknown; type?: unknown };
    return wallet.type === 'wallet'
      && wallet.chain_type === chainType
      && typeof wallet.address === 'string';
  }) as { address?: string } | undefined;

  return account?.address ?? null;
}

function legalConfigurationMessage() {
  if (hasLegalConfiguration()) return null;
  return typeof __DEV__ !== 'undefined' && __DEV__
    ? 'Legal links are not configured, so this sign-in is for development testing only.'
    : 'Terms and Privacy links must be configured before sign-in can be enabled.';
}

function canBeginLogin() {
  return hasLegalConfiguration() || (typeof __DEV__ !== 'undefined' && __DEV__);
}

function hasLegalConfiguration() {
  return Boolean(
    process.env.EXPO_PUBLIC_TERMS_URL?.trim()
      && process.env.EXPO_PUBLIC_PRIVACY_URL?.trim(),
  );
}
