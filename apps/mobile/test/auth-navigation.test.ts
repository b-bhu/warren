import assert from 'node:assert/strict';
import test from 'node:test';

import { viewerStatusFromPrivyState } from '../src/features/privy/account-state.js';
import { canResumePrivateIntent } from '../src/features/privy/auth-navigation.js';

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
