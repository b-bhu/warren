import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  lendingActionCreateSchema, lendingActionParamsSchema, lendingSignedStepSchema,
  lendingStepParamsSchema, lendingWalletQuerySchema,
} from '@warren/lending-contract';
import { requirePrivyIdentity } from '../execution/identity.js';
import type { ExecutionIdentityVerifier } from '../execution/types.js';
import { ExecutionServiceFault } from '../execution/service.js';
import { LendingMarketFault, KaminoMarketCatalog } from './market.js';
import { LendingService, LendingServiceFault } from './service.js';

const idempotencyKeySchema = z.string().min(16).max(128).regex(/^[A-Za-z0-9._:-]+$/);

export function registerLendingRoutes(
  app: FastifyInstance,
  catalog: KaminoMarketCatalog,
  service?: LendingService,
  identityVerifier?: ExecutionIdentityVerifier,
) {
  app.get('/v1/lending/kamino/xstocks', async (_request, reply) => {
    reply.header('cache-control', 'public, max-age=5, stale-while-revalidate=5');
    try { return await catalog.load(); }
    catch (error) {
      if (error instanceof LendingMarketFault) {
        reply.code(error.status);
        return { error: { code: 'LENDING_MARKET_UNAVAILABLE', message: error.message, retryable: error.retryable } };
      }
      throw error;
    }
  });

  const requireService = () => {
    if (!service || !identityVerifier) throw new LendingServiceFault('LENDING_PROVIDER_UNAVAILABLE', 503, 'Private lending actions are not configured.', true);
    return { service, identityVerifier };
  };
  app.get('/v1/lending/kamino/xstocks/positions', async (request) => {
    const deps = requireService();
    const identity = await requirePrivyIdentity(request, deps.identityVerifier, 'Sign in to view lending positions.');
    const query = lendingWalletQuerySchema.parse(request.query);
    return deps.service.wallet(identity, query.walletAddress);
  });
  app.get('/v1/lending/kamino/xstocks/actions', async (request) => {
    const deps = requireService();
    const identity = await requirePrivyIdentity(request, deps.identityVerifier, 'Sign in to view lending activity.');
    const query = lendingWalletQuerySchema.parse(request.query);
    return deps.service.history(identity, query.walletAddress);
  });
  app.post('/v1/lending/kamino/xstocks/preview', async (request) => {
    const deps = requireService();
    const identity = await requirePrivyIdentity(request, deps.identityVerifier, 'Sign in to preview a lending action.');
    return deps.service.preview(identity, lendingActionCreateSchema.parse(request.body));
  });
  app.post('/v1/lending/kamino/xstocks/actions', async (request, reply) => {
    const deps = requireService();
    const identity = await requirePrivyIdentity(request, deps.identityVerifier, 'Sign in to review a lending action.');
    const result = await deps.service.create(identity, lendingActionCreateSchema.parse(request.body), idempotencyKeySchema.parse(request.headers['idempotency-key']));
    reply.code(201);
    return result;
  });
  app.get('/v1/lending/kamino/xstocks/actions/:actionId', async (request) => {
    const deps = requireService();
    const identity = await requirePrivyIdentity(request, deps.identityVerifier, 'Sign in to view this lending action.');
    const { actionId } = lendingActionParamsSchema.parse(request.params);
    return deps.service.status(identity, actionId);
  });
  app.post('/v1/lending/kamino/xstocks/actions/:actionId/next-step', async (request) => {
    const deps = requireService();
    const identity = await requirePrivyIdentity(request, deps.identityVerifier, 'Sign in to continue this lending action.');
    const { actionId } = lendingActionParamsSchema.parse(request.params);
    return deps.service.nextStep(identity, actionId);
  });
  app.post('/v1/lending/kamino/xstocks/actions/:actionId/steps/:stepId/refresh', async (request) => {
    const deps = requireService();
    const identity = await requirePrivyIdentity(request, deps.identityVerifier, 'Sign in to refresh this lending review.');
    const { actionId, stepId } = lendingStepParamsSchema.parse(request.params);
    return deps.service.refreshStep(identity, actionId, stepId);
  });
  app.post('/v1/lending/kamino/xstocks/actions/:actionId/steps/:stepId/submit', async (request) => {
    const deps = requireService();
    const identity = await requirePrivyIdentity(request, deps.identityVerifier, 'Sign in to submit this lending transaction.');
    const { actionId, stepId } = lendingStepParamsSchema.parse(request.params);
    const { signedTransaction } = lendingSignedStepSchema.parse(request.body);
    return deps.service.submit(identity, actionId, stepId, signedTransaction, idempotencyKeySchema.parse(request.headers['idempotency-key']));
  });
}
