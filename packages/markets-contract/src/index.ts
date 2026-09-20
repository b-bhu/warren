import { z } from 'zod';

export const marketProductSchema = z.enum(['spot', 'prestock', 'perpetual']);
export type MarketProduct = z.infer<typeof marketProductSchema>;

export const marketAvailabilitySchema = z.enum(['available', 'preview', 'paused', 'unavailable']);
export type MarketAvailability = z.infer<typeof marketAvailabilitySchema>;

export const marketDataStateSchema = z.enum(['sample', 'live', 'delayed', 'stale', 'unavailable']);
export type MarketDataState = z.infer<typeof marketDataStateSchema>;

export const marketVerificationSchema = z.enum(['verified', 'unverified']);
export type MarketVerification = z.infer<typeof marketVerificationSchema>;

export const marketSortSchema = z.enum(['activity', 'alphabetical', 'change']);
export type MarketSort = z.infer<typeof marketSortSchema>;

const identifierSchema = z.string().min(1).max(160).regex(/^[a-zA-Z0-9:_-]+$/);
const assetIdSchema = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9:_-]*$/);
const publicHttpUrlSchema = z.string().url().regex(/^https?:\/\//i);

export const marketValueSchema = z.object({
  label: z.string().min(1).max(48),
  amount: z.number().finite().nonnegative().nullable(),
  currency: z.literal('USD'),
  asOf: z.string().datetime().nullable(),
  dataState: marketDataStateSchema,
}).strict().superRefine((value, context) => {
  if (value.amount === null && value.dataState !== 'unavailable') {
    context.addIssue({ code: 'custom', message: 'A missing value must be unavailable', path: ['dataState'] });
  }
  if (value.dataState !== 'unavailable' && value.asOf === null) {
    context.addIssue({ code: 'custom', message: 'Available data requires a source timestamp', path: ['asOf'] });
  }
});
export type MarketValue = z.infer<typeof marketValueSchema>;

const nullableMetricSchema = z.object({
  value: z.number().finite().nullable(),
  asOf: z.string().datetime().nullable(),
  dataState: marketDataStateSchema,
}).strict().superRefine((metric, context) => {
  if (metric.value === null && metric.dataState !== 'unavailable') {
    context.addIssue({ code: 'custom', message: 'A missing metric must be unavailable', path: ['dataState'] });
  }
  if (metric.dataState !== 'unavailable' && metric.asOf === null) {
    context.addIssue({ code: 'custom', message: 'Available metrics require a source timestamp', path: ['asOf'] });
  }
});

const instrumentBaseShape = {
  instrumentId: identifierSchema,
  assetId: assetIdSchema,
  companyName: z.string().min(1).max(160),
  ticker: z.string().min(1).max(24).nullable(),
  logoUrl: publicHttpUrlSchema.nullable(),
  symbol: z.string().min(1).max(64),
  provider: z.string().min(1).max(80),
  providerUrl: publicHttpUrlSchema.nullable(),
  exactIdentifier: z.string().min(1).max(160),
  verificationState: marketVerificationSchema,
  availability: marketAvailabilitySchema,
  description: z.string().min(1).max(1_000).nullable(),
  marketValue: marketValueSchema,
};

export const spotInstrumentSchema = z.object({
  ...instrumentBaseShape,
  productType: z.literal('spot'),
  network: z.literal('Solana'),
  issuer: z.string().min(1).max(80),
  mint: z.string().min(32).max(64),
  stockVariantTier: z.enum(['share_redeemable', 'cash_redeemable', 'not_redeemable', 'unknown']),
  changePercent: nullableMetricSchema,
  volume24hUsd: nullableMetricSchema,
  liquidityUsd: z.number().finite().nonnegative().nullable(),
}).strict();
export type SpotInstrument = z.infer<typeof spotInstrumentSchema>;

export const prestockInstrumentSchema = z.object({
  ...instrumentBaseShape,
  productType: z.literal('prestock'),
  network: z.literal('Solana'),
  mint: z.string().min(32).max(64),
  exposureType: z.enum(['spv_exposure', 'loan_participation']),
  structureLabel: z.string().min(1).max(160),
  markPrice: z.number().finite().nonnegative().nullable(),
  tokenPrice: z.number().finite().nonnegative().nullable(),
  impliedValuation: z.number().finite().nonnegative().nullable(),
  markValuation: z.number().finite().nonnegative().nullable(),
  supply: z.number().finite().nonnegative().nullable(),
  transferFeeBps: z.number().int().min(0).max(10_000).nullable(),
  detailsUrl: publicHttpUrlSchema.nullable(),
}).strict();
export type PrestockInstrument = z.infer<typeof prestockInstrumentSchema>;

export const perpetualInstrumentSchema = z.object({
  ...instrumentBaseShape,
  productType: z.literal('perpetual'),
  venue: z.literal('Phoenix'),
  marketPubkey: z.string().min(32).max(64),
  marginMode: z.enum(['cross', 'isolated']),
  maxLeverage: z.number().finite().positive(),
  fundingRatePercent: nullableMetricSchema,
  nextFundingAt: z.string().datetime().nullable(),
  openInterestBase: z.number().finite().nonnegative().nullable(),
  oracleLabel: z.string().min(1).max(80),
}).strict();
export type PerpetualInstrument = z.infer<typeof perpetualInstrumentSchema>;

export const marketInstrumentSchema = z.discriminatedUnion('productType', [
  spotInstrumentSchema,
  prestockInstrumentSchema,
  perpetualInstrumentSchema,
]);
export type MarketInstrument = z.infer<typeof marketInstrumentSchema>;

export const marketCountsSchema = z.object({
  spot: z.number().int().nonnegative(),
  prestock: z.number().int().nonnegative(),
  perpetual: z.number().int().nonnegative(),
}).strict();
export type MarketCounts = z.infer<typeof marketCountsSchema>;

export const marketsWarningSchema = z.object({
  provider: z.string().min(1).max(80),
  product: marketProductSchema.nullable(),
  code: z.string().min(1).max(64).regex(/^[A-Z][A-Z0-9_]*$/),
  message: z.string().min(1).max(240),
  retryable: z.boolean(),
}).strict();
export type MarketsWarning = z.infer<typeof marketsWarningSchema>;

const optionalCursorSchema = z.preprocess(
  (value) => typeof value === 'string' ? value.trim() || undefined : value,
  z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/).optional(),
);

export const marketsQuerySchema = z.object({
  product: marketProductSchema.default('spot'),
  availability: z.enum(['all', 'available']).default('all'),
  sort: marketSortSchema.optional(),
  cursor: optionalCursorSchema,
  limit: z.coerce.number().int().min(1).max(50).default(24),
}).strict().superRefine((query, context) => {
  if (query.product === 'prestock' && query.sort && query.sort !== 'alphabetical') {
    context.addIssue({ code: 'custom', message: 'PreStocks support alphabetical sorting only', path: ['sort'] });
  }
  if (query.product === 'perpetual' && query.sort === 'change') {
    context.addIssue({ code: 'custom', message: 'Perpetuals do not support change sorting', path: ['sort'] });
  }
});
export type MarketsQuery = z.infer<typeof marketsQuerySchema>;

export const marketsResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  query: z.object({
    product: marketProductSchema,
    availability: z.enum(['all', 'available']),
    sort: marketSortSchema,
  }).strict(),
  counts: marketCountsSchema,
  items: z.array(marketInstrumentSchema).max(50),
  pageInfo: z.object({
    nextCursor: z.string().min(1).max(256).nullable(),
    hasNextPage: z.boolean(),
  }).strict(),
  warnings: z.array(marketsWarningSchema).max(20),
}).strict();
export type MarketsResponse = z.infer<typeof marketsResponseSchema>;

export const marketSearchQuerySchema = z.object({
  q: z.preprocess(
    (value) => typeof value === 'string' ? value.trim() : value,
    z.string().min(1).max(80),
  ),
  limit: z.coerce.number().int().min(1).max(20).default(12),
}).strict();
export type MarketSearchQuery = z.infer<typeof marketSearchQuerySchema>;

export const marketCapabilitySchema = z.object({
  productType: marketProductSchema,
  instrumentCount: z.number().int().positive(),
  availability: marketAvailabilitySchema,
}).strict();
export type MarketCapability = z.infer<typeof marketCapabilitySchema>;

export const marketCompanySummarySchema = z.object({
  assetId: assetIdSchema,
  companyName: z.string().min(1).max(160),
  ticker: z.string().min(1).max(24).nullable(),
  logoUrl: publicHttpUrlSchema.nullable(),
  capabilities: z.array(marketCapabilitySchema).min(1).max(3),
}).strict();
export type MarketCompanySummary = z.infer<typeof marketCompanySummarySchema>;

export const marketSearchResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  query: z.string().min(1).max(80),
  items: z.array(marketCompanySummarySchema).max(20),
  warnings: z.array(marketsWarningSchema).max(20),
}).strict();
export type MarketSearchResponse = z.infer<typeof marketSearchResponseSchema>;

export const marketCompanyParamsSchema = z.object({ assetId: assetIdSchema }).strict();

export const marketCompanyResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  company: z.object({
    assetId: assetIdSchema,
    companyName: z.string().min(1).max(160),
    ticker: z.string().min(1).max(24).nullable(),
    logoUrl: publicHttpUrlSchema.nullable(),
  }).strict(),
  availableNow: z.number().int().nonnegative(),
  instruments: z.array(marketInstrumentSchema).min(1).max(50),
  warnings: z.array(marketsWarningSchema).max(20),
}).strict();
export type MarketCompanyResponse = z.infer<typeof marketCompanyResponseSchema>;

export const marketsApiErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'NOT_FOUND',
  'RATE_LIMITED',
  'REGISTRY_UNAVAILABLE',
  'INTERNAL_ERROR',
]);
export const marketsApiErrorSchema = z.object({
  error: z.object({
    code: marketsApiErrorCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
    requestId: z.string().min(1),
    details: z.object({ retryAfterSeconds: z.number().int().positive().optional() }).strict().optional(),
  }).strict(),
}).strict();
export type MarketsApiError = z.infer<typeof marketsApiErrorSchema>;
