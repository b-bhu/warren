import { createContext, useContext, type PropsWithChildren } from 'react';

import type { TransactionWallet } from './transaction-wallet.native';

const unavailable = async (): Promise<never> => {
  throw new Error('Transaction signing is available only in the configured native app.');
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
  return <TransactionWalletContext.Provider value={{
    status: 'unsupported',
    viewerStatus: 'guest',
    address: null,
    getAccessToken: unavailable,
    signTransaction: unavailable,
    signOut: unavailable,
  }}>
    {children}
  </TransactionWalletContext.Provider>;
}

export function useTransactionWallet() {
  return useContext(TransactionWalletContext);
}

export type { TransactionWallet } from './transaction-wallet.native';
