import type {
  PortfolioDataState,
  PortfolioMetric,
  PortfolioMoney,
  PortfolioOverviewResponse,
} from '@warren/portfolio-contract';

export type PortfolioAccountPresentationState =
  | 'new_wallet'
  | 'spot_only'
  | 'phoenix_only'
  | 'full'
  | 'partial';

export function portfolioAccountPresentationState(
  overview: Pick<PortfolioOverviewResponse, 'perpetuals' | 'wallet'>,
): PortfolioAccountPresentationState {
  const funded = overview.wallet.supportedAssetState === 'funded';
  const walletClassified = overview.wallet.supportedAssetState === 'funded'
    || overview.wallet.supportedAssetState === 'empty'
    || overview.wallet.supportedAssetState === 'unsupported_only';
  if (!walletClassified || overview.perpetuals.accountState === 'unavailable') return 'partial';
  if (funded && overview.perpetuals.accountState === 'ready') return 'full';
  if (funded) return 'spot_only';
  return overview.perpetuals.accountState === 'ready' ? 'phoenix_only' : 'new_wallet';
}

export function formatPortfolioMoney(
  money: PortfolioMoney,
  options: { mask?: boolean; signed?: boolean } = {},
) {
  if (options.mask) return '••••••';
  if (money.amount === null) return '—';
  const absolute = Math.abs(money.amount).toLocaleString('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
  const sign = money.amount < 0 ? '−' : options.signed && money.amount > 0 ? '+' : '';
  return `${sign}$${absolute}`;
}

export function formatPortfolioPercent(
  metric: PortfolioMetric,
  options: { mask?: boolean; signed?: boolean } = {},
) {
  if (options.mask) return '••••';
  if (metric.value === null) return '—';
  const sign = metric.value < 0 ? '−' : options.signed && metric.value > 0 ? '+' : '';
  return `${sign}${Math.abs(metric.value).toFixed(2)}%`;
}

export function formatNullableUsd(value: number | null, options: { signed?: boolean } = {}) {
  if (value === null) return '—';
  const absolute = Math.abs(value).toLocaleString('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
  const sign = value < 0 ? '−' : options.signed && value > 0 ? '+' : '';
  return `${sign}$${absolute}`;
}

export function formatUpdatedAt(value: string, now = Date.now()) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Update time not provided';
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return 'Updated moments ago';
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} hr ago`;
  const date = new Date(timestamp);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `Updated ${months[date.getMonth()]} ${date.getDate()}`;
}

export function dataStateLabel(state: PortfolioDataState) {
  if (state === 'delayed') return 'Delayed';
  if (state === 'stale') return 'Stale';
  if (state === 'unavailable') return 'Needs refresh';
  return 'Live';
}

export function overviewIsEmpty(overview: PortfolioOverviewResponse) {
  return overview.attention.length === 0
    && overview.counts.openOrders === 0
    && overview.counts.openPositions === 0
    && overview.counts.holdings === 0;
}

export function equitySegments(overview: PortfolioOverviewResponse) {
  const candidates = [
    { key: 'owned', label: 'Owned stocks', money: overview.equity.pricedHoldings },
    { key: 'perps', label: 'Perps equity', money: overview.equity.perpetualEquity },
    { key: 'cash', label: 'Cash', money: overview.equity.cash },
  ] as const;
  const positiveTotal = candidates.reduce((sum, candidate) => sum + Math.max(0, candidate.money.amount ?? 0), 0);
  return candidates.map((candidate) => ({
    ...candidate,
    share: positiveTotal > 0 && candidate.money.amount !== null
      ? Math.max(0, candidate.money.amount) / positiveTotal
      : 0,
  }));
}

export function todayChangeAvailable(overview: PortfolioOverviewResponse) {
  return overview.equity.todayChangeUsd.amount !== null
    && overview.equity.todayChangePercent.value !== null;
}
