import type { TransactionWallet } from './transaction-wallet';
import type { ViewerStatus } from './viewer-status';

export function canResumePrivateIntent(
  viewerStatus: ViewerStatus,
  walletStatus: TransactionWallet['status'],
) {
  return viewerStatus === 'signed-in' && walletStatus === 'ready';
}
