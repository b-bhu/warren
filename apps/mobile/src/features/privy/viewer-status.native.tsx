import { createContext, useContext, type PropsWithChildren } from 'react';

import { useTransactionWallet } from './transaction-wallet';

export type ViewerStatus = 'guest' | 'loading' | 'signed-in';

const ViewerStatusContext = createContext<ViewerStatus>('guest');

export function ViewerStatusProvider({ children }: PropsWithChildren) {
  const wallet = useTransactionWallet();
  return <ViewerStatusContext.Provider value={wallet.viewerStatus}>{children}</ViewerStatusContext.Provider>;
}

export function useViewerStatus() {
  return useContext(ViewerStatusContext);
}
