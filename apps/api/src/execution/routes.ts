import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  executionParamsSchema,
  orderSubmitSchema,
  perpetualOrderCreateSchema,
  spotAssetSearchQuerySchema,
  spotOrderCreateSchema,
} from '@warren/execution-contract';
import { z } from 'zod';

import { ExecutionServiceFault } from './service.js';
import { requirePrivyIdentity } from './identity.js';
import type { ExecutionIdentity, ExecutionIdentityVerifier, ExecutionServiceContract } from './types.js';

const idempotencyKeySchema = z.string().min(16).max(128).regex(/^[A-Za-z0-9._:-]+$/);

export function registerExecutionRoutes(
  app: FastifyInstance,
  service: ExecutionServiceContract,
  identityVerifier: ExecutionIdentityVerifier,
  limits: { max: number; windowMs: number } = { max: 20, windowMs: 60_000 },
) {
  const identityBuckets = new Map<string, { count: number; resetAt: number }>();
  const guardIdentity = (identity: ExecutionIdentity) => {
    const at = Date.now();
    for (const [key, bucket] of identityBuckets) if (bucket.resetAt <= at) identityBuckets.delete(key);
    const prior = identityBuckets.get(identity.userId);
    const bucket = !prior || prior.resetAt <= at ? { count: 0, resetAt: at + limits.windowMs } : prior;
    bucket.count += 1;
    identityBuckets.set(identity.userId, bucket);
    if (bucket.count > limits.max) throw new ExecutionServiceFault('RATE_LIMITED', 429, 'Too many execution requests. Try again shortly.', true);
  };

  app.get('/v1/execution/spot/assets', async (request) => {
    const query = spotAssetSearchQuerySchema.parse(request.query);
    return service.searchSpotAssets(query.query);
  });

  app.post('/v1/execution/spot/orders', async (request, reply) => {
    const identity = await requirePrivyIdentity(request, identityVerifier, 'Sign in before creating an executable order.');
    guardIdentity(identity);
    const review = await service.createSpotOrder(identity, spotOrderCreateSchema.parse(request.body));
    reply.code(201);
    return review;
  });

  app.post('/v1/execution/spot/orders/:executionId/submit', async (request) => {
    const identity = await requirePrivyIdentity(request, identityVerifier, 'Sign in before creating an executable order.');
    guardIdentity(identity);
    const { executionId } = executionParamsSchema.parse(request.params);
    const body = orderSubmitSchema.parse(request.body);
    return service.submitSpotOrder(identity, executionId, body.signedTransaction, idempotencyKey(request));
  });

  app.post('/v1/execution/perpetual/orders', async (request, reply) => {
    const identity = await requirePrivyIdentity(request, identityVerifier, 'Sign in before creating an executable order.');
    guardIdentity(identity);
    const result = await service.createPerpetualOrder(identity, perpetualOrderCreateSchema.parse(request.body));
    if (result.state === 'review') reply.code(201);
    return result;
  });

  app.post('/v1/execution/perpetual/orders/:executionId/submit', async (request) => {
    const identity = await requirePrivyIdentity(request, identityVerifier, 'Sign in before creating an executable order.');
    guardIdentity(identity);
    const { executionId } = executionParamsSchema.parse(request.params);
    const body = orderSubmitSchema.parse(request.body);
    return service.submitPerpetualOrder(identity, executionId, body.signedTransaction, idempotencyKey(request));
  });
}

function idempotencyKey(request: FastifyRequest) {
  return idempotencyKeySchema.parse(request.headers['idempotency-key']);
}
