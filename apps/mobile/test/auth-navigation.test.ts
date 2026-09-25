import assert from 'node:assert/strict';
import test from 'node:test';

import { viewerStatusFromPrivyState } from '../src/features/privy/account-state.js';
import { authProgressMode, canResumePrivateIntent } from '../src/features/privy/auth-navigation.js';

test('private intents resume only after both the session and Solana wallet are ready', () => {
  assert.equal(canResumePrivateIntent('signed-in', 'ready'), true);
  assert.equal(canResumePrivateIntent('signed-in', 'loading'), false);
  assert.equal(canResumePrivateIntent('signed-in', 'recovery-required'), false);
  assert.equal(canResumePrivateIntent('signed-in', 'error'), false);
  assert.equal(canResumePrivateIntent('guest', 'ready'), false);
  assert.equal(canResumePrivateIntent('loading', 'ready'), false);
});

test('the global viewer state and wallet state share one Privy snapshot', () => {
  assert.equal(viewerStatusFromPrivyState(false, false), 'loading');
  assert.equal(viewerStatusFromPrivyState(false, true), 'loading');
  assert.equal(viewerStatusFromPrivyState(true, false), 'guest');
  assert.equal(viewerStatusFromPrivyState(true, true), 'signed-in');
});

test('sending or verifying an email code keeps the form mounted until a session returns', () => {
  const state = { activeProvider: 'email' as const, awaitingSession: false, hasUser: false, isReady: true, walletReady: false };
  assert.equal(authProgressMode(state), null);
  assert.equal(authProgressMode({ ...state, awaitingSession: true }), 'preparing');
  assert.equal(authProgressMode({ ...state, hasUser: true }), 'preparing');
  assert.equal(authProgressMode({ ...state, hasUser: true, walletReady: true, activeProvider: null }), null);
});

test('wallet handoff and restored session preparation use real provider readiness', () => {
  const state = { activeProvider: null, awaitingSession: false, hasUser: false, isReady: true, walletReady: false };
  assert.equal(authProgressMode({ ...state, activeProvider: 'external-wallet' }), 'wallet-approval');
  assert.equal(authProgressMode({ ...state, isReady: false }), 'preparing');
  assert.equal(authProgressMode({ ...state, hasUser: true }), 'preparing');
  assert.equal(authProgressMode(state), null);
});
