import {
  hasError,
  isConnected,
  needsRecovery,
  useEmbeddedEthereumWallet,
  useEmbeddedSolanaWallet,
  useLoginWithEmail,
  useLoginWithSiws,
  usePrivy,
} from '@privy-io/expo';
import {
  SolanaMobileWalletAdapterErrorCode,
  transact,
  type AppIdentity,
} from '@solana-mobile/mobile-wallet-adapter-protocol';
import { base64FromUint8Array } from '@solana-mobile/mobile-wallet-adapter-protocol/encoding';
import { getAddressCodec, getBase64Encoder } from '@solana/kit';
import { useCallback, useEffect, useState } from 'react';

import { LiquidLedgerScreen } from './LiquidLedgerScreen';
import { usePrivyRuntimeStatus } from './config';

type Provider = 'email' | 'external-wallet';

const CANCELLED_AUTH = /association cancelled|plugin closed|user rejected|user denied|request rejected|cancell?ed/i;
const SESSION_RECONCILIATION_TIMEOUT_MS = 12_000;
const WALLET_PREPARATION_TIMEOUT_MS = 25_000;
const DEFAULT_DEVELOPMENT_APP_URL = 'https://stocklana.test';
const STOCKLANA_LOGIN_URI = 'stocklana://privy-login';
const walletIdentity = readWalletIdentityConfig();
const mobileWalletIdentity: AppIdentity = {
  name: 'Stocklana',
  uri: walletIdentity.mobileWalletUri,
};

export function PrivyEntry() {
  const runtimeStatus = usePrivyRuntimeStatus();

  if (runtimeStatus !== 'configured') {
    return <LiquidLedgerScreen mode="missing-config" />;
  }

  return <ConfiguredPrivyEntry />;
}

function ConfiguredPrivyEntry() {
  const { error: initializationError, isReady, logout, refreshUser, user } = usePrivy();
  const { loginWithCode, sendCode } = useLoginWithEmail();
  const { generateMessage, login: loginWithSiws } = useLoginWithSiws();
  const ethereumWallet = useEmbeddedEthereumWallet();
  const solanaWallet = useEmbeddedSolanaWallet();
  const [activeProvider, setActiveProvider] = useState<Provider | null>(null);
  const [awaitingSession, setAwaitingSession] = useState(false);
  const [email, setEmail] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
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

  const beginExternalWalletLogin = useCallback(async () => {
    setLocalError(null);
    setEmailError(null);
    setAwaitingSession(false);
    setSessionTimedOut(false);
    setTimedOutUserId(null);
    setActiveProvider('external-wallet');

    try {
      const authenticatedUser = await transact(async (wallet) => {
        const authorization = await wallet.authorize({
          chain: 'solana:mainnet',
          identity: mobileWalletIdentity,
        });
        const account = authorization.accounts[0];
        if (!account) throw new Error('The wallet did not return a Solana account.');

        const externalAddress = decodeSolanaAddress(account.address);
        const { message } = await generateMessage({
          from: {
            domain: walletIdentity.domain,
            uri: STOCKLANA_LOGIN_URI,
          },
          wallet: { address: externalAddress },
        });
        const { signed_payloads: signedPayloads } = await wallet.signMessages({
          addresses: [account.address],
          payloads: [base64FromUint8Array(new TextEncoder().encode(message))],
        });
        const signature = signedPayloads[0];
        if (!signature) throw new Error('The wallet did not return a signed message.');

        return loginWithSiws({
          message,
          signature,
        });
      });
      setAwaitingSession(Boolean(authenticatedUser));
    } catch (error) {
      const message = errorMessage(error);
      logDevelopmentAuthError('mobile wallet adapter SIWS', message);
      if (!isCancelledWalletAuth(error, message)) {
        setLocalError(friendlyAuthError(message, 'Wallet', errorCode(error)));
      }
    } finally {
      setActiveProvider(null);
    }
  }, [generateMessage, loginWithSiws]);

  const requestEmailCode = useCallback(async () => {
    const normalizedEmail = email.trim().toLowerCase();
    setEmailError(null);
    setLocalError(null);

    if (!isValidEmail(normalizedEmail)) {
      setEmailError('Enter a valid email address.');
      return;
    }

    setActiveProvider('email');
    try {
      await sendCode({ email: normalizedEmail });
      setEmail(normalizedEmail);
      setEmailCode('');
      setEmailCodeSent(true);
    } catch (error) {
      const message = errorMessage(error);
      logDevelopmentAuthError('email code request', message);
      setEmailError(friendlyAuthError(message, 'Email'));
    } finally {
      setActiveProvider(null);
    }
  }, [email, sendCode]);

  const verifyEmailCode = useCallback(async () => {
    const normalizedCode = emailCode.replace(/\D/g, '');
    setEmailError(null);
    setLocalError(null);

    if (normalizedCode.length !== 6) {
      setEmailError('Enter the 6-digit code sent to your email.');
      return;
    }

    setAwaitingSession(false);
    setSessionTimedOut(false);
    setTimedOutUserId(null);
    setActiveProvider('email');
    try {
      const authenticatedUser = await loginWithCode({
        code: normalizedCode,
        email,
      });
      setAwaitingSession(Boolean(authenticatedUser));
    } catch (error) {
      const message = errorMessage(error);
      logDevelopmentAuthError('email code verification', message);
      setEmailError(friendlyAuthError(message, 'Email'));
    } finally {
      setActiveProvider(null);
    }
  }, [email, emailCode, loginWithCode]);

  const resetEmail = useCallback(() => {
    setEmailCode('');
    setEmailCodeSent(false);
    setEmailError(null);
  }, []);

  const retry = useCallback(async () => {
    setLocalError(null);
    setEmailError(null);
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
    setEmailError(null);
    setAwaitingSession(false);
    setSessionTimedOut(false);
    setTimedOutUserId(null);
    setEmail('');
    setEmailCode('');
    setEmailCodeSent(false);
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
      emailAuth={{
        code: emailCode,
        codeSent: emailCodeSent,
        email,
        message: emailError,
        onCodeChange: (value) => setEmailCode(value.replace(/\D/g, '').slice(0, 6)),
        onEmailChange: setEmail,
        onReset: resetEmail,
        onSendCode: canBeginLogin() ? () => void requestEmailCode() : undefined,
        onVerifyCode: canBeginLogin() ? () => void verifyEmailCode() : undefined,
      }}
      message={legalConfigurationMessage()}
      mode="sign-in"
      walletAuth={{
        onConnect: canBeginLogin() ? () => void beginExternalWalletLogin() : undefined,
      }}
    />
  );
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Unknown Privy error';
}

function friendlyAuthError(
  message: string,
  method?: 'Email' | 'Wallet',
  code?: string,
) {
  if (code === SolanaMobileWalletAdapterErrorCode.ERROR_WALLET_NOT_FOUND) {
    return 'No compatible Solana wallet was found. Install an MWA-compatible wallet and try again.';
  }
  if (/network|fetch|offline|internet/i.test(message)) {
    return 'Stocklana could not reach Privy. Check your connection and try again.';
  }
  if (/not enabled|disabled|not configured|unsupported.*(?:login|oauth|provider)/i.test(message)) {
    return `${method ?? 'This'} sign-in is not enabled in the Privy dashboard.`;
  }
  if (/client|identifier|origin|redirect|scheme|unauthori[sz]ed/i.test(message)) {
    return 'Privy rejected this mobile client. Check its Android app identifier and URL scheme.';
  }
  if (/code|otp|expired|invalid/i.test(message) && method === 'Email') {
    return 'That email code is incorrect or expired. Request a new code and try again.';
  }
  if (/rate|too many/i.test(message)) {
    return 'Too many sign-in attempts. Wait a few minutes and try again.';
  }
  return 'Sign-in could not be completed. Please try again.';
}

function readWalletIdentityConfig() {
  const configuredAppUrl = process.env.EXPO_PUBLIC_APP_URL?.trim();
  const appUrl = configuredAppUrl || DEFAULT_DEVELOPMENT_APP_URL;

  try {
    const parsed = new URL(appUrl);
    if (parsed.protocol !== 'https:' || !parsed.host) throw new Error('Invalid URL');
    const normalizedAppUrl = parsed.toString().replace(/\/$/, '');
    return {
      domain: parsed.host,
      mobileWalletUri: configuredAppUrl ? normalizedAppUrl : STOCKLANA_LOGIN_URI,
    };
  } catch {
    return {
      domain: 'stocklana.test',
      mobileWalletUri: STOCKLANA_LOGIN_URI,
    };
  }
}

function decodeSolanaAddress(encodedAddress: string) {
  const addressBytes = getBase64Encoder().encode(encodedAddress);
  return getAddressCodec().decode(addressBytes).toString();
}

function errorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function isCancelledWalletAuth(error: unknown, message: string) {
  return errorCode(error) === SolanaMobileWalletAdapterErrorCode.ERROR_ASSOCIATION_CANCELLED
    || CANCELLED_AUTH.test(message);
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function logDevelopmentAuthError(flow: string, message: string) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn(`[Privy ${flow}] ${message}`);
  }
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
