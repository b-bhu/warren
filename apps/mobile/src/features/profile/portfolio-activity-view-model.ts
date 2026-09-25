import type {
  PortfolioActivityItem,
  PortfolioActivityQuery,
  PortfolioWarning,
} from '@warren/portfolio-contract';

export type ActivityFilters = Pick<PortfolioActivityQuery, 'kind' | 'status'> & { query: string };

export type ActivityListRow =
  | { key: string; kind: 'header'; label: string }
  | { item: PortfolioActivityItem; key: string; kind: 'item' };

export function activitySheetKeys(input: {
  activityId: string | null;
  status: ActivityFilters['status'];
  statusSheetOpen: boolean;
}) {
  return {
    activityDetail: `activity-detail:${input.activityId ?? 'closed'}`,
    statusFilter: `status-filter:${input.statusSheetOpen ? input.status : 'closed'}`,
  } as const;
}

export function activityRefreshFlags() {
  return {
    loadMoreError: undefined,
    loadingMore: false,
    refreshError: undefined,
    refreshing: true,
  } as const;
}

export function activityPageCanCommit(input: {
  currentCursor: string | null;
  currentGeneration: number;
  refreshing: boolean;
  requestCursor: string;
  requestGeneration: number;
}) {
  return !input.refreshing
    && input.currentGeneration === input.requestGeneration
    && input.currentCursor === input.requestCursor;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function activityRequestPath(input: {
  cursor?: string | null;
  filters: ActivityFilters;
  limit?: number;
  walletAddress: string;
}) {
  const parameters = [
    ['walletAddress', input.walletAddress],
    ['limit', String(input.limit ?? 20)],
    ['kind', input.filters.kind],
    ['status', input.filters.status],
  ];
  const query = input.filters.query.trim();
  if (query) parameters.push(['query', query]);
  if (input.cursor) parameters.push(['cursor', input.cursor]);
  return `/v1/portfolio/activity?${parameters.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')}`;
}

export function mergeActivityItems(
  current: readonly PortfolioActivityItem[],
  incoming: readonly PortfolioActivityItem[],
) {
  const seen = new Set<string>();
  return [...current, ...incoming].filter((item) => {
    if (seen.has(item.activityId)) return false;
    seen.add(item.activityId);
    return true;
  });
}

export function mergePortfolioWarnings(
  current: readonly PortfolioWarning[],
  incoming: readonly PortfolioWarning[],
) {
  const seen = new Set<string>();
  return [...current, ...incoming].filter((warning) => {
    const key = `${warning.section}:${warning.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildActivityRows(items: readonly PortfolioActivityItem[], now = new Date()) {
  const rows: ActivityListRow[] = [];
  let priorGroup: string | undefined;
  for (const item of items) {
    const group = activityGroup(item.occurredAt, now);
    if (group.key !== priorGroup) {
      rows.push({ key: `header:${group.key}`, kind: 'header', label: group.label });
      priorGroup = group.key;
    }
    rows.push({ item, key: `item:${item.activityId}`, kind: 'item' });
  }
  return rows;
}

export function activityGroup(value: string, now = new Date()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { key: 'unknown', label: 'Date not provided' };
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const daysAgo = Math.round((nowDay - dateDay) / 86_400_000);
  if (daysAgo <= 0) return { key: 'today', label: 'Today' };
  if (daysAgo === 1) return { key: 'yesterday', label: 'Yesterday' };
  if (daysAgo <= 7) {
    return {
      key: `date:${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`,
      label: `${SHORT_MONTHS[date.getMonth()]} ${date.getDate()}`,
    };
  }
  return {
    key: `month:${date.getFullYear()}-${date.getMonth() + 1}`,
    label: `${MONTHS[date.getMonth()]} ${date.getFullYear()}`,
  };
}

export function formatActivityTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time not provided';
  const hours = date.getHours();
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(date.getMinutes()).padStart(2, '0')} ${period}`;
}

export function formatActivityDateTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Date not provided';
  return `${SHORT_MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()} · ${formatActivityTime(value)}`;
}

export function formatActivityValue(item: PortfolioActivityItem) {
  if (item.valueUsd === null) return null;
  const absolute = Math.abs(item.valueUsd).toLocaleString('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
  const positive = item.action === 'received' || item.action === 'funding_received' || item.action === 'sold';
  const negative = item.action === 'sent' || item.action === 'funding_paid';
  return `${positive ? '+' : negative ? '−' : item.valueUsd < 0 ? '−' : ''}$${absolute}`;
}

export function activityStatusLabel(status: PortfolioActivityItem['status']) {
  return status[0]!.toUpperCase() + status.slice(1);
}

export function activityKindLabel(kind: PortfolioActivityItem['kind']) {
  if (kind === 'perpetual') return 'Perpetual';
  return kind[0]!.toUpperCase() + kind.slice(1);
}

export function activityActionLabel(action: PortfolioActivityItem['action']) {
  return action.split('_').map((part) => part[0]!.toUpperCase() + part.slice(1)).join(' ');
}
