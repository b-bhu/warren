import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { assetsQuerySchema } from '@warren/home-contract';
import type { HomeService } from './service.js';

export function registerHomeRoutes(app: FastifyInstance, service: HomeService, cacheSeconds: number, staleSeconds: number) {
  app.get('/v1/home', async (request, reply) => {
    const payload = await service.getHome();
    return sendPublicRead(request, reply, payload, cacheSeconds, staleSeconds);
  });

  app.get('/v1/assets', async (request, reply) => {
    const query = assetsQuerySchema.parse(request.query);
    const payload = await service.getAssets(query);
    return sendPublicRead(request, reply, payload, cacheSeconds, staleSeconds);
  });
}

function sendPublicRead(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
  cacheSeconds: number,
  staleSeconds: number,
) {
  const etagPayload = payload && typeof payload === 'object'
    ? { ...(payload as Record<string, unknown>), generatedAt: undefined }
    : payload;
  const etag = `"${createHash('sha256').update(JSON.stringify(etagPayload)).digest('base64url')}"`;
  reply.header('cache-control', `public, max-age=${cacheSeconds}, stale-while-revalidate=${staleSeconds}`);
  reply.header('etag', etag);
  reply.header('vary', 'accept-encoding');
  if (request.headers['if-none-match'] === etag) return reply.code(304).send();
  return reply.send(payload);
}
