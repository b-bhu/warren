import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  marketCompanyParamsSchema,
  marketHistoryQuerySchema,
  marketSearchQuerySchema,
  marketsQuerySchema,
} from '@warren/markets-contract';
import type { MarketsService } from './service.js';

export function registerMarketsRoutes(
  app: FastifyInstance,
  service: MarketsService,
  cacheSeconds: number,
  staleSeconds: number,
) {
  app.get('/v1/markets', async (request, reply) => {
    const query = marketsQuerySchema.parse(request.query);
    const payload = await service.getMarkets(query);
    return sendPublicRead(request, reply, payload, cacheSeconds, staleSeconds);
  });

  app.get('/v1/markets/search', async (request, reply) => {
    const query = marketSearchQuerySchema.parse(request.query);
    const payload = await service.search(query);
    return sendPublicRead(request, reply, payload, cacheSeconds, staleSeconds);
  });

  app.get('/v1/markets/companies/:assetId', async (request, reply) => {
    const { assetId } = marketCompanyParamsSchema.parse(request.params);
    const payload = await service.getCompany(assetId);
    return sendPublicRead(request, reply, payload, cacheSeconds, staleSeconds);
  });

  app.get('/v1/markets/companies/:assetId/history', async (request, reply) => {
    const { assetId } = marketCompanyParamsSchema.parse(request.params);
    const query = marketHistoryQuerySchema.parse(request.query);
    const payload = await service.getCompanyHistory(assetId, query);
    return sendPublicRead(request, reply, payload, cacheSeconds, staleSeconds);
  });

  app.get('/v1/markets/companies/:assetId/news', async (request, reply) => {
    const { assetId } = marketCompanyParamsSchema.parse(request.params);
    const payload = await service.getCompanyNews(assetId);
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
