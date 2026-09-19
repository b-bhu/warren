import { z } from 'zod';

export const dataStateSchema = z.enum(['sample', 'live', 'delayed', 'stale', 'unavailable']);
export type DataState = z.infer<typeof dataStateSchema>;

const publicHttpUrlSchema = z.string().url().regex(/^https?:\/\//i);

export const marketSessionSchema = z.enum(['open', 'closed', 'pre_market', 'after_hours', 'unavailable']);
export type MarketSession = z.infer<typeof marketSessionSchema>;

export const homeWarningSchema = z.object({
  section: z.enum(['market', 'indices', 'companies', 'prices', 'earnings', 'news']),
  code: z.string().min(1).max(64).regex(/^[A-Z][A-Z0-9_]*$/),
  message: z.string().min(1).max(240),
  retryable: z.boolean(),
  assetIds: z.array(z.string().min(1).max(128)).max(50).optional(),
}).strict();
export type HomeWarning = z.infer<typeof homeWarningSchema>;

export const marketStatusSchema = z.object({
  region: z.literal('US'),
  session: marketSessionSchema,
  label: z.string().min(1).max(80),
  asOf: z.string().datetime().nullable(),
  nextOpenAt: z.string().datetime().nullable().optional(),
  nextCloseAt: z.string().datetime().nullable().optional(),
  dataState: dataStateSchema,
}).strict();
export type MarketStatus = z.infer<typeof marketStatusSchema>;

export const indexSummarySchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  value: z.number().finite().nonnegative().nullable(),
  changePercent: z.number().finite().nullable(),
  period: z.literal('1d'),
  asOf: z.string().datetime().nullable(),
  dataState: dataStateSchema,
}).strict();
export type IndexSummary = z.infer<typeof indexSummarySchema>;

export const companySummarySchema = z.object({
  assetId: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9:_-]*$/),
  companyName: z.string().min(1).max(160),
  ticker: z.string().min(1).max(24),
  logoUrl: publicHttpUrlSchema.nullable(),
  referencePrice: z.number().finite().nonnegative().nullable(),
  currency: z.literal('USD'),
  changePercent: z.number().finite().nullable(),
  changePeriod: z.literal('1d'),
  priceAsOf: z.string().datetime().nullable(),
  priceDataState: dataStateSchema,
  changeAsOf: z.string().datetime().nullable(),
  changeDataState: dataStateSchema,
  earningsAt: z.string().datetime().nullable(),
  instrumentHints: z.array(z.string().min(1).max(64)).max(50),
}).strict().superRefine((value, context) => {
  if (value.referencePrice === null) {
    if (value.priceAsOf !== null || value.priceDataState !== 'unavailable') {
      context.addIssue({ code: 'custom', message: 'Unavailable prices cannot carry freshness metadata', path: ['referencePrice'] });
    }
  } else if (value.priceAsOf === null || value.priceDataState === 'unavailable') {
    context.addIssue({ code: 'custom', message: 'Prices require a timestamp and available data state', path: ['referencePrice'] });
  }

  if (value.changePercent === null) {
    if (value.changeAsOf !== null || value.changeDataState !== 'unavailable') {
      context.addIssue({ code: 'custom', message: 'Unavailable changes cannot carry freshness metadata', path: ['changePercent'] });
    }
  } else if (value.changeAsOf === null || value.changeDataState === 'unavailable') {
    context.addIssue({ code: 'custom', message: 'Changes require a timestamp and available data state', path: ['changePercent'] });
  }
});
export type CompanySummary = z.infer<typeof companySummarySchema>;

export const newsSummarySchema = z.object({
  id: z.string().min(1).max(160),
  headline: z.string().min(1).max(240),
  category: z.string().min(1).max(80),
  source: z.string().min(1).max(120),
  publishedAt: z.string().datetime(),
  summary: z.string().min(1).max(500).nullable(),
  url: publicHttpUrlSchema.nullable(),
  relatedAssetIds: z.array(z.string().min(1).max(128)).max(20),
  dataState: dataStateSchema,
}).strict();
export type NewsSummary = z.infer<typeof newsSummarySchema>;

export const pageInfoSchema = z.object({
  nextCursor: z.string().min(1).max(256).nullable(),
  hasNextPage: z.boolean(),
}).strict();
export type PageInfo = z.infer<typeof pageInfoSchema>;

export const homeResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  market: marketStatusSchema,
  indices: z.array(indexSummarySchema).max(20),
  companies: z.array(companySummarySchema).max(36),
  pageInfo: pageInfoSchema,
  news: z.array(newsSummarySchema).max(20),
  warnings: z.array(homeWarningSchema).max(50),
}).strict();
export type HomeResponse = z.infer<typeof homeResponseSchema>;

const optionalTrimmedQuery = z.preprocess(
  (value) => typeof value === 'string' ? value.trim() || undefined : value,
  z.string().min(1).max(80).optional(),
);

const idsQuery = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}, z.array(z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9:_-]*$/)).max(50).optional())
  .transform((value) => value ? [...new Set(value)] : value);

export const assetsQuerySchema = z.object({
  q: optionalTrimmedQuery,
  view: z.enum(['all', 'earnings']).default('all'),
  ids: idsQuery,
  cursor: z.preprocess(
    (value) => typeof value === 'string' ? value.trim() || undefined : value,
    z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/).optional(),
  ),
  limit: z.coerce.number().int().min(1).max(36).default(24),
}).strict().superRefine((value, context) => {
  if (value.q && value.ids) {
    context.addIssue({ code: 'custom', message: 'q and ids cannot be combined', path: ['ids'] });
  }
  if (value.ids && value.cursor) {
    context.addIssue({ code: 'custom', message: 'ids and cursor cannot be combined', path: ['cursor'] });
  }
});
export type AssetsQuery = z.infer<typeof assetsQuerySchema>;

export const assetsResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  query: z.object({
    q: z.string().nullable(),
    view: z.enum(['all', 'earnings']),
    ids: z.array(z.string()),
  }).strict(),
  items: z.array(companySummarySchema).max(50),
  pageInfo: pageInfoSchema,
  warnings: z.array(homeWarningSchema).max(50),
}).strict();
export type AssetsResponse = z.infer<typeof assetsResponseSchema>;

export const homeApiErrorCodeSchema = z.enum(['INVALID_REQUEST', 'RATE_LIMITED', 'CATALOG_UNAVAILABLE', 'INTERNAL_ERROR']);
export const homeApiErrorSchema = z.object({
  error: z.object({
    code: homeApiErrorCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
    requestId: z.string().min(1),
    details: z.object({ retryAfterSeconds: z.number().int().positive().optional() }).strict().optional(),
  }).strict(),
}).strict();
export type HomeApiError = z.infer<typeof homeApiErrorSchema>;
