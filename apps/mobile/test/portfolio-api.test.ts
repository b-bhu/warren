import assert from 'node:assert/strict';
import test from 'node:test';

import { portfolioErrorForResponse } from '../src/features/profile/portfolio-api.js';

test('Portfolio API errors map to safe client states without exposing provider payloads', () => {
  const session = portfolioErrorForResponse(401, 'SESSION_INVALID');
  assert.equal(session.failure, 'session');
  assert.equal(session.retryable, false);
  assert.match(session.message, /session has expired/i);

  const wallet = portfolioErrorForResponse(403, 'WALLET_MISMATCH');
  assert.equal(wallet.failure, 'wallet');
  assert.equal(wallet.retryable, false);
  assert.match(wallet.message, /verify this Solana wallet/i);

  const rateLimit = portfolioErrorForResponse(429, 'RATE_LIMITED');
  assert.equal(rateLimit.failure, 'service');
  assert.equal(rateLimit.retryable, true);

  const insufficientRent = portfolioErrorForResponse(
    422,
    'REGISTRATION_STATE_INVALID',
    'Transaction simulation failed: insufficient funds for rent',
  );
  assert.equal(insufficientRent.failure, 'service');
  assert.equal(insufficientRent.retryable, false);
  assert.match(insufficientRent.message, /enough SOL/i);
  assert.match(insufficientRent.message, /account rent/i);

  const provider = portfolioErrorForResponse(503, 'UPSTREAM_SECRET_INTERNAL_CODE');
  assert.equal(provider.failure, 'service');
  assert.equal(provider.retryable, true);
  assert.doesNotMatch(provider.message, /UPSTREAM_SECRET_INTERNAL_CODE/);
});
