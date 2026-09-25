import assert from 'node:assert/strict';
import test from 'node:test';

import type { PortfolioActivityItem } from '@warren/portfolio-contract';

import {
  activityGroup,
  activityPageCanCommit,
  activityRefreshFlags,
  activityRequestPath,
  activitySheetKeys,
  buildActivityRows,
  formatActivityValue,
  mergeActivityItems,
} from '../src/features/profile/portfolio-activity-view-model.js';

test('activity sheets keep distinct stable keys while both are closed', () => {
  const closed = activitySheetKeys({ activityId: null, status: 'all', statusSheetOpen: false });
  assert.deepEqual(closed, {
    activityDetail: 'activity-detail:closed',
    statusFilter: 'status-filter:closed',
  });
  assert.notEqual(closed.activityDetail, closed.statusFilter);

  assert.deepEqual(activitySheetKeys({ activityId: 'event-42', status: 'failed', statusSheetOpen: true }), {
    activityDetail: 'activity-detail:event-42',
    statusFilter: 'status-filter:failed',
  });
});

function item(id: string, occurredAt: string, overrides: Partial<PortfolioActivityItem> = {}): PortfolioActivityItem {
  return {
    activityId: id,
    kind: 'trade',
    productType: 'spot',
    action: 'bought',
    status: 'confirmed',
    title: 'Bought NVIDIA',
    subtitle: 'NVDAx',
    assetId: 'nvda',
    instrumentId: 'spot:nvda',
    companyName: 'NVIDIA',
    symbol: 'NVDAx',
    quantity: '1',
    valueUsd: 100,
    occurredAt,
    signature: null,
    explorerUrl: null,
    executionId: null,
    groupId: id,
    ...overrides,
  };
}

test('activity request path sends active wallet, server filters, search, and opaque cursor', () => {
  assert.equal(
    activityRequestPath({
      cursor: 'cursor_2',
      filters: { kind: 'perpetuals', query: ' NVDA / long ', status: 'unknown' },
      limit: 50,
      walletAddress: 'wallet-address',
    }),
    '/v1/portfolio/activity?walletAddress=wallet-address&limit=50&kind=perpetuals&status=unknown&query=NVDA%20%2F%20long&cursor=cursor_2',
  );
});

test('cursor page merge preserves order and removes repeated activity IDs', () => {
  const first = item('a', '2026-09-23T09:00:00.000Z');
  const second = item('b', '2026-09-22T09:00:00.000Z');
  const third = item('c', '2026-09-21T09:00:00.000Z');
  assert.deepEqual(mergeActivityItems([first, second], [second, third]).map((entry) => entry.activityId), ['a', 'b', 'c']);
});

test('refresh serializes pagination and invalidates an older cursor generation', () => {
  assert.deepEqual(activityRefreshFlags(), {
    loadMoreError: undefined,
    loadingMore: false,
    refreshError: undefined,
    refreshing: true,
  });
  assert.equal(activityPageCanCommit({
    currentCursor: 'cursor-b',
    currentGeneration: 2,
    refreshing: false,
    requestCursor: 'cursor-a',
    requestGeneration: 1,
  }), false);
  assert.equal(activityPageCanCommit({
    currentCursor: 'cursor-a',
    currentGeneration: 1,
    refreshing: true,
    requestCursor: 'cursor-a',
    requestGeneration: 1,
  }), false);
  assert.equal(activityPageCanCommit({
    currentCursor: 'cursor-a',
    currentGeneration: 1,
    refreshing: false,
    requestCursor: 'cursor-a',
    requestGeneration: 1,
  }), true);
});

test('activity groups use Today, Yesterday, calendar date, then older month', () => {
  const now = new Date(2026, 8, 23, 12, 0, 0);
  assert.equal(activityGroup(new Date(2026, 8, 23, 1).toISOString(), now).label, 'Today');
  assert.equal(activityGroup(new Date(2026, 8, 22, 23).toISOString(), now).label, 'Yesterday');
  assert.equal(activityGroup(new Date(2026, 8, 19, 12).toISOString(), now).label, 'Sep 19');
  assert.equal(activityGroup(new Date(2026, 7, 1, 12).toISOString(), now).label, 'August 2026');

  const rows = buildActivityRows([
    item('a', new Date(2026, 8, 23, 9).toISOString()),
    item('b', new Date(2026, 8, 23, 8).toISOString()),
    item('c', new Date(2026, 8, 22, 9).toISOString()),
  ], now);
  assert.deepEqual(rows.map((row) => row.key), ['header:today', 'item:a', 'item:b', 'header:yesterday', 'item:c']);
});

test('activity value signs follow event meaning without treating purchases as cash debits', () => {
  const base = item('a', '2026-09-23T09:00:00.000Z');
  assert.equal(formatActivityValue(base), '$100.00');
  assert.equal(formatActivityValue({ ...base, action: 'received' }), '+$100.00');
  assert.equal(formatActivityValue({ ...base, action: 'sent' }), '−$100.00');
  assert.equal(formatActivityValue({ ...base, valueUsd: null }), null);
});
