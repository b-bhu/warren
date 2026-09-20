import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { DeterministicTestWalletAdapter } from '@warren/test-wallet-provider';
import { buildApp } from '../src/server.js';
import { readConfig, type Config } from '../src/config.js';
import { serializeEip4361V1, serializeSiwsV1 } from '@warren/auth-contract';

const fixtures = JSON.parse(readFileSync(new URL('../../../packages/auth-contract/fixtures/v1/canonical.json', import.meta.url), 'utf8')) as Record<string, any>;

function setup(overrides: Partial<Config> = {}, injectTestProvider = true) {
  const directory = mkdtempSync(join(tmpdir(), 'warren-api-'));
  const config: Config = { NODE_ENV: 'test', PORT: 0, DATABASE_URL: `file:${join(directory, 'test.db')}`, AUTH_DOMAIN: 'warren.test', AUTH_URI: 'https://warren.test', CHALLENGE_TTL_SECONDS: 900, ATTEMPT_TTL_SECONDS: 1200, ACCESS_TTL_SECONDS: 900, REFRESH_TTL_SECONDS: 2_592_000, SESSION_HMAC_PEPPER: 'test-only-pepper-with-at-least-24-characters', SESSION_RESULT_ENCRYPTION_KEY: 'test-only-result-encryption-key-at-least-32-chars', EVM_SUPPORTED_CHAIN_IDS: '1', SOLANA_SUPPORTED_CLUSTERS: 'devnet', CORS_ORIGINS: 'https://warren.test', RATE_LIMIT_MAX: 60, RATE_LIMIT_WINDOW_SECONDS: 60, TOKENS_API_BASE_URL: 'https://api.tokens.test', HOME_PROVIDER_TIMEOUT_MS: 5_000, HOME_CATALOG_CACHE_SECONDS: 60, HOME_CATALOG_STALE_SECONDS: 900, HOME_HTTP_CACHE_SECONDS: 15, HOME_HTTP_STALE_SECONDS: 60, PRESTOCKS_API_URL: 'https://prestocks.test/api/prestocks', PHOENIX_API_BASE_URL: 'https://phoenix.test', MARKETS_PROVIDER_TIMEOUT_MS: 8_000, MARKETS_REGISTRY_CACHE_SECONDS: 60, MARKETS_REGISTRY_STALE_SECONDS: 900, MARKETS_HTTP_CACHE_SECONDS: 15, MARKETS_HTTP_STALE_SECONDS: 60, ...overrides };
  const provider = new DeterministicTestWalletAdapter('test'); const app = buildApp(injectTestProvider ? { config, provider } : { config });
  return { app, provider, databaseFile: join(directory, 'test.db'), close: async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('canonical fixtures preserve exact EIP-4361/SIWS bytes and reject non-alphanumeric nonce', () => {
  assert.equal(serializeEip4361V1(fixtures.input), fixtures.evm.message);
  assert.equal(serializeSiwsV1(fixtures.input), fixtures.solana.message);
  assert.equal(createHash('sha256').update(fixtures.evm.message).digest('hex'), fixtures.evm.sha256);
  assert.equal(createHash('sha256').update(fixtures.solana.message).digest('hex'), fixtures.solana.sha256);
  assert.match(fixtures.solana.message, /\nChain ID: 1\n/);
  assert.throws(() => serializeSiwsV1({ ...fixtures.input, nonce: 'bad_nonce' }));
});
async function request(app: FastifyInstance, method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) {
  const response: any = await app.inject({ method, url, payload, headers } as any); return { response, body: response.payload ? response.json() as Record<string, any> : {} };
}
async function attempt(app: FastifyInstance, family: 'evm' | 'solana', purpose: 'sign_in' | 'link_wallet' = 'sign_in', access?: string) {
  const { response, body } = await request(app, 'POST', '/v1/auth/attempts', { purpose, family, providerId: 'deterministic' }, access ? { authorization: `Bearer ${access}` } : {});
  assert.equal(response.statusCode, 201); return body;
}
async function challenge(app: FastifyInstance, item: Record<string, any>, address: string, chainContext: string, credentialRef = address.startsWith('0x') ? 'deterministic:evm' : 'deterministic:solana') {
  const { response, body } = await request(app, 'POST', `/v1/auth/attempts/${item.attemptId}/challenges`, { credentialRef, address, chainContext }, { 'x-attempt-capability': item.attemptCapability }); assert.equal(response.statusCode, 200); return body;
}

test('config rejects unsafe TTL, network, and production CORS invariants', () => {
  assert.throws(() => readConfig({ NODE_ENV: 'test', CHALLENGE_TTL_SECONDS: '900', ATTEMPT_TTL_SECONDS: '899' }));
  assert.throws(() => readConfig({ NODE_ENV: 'test', EVM_SUPPORTED_CHAIN_IDS: '01' }));
  assert.throws(() => readConfig({ NODE_ENV: 'test', SOLANA_SUPPORTED_CLUSTERS: 'devnet,' }));
  assert.throws(() => readConfig({ NODE_ENV: 'production', DATABASE_URL: 'file:/var/lib/warren.db', AUTH_URI: 'https://api.warren.test', SESSION_HMAC_PEPPER: 'a-production-hmac-pepper-that-is-long-enough', SESSION_RESULT_ENCRYPTION_KEY: 'a-production-result-key-that-is-long-enough', CORS_ORIGINS: '*' }));
  assert.throws(() => readConfig({ NODE_ENV: 'production', DATABASE_URL: 'file:/var/lib/warren.db', AUTH_URI: 'https://api.warren.test', SESSION_HMAC_PEPPER: 'a-production-hmac-pepper-that-is-long-enough', SESSION_RESULT_ENCRYPTION_KEY: 'a-production-result-key-that-is-long-enough', CORS_ORIGINS: 'https://warren.test' }), /TOKENS_API_KEY/);
});
async function proof(app: FastifyInstance, item: Record<string, any>, challengeValue: Record<string, any>, signature: string) {
  return request(app, 'POST', `/v1/auth/attempts/${item.attemptId}/proofs`, { challengeId: challengeValue.challengeId, protocol: challengeValue.protocol, signature }, { 'x-attempt-capability': item.attemptCapability });
}

test('EVM sign-in verifies an exact message, resumes profile, rotates then revokes reused refresh', async () => {
  const env = setup(); try {
    const first = await attempt(env.app, 'evm'); const firstChallenge = await challenge(env.app, first, env.provider.evmAddress, '1');
    assert.deepEqual(first.developmentCredential, { credentialRef: 'deterministic:evm', family: 'evm', address: env.provider.evmAddress, network: '1' });
    const signed = await env.provider.signForTests('evm', firstChallenge.message); const completed = await proof(env.app, first, firstChallenge, signed.toUpperCase());
    assert.equal(completed.response.statusCode, 200); assert.ok(completed.body.accessToken.startsWith('st1.'));
    const resumedAttempt = await attempt(env.app, 'evm'); const resumedChallenge = await challenge(env.app, resumedAttempt, env.provider.evmAddress, '1');
    const resumed = await proof(env.app, resumedAttempt, resumedChallenge, await env.provider.signForTests('evm', resumedChallenge.message));
    assert.equal(resumed.body.profileId, completed.body.profileId);
    const me = await request(env.app, 'GET', '/v1/me', undefined, { authorization: `Bearer ${completed.body.accessToken}` }); assert.equal(me.body.wallets.length, 1);
    const refresh = await request(env.app, 'POST', '/v1/sessions/refresh', { refreshToken: completed.body.refreshToken }, { 'idempotency-key': 'refresh-request-0001' }); assert.equal(refresh.response.statusCode, 200);
    const reused = await request(env.app, 'POST', '/v1/sessions/refresh', { refreshToken: completed.body.refreshToken }, { 'idempotency-key': 'different-refresh-key' }); assert.equal(reused.response.statusCode, 401); assert.equal(reused.body.error.code, 'SESSION_INVALID');
    const revokedFamilyAccess = await request(env.app, 'GET', '/v1/me', undefined, { authorization: `Bearer ${refresh.body.accessToken}` }); assert.equal(revokedFamilyAccess.response.statusCode, 401);
  } finally { await env.close(); }
});

test('mutated proof is rejected without consuming challenge, replay only succeeds once', async () => {
  const env = setup(); try {
    const item = await attempt(env.app, 'solana'); const value = await challenge(env.app, item, env.provider.solanaAddress, 'devnet'); const signature = await env.provider.signForTests('solana', value.message);
    const mutated = `${signature.slice(0, 2)}${signature[2] === '0' ? '1' : '0'}${signature.slice(3)}`;
    const bad = await proof(env.app, item, value, mutated); assert.equal(bad.response.statusCode, 422); assert.equal(bad.body.error.code, 'PROOF_INVALID');
    const good = await proof(env.app, item, value, signature); assert.equal(good.response.statusCode, 200);
    const replay = await proof(env.app, item, value, signature); assert.equal(replay.response.statusCode, 409); assert.equal(replay.body.error.code, 'CHALLENGE_REPLAYED');
  } finally { await env.close(); }
});

test('credential network is provider-authoritative across configured EVM networks', async () => {
  const env = setup({ EVM_SUPPORTED_CHAIN_IDS: '1,10' }); try {
    const item = await attempt(env.app, 'evm');
    const wrongNetwork = await request(env.app, 'POST', `/v1/auth/attempts/${item.attemptId}/challenges`, { credentialRef: 'deterministic:evm', address: env.provider.evmAddress, chainContext: '10' }, { 'x-attempt-capability': item.attemptCapability });
    assert.equal(wrongNetwork.response.statusCode, 422); assert.equal(wrongNetwork.body.error.code, 'WRONG_NETWORK');
  } finally { await env.close(); }
});

test('expired challenge cannot reserve a signature request or prompt a provider', async () => {
  const env = setup(); try {
    const item = await attempt(env.app, 'evm'); const value = await challenge(env.app, item, env.provider.evmAddress, '1');
    const database = new Database(env.databaseFile); database.prepare('UPDATE sign_challenges SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', value.challengeId); database.close();
    const response = await request(env.app, 'POST', `/v1/auth/attempts/${item.attemptId}/signature-requests`, { challengeId: value.challengeId, credentialRef: value.credentialRef }, { 'x-attempt-capability': item.attemptCapability, 'idempotency-key': 'expired-challenge-request' });
    assert.equal(response.response.statusCode, 410); assert.equal(response.body.error.code, 'CHALLENGE_EXPIRED'); assert.equal(env.provider.signatureRequestCount, 0);
  } finally { await env.close(); }
});

test('production disabled provider rejects dead attempts before persistence', async () => {
  const env = setup({ NODE_ENV: 'production' }, false); try {
    const response = await request(env.app, 'POST', '/v1/auth/attempts', { purpose: 'sign_in', family: 'evm', providerId: 'disabled' }); assert.equal(response.response.statusCode, 503); assert.equal(response.body.error.code, 'PROVIDER_DISABLED');
    const database = new Database(env.databaseFile, { readonly: true }); assert.equal((database.prepare('SELECT COUNT(*) AS count FROM auth_attempts').get() as { count: number }).count, 0); database.close();
  } finally { await env.close(); }
});

test('deterministic signature requests are idempotent and poll completes through the same verifier', async () => {
  const env = setup(); try {
    const item = await attempt(env.app, 'evm'); const value = await challenge(env.app, item, env.provider.evmAddress, '1');
    const headers = { 'x-attempt-capability': item.attemptCapability, 'idempotency-key': 'signature-request-0001' };
    const one = await request(env.app, 'POST', `/v1/auth/attempts/${item.attemptId}/signature-requests`, { challengeId: value.challengeId, credentialRef: value.credentialRef }, headers);
    const duplicate = await request(env.app, 'POST', `/v1/auth/attempts/${item.attemptId}/signature-requests`, { challengeId: value.challengeId, credentialRef: value.credentialRef }, headers);
    assert.equal(one.response.statusCode, 200); assert.equal(one.body.requestId, duplicate.body.requestId);
    const polled = await request(env.app, 'GET', `/v1/auth/attempts/${item.attemptId}/signature-requests/${one.body.requestId}`, undefined, headers);
    assert.equal(polled.response.statusCode, 200); assert.ok(polled.body.accessToken);
  } finally { await env.close(); }
});

test('linking a wallet owned by a different private profile fails closed', async () => {
  const env = setup(); try {
    const ownerAttempt = await attempt(env.app, 'solana'); const ownerChallenge = await challenge(env.app, ownerAttempt, env.provider.solanaAddress, 'devnet'); const owner = await proof(env.app, ownerAttempt, ownerChallenge, await env.provider.signForTests('solana', ownerChallenge.message));
    const userAttempt = await attempt(env.app, 'evm'); const userChallenge = await challenge(env.app, userAttempt, env.provider.evmAddress, '1'); const user = await proof(env.app, userAttempt, userChallenge, await env.provider.signForTests('evm', userChallenge.message));
    const linking = await attempt(env.app, 'solana', 'link_wallet', user.body.accessToken); const linkChallenge = await challenge(env.app, linking, env.provider.solanaAddress, 'devnet'); const conflict = await proof(env.app, linking, linkChallenge, await env.provider.signForTests('solana', linkChallenge.message));
    assert.equal(conflict.response.statusCode, 409); assert.equal(conflict.body.error.code, 'WALLET_CONFLICT'); assert.equal(conflict.body.profileId, undefined); assert.ok(owner.body.profileId !== user.body.profileId);
  } finally { await env.close(); }
});

test('linking a second active wallet in the same family blocks before the partial index', async () => {
  const env = setup(); try {
    const userAttempt = await attempt(env.app, 'evm'); const userChallenge = await challenge(env.app, userAttempt, env.provider.evmAddress, '1'); const user = await proof(env.app, userAttempt, userChallenge, await env.provider.signForTests('evm', userChallenge.message));
    const linking = await attempt(env.app, 'evm', 'link_wallet', user.body.accessToken);
    const alternate = await challenge(env.app, linking, env.provider.alternateEvmAddress, '1', 'deterministic:evm-alt');
    const conflict = await proof(env.app, linking, alternate, await env.provider.signForTests('evm', alternate.message, 'deterministic:evm-alt'));
    assert.equal(conflict.response.statusCode, 409); assert.equal(conflict.body.error.code, 'WALLET_CONFLICT'); assert.equal(conflict.body.error.message, 'This wallet cannot be linked to this profile.');
    const status = await request(env.app, 'GET', `/v1/auth/attempts/${linking.attemptId}`, undefined, { 'x-attempt-capability': linking.attemptCapability }); assert.equal(status.body.state, 'blocked');
    const blockedChallenge = await request(env.app, 'POST', `/v1/auth/attempts/${linking.attemptId}/challenges`, { credentialRef: 'deterministic:evm-alt', address: env.provider.alternateEvmAddress, chainContext: '1' }, { 'x-attempt-capability': linking.attemptCapability }); assert.equal(blockedChallenge.response.statusCode, 409); assert.equal(blockedChallenge.body.error.code, 'ATTEMPT_STATE_INVALID');
  } finally { await env.close(); }
});

test('a completed attempt cannot mint a fresh challenge with its still-valid capability', async () => {
  const env = setup(); try {
    const item = await attempt(env.app, 'evm'); const value = await challenge(env.app, item, env.provider.evmAddress, '1');
    const complete = await proof(env.app, item, value, await env.provider.signForTests('evm', value.message)); assert.equal(complete.response.statusCode, 200);
    const retry = await request(env.app, 'POST', `/v1/auth/attempts/${item.attemptId}/challenges`, { credentialRef: 'deterministic:evm', address: env.provider.evmAddress, chainContext: '1' }, { 'x-attempt-capability': item.attemptCapability });
    assert.equal(retry.response.statusCode, 409); assert.equal(retry.body.error.code, 'ATTEMPT_STATE_INVALID');
  } finally { await env.close(); }
});

test('concurrent verification has exactly one success', async () => {
  const env = setup(); try {
    const item = await attempt(env.app, 'evm'); const value = await challenge(env.app, item, env.provider.evmAddress, '1'); const signature = await env.provider.signForTests('evm', value.message);
    const results = await Promise.all(Array.from({ length: 20 }, () => proof(env.app, item, value, signature)));
    assert.equal(results.filter((result) => result.response.statusCode === 200).length, 1);
    assert.equal(results.filter((result) => result.body.error?.code === 'CHALLENGE_REPLAYED').length, 19);
  } finally { await env.close(); }
});

test('revoked initiating session blocks a backgrounded link attempt before completion', async () => {
  const env = setup(); try {
    const userAttempt = await attempt(env.app, 'evm'); const userChallenge = await challenge(env.app, userAttempt, env.provider.evmAddress, '1');
    const user = await proof(env.app, userAttempt, userChallenge, await env.provider.signForTests('evm', userChallenge.message));
    const linking = await attempt(env.app, 'solana', 'link_wallet', user.body.accessToken); const linkChallenge = await challenge(env.app, linking, env.provider.solanaAddress, 'devnet');
    const signed = await env.provider.signForTests('solana', linkChallenge.message);
    const revoked = await request(env.app, 'POST', '/v1/sessions/revoke', undefined, { authorization: `Bearer ${user.body.accessToken}` }); assert.equal(revoked.response.statusCode, 204);
    const completed = await proof(env.app, linking, linkChallenge, signed); assert.equal(completed.response.statusCode, 401); assert.equal(completed.body.error.code, 'SESSION_INVALID');
    const status = await request(env.app, 'GET', `/v1/auth/attempts/${linking.attemptId}`, undefined, { 'x-attempt-capability': linking.attemptCapability }); assert.equal(status.body.state, 'blocked');
  } finally { await env.close(); }
});

test('signature reservation is concurrent-safe and terminal polls do not consume or reissue credentials', async () => {
  const env = setup(); try {
    const item = await attempt(env.app, 'evm'); const value = await challenge(env.app, item, env.provider.evmAddress, '1');
    const headers = { 'x-attempt-capability': item.attemptCapability, 'idempotency-key': 'concurrent-signature-request' };
    const requests = await Promise.all(Array.from({ length: 12 }, () => request(env.app, 'POST', `/v1/auth/attempts/${item.attemptId}/signature-requests`, { challengeId: value.challengeId, credentialRef: value.credentialRef }, headers)));
    assert.equal(env.provider.signatureRequestCount, 1); assert.equal(new Set(requests.map((result) => result.body.requestId)).size, 1);
    const requestId = requests[0].body.requestId;
    const first = await request(env.app, 'GET', `/v1/auth/attempts/${item.attemptId}/signature-requests/${requestId}`, undefined, headers); assert.equal(first.response.statusCode, 200); assert.ok(first.body.accessToken);
    const repeat = await request(env.app, 'GET', `/v1/auth/attempts/${item.attemptId}/signature-requests/${requestId}`, undefined, headers); assert.equal(repeat.response.statusCode, 200); assert.equal(repeat.body.state, 'complete'); assert.equal(repeat.body.accessToken, first.body.accessToken); assert.equal(repeat.body.refreshToken, first.body.refreshToken); assert.equal(repeat.body.profileId, first.body.profileId);
  } finally { await env.close(); }
});

test('wrong refresh secret does not revoke a family, while same-key retry is non-destructive', async () => {
  const env = setup(); try {
    const item = await attempt(env.app, 'evm'); const value = await challenge(env.app, item, env.provider.evmAddress, '1'); const done = await proof(env.app, item, value, await env.provider.signForTests('evm', value.message));
    const badToken = `${done.body.refreshToken.slice(0, -1)}${done.body.refreshToken.endsWith('a') ? 'b' : 'a'}`;
    const wrong = await request(env.app, 'POST', '/v1/sessions/refresh', { refreshToken: badToken }, { 'idempotency-key': 'wrong-secret-request' }); assert.equal(wrong.response.statusCode, 401);
    const fresh = await request(env.app, 'POST', '/v1/sessions/refresh', { refreshToken: done.body.refreshToken }, { 'idempotency-key': 'refresh-retry-request' }); assert.equal(fresh.response.statusCode, 200);
    const retry = await request(env.app, 'POST', '/v1/sessions/refresh', { refreshToken: done.body.refreshToken }, { 'idempotency-key': 'refresh-retry-request' }); assert.equal(retry.response.statusCode, 200); assert.equal(retry.body.accessToken, fresh.body.accessToken);
    const stillValid = await request(env.app, 'GET', '/v1/me', undefined, { authorization: `Bearer ${fresh.body.accessToken}` }); assert.equal(stillValid.response.statusCode, 200);
  } finally { await env.close(); }
});

test('mutating public routes return a contract-shaped 429 response', async () => {
  const env = setup({ RATE_LIMIT_MAX: 1 }); try {
    const first = await request(env.app, 'POST', '/v1/auth/attempts', { purpose: 'sign_in', family: 'evm', providerId: 'deterministic' }); assert.equal(first.response.statusCode, 201);
    const limited = await request(env.app, 'POST', '/v1/auth/attempts', { purpose: 'sign_in', family: 'evm', providerId: 'deterministic' }); assert.equal(limited.response.statusCode, 429); assert.equal(limited.body.error.code, 'RATE_LIMITED'); assert.ok(limited.body.error.details.retryAfterSeconds >= 1);
  } finally { await env.close(); }
});

test('normalized provider polling is rate limited without limiting health or me', async () => {
  const env = setup({ RATE_LIMIT_MAX: 1 }); try {
    const item = await attempt(env.app, 'evm'); const value = await challenge(env.app, item, env.provider.evmAddress, '1'); const headers = { 'x-attempt-capability': item.attemptCapability, 'idempotency-key': 'single-poll-rate-limit' };
    const created = await request(env.app, 'POST', `/v1/auth/attempts/${item.attemptId}/signature-requests`, { challengeId: value.challengeId, credentialRef: value.credentialRef }, headers); assert.equal(created.response.statusCode, 200);
    const first = await request(env.app, 'GET', `/v1/auth/attempts/${item.attemptId}/signature-requests/${created.body.requestId}`, undefined, headers); assert.equal(first.response.statusCode, 200);
    const limited = await request(env.app, 'GET', `/v1/auth/attempts/${item.attemptId}/signature-requests/${created.body.requestId}`, undefined, headers); assert.equal(limited.response.statusCode, 429); assert.equal(limited.body.error.code, 'RATE_LIMITED');
    assert.equal((await request(env.app, 'GET', '/v1/health')).response.statusCode, 200);
  } finally { await env.close(); }
});

test('invalid input maps to 400 and provider outages map to a redacted 502', async () => {
  const env = setup(); try {
    const item = await attempt(env.app, 'evm'); const value = await challenge(env.app, item, env.provider.evmAddress, '1');
    const headers = { 'x-attempt-capability': item.attemptCapability, 'idempotency-key': 'validation-and-provider-errors' };
    const invalid = await request(env.app, 'POST', `/v1/auth/attempts/${item.attemptId}/signature-requests`, { challengeId: value.challengeId }, headers); assert.equal(invalid.response.statusCode, 400); assert.equal(invalid.body.error.code, 'INVALID_REQUEST');
    env.provider.requestMessageSignature = async () => { throw new Error('provider raw diagnostic must not escape'); };
    const outage = await request(env.app, 'POST', `/v1/auth/attempts/${item.attemptId}/signature-requests`, { challengeId: value.challengeId, credentialRef: value.credentialRef }, headers); assert.equal(outage.response.statusCode, 502); assert.equal(outage.body.error.code, 'PROVIDER_UNAVAILABLE'); assert.doesNotMatch(outage.body.error.message, /diagnostic/);
  } finally { await env.close(); }
});

test('provider credential discovery failure creates no orphan attempt', async () => {
  const env = setup(); try {
    env.provider.listCredentials = async () => { throw new Error('credential service unavailable'); };
    const failed = await request(env.app, 'POST', '/v1/auth/attempts', { purpose: 'sign_in', family: 'evm', providerId: 'deterministic' }); assert.equal(failed.response.statusCode, 502);
    const database = new Database(env.databaseFile, { readonly: true });
    assert.equal((database.prepare('SELECT COUNT(*) AS count FROM auth_attempts').get() as { count: number }).count, 0); database.close();
  } finally { await env.close(); }
});
