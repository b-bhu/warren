import type { TransactionWallet } from './transaction-wallet';
import type { ViewerStatus } from './viewer-status';

export function canResumePrivateIntent(
  viewerStatus: ViewerStatus,
  walletStatus: TransactionWallet['status'],
) {
  return viewerStatus === 'signed-in' && walletStatus === 'ready';
}

/** Email requests stay on their form; only session/wallet setup replaces it. */
export function authProgressMode({ activeProvider, awaitingSession, hasUser, isReady, walletReady }: {
  activeProvider: 'email' | 'external-wallet' | null;
  awaitingSession: boolean;
  hasUser: boolean;
  isReady: boolean;
  walletReady: boolean;
}): 'wallet-approval' | 'preparing' | null {
  if (activeProvider === 'external-wallet') return 'wallet-approval';
  if (!isReady || (!hasUser && awaitingSession) || (hasUser && !walletReady)) return 'preparing';
  return null;
}
