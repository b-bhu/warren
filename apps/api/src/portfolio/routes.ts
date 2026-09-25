import type { FastifyInstance } from 'fastify';
import { PublicKey } from '@solana/web3.js';
import {
  phoenixRegistrationCreateSchema,
  phoenixRegistrationParamsSchema,
  phoenixRegistrationSubmitSchema,
  portfolioActivityQuerySchema,
  portfolioWalletQuerySchema,
} from '@warren/portfolio-contract';
import { z } from 'zod';

import { requirePrivyIdentity } from '../execution/identity.js';
import type { ExecutionIdentityVerifier } from '../execution/types.js';
import type { ExecutionIdentity } from '../execution/types.js';
import { PortfolioServiceFault, type PortfolioService } from './service.js';
import type { PhoenixRegistrationService } from './registration-service.js';

const idempotencyKeySchema = z.string().min(16).max(128).regex(/^[A-Za-z0-9._:-]+$/);

export function registerPortfolioRoutes(
  app: FastifyInstance,
  service: PortfolioService,
  identityVerifier: ExecutionIdentityVerifier,
  registrationService?: PhoenixRegistrationService,
) {
  app.get('/v1/portfolio/overview', async (request) => {
    const verified = await requirePrivyIdentity(request, identityVerifier, 'Sign in to view your Portfolio.');
    const identity = scopeWallet(verified, portfolioWalletQuerySchema.parse(request.query).walletAddress);
    return service.getOverview(identity);
  });

  app.get('/v1/portfolio/positions', async (request) => {
    const verified = await requirePrivyIdentity(request, identityVerifier, 'Sign in to view your positions.');
    const identity = scopeWallet(verified, portfolioWalletQuerySchema.parse(request.query).walletAddress);
    return service.getPositions(identity);
  });

  app.get('/v1/portfolio/activity', async (request) => {
    const verified = await requirePrivyIdentity(request, identityVerifier, 'Sign in to view your activity.');
    const query = portfolioActivityQuerySchema.parse(request.query);
    const identity = scopeWallet(verified, query.walletAddress);
    return service.getActivity(identity, query);
  });

  app.post('/v1/portfolio/phoenix/registrations', async (request, reply) => {
    if (!registrationService) throw new PortfolioServiceFault('REGISTRATION_PROVIDER_UNAVAILABLE', 503, 'Phoenix registration is not configured.', true);
    const verified = await requirePrivyIdentity(request, identityVerifier, 'Sign in to create a Phoenix account.');
    const body = phoenixRegistrationCreateSchema.parse(request.body);
    const identity = scopeWallet(verified, body.walletAddress);
    const review = await registrationService.createReview(identity, body.walletAddress);
    reply.code(201);
    return review;
  });

  app.post('/v1/portfolio/phoenix/registrations/:registrationId/submit', async (request) => {
    if (!registrationService) throw new PortfolioServiceFault('REGISTRATION_PROVIDER_UNAVAILABLE', 503, 'Phoenix registration is not configured.', true);
    const identity = await requirePrivyIdentity(request, identityVerifier, 'Sign in to create a Phoenix account.');
    const { registrationId } = phoenixRegistrationParamsSchema.parse(request.params);
    const { signedTransaction } = phoenixRegistrationSubmitSchema.parse(request.body);
    return registrationService.submit(identity, registrationId, signedTransaction, idempotencyKeySchema.parse(request.headers['idempotency-key']));
  });

  app.get('/v1/portfolio/phoenix/registrations/:registrationId', async (request) => {
    if (!registrationService) throw new PortfolioServiceFault('REGISTRATION_PROVIDER_UNAVAILABLE', 503, 'Phoenix registration is not configured.', true);
    const identity = await requirePrivyIdentity(request, identityVerifier, 'Sign in to check Phoenix account creation.');
    const { registrationId } = phoenixRegistrationParamsSchema.parse(request.params);
    return registrationService.status(identity, registrationId);
  });
}

function scopeWallet(identity: ExecutionIdentity, requested: string | undefined): ExecutionIdentity {
  if (!requested) return identity;
  let canonical: string;
  try { canonical = new PublicKey(requested).toBase58(); }
  catch { throw new PortfolioServiceFault('WALLET_MISMATCH', 403, 'This wallet does not belong to the signed-in account.'); }
  const owned = identity.walletAddresses.some((address) => {
    try { return new PublicKey(address).toBase58() === canonical; }
    catch { return false; }
  });
  if (!owned) throw new PortfolioServiceFault('WALLET_MISMATCH', 403, 'This wallet does not belong to the signed-in account.');
  return { ...identity, walletAddresses: [canonical] };
}
