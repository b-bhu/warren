import assert from 'node:assert/strict';
import test from 'node:test';

import {
  accountControlsAvailable,
  accountControlKey,
  parsePortfolioView,
  portfolioAccessState,
  portfolioSubtitle,
  portfolioTabIntent,
} from '../src/features/profile/portfolio-state.js';

test('portfolio view parsing accepts only the three visible views', () => {
  assert.equal(parsePortfolioView('positions'), 'positions');
  assert.equal(parsePortfolioView(['activity']), 'activity');
  assert.equal(parsePortfolioView('settings'), 'overview');
  assert.equal(parsePortfolioView(undefined), 'overview');
});

test('private Portfolio tabs preserve the requested destination through sign-in', () => {
  assert.deepEqual(portfolioTabIntent('positions', false), { kind: 'sign-in', returnView: 'positions' });
  assert.deepEqual(portfolioTabIntent('activity', false), { kind: 'sign-in', returnView: 'activity' });
  assert.deepEqual(portfolioTabIntent('overview', false), { kind: 'select', view: 'overview' });
  assert.deepEqual(portfolioTabIntent('positions', true), { kind: 'select', view: 'positions' });
});

test('Portfolio shell copy distinguishes guest, account check, and wallet setup', () => {
  assert.equal(portfolioSubtitle({ viewerStatus: 'guest', walletStatus: 'guest' }), 'Saved locally on this phone');
  assert.equal(portfolioSubtitle({ viewerStatus: 'loading', walletStatus: 'loading' }), 'Checking your Warren account');
  assert.equal(portfolioSubtitle({ viewerStatus: 'signed-in', walletStatus: 'loading' }), 'Preparing your Solana wallet');
  assert.equal(portfolioSubtitle({ viewerStatus: 'signed-in', walletStatus: 'recovery-required' }), 'Wallet recovery required');
  assert.equal(portfolioSubtitle({ viewerStatus: 'signed-in', walletStatus: 'error' }), 'Wallet setup needs attention');
  assert.equal(portfolioSubtitle({ viewerStatus: 'signed-in', walletStatus: 'ready' }), 'Signed in · Portfolio shown below');
});

test('Portfolio never renders guest sign-in while Privy is still reconciling', () => {
  assert.equal(portfolioAccessState('loading', 'loading'), 'checking-account');
  assert.equal(portfolioAccessState('guest', 'guest'), 'guest');
  assert.equal(portfolioAccessState('signed-in', 'loading'), 'preparing-wallet');
  assert.equal(portfolioAccessState('signed-in', 'recovery-required'), 'wallet-unavailable');
  assert.equal(portfolioAccessState('signed-in', 'ready'), 'ready');
});

test('account controls require a ready Solana wallet', () => {
  assert.equal(accountControlsAvailable('ready'), true);
  assert.equal(accountControlsAvailable('loading'), false);
  assert.equal(accountControlsAvailable('recovery-required'), false);
  assert.equal(accountControlsAvailable('error'), false);
  assert.equal(accountControlsAvailable('unsupported'), false);
  assert.equal(accountControlsAvailable('guest'), false);
});

test('sensitive account sheets do not reopen after wallet readiness is lost', () => {
  const ready = accountControlKey('ready', 'wallet-address');
  const unavailable = accountControlKey('loading', 'wallet-address');
  const restored = accountControlKey('ready', 'wallet-address');

  assert.notEqual(ready, unavailable);
  assert.notEqual(unavailable, restored);
  assert.equal(accountControlKey('unsupported', 'wallet-address'), 'unavailable:unsupported');
  assert.equal(accountControlKey('recovery-required', 'wallet-address'), 'unavailable:recovery-required');
});
