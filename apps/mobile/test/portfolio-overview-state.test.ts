import assert from 'node:assert/strict';
import test from 'node:test';

import { PortfolioRequestError } from '../src/features/profile/portfolio-api.js';
import {
  portfolioFailureState,
  type PortfolioLoadState,
} from '../src/features/profile/portfolio-load-state.js';

test('a retryable refresh failure preserves the last successful Portfolio response', () => {
  const ready: PortfolioLoadState<{ marker: string }> = {
    data: { marker: 'last-success' },
    phase: 'ready',
    refreshing: true,
  };
  const next = portfolioFailureState(
    ready,
    new PortfolioRequestError('Could not refresh.', 'service', true, 503),
  );
  assert.equal(next.phase, 'ready');
  if (next.phase !== 'ready') return;
  assert.equal(next.data.marker, 'last-success');
  assert.equal(next.refreshing, false);
  assert.equal(next.refreshError, 'Could not refresh.');
});

test('session and wallet failures replace private Portfolio data with reconnect state', () => {
  const ready: PortfolioLoadState<{ marker: string }> = {
    data: { marker: 'private-data' },
    phase: 'ready',
    refreshing: true,
  };
  for (const failure of ['session', 'wallet'] as const) {
    const next: PortfolioLoadState<{ marker: string }> = portfolioFailureState(
      ready,
      new PortfolioRequestError('Reconnect.', failure, false, 401),
    );
    assert.equal(next.phase, 'error');
  }
});
