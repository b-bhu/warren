import assert from 'node:assert/strict';
import test from 'node:test';

import type { PhoenixRegistrationResult, PortfolioOverviewResponse } from '@warren/portfolio-contract';

import {
  equitySegments,
  formatPortfolioMoney,
  formatPortfolioPercent,
  formatUpdatedAt,
  overviewIsEmpty,
  portfolioAccountPresentationState,
  todayChangeAvailable,
} from '../src/features/profile/portfolio-view-model.js';
import {
  launchPhoenixSetup,
  PHOENIX_APP_URL,
  phoenixRecoveryModel,
} from '../src/features/profile/phoenix-recovery.js';
import {
  phoenixRegistrationErrorMessage,
  waitForPhoenixRegistration,
} from '../src/features/profile/phoenix-registration.js';

const at = '2026-09-23T10:00:00.000Z';
const money = (amount: number | null) => ({
  amount,
  currency: 'USD' as const,
  asOf: amount === null ? null : at,
  dataState: amount === null ? 'unavailable' as const : 'live' as const,
});
const metric = (value: number | null) => ({
  value,
  asOf: value === null ? null : at,
  dataState: value === null ? 'unavailable' as const : 'live' as const,
});

function overview(): PortfolioOverviewResponse {
  return {
    generatedAt: at,
    wallet: { address: '11111111111111111111111111111111', displayAddress: '1111…1111', network: 'Solana', supportedAssetState: 'funded' },
    perpetuals: { accountState: 'ready', registration: null },
    equity: {
      netAccountEquity: money(250),
      todayChangeUsd: money(null),
      todayChangePercent: metric(null),
      pricedHoldings: money(100),
      perpetualEquity: money(50),
      cash: money(100),
      grossPerpetualExposure: money(600),
      liabilities: money(0),
    },
    attention: [],
    openOrders: [],
    openPositions: [],
    holdings: [],
    cashBalances: [],
    counts: { openOrders: 0, openPositions: 0, holdings: 0, unpricedHoldings: 0 },
    warnings: [],
  };
}

test('money and percentage formatting never invent missing values', () => {
  assert.equal(formatPortfolioMoney(money(null)), '—');
  assert.equal(formatPortfolioMoney(money(12.5)), '$12.50');
  assert.equal(formatPortfolioMoney(money(-4.2), { signed: true }), '−$4.20');
  assert.equal(formatPortfolioMoney(money(12.5), { mask: true }), '••••••');
  assert.equal(formatPortfolioPercent(metric(null)), '—');
  assert.equal(formatPortfolioPercent(metric(2.345), { signed: true }), '+2.35%');
});

test('equity segments exclude gross perpetual exposure from the composition', () => {
  const segments = equitySegments(overview());
  assert.deepEqual(segments.map((segment) => segment.key), ['owned', 'perps', 'cash']);
  assert.deepEqual(segments.map((segment) => segment.share), [0.4, 0.2, 0.4]);
  assert.equal(segments.some((segment) => segment.money.amount === 600), false);
});

test('today change is shown only when both authoritative values exist', () => {
  const response = overview();
  assert.equal(todayChangeAvailable(response), false);
  response.equity.todayChangeUsd = money(4);
  response.equity.todayChangePercent = metric(1.6);
  assert.equal(todayChangeAvailable(response), true);
});

test('overview empty state ignores cash while respecting owned/open items', () => {
  const response = overview();
  assert.equal(overviewIsEmpty(response), true);
  response.counts.holdings = 1;
  assert.equal(overviewIsEmpty(response), false);
});

test('Portfolio presentation preserves the four account states and provider failure', () => {
  const response = overview();
  assert.equal(portfolioAccountPresentationState(response), 'full');

  response.perpetuals = { accountState: 'not_initialized', registration: { feePayer: 'user_wallet', mode: 'non_referral' } };
  assert.equal(portfolioAccountPresentationState(response), 'spot_only');

  response.wallet.supportedAssetState = 'empty';
  assert.equal(portfolioAccountPresentationState(response), 'new_wallet');

  response.perpetuals = { accountState: 'ready', registration: null };
  assert.equal(portfolioAccountPresentationState(response), 'phoenix_only');

  response.perpetuals = { accountState: 'unavailable', registration: null };
  assert.equal(portfolioAccountPresentationState(response), 'partial');
  response.perpetuals = { accountState: 'ready', registration: null };
  response.wallet.supportedAssetState = 'unavailable';
  assert.equal(portfolioAccountPresentationState(response), 'partial');
});

test('Phoenix recovery distinguishes onboarding from provider failure without invalidating Warren auth', () => {
  const response = overview();
  response.perpetuals = { accountState: 'not_initialized', registration: { feePayer: 'user_wallet', mode: 'non_referral' } };
  assert.deepEqual(phoenixRecoveryModel(response), {
    body: 'Create the default Phoenix trading account with this Warren wallet. This is one Solana transaction and does not open a trade.',
    kind: 'onboarding',
    primaryAction: 'create-in-warren',
    secondaryAction: null,
    title: 'Create your Phoenix account',
  });

  response.perpetuals = { accountState: 'unavailable', registration: null };
  assert.equal(phoenixRecoveryModel(response)?.title, 'Phoenix data could not be loaded');
  assert.equal(phoenixRecoveryModel(response)?.primaryAction, 'retry');
  assert.equal(phoenixRecoveryModel(response)?.secondaryAction, 'open-phoenix');

  response.warnings = [{
    section: 'perpetuals', code: 'PHOENIX_AUTH_REQUIRED', message: 'Reconnect.', retryable: false,
  }];
  assert.equal(phoenixRecoveryModel(response)?.title, 'Phoenix data could not be loaded');
  assert.equal(phoenixRecoveryModel(response)?.primaryAction, 'retry');

  response.perpetuals = { accountState: 'ready', registration: null };
  assert.equal(phoenixRecoveryModel(response), null);
});

test('Phoenix handoff opens only the selected trusted Phoenix URL and reports launch failure', async () => {
  const opened: string[] = [];
  assert.equal(await launchPhoenixSetup('https://www.phoenix.trade/?market=NVDA', (url) => {
    opened.push(url);
  }), true);
  assert.deepEqual(opened, ['https://www.phoenix.trade/?market=NVDA']);

  assert.equal(await launchPhoenixSetup('https://example.com/phoenix', () => {
    throw new Error('must not be called');
  }), false);
  assert.equal(await launchPhoenixSetup(PHOENIX_APP_URL, () => ({ type: 'locked' })), false);
  assert.equal(await launchPhoenixSetup(PHOENIX_APP_URL, async () => {
    throw new Error('browser unavailable');
  }), false);
});

test('Phoenix registration waits for a terminal signature state and maps wallet cancellation safely', async () => {
  const states: PhoenixRegistrationResult['state'][] = ['submitted', 'submitted', 'confirmed'];
  let pauses = 0;
  const result = await waitForPhoenixRegistration({
    attempts: 4,
    pause: async () => { pauses += 1; },
    read: async () => registrationResult(states.shift() ?? 'confirmed'),
  });
  assert.equal(result.state, 'confirmed');
  assert.equal(pauses, 2);
  assert.equal(
    phoenixRegistrationErrorMessage(new Error('User rejected request')),
    'You cancelled the wallet approval. Nothing was submitted.',
  );
  assert.equal(
    phoenixRegistrationErrorMessage(new Error('Transaction simulation failed: insufficient funds for rent')),
    'This wallet does not have enough SOL to create the Phoenix account. Deposit more SOL to cover account rent and the network fee, then try again.',
  );
  assert.equal(
    phoenixRegistrationErrorMessage(new Error('Attempt to debit an account but found no record of a prior credit')),
    'This wallet does not have enough SOL to create the Phoenix account. Deposit more SOL to cover account rent and the network fee, then try again.',
  );
});

test('updated labels are deterministic without unsupported dateStyle formatting', () => {
  const now = Date.parse('2026-09-23T10:30:00.000Z');
  assert.equal(formatUpdatedAt(at, now), 'Updated 30 min ago');
  assert.equal(formatUpdatedAt('not-a-date', now), 'Update time not provided');
});

function registrationResult(state: PhoenixRegistrationResult['state']): PhoenixRegistrationResult {
  return {
    registrationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    state,
    venue: 'Phoenix',
    walletAddress: '11111111111111111111111111111111',
    traderPda: '11111111111111111111111111111111',
    signature: '11111111111111111111111111111111',
    explorerUrl: 'https://explorer.solana.com/tx/11111111111111111111111111111111',
    message: 'Status',
    nextAction: state === 'confirmed' ? 'add_collateral' : state === 'failed' ? 'retry' : 'wait_for_confirmation',
  };
}
