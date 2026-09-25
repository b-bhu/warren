import {
  hasError,
  isConnected,
  needsRecovery,
  useEmbeddedSolanaWallet,
  usePrivy,
  usePrivyClient,
} from '@privy-io/expo';
import { VersionedTransaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';

import { viewerStatusFromPrivyState } from './account-state';
import { usePrivyRuntimeStatus } from './config';

export type TransactionWallet = {
  status: 'guest' | 'loading' | 'ready' | 'recovery-required' | 'error' | 'unsupported';
  viewerStatus: 'guest' | 'loading' | 'signed-in';
  address: string | null;
  accountIdentityLabel?: string;
  getAccessToken: () => Promise<string>;
  signTransaction: (unsignedTransaction: string) => Promise<string>;
  signOut: () => Promise<void>;
};

const unavailable = async (): Promise<never> => {
  throw new Error('The embedded Solana wallet is not ready.');
};

const TransactionWalletContext = createContext<TransactionWallet>({
  status: 'unsupported',
  viewerStatus: 'guest',
  address: null,
  getAccessToken: unavailable,
  signTransaction: unavailable,
  signOut: unavailable,
});

export function TransactionWalletProvider({ children }: PropsWithChildren) {
  const runtimeStatus = usePrivyRuntimeStatus();
  if (runtimeStatus !== 'configured') {
    return (
      <TransactionWalletContext.Provider value={{
        status: 'unsupported',
        viewerStatus: 'guest',
        address: null,
        getAccessToken: unavailable,
        signTransaction: unavailable,
        signOut: unavailable,
      }}>
        {children}
      </TransactionWalletContext.Provider>
    );
  }
  return <ConfiguredTransactionWallet>{children}</ConfiguredTransactionWallet>;
}

function ConfiguredTransactionWallet({ children }: PropsWithChildren) {
  const {
    getAccessToken: readAccessToken,
    isReady,
    logout,
    user,
  } = usePrivy();
  const privyClient = usePrivyClient();
  const solanaWallet = useEmbeddedSolanaWallet();
  const [reconciliationPending, setReconciliationPending] = useState(true);
  const wallet = isConnected(solanaWallet) ? solanaWallet.wallets[0] : undefined;
  const address = wallet?.address ?? null;
  const accountEmail = user?.linked_accounts.find((account) => account.type === 'email');
  const accountIdentityLabel = accountEmail ? `Account email · ${accountEmail.address}` : undefined;

  useEffect(() => {
    if (!isReady) return;
    if (user) return;

    let active = true;
    let running = false;
    const reconcileStoredSession = async () => {
      if (running) return;
      running = true;
      if (active) setReconciliationPending(true);
      try {
        // Returning from an external wallet can foreground Warren before Privy's
        // reactive user snapshot catches up. A stored access token is authoritative;
        // refreshUser republishes that session through the root Privy provider.
        const token = await readAccessToken();
        if (token) await privyClient.user.refreshUser();
      } catch {
        // Privy's auth UI remains the source of user-facing recovery/error copy.
      } finally {
        running = false;
        if (active) setReconciliationPending(false);
      }
    };

    void reconcileStoredSession();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void reconcileStoredSession();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [isReady, privyClient, readAccessToken, user]);

  const reconcilingSession = !user && reconciliationPending;
  const accountStateReady = isReady && !reconcilingSession;
  const viewerStatus = viewerStatusFromPrivyState(accountStateReady, Boolean(user));
  const status: TransactionWallet['status'] = !accountStateReady
    ? 'loading'
    : !user
      ? 'guest'
      : needsRecovery(solanaWallet)
        ? 'recovery-required'
        : hasError(solanaWallet)
          ? 'error'
          : address
            ? 'ready'
            : 'loading';

  const value = useMemo<TransactionWallet>(() => ({
    status,
    viewerStatus,
    address,
    accountIdentityLabel,
    getAccessToken: async () => {
      const token = await readAccessToken();
      if (!token) throw new Error('Your sign-in session is no longer available.');
      return token;
    },
    signTransaction: async (unsignedTransaction: string) => {
      if (!wallet) throw new Error('The embedded Solana wallet is not ready.');
      const provider = await wallet.getProvider();
      const transaction = VersionedTransaction.deserialize(Buffer.from(unsignedTransaction, 'base64'));
      const response = await provider.request({
        method: 'signTransaction',
        params: { transaction },
      });
      return Buffer.from(response.signedTransaction.serialize()).toString('base64');
    },
    signOut: logout,
  }), [accountIdentityLabel, address, logout, readAccessToken, status, viewerStatus, wallet]);

  return <TransactionWalletContext.Provider value={value}>{children}</TransactionWalletContext.Provider>;
}

export function useTransactionWallet() {
  return useContext(TransactionWalletContext);
}
