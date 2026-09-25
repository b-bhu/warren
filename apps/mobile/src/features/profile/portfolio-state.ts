export const portfolioViews = ['overview', 'positions', 'activity'] as const;
export type PortfolioView = (typeof portfolioViews)[number];
export type PortfolioSheetMode = 'account' | 'receive' | 'portfolio-info' | 'about';
export type PortfolioAccessState =
  | 'checking-account'
  | 'guest'
  | 'preparing-wallet'
  | 'wallet-unavailable'
  | 'ready';

type WalletStatus = 'guest' | 'loading' | 'ready' | 'recovery-required' | 'error' | 'unsupported';

export function portfolioAccessState(
  viewerStatus: 'guest' | 'loading' | 'signed-in',
  walletStatus: WalletStatus,
): PortfolioAccessState {
  if (viewerStatus === 'loading') return 'checking-account';
  if (viewerStatus === 'guest') return 'guest';
  if (walletStatus === 'loading') return 'preparing-wallet';
  if (walletStatus === 'ready') return 'ready';
  return 'wallet-unavailable';
}

export function parsePortfolioView(value: string | string[] | undefined): PortfolioView {
  const candidate = Array.isArray(value) ? value[0] : value;
  return portfolioViews.includes(candidate as PortfolioView) ? candidate as PortfolioView : 'overview';
}

export function portfolioTabIntent(view: PortfolioView, signedIn: boolean) {
  return signedIn || view === 'overview'
    ? { kind: 'select' as const, view }
    : { kind: 'sign-in' as const, returnView: view };
}

export function portfolioSubtitle(input: {
  viewerStatus: 'guest' | 'loading' | 'signed-in';
  walletStatus: WalletStatus;
}) {
  if (input.viewerStatus === 'loading') return 'Checking your Warren account';
  if (input.viewerStatus !== 'signed-in') return 'Saved locally on this phone';
  if (input.walletStatus === 'recovery-required') return 'Wallet recovery required';
  if (input.walletStatus === 'error') return 'Wallet setup needs attention';
  if (input.walletStatus === 'unsupported') return 'This build does not support wallet access';
  if (input.walletStatus !== 'ready') return 'Preparing your Solana wallet';
  return 'Signed in · Portfolio shown below';
}

export function accountControlsAvailable(walletStatus: WalletStatus) {
  return walletStatus === 'ready';
}

export function accountControlKey(
  walletStatus: WalletStatus,
  address: string | null,
) {
  return walletStatus === 'ready' ? `ready:${address ?? 'address-pending'}` : `unavailable:${walletStatus}`;
}
