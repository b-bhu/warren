import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { z } from 'zod';
import { getAddress, isAddress, recoverMessageAddress } from 'viem';
import {
  challengeRequestSchema, createAttemptSchema, idempotencyKeySchema, proofSchema, refreshSchema, serializeEip4361V1,
  serializeSiwsV1, signatureRequestSchema, type ErrorCode, type WalletFamily,
} from '@warren/auth-contract';
import type { ExecutionErrorCode } from '@warren/execution-contract';
import { DeterministicTestWalletAdapter } from '@warren/test-wallet-provider';
import type { ProviderAdapter } from '@warren/provider-contract';
import { openDatabase, type Sqlite } from './db.js';
import { readConfig, type Config } from './config.js';
import { registerHomeRoutes } from './home/routes.js';
import { HomeService, HomeServiceFault } from './home/service.js';
import { FixtureCatalogSource, FixtureSupplementSource, TokensCatalogSource, TokensNewsSource } from './home/sources.js';
import { registerMarketsRoutes } from './markets/routes.js';
import { MarketsService, MarketsServiceFault } from './markets/service.js';
import { TokensMarketDetailsSource } from './markets/details-sources.js';
import { FixtureSpotSource, PhoenixPerpetualSource, PreStocksSource, TesseraSource, TokensSpotSource } from './markets/sources.js';
import { registerExecutionRoutes } from './execution/routes.js';
import { ExecutionService, ExecutionServiceFault } from './execution/service.js';
import {
  DisabledExecutionIdentityVerifier,
  JupiterExecutionSource,
  PhoenixExecutionSource,
  PrivyExecutionIdentityVerifier,
  SolanaRpcGateway,
} from './execution/sources.js';
import type { ExecutionIdentityVerifier, ExecutionServiceContract } from './execution/types.js';
import { SqliteExecutionIntentStore } from './execution/store.js';
import { registerPortfolioRoutes } from './portfolio/routes.js';
import { PortfolioService, PortfolioServiceFault, type PortfolioErrorCode } from './portfolio/service.js';
import { SqlitePortfolioSnapshotStore } from './portfolio/snapshots.js';
import { HeliusPortfolioSource, PhoenixPortfolioSource, UnavailableWalletPortfolioSource } from './portfolio/sources.js';
import { PhoenixRegistrationService } from './portfolio/registration-service.js';
import { PhoenixRegistrationSource } from './portfolio/registration-source.js';
import { SqlitePhoenixRegistrationIntentStore } from './portfolio/registration-store.js';
import { KaminoMarketCatalog } from './lending/market.js';
import { registerLendingRoutes } from './lending/routes.js';
import { KaminoSdkAdapter } from './lending/kamino-sdk.js';
import { LendingService, LendingServiceFault } from './lending/service.js';
import { SqliteLendingActionStore } from './lending/store.js';

type Row = Record<string, unknown>;
type AppOptions = {
  config?: Config;
  db?: Sqlite;
  provider?: ProviderAdapter;
  homeService?: HomeService;
  marketsService?: MarketsService;
  executionService?: ExecutionServiceContract;
  executionIdentityVerifier?: ExecutionIdentityVerifier;
  portfolioService?: PortfolioService;
  phoenixRegistrationService?: PhoenixRegistrationService;
  kaminoMarketCatalog?: KaminoMarketCatalog;
  lendingService?: LendingService;
};
type Completion = { profileId: string; accessToken?: string; refreshToken?: string; accessExpiresAt?: string; alreadyCompleted?: boolean };
class ApiFault extends Error {
  constructor(readonly code: ErrorCode | ExecutionErrorCode | PortfolioErrorCode | 'CATALOG_UNAVAILABLE' | 'REGISTRY_UNAVAILABLE', readonly status: number, message: string, readonly retryable = false, readonly attemptId?: string, readonly details?: { retryAfterSeconds?: number }, readonly executionId?: string) { super(message); }
}
const now = () => new Date().toISOString();
const expiry = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const opaque = () => randomBytes(32).toString('base64url');
const nonce = () => randomBytes(24).toString('hex'); // protocol nonce: alphanumeric, 48 chars; bearer tokens use opaque().
const id = () => randomUUID();

function canonicalAddress(family: WalletFamily, address: string): { normalized: string; display: string } {
  if (family === 'evm') {
    if (!isAddress(address)) throw new ApiFault('INVALID_REQUEST', 400, 'The wallet address is not valid.');
    return { normalized: getAddress(address).toLowerCase(), display: getAddress(address) };
  }
  try { const decoded = bs58.decode(address); if (decoded.length !== 32) throw new Error(); return { normalized: bs58.encode(decoded), display: bs58.encode(decoded) }; }
  catch { throw new ApiFault('INVALID_REQUEST', 400, 'The wallet address is not valid.'); }
}
function contextOk(config: Config, family: WalletFamily, context: string) {
  const allowed = family === 'evm' ? config.EVM_SUPPORTED_CHAIN_IDS.split(',') : config.SOLANA_SUPPORTED_CLUSTERS.split(',');
  if (!allowed.includes(context)) throw new ApiFault('WRONG_NETWORK', 422, 'This wallet network is not supported.');
}
function hmac(config: Config, value: string) { return createHmac('sha256', config.SESSION_HMAC_PEPPER).update(value).digest('hex'); }
function safeEqual(a: string, b: string) { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
function bearer(request: FastifyRequest) { const value = request.headers.authorization; return value?.startsWith('Bearer ') ? value.slice(7) : undefined; }
function capability(request: FastifyRequest) { const value = request.headers['x-attempt-capability']; return typeof value === 'string' ? value : undefined; }
function idempotencyKey(request: FastifyRequest) { const value = request.headers['idempotency-key']; return idempotencyKeySchema.parse(value); }
function tokenParts(token: string) { const match = /^st1\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,})$/.exec(token); return match ? { id: match[1], secret: match[2] } : undefined; }

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const config = options.config ?? readConfig();
  const db = options.db ?? openDatabase(config.DATABASE_URL);
  const disabledProvider: ProviderAdapter = {
    id: 'disabled', async getSupport() { return { families: [] }; }, async listCredentials() { throw new ApiFault('PROVIDER_DISABLED', 503, 'Wallet signing is not configured.', true); }, async validateCredential() { throw new ApiFault('PROVIDER_DISABLED', 503, 'Wallet signing is not configured.', true); },
    async requestMessageSignature() { throw new ApiFault('PROVIDER_DISABLED', 503, 'Wallet signing is not configured.', true); }, async getMessageSignature() { throw new ApiFault('PROVIDER_DISABLED', 503, 'Wallet signing is not configured.', true); },
  };
  const provider = options.provider ?? (config.NODE_ENV === 'production' ? disabledProvider : new DeterministicTestWalletAdapter(config.NODE_ENV));
  const catalog = config.TOKENS_API_KEY
    ? new TokensCatalogSource({ apiKey: config.TOKENS_API_KEY, baseUrl: config.TOKENS_API_BASE_URL, timeoutMs: config.HOME_PROVIDER_TIMEOUT_MS })
    : new FixtureCatalogSource();
  const fixtureSupplement = new FixtureSupplementSource();
  const homeService = options.homeService ?? new HomeService({
    catalog,
    market: fixtureSupplement,
    indices: fixtureSupplement,
    news: config.TOKENS_API_KEY
      ? new TokensNewsSource({ apiKey: config.TOKENS_API_KEY, baseUrl: config.TOKENS_API_BASE_URL, timeoutMs: config.HOME_PROVIDER_TIMEOUT_MS })
      : fixtureSupplement,
    cacheTtlMs: config.HOME_CATALOG_CACHE_SECONDS * 1000,
    staleTtlMs: config.HOME_CATALOG_STALE_SECONDS * 1000,
  });
  const marketDetailsSource = config.TOKENS_API_KEY
    ? new TokensMarketDetailsSource({
      apiKey: config.TOKENS_API_KEY,
      baseUrl: config.TOKENS_API_BASE_URL,
      timeoutMs: config.MARKETS_PROVIDER_TIMEOUT_MS,
    })
    : undefined;
  const marketsService = options.marketsService ?? new MarketsService({
    sources: [
      config.TOKENS_API_KEY
        ? new TokensSpotSource({ apiKey: config.TOKENS_API_KEY, baseUrl: config.TOKENS_API_BASE_URL, timeoutMs: config.MARKETS_PROVIDER_TIMEOUT_MS })
        : new FixtureSpotSource(),
      new PreStocksSource({ url: config.PRESTOCKS_API_URL, timeoutMs: config.MARKETS_PROVIDER_TIMEOUT_MS }),
      new TesseraSource(),
      new PhoenixPerpetualSource({ baseUrl: config.PHOENIX_API_BASE_URL, timeoutMs: config.MARKETS_PROVIDER_TIMEOUT_MS }),
    ],
    historySource: marketDetailsSource,
    newsSource: marketDetailsSource,
    cacheTtlMs: config.MARKETS_REGISTRY_CACHE_SECONDS * 1000,
    staleTtlMs: config.MARKETS_REGISTRY_STALE_SECONDS * 1000,
  });
  const executionIdentityVerifier = options.executionIdentityVerifier ?? (
    config.PRIVY_APP_ID && config.PRIVY_APP_SECRET
      ? new PrivyExecutionIdentityVerifier(config.PRIVY_APP_ID, config.PRIVY_APP_SECRET)
      : new DisabledExecutionIdentityVerifier()
  );
  const executionStore = new SqliteExecutionIntentStore(db);
  const executionService = options.executionService ?? new ExecutionService({
    markets: marketsService,
    spot: new JupiterExecutionSource({
      baseUrl: config.JUPITER_API_BASE_URL,
      apiKey: config.JUPITER_API_KEY,
      timeoutMs: config.EXECUTION_PROVIDER_TIMEOUT_MS,
    }),
    perpetual: new PhoenixExecutionSource({
      baseUrl: config.PHOENIX_API_BASE_URL,
      timeoutMs: config.EXECUTION_PROVIDER_TIMEOUT_MS,
    }),
    solana: new SolanaRpcGateway(config.HELIUS_RPC_URL ?? config.SOLANA_RPC_URL),
    store: executionStore,
    intentTtlMs: config.EXECUTION_INTENT_TTL_SECONDS * 1000,
  });
  const portfolioService = options.portfolioService ?? new PortfolioService({
    markets: marketsService,
    wallet: config.HELIUS_RPC_URL
      ? new HeliusPortfolioSource({ rpcUrl: config.HELIUS_RPC_URL, timeoutMs: config.EXECUTION_PROVIDER_TIMEOUT_MS })
      : new UnavailableWalletPortfolioSource(),
    phoenix: new PhoenixPortfolioSource({
      baseUrl: config.PHOENIX_API_BASE_URL,
      timeoutMs: config.EXECUTION_PROVIDER_TIMEOUT_MS,
    }),
    executions: executionStore,
    snapshots: new SqlitePortfolioSnapshotStore(db),
    phoenixRegistrationMode: config.PHOENIX_REFERRAL_CODE ? 'referral' : 'non_referral',
  });
  const phoenixRegistrationService = options.phoenixRegistrationService ?? new PhoenixRegistrationService({
    provider: new PhoenixRegistrationSource({
      baseUrl: config.PHOENIX_API_BASE_URL,
      rpcUrl: config.HELIUS_RPC_URL ?? config.SOLANA_RPC_URL,
      timeoutMs: config.EXECUTION_PROVIDER_TIMEOUT_MS,
    }),
    solana: new SolanaRpcGateway(config.HELIUS_RPC_URL ?? config.SOLANA_RPC_URL),
    store: new SqlitePhoenixRegistrationIntentStore(db),
    ...(config.PHOENIX_REFERRAL_CODE ? { referralCode: config.PHOENIX_REFERRAL_CODE } : {}),
    reviewTtlMs: config.EXECUTION_INTENT_TTL_SECONDS * 1000,
  });
  const kaminoMarketCatalog = options.kaminoMarketCatalog ?? new KaminoMarketCatalog({
    baseUrl: config.KAMINO_API_BASE_URL,
    timeoutMs: config.KAMINO_MARKET_TIMEOUT_MS,
    enabled: config.KAMINO_LENDING_ENABLED === 'true',
    newRiskEnabled: config.KAMINO_LENDING_NEW_RISK_ENABLED === 'true',
    recoveryEnabled: config.KAMINO_LENDING_REPAY_ENABLED === 'true' || config.KAMINO_LENDING_WITHDRAW_ENABLED === 'true',
  });
  const lendingSdk = new KaminoSdkAdapter({ rpcUrl: config.HELIUS_RPC_URL ?? config.SOLANA_RPC_URL, timeoutMs: config.EXECUTION_PROVIDER_TIMEOUT_MS });
  const lendingService = options.lendingService ?? new LendingService({
    catalog: kaminoMarketCatalog,
    sdk: lendingSdk,
    store: new SqliteLendingActionStore(db),
    flags: {
      catalogEnabled: config.KAMINO_LENDING_ENABLED === 'true',
      newRiskEnabled: config.KAMINO_LENDING_NEW_RISK_ENABLED === 'true',
      repayEnabled: config.KAMINO_LENDING_REPAY_ENABLED === 'true',
      withdrawEnabled: config.KAMINO_LENDING_WITHDRAW_ENABLED === 'true',
      borrowHeadroomBps: config.KAMINO_BORROW_HEADROOM_BPS,
    },
    send: lendingSdk.send.bind(lendingSdk),
    signatureState: lendingSdk.getSignatureState.bind(lendingSdk),
  });
  const app = Fastify({ logger: config.NODE_ENV === 'test' ? false : { level: 'info', redact: ['req.headers.authorization', 'req.headers.x-attempt-capability', 'req.headers.idempotency-key', 'req.body.signedTransaction', 'res.body.unsignedTransaction'] }, genReqId: id });
  const origins = config.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
  app.register(cors, { origin: origins });
  const buckets = new Map<string, { count: number; resetAt: number }>();
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0];
    const sensitivePoll = request.method === 'GET' && /^\/v1\/auth\/attempts\/[^/]+\/(credentials|signature-requests\/[^/]+)$/.test(path);
    const publicMarketRead = request.method === 'GET'
      && (path === '/v1/home' || path === '/v1/assets' || path === '/v1/markets' || path.startsWith('/v1/markets/') || path === '/v1/execution/spot/assets' || path === '/v1/lending/kamino/xstocks');
    const privatePortfolioRead = request.method === 'GET' && path.startsWith('/v1/portfolio/');
    const privateLendingRead = request.method === 'GET' && path.startsWith('/v1/lending/kamino/xstocks/');
    const mutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && path.startsWith('/v1/');
    if (!mutation && !sensitivePoll && !publicMarketRead && !privatePortfolioRead && !privateLendingRead) return;
    const scope = publicMarketRead || privatePortfolioRead || privateLendingRead ? path
      : /^\/v1\/auth\/attempts\/[^/]+\/signature-requests\/[^/]+$/.test(path) ? 'auth-poll'
      : /^\/v1\/auth\/attempts\/[^/]+\/credentials$/.test(path) ? 'auth-credentials'
        : path.replace(/\/v1\/auth\/attempts\/[^/]+/g, '/v1/auth/attempts/:attemptId');
    const at = Date.now();
    if (buckets.size >= 2_048) for (const [key, bucket] of buckets) if (bucket.resetAt <= at) buckets.delete(key);
    while (buckets.size >= 4_096) buckets.delete(buckets.keys().next().value!);
    const bucketKey = `${request.ip}:${scope}`; const prior = buckets.get(bucketKey);
    const bucket = !prior || prior.resetAt <= at ? { count: 0, resetAt: at + config.RATE_LIMIT_WINDOW_SECONDS * 1000 } : prior;
    bucket.count += 1; buckets.set(bucketKey, bucket);
    if (bucket.count > config.RATE_LIMIT_MAX) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - at) / 1000)); reply.header('retry-after', retryAfterSeconds);
      throw new ApiFault('RATE_LIMITED', 429, 'Too many requests. Please try again shortly.', true, undefined, { retryAfterSeconds });
    }
  });
  app.addHook('onSend', async (_request, reply) => { if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store'); });
  app.setErrorHandler((error, request, reply) => {
    const fault = error instanceof ApiFault ? error : error instanceof HomeServiceFault
      ? error.code === 'INVALID_CURSOR'
        ? new ApiFault('INVALID_REQUEST', 400, error.message, error.retryable)
        : error.code === 'CATALOG_UNAVAILABLE'
          ? new ApiFault('CATALOG_UNAVAILABLE', 503, error.message, error.retryable)
          : new ApiFault('INTERNAL_ERROR', 500, 'Something went wrong. Please try again.', true)
      : error instanceof MarketsServiceFault
        ? error.code === 'INVALID_CURSOR'
          ? new ApiFault('INVALID_REQUEST', 400, error.message, error.retryable)
          : error.code === 'NOT_FOUND'
            ? new ApiFault('NOT_FOUND', 404, error.message, error.retryable)
            : error.code === 'REGISTRY_UNAVAILABLE'
              ? new ApiFault('REGISTRY_UNAVAILABLE', 503, error.message, error.retryable)
              : new ApiFault('INTERNAL_ERROR', 500, 'Something went wrong. Please try again.', true)
      : error instanceof ExecutionServiceFault
        ? new ApiFault(error.code, error.status, error.message, error.retryable, undefined, undefined, error.executionId)
      : error instanceof PortfolioServiceFault
        ? error.code === 'CONTRACT_INVALID'
          ? new ApiFault('INTERNAL_ERROR', 500, 'Something went wrong. Please try again.', true)
          : new ApiFault(error.code, error.status, error.message, error.retryable)
      : error instanceof LendingServiceFault
        ? new ApiFault(error.code === 'LENDING_ACTION_PAUSED' ? 'EXECUTION_STATE_INVALID' : error.code === 'LENDING_NOT_FOUND' ? 'NOT_FOUND' : error.code === 'WALLET_MISMATCH' ? 'WALLET_MISMATCH' : error.code === 'LENDING_PROVIDER_UNAVAILABLE' ? 'PROVIDER_UNAVAILABLE' : 'INVALID_REQUEST', error.status, error.message, error.retryable)
      : error instanceof z.ZodError
      ? new ApiFault('INVALID_REQUEST', 400, 'The request could not be processed.')
      : new ApiFault('INTERNAL_ERROR', 500, 'Something went wrong. Please try again.', true);
    if (!(error instanceof ApiFault) && !(error instanceof z.ZodError)) request.log.error({ requestId: request.id, errorName: error instanceof Error ? error.name : 'unknown' }, 'Unhandled API error');
    reply.status(fault.status).send({ error: { code: fault.code, message: fault.message, retryable: fault.retryable, requestId: request.id, ...(fault.attemptId ? { attemptId: fault.attemptId } : {}), ...(fault.executionId ? { executionId: fault.executionId } : {}), ...(fault.details ? { details: fault.details } : {}) } });
  });

  const requireAccess = (request: FastifyRequest): Row => {
    const token = bearer(request), parts = token && tokenParts(token); if (!parts) throw new ApiFault('SESSION_INVALID', 401, 'Your session is not valid.');
    const row = db.prepare('SELECT a.*, f.profile_id, f.revoked_at AS family_revoked_at FROM access_tokens a JOIN session_families f ON f.id=a.family_id WHERE a.id=?').get(parts.id) as Row | undefined;
    if (!row || row.revoked_at || row.family_revoked_at || String(row.expires_at) < now() || !safeEqual(hmac(config, parts.secret), String(row.digest))) throw new ApiFault('SESSION_INVALID', 401, 'Your session is not valid.');
    return row;
  };
  // Completion credentials are AES-256-GCM encrypted so a lost response can be safely replayed until expiry.
  // This is a deliberate demo/BFF recovery tradeoff: production must keep this key separate from the DB and rotate it.
  const resultKey = createHash('sha256').update(config.SESSION_RESULT_ENCRYPTION_KEY).digest();
  const sealCompletion = (completion: Completion) => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', resultKey, iv); const encrypted = Buffer.concat([cipher.update(JSON.stringify(completion), 'utf8'), cipher.final()]); return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`; };
  const openCompletion = (ciphertext: string): Completion => { const [ivText, tagText, bodyText] = ciphertext.split('.'); if (!ivText || !tagText || !bodyText) throw new Error('Malformed completion ciphertext'); const decipher = createDecipheriv('aes-256-gcm', resultKey, Buffer.from(ivText, 'base64url')); decipher.setAuthTag(Buffer.from(tagText, 'base64url')); return JSON.parse(Buffer.concat([decipher.update(Buffer.from(bodyText, 'base64url')), decipher.final()]).toString('utf8')) as Completion; };
  const requireAttempt = (request: FastifyRequest, attemptId: string): Row => {
    const row = db.prepare('SELECT * FROM auth_attempts WHERE id=?').get(attemptId) as Row | undefined;
    if (!row) throw new ApiFault('NOT_FOUND', 404, 'This onboarding attempt was not found.');
    if (String(row.expires_at) < now()) throw new ApiFault('ATTEMPT_EXPIRED', 410, 'This onboarding attempt has expired.', false, attemptId);
    const token = capability(request);
    if (token && safeEqual(hmac(config, token), String(row.capability_digest))) return row;
    if (row.initiating_profile_id && bearer(request)) { const session = requireAccess(request); if (session.profile_id === row.initiating_profile_id) return row; }
    throw new ApiFault('ATTEMPT_FORBIDDEN', 403, 'This onboarding attempt is not available.', false, attemptId);
  };
  const issueSession = (profileId: string, familyId: string = id()) => {
    const accessId = id(), refreshId = id(), accessSecret = opaque(), refreshSecret = opaque();
    if (!db.prepare('SELECT 1 FROM session_families WHERE id=?').get(familyId)) db.prepare('INSERT INTO session_families(id,profile_id,created_at) VALUES (?,?,?)').run(familyId, profileId, now());
    db.prepare('INSERT INTO access_tokens(id,family_id,digest,expires_at) VALUES (?,?,?,?)').run(accessId, familyId, hmac(config, accessSecret), expiry(config.ACCESS_TTL_SECONDS));
    db.prepare('INSERT INTO refresh_tokens(id,family_id,digest,expires_at) VALUES (?,?,?,?)').run(refreshId, familyId, hmac(config, refreshSecret), expiry(config.REFRESH_TTL_SECONDS));
    return { accessToken: `st1.${accessId}.${accessSecret}`, refreshToken: `st1.${refreshId}.${refreshSecret}`, accessExpiresAt: expiry(config.ACCESS_TTL_SECONDS) };
  };
  const commitBlockedAttempt = (attemptId: string, profileId: string | null, category: string, providerRequestId?: string) => {
    db.prepare("UPDATE auth_attempts SET state='blocked' WHERE id=?").run(attemptId); db.prepare('UPDATE sign_challenges SET invalidated_at=? WHERE attempt_id=? AND consumed_at IS NULL').run(now(), attemptId);
    db.prepare('INSERT INTO audit_events(id,created_at,category,attempt_id,profile_id) VALUES (?,?,?,?,?)').run(id(), now(), category, attemptId, profileId);
    if (providerRequestId) db.prepare("UPDATE provider_requests SET state='blocked', terminal_reason=? WHERE provider_request_id=?").run(category, providerRequestId);
  };
  const verifyAndComplete = async (attemptId: string, proof: { challengeId: string; protocol: 'eip4361-v1' | 'siws-v1'; signature: string }, providerRequestId?: string): Promise<Completion> => {
    const challenge = db.prepare('SELECT c.*, a.purpose, a.initiating_profile_id, a.initiating_session_family_id, a.family FROM sign_challenges c JOIN auth_attempts a ON a.id=c.attempt_id WHERE c.id=? AND c.attempt_id=?').get(proof.challengeId, attemptId) as Row | undefined;
    if (!challenge) throw new ApiFault('NOT_FOUND', 404, 'This signing challenge was not found.', false, attemptId);
    if (challenge.protocol !== proof.protocol) throw new ApiFault('PROOF_INVALID', 422, 'The wallet proof is not valid.', false, attemptId);
    if (String(challenge.expires_at) < now()) throw new ApiFault('CHALLENGE_EXPIRED', 410, 'This signing challenge has expired.', false, attemptId);
    const message = String(challenge.message_utf8), family = String(challenge.family) as WalletFamily, normalized = String(challenge.address_normalized);
    let verified = false;
    try {
      if (family === 'evm') { const signature = proof.signature.startsWith('0x') || proof.signature.startsWith('0X') ? `0x${proof.signature.slice(2).toLowerCase()}` : proof.signature; verified = /^0x[0-9a-f]{130}$/.test(signature) && (await recoverMessageAddress({ message, signature: signature as `0x${string}` })).toLowerCase() === normalized; }
      else verified = /^[0-9a-f]{128}$/.test(proof.signature) && nacl.sign.detached.verify(new TextEncoder().encode(message), Buffer.from(proof.signature, 'hex'), bs58.decode(normalized));
    } catch { verified = false; }
    if (!verified) throw new ApiFault('PROOF_INVALID', 422, 'The wallet proof is not valid.', false, attemptId);

    db.exec('BEGIN IMMEDIATE');
    try {
      if (String(challenge.purpose) === 'link_wallet') {
        const familyRow = db.prepare('SELECT revoked_at FROM session_families WHERE id=? AND profile_id=?').get(challenge.initiating_session_family_id, challenge.initiating_profile_id) as Row | undefined;
        if (!familyRow || familyRow.revoked_at) { commitBlockedAttempt(attemptId, String(challenge.initiating_profile_id), 'link_session_revoked', providerRequestId); db.exec('COMMIT'); throw new ApiFault('SESSION_INVALID', 401, 'Your session is not valid.', false, attemptId); }
      }
      const consumed = db.prepare('UPDATE sign_challenges SET consumed_at=? WHERE id=? AND attempt_id=? AND consumed_at IS NULL AND invalidated_at IS NULL AND expires_at>=? AND not_before<=?').run(now(), proof.challengeId, attemptId, now(), now());
      if (consumed.changes !== 1) {
        if (providerRequestId) { const terminal = db.prepare("SELECT profile_id FROM provider_requests WHERE provider_request_id=? AND state='complete'").get(providerRequestId) as Row | undefined; if (terminal) { db.exec('COMMIT'); return { profileId: String(terminal.profile_id), alreadyCompleted: true }; } }
        throw new ApiFault('CHALLENGE_REPLAYED', 409, 'This signing challenge has already been used.', false, attemptId);
      }
      const existing = (family === 'evm'
        ? db.prepare("SELECT * FROM wallets WHERE family='evm' AND chain_id=? AND address_normalized=? AND revoked_at IS NULL").get(String(challenge.chain_context), normalized)
        : db.prepare("SELECT * FROM wallets WHERE family='solana' AND cluster=? AND address_normalized=? AND revoked_at IS NULL").get(String(challenge.chain_context), normalized)) as Row | undefined;
      let profileId: string;
      if (String(challenge.purpose) === 'link_wallet') {
        profileId = String(challenge.initiating_profile_id);
        if (existing && existing.profile_id !== profileId) { commitBlockedAttempt(attemptId, profileId, 'wallet_conflict', providerRequestId); db.exec('COMMIT'); throw new ApiFault('WALLET_CONFLICT', 409, 'This wallet cannot be linked to this profile.', false, attemptId); }
        const existingFamily = db.prepare('SELECT id FROM wallets WHERE profile_id=? AND family=? AND revoked_at IS NULL').get(profileId, family) as Row | undefined;
        if (!existing && existingFamily) { commitBlockedAttempt(attemptId, profileId, 'wallet_family_already_linked', providerRequestId); db.exec('COMMIT'); throw new ApiFault('WALLET_CONFLICT', 409, 'This wallet cannot be linked to this profile.', false, attemptId); }
        if (!existing) db.prepare('INSERT INTO wallets(id,profile_id,family,namespace,chain_id,cluster,address_normalized,address_display,verified_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id(), profileId, family, family === 'evm' ? 'eip155' : 'solana', family === 'evm' ? String(challenge.chain_context) : null, family === 'solana' ? String(challenge.chain_context) : null, normalized, String(challenge.address_display), now());
      } else if (existing) profileId = String(existing.profile_id);
      else { profileId = id(); db.prepare('INSERT INTO profiles(id,created_at) VALUES (?,?)').run(profileId, now()); db.prepare('INSERT INTO wallets(id,profile_id,family,namespace,chain_id,cluster,address_normalized,address_display,verified_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id(), profileId, family, family === 'evm' ? 'eip155' : 'solana', family === 'evm' ? String(challenge.chain_context) : null, family === 'solana' ? String(challenge.chain_context) : null, normalized, String(challenge.address_display), now()); }
      db.prepare("UPDATE auth_attempts SET state='complete' WHERE id=?").run(attemptId);
      const tokens = issueSession(profileId);
      if (providerRequestId) db.prepare("UPDATE provider_requests SET state='complete', completed_at=?, profile_id=?, completion_ciphertext=? WHERE provider_request_id=?").run(now(), profileId, sealCompletion({ profileId, ...tokens }), providerRequestId);
      db.exec('COMMIT'); return { profileId, ...tokens };
    } catch (error) { try { db.exec('ROLLBACK'); } catch { /* committed terminal result */ } throw error; }
  };
  const providerFault = (error: unknown): ApiFault => error instanceof ApiFault ? error : new ApiFault('PROVIDER_UNAVAILABLE', 502, 'Warren could not start wallet signing.', true);

  app.get('/v1/health', async () => ({ status: 'ok' }));
  registerHomeRoutes(app, homeService, config.HOME_HTTP_CACHE_SECONDS, config.HOME_HTTP_STALE_SECONDS);
  registerMarketsRoutes(app, marketsService, config.MARKETS_HTTP_CACHE_SECONDS, config.MARKETS_HTTP_STALE_SECONDS);
  registerExecutionRoutes(app, executionService, executionIdentityVerifier, {
    max: Math.min(config.RATE_LIMIT_MAX, 20),
    windowMs: config.RATE_LIMIT_WINDOW_SECONDS * 1000,
  });
  registerPortfolioRoutes(app, portfolioService, executionIdentityVerifier, phoenixRegistrationService);
  registerLendingRoutes(app, kaminoMarketCatalog, lendingService, executionIdentityVerifier);
  app.post('/v1/auth/attempts', async (request, reply) => {
    const body = createAttemptSchema.parse(request.body); let profileId: string | null = null, sessionFamilyId: string | null = null;
    let support; try { support = await provider.getSupport(); } catch (error) { throw providerFault(error); }
    if (body.providerId !== provider.id || !support.families.includes(body.family)) throw new ApiFault('PROVIDER_DISABLED', 503, 'This wallet provider is not configured.', true);
    if (body.purpose === 'link_wallet') { const session = requireAccess(request); profileId = String(session.profile_id); sessionFamilyId = String(session.family_id); }
    let developmentCredential;
    if (config.NODE_ENV !== 'production') { try { developmentCredential = (await provider.listCredentials({ family: body.family }))[0]; } catch (error) { throw providerFault(error); } }
    const attemptId = id(), cap = opaque(), expiresAt = expiry(config.ATTEMPT_TTL_SECONDS);
    db.prepare('INSERT INTO auth_attempts(id,purpose,initiating_profile_id,initiating_session_family_id,family,provider_id,capability_digest,state,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(attemptId, body.purpose, profileId, sessionFamilyId, body.family, body.providerId, hmac(config, cap), 'connecting', expiresAt, now());
    reply.code(201); return { attemptId, attemptCapability: cap, state: 'connecting', expiresAt, supportedContext: body.family === 'evm' ? config.EVM_SUPPORTED_CHAIN_IDS.split(',') : config.SOLANA_SUPPORTED_CLUSTERS.split(','), ...(developmentCredential ? { developmentCredential } : {}) };
  });
  app.get('/v1/auth/attempts/:attemptId/credentials', async (request) => {
    const attemptId = String((request.params as { attemptId: string }).attemptId), attempt = requireAttempt(request, attemptId);
    if (config.NODE_ENV === 'production') throw new ApiFault('PROVIDER_DISABLED', 503, 'Credential discovery is not configured.', true, attemptId);
    try { return { credentials: await provider.listCredentials({ family: String(attempt.family) as WalletFamily }) }; } catch (error) { throw providerFault(error); }
  });
  app.post('/v1/auth/attempts/:attemptId/challenges', async (request) => {
    const attemptId = String((request.params as { attemptId: string }).attemptId), attempt = requireAttempt(request, attemptId), body = challengeRequestSchema.parse(request.body);
    if (!['connecting', 'connected_unverified'].includes(String(attempt.state))) throw new ApiFault('ATTEMPT_STATE_INVALID', 409, 'This onboarding attempt can no longer create a signing challenge.', false, attemptId);
    const family = String(attempt.family) as WalletFamily; const address = canonicalAddress(family, body.address);
    let credential; try { credential = await provider.validateCredential({ credentialRef: body.credentialRef, family, address: address.display }); } catch (error) { throw providerFault(error); }
    if (!credential || credential.family !== family || credential.credentialRef !== body.credentialRef) throw new ApiFault('ADDRESS_MISMATCH', 422, 'The selected wallet credential does not match this challenge.');
    if (credential.network !== body.chainContext) throw new ApiFault('WRONG_NETWORK', 422, 'This wallet network is not supported.');
    contextOk(config, family, credential.network);
    if (canonicalAddress(family, credential.address).normalized !== address.normalized) throw new ApiFault('ADDRESS_MISMATCH', 422, 'The selected wallet credential does not match this challenge.');
    const issuedAt = now(), expiresAt = expiry(config.CHALLENGE_TTL_SECONDS), challengeNonce = nonce(), protocol = family === 'evm' ? 'eip4361-v1' : 'siws-v1';
    const input = { domain: config.AUTH_DOMAIN, uri: config.AUTH_URI, address: address.display, nonce: challengeNonce, issuedAt, expiresAt, requestId: attemptId, chainContext: body.chainContext, statement: 'Sign in to Warren. This is free and will not move funds.' };
    const message = family === 'evm' ? serializeEip4361V1(input) : serializeSiwsV1(input), challengeId = id();
    db.prepare('UPDATE sign_challenges SET invalidated_at=? WHERE attempt_id=? AND consumed_at IS NULL AND invalidated_at IS NULL').run(now(), attemptId);
    db.prepare('INSERT INTO sign_challenges(id,attempt_id,protocol,nonce,message_utf8,message_sha256,address_normalized,address_display,chain_context,issued_at,not_before,expires_at,credential_ref) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(challengeId, attemptId, protocol, challengeNonce, message, sha256(message), address.normalized, address.display, body.chainContext, issuedAt, issuedAt, expiresAt, body.credentialRef);
    db.prepare("UPDATE auth_attempts SET state='connected_unverified' WHERE id=?").run(attemptId);
    return { challengeId, protocol, message, messageUtf8Hex: Buffer.from(message).toString('hex'), sha256: sha256(message), nonce: challengeNonce, issuedAt, expiresAt, credentialRef: body.credentialRef };
  });
  app.post('/v1/auth/attempts/:attemptId/proofs', async (request) => { if (config.NODE_ENV === 'production') throw new ApiFault('PROVIDER_DISABLED', 403, 'Direct wallet proofs are disabled.'); const attemptId = String((request.params as { attemptId: string }).attemptId); requireAttempt(request, attemptId); return verifyAndComplete(attemptId, proofSchema.parse(request.body)); });
  app.post('/v1/auth/attempts/:attemptId/signature-requests', async (request) => {
    const attemptId = String((request.params as { attemptId: string }).attemptId), attempt = requireAttempt(request, attemptId), body = signatureRequestSchema.parse(request.body), keyDigest = hmac(config, idempotencyKey(request));
    db.exec('BEGIN IMMEDIATE'); let requestId: string | undefined;
    try {
      const challenge = db.prepare('SELECT * FROM sign_challenges WHERE id=? AND attempt_id=? AND consumed_at IS NULL AND invalidated_at IS NULL').get(body.challengeId, attemptId) as Row | undefined;
      if (!challenge) throw new ApiFault('NOT_FOUND', 404, 'This signing challenge was not found.', false, attemptId);
      if (String(challenge.expires_at) < now()) throw new ApiFault('CHALLENGE_EXPIRED', 410, 'This signing challenge has expired.', false, attemptId);
      if (challenge.credential_ref !== body.credentialRef) throw new ApiFault('ADDRESS_MISMATCH', 422, 'The selected wallet credential does not match this challenge.', false, attemptId);
      const existing = db.prepare('SELECT * FROM provider_requests WHERE attempt_id=? AND challenge_id=?').get(attemptId, body.challengeId) as Row | undefined;
      if (existing) { db.exec('COMMIT'); if (!safeEqual(String(existing.idempotency_digest), keyDigest)) throw new ApiFault('ATTEMPT_STATE_INVALID', 409, 'A signing request already exists for this challenge.', false, attemptId); return { requestId: String(existing.provider_request_id), state: String(existing.state), pollAfterMs: 250 }; }
      const sameKey = db.prepare('SELECT provider_request_id FROM provider_requests WHERE attempt_id=? AND idempotency_digest=?').get(attemptId, keyDigest) as Row | undefined;
      if (sameKey) { db.exec('COMMIT'); throw new ApiFault('ATTEMPT_STATE_INVALID', 409, 'This idempotency key was already used for another request.', false, attemptId); }
      requestId = id(); db.prepare('INSERT INTO provider_requests(id,attempt_id,challenge_id,provider_request_id,state,created_at,idempotency_digest) VALUES (?,?,?,?,?,?,?)').run(id(), attemptId, body.challengeId, requestId, 'awaiting_signature', now(), keyDigest);
      db.prepare("UPDATE auth_attempts SET state='awaiting_signature' WHERE id=?").run(attemptId); db.exec('COMMIT');
      const started = await provider.requestMessageSignature({ requestId: requestId!, credentialRef: body.credentialRef, family: String(attempt.family) as WalletFamily, network: String(challenge.chain_context), messageUtf8: new TextEncoder().encode(String(challenge.message_utf8)), messageSha256: String(challenge.message_sha256) });
      if (started.id !== requestId) throw new Error('Provider changed the reserved request identifier');
      return { requestId: requestId!, state: started.state, pollAfterMs: started.pollAfterMs };
    } catch (error) { try { db.exec('ROLLBACK'); } catch { /* reservation committed before provider I/O */ } if (error instanceof ApiFault) throw error; if (typeof requestId !== 'undefined') db.prepare("UPDATE provider_requests SET state='failed' WHERE provider_request_id=?").run(requestId); throw providerFault(error); }
  });
  app.get('/v1/auth/attempts/:attemptId/signature-requests/:requestId', async (request) => {
    const { attemptId, requestId } = request.params as { attemptId: string; requestId: string }; requireAttempt(request, attemptId);
    const row = db.prepare('SELECT * FROM provider_requests WHERE attempt_id=? AND provider_request_id=?').get(attemptId, requestId) as Row | undefined;
    if (!row) throw new ApiFault('NOT_FOUND', 404, 'This signing request was not found.');
    if (row.state === 'complete') return { requestId, state: 'complete', ...openCompletion(String(row.completion_ciphertext)), alreadyCompleted: true };
    if (row.state === 'blocked') throw new ApiFault('ATTEMPT_STATE_INVALID', 409, 'This signing request can no longer be completed.', false, attemptId);
    if (row.state === 'failed') throw new ApiFault('PROVIDER_UNAVAILABLE', 502, 'Warren could not start wallet signing.', true, attemptId);
    let result; try { result = await provider.getMessageSignature({ requestId }); } catch (error) { throw providerFault(error); }
    if (result.state !== 'approved' || !result.signature) return { requestId, state: result.state };
    const challenge = db.prepare('SELECT protocol FROM sign_challenges WHERE id=?').get(row.challenge_id) as Row;
    const completion = await verifyAndComplete(attemptId, { challengeId: String(row.challenge_id), protocol: String(challenge.protocol) as 'eip4361-v1' | 'siws-v1', signature: result.signature }, requestId);
    return { requestId, state: 'complete', ...completion };
  });
  app.get('/v1/auth/attempts/:attemptId', async (request) => { const attemptId = String((request.params as { attemptId: string }).attemptId), attempt = requireAttempt(request, attemptId); const challenge = db.prepare('SELECT * FROM sign_challenges WHERE attempt_id=? AND invalidated_at IS NULL ORDER BY issued_at DESC LIMIT 1').get(attemptId) as Row | undefined; const providerRequest = db.prepare('SELECT provider_request_id FROM provider_requests WHERE attempt_id=? ORDER BY created_at DESC LIMIT 1').get(attemptId) as Row | undefined; return { attemptId, state: attempt.state, expiresAt: attempt.expires_at, ...(challenge ? { addressDisplay: `${String(challenge.address_display).slice(0, 6)}…${String(challenge.address_display).slice(-4)}`, chainContext: challenge.chain_context, credentialRef: challenge.credential_ref } : {}), ...(providerRequest ? { providerRequestId: providerRequest.provider_request_id } : {}) }; });
  app.get('/v1/me', async (request) => { const session = requireAccess(request), wallets = db.prepare('SELECT family,address_display,chain_id,cluster,verified_at FROM wallets WHERE profile_id=? AND revoked_at IS NULL').all(session.profile_id) as Row[]; return { profileId: session.profile_id, wallets: wallets.map((wallet) => ({ family: wallet.family, addressDisplay: wallet.address_display, context: wallet.chain_id ?? wallet.cluster, verifiedAt: wallet.verified_at })) }; });
  app.post('/v1/sessions/refresh', async (request) => {
    const body = refreshSchema.parse(request.body), parts = tokenParts(body.refreshToken), keyDigest = hmac(config, idempotencyKey(request)); if (!parts) throw new ApiFault('SESSION_INVALID', 401, 'Your session is not valid.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = db.prepare('SELECT r.*, f.profile_id, f.revoked_at AS family_revoked_at FROM refresh_tokens r JOIN session_families f ON f.id=r.family_id WHERE r.id=?').get(parts.id) as Row | undefined;
      if (!row || row.family_revoked_at || row.revoked_at || String(row.expires_at) < now() || !safeEqual(hmac(config, parts.secret), String(row.digest))) { db.exec('COMMIT'); throw new ApiFault('SESSION_INVALID', 401, 'Your session is not valid.'); }
      if (row.used_at) {
        if (row.used_idempotency_digest && safeEqual(String(row.used_idempotency_digest), keyDigest) && row.completion_ciphertext) { const completion = openCompletion(String(row.completion_ciphertext)); db.exec('COMMIT'); return completion; }
        db.prepare('UPDATE session_families SET revoked_at=?, revoke_reason=? WHERE id=? AND revoked_at IS NULL').run(now(), 'refresh_reuse', row.family_id); db.exec('COMMIT'); throw new ApiFault('SESSION_INVALID', 401, 'Your session is not valid.');
      }
      db.prepare('UPDATE refresh_tokens SET used_at=?, used_idempotency_digest=? WHERE id=?').run(now(), keyDigest, parts.id); const tokens = issueSession(String(row.profile_id), String(row.family_id)); const next = tokenParts(tokens.refreshToken)!; db.prepare('UPDATE refresh_tokens SET replaced_by=?, completion_ciphertext=? WHERE id=?').run(next.id, sealCompletion({ profileId: String(row.profile_id), ...tokens }), parts.id); db.exec('COMMIT'); return tokens;
    } catch (error) { try { db.exec('ROLLBACK'); } catch { /* terminal state committed */ } throw error; }
  });
  app.post('/v1/sessions/revoke', async (request, reply) => { const session = requireAccess(request); db.prepare('UPDATE session_families SET revoked_at=?, revoke_reason=? WHERE id=?').run(now(), 'sign_out', session.family_id); reply.code(204).send(); });
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) { const config = readConfig(); buildApp({ config }).listen({ host: '0.0.0.0', port: config.PORT }).catch((error) => { console.error(error); process.exit(1); }); }
