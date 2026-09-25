import { z } from 'zod';

export const marketProductSchema = z.enum(['spot', 'prestock', 'perpetual']);
export type MarketProduct = z.infer<typeof marketProductSchema>;

export const marketAvailabilitySchema = z.enum(['available', 'preview', 'paused', 'unavailable']);
export type MarketAvailability = z.infer<typeof marketAvailabilitySchema>;

export const marketDataStateSchema = z.enum(['sample', 'live', 'delayed', 'stale', 'unavailable']);
export type MarketDataState = z.infer<typeof marketDataStateSchema>;

export const marketHistoryRangeSchema = z.enum(['1d', '1w', '1m', '3m', '6m', '1y', '5y']);
export type MarketHistoryRange = z.infer<typeof marketHistoryRangeSchema>;

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
  section: z.enum(['registry', 'company', 'history', 'news']),
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

export const marketCompanyDescriptionSchema = z.object({
  text: z.string().min(1).max(1_000),
  source: z.string().min(1).max(80),
  sourceUrl: publicHttpUrlSchema.nullable(),
}).strict();
export type MarketCompanyDescription = z.infer<typeof marketCompanyDescriptionSchema>;

export const marketHeroSchema = z.object({
  instrumentId: identifierSchema,
  productType: marketProductSchema,
  provider: z.string().min(1).max(80),
  value: marketValueSchema,
}).strict();
export type MarketHero = z.infer<typeof marketHeroSchema>;

export const marketHistoryCapabilitySchema = z.object({
  instrumentId: identifierSchema,
  valueLabel: z.string().min(1).max(48),
  currency: z.literal('USD'),
  source: z.string().min(1).max(80),
  supportedRanges: z.array(marketHistoryRangeSchema).min(1).max(10),
  defaultRange: marketHistoryRangeSchema,
}).strict().superRefine((capability, context) => {
  if (!capability.supportedRanges.includes(capability.defaultRange)) {
    context.addIssue({ code: 'custom', message: 'The default range must be supported', path: ['defaultRange'] });
  }
});
export type MarketHistoryCapability = z.infer<typeof marketHistoryCapabilitySchema>;

export const marketCompanyResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  company: z.object({
    assetId: assetIdSchema,
    companyName: z.string().min(1).max(160),
    ticker: z.string().min(1).max(24).nullable(),
    logoUrl: publicHttpUrlSchema.nullable(),
    description: marketCompanyDescriptionSchema.nullable(),
  }).strict(),
  primaryInstrumentId: identifierSchema.nullable(),
  hero: marketHeroSchema.nullable(),
  history: marketHistoryCapabilitySchema.nullable(),
  availableNow: z.number().int().nonnegative(),
  instruments: z.array(marketInstrumentSchema).min(1).max(50),
  warnings: z.array(marketsWarningSchema).max(20),
}).strict().superRefine((response, context) => {
  const primary = response.primaryInstrumentId
    ? response.instruments.find((instrument) => instrument.instrumentId === response.primaryInstrumentId)
    : undefined;
  const availableNow = response.instruments.filter((instrument) => instrument.availability === 'available').length;

  if (response.instruments.some((instrument) => instrument.assetId !== response.company.assetId)) {
    context.addIssue({ code: 'custom', message: 'Every instrument must belong to the company', path: ['instruments'] });
  }
  if (response.availableNow !== availableNow) {
    context.addIssue({ code: 'custom', message: 'Available count must match the instruments', path: ['availableNow'] });
  }
  if (response.primaryInstrumentId && !primary) {
    context.addIssue({ code: 'custom', message: 'Primary instrument must be present in instruments', path: ['primaryInstrumentId'] });
  }
  if (!response.primaryInstrumentId && response.hero) {
    context.addIssue({ code: 'custom', message: 'A hero requires a primary instrument', path: ['hero'] });
  }
  if (primary && !response.hero) {
    context.addIssue({ code: 'custom', message: 'A primary instrument requires a hero', path: ['hero'] });
  }
  if (primary && response.hero) {
    const valueMatches = response.hero.value.label === primary.marketValue.label
      && response.hero.value.amount === primary.marketValue.amount
      && response.hero.value.currency === primary.marketValue.currency
      && response.hero.value.asOf === primary.marketValue.asOf
      && response.hero.value.dataState === primary.marketValue.dataState;
    if (
      response.hero.instrumentId !== primary.instrumentId
      || response.hero.productType !== primary.productType
      || response.hero.provider !== primary.provider
      || !valueMatches
    ) {
      context.addIssue({ code: 'custom', message: 'Hero must preserve the exact primary instrument value', path: ['hero'] });
    }
  }
  if (response.history && (
    !primary
    || response.history.instrumentId !== primary.instrumentId
    || response.history.valueLabel !== primary.marketValue.label
    || response.history.currency !== primary.marketValue.currency
  )) {
    context.addIssue({ code: 'custom', message: 'History capability must match the primary instrument value', path: ['history'] });
  }
});
export type MarketCompanyResponse = z.infer<typeof marketCompanyResponseSchema>;

export const marketHistoryQuerySchema = z.object({
  instrumentId: identifierSchema,
  range: marketHistoryRangeSchema.default('1m'),
}).strict();
export type MarketHistoryQuery = z.infer<typeof marketHistoryQuerySchema>;

export const marketHistoryPointSchema = z.object({
  time: z.string().datetime(),
  open: z.number().finite().nonnegative(),
  high: z.number().finite().nonnegative(),
  low: z.number().finite().nonnegative(),
  close: z.number().finite().nonnegative(),
  volume: z.number().finite().nonnegative().nullable(),
}).strict().superRefine((point, context) => {
  if (point.high < Math.max(point.open, point.close, point.low)) {
    context.addIssue({ code: 'custom', message: 'High must contain the candle values', path: ['high'] });
  }
  if (point.low > Math.min(point.open, point.close, point.high)) {
    context.addIssue({ code: 'custom', message: 'Low must contain the candle values', path: ['low'] });
  }
});
export type MarketHistoryPoint = z.infer<typeof marketHistoryPointSchema>;

export const marketHistoryResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  assetId: assetIdSchema,
  instrumentId: identifierSchema,
  range: marketHistoryRangeSchema,
  interval: z.enum(['5m', '1H', '4H', '1D', '1W']).nullable(),
  valueLabel: z.string().min(1).max(48),
  currency: z.literal('USD'),
  provider: z.string().min(1).max(80).nullable(),
  asOf: z.string().datetime().nullable(),
  dataState: marketDataStateSchema,
  points: z.array(marketHistoryPointSchema).max(2_000),
  warnings: z.array(marketsWarningSchema).max(20),
}).strict().superRefine((history, context) => {
  if (history.points.length === 0 && history.dataState !== 'unavailable') {
    context.addIssue({ code: 'custom', message: 'Empty history must be unavailable', path: ['dataState'] });
  }
  if (history.points.length > 0 && (history.interval === null || history.provider === null || history.asOf === null || history.dataState === 'unavailable')) {
    context.addIssue({ code: 'custom', message: 'Available history requires interval, provider, timestamp, and data state', path: ['points'] });
  }
});
export type MarketHistoryResponse = z.infer<typeof marketHistoryResponseSchema>;

export const marketCompanyNewsItemSchema = z.object({
  id: z.string().min(1).max(160),
  assetId: assetIdSchema,
  headline: z.string().min(1).max(240),
  source: z.string().min(1).max(120),
  publishedAt: z.string().datetime(),
  imageUrl: publicHttpUrlSchema.nullable(),
  summary: z.string().min(1).max(500).nullable(),
  url: publicHttpUrlSchema,
  dataState: marketDataStateSchema,
}).strict();
export type MarketCompanyNewsItem = z.infer<typeof marketCompanyNewsItemSchema>;

export const marketCompanyNewsResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  assetId: assetIdSchema,
  items: z.array(marketCompanyNewsItemSchema).max(20),
  warnings: z.array(marketsWarningSchema).max(20),
}).strict();
export type MarketCompanyNewsResponse = z.infer<typeof marketCompanyNewsResponseSchema>;

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
