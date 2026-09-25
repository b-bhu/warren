import type { FastifyRequest } from 'fastify';

import { ProviderResponseError } from './sources.js';
import { ExecutionServiceFault } from './service.js';
import type { ExecutionIdentity, ExecutionIdentityVerifier } from './types.js';

export async function requirePrivyIdentity(
  request: FastifyRequest,
  verifier: ExecutionIdentityVerifier,
  authRequiredMessage = 'Sign in to continue.',
): Promise<ExecutionIdentity> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ') || authorization.length <= 7) {
    throw new ExecutionServiceFault('AUTH_REQUIRED', 401, authRequiredMessage);
  }
  const rawToken = authorization.slice(7);
  try {
    const verified = await verifier.verify(rawToken);
    return { ...verified, rawToken };
  } catch (error) {
    if (error instanceof ProviderResponseError && error.status === 503) {
      throw new ExecutionServiceFault('PROVIDER_UNAVAILABLE', 503, 'Sign-in could not be verified. Try again shortly.', true);
    }
    throw new ExecutionServiceFault('SESSION_INVALID', 401, 'Your sign-in session is no longer valid.');
  }
}
