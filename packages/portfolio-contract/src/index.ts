import { z } from 'zod';

const identifierSchema = z.string().min(1).max(220).regex(/^[a-zA-Z0-9:._-]+$/);
const assetIdSchema = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9:_-]*$/);
const solanaAddressSchema = z.string().min(32).max(44).regex(/^[1-9A-HJ-NP-Za-km-z]+$/);
const publicHttpUrlSchema = z.string().url().regex(/^https?:\/\//i);
const nullablePublicHttpUrlSchema = publicHttpUrlSchema.nullable();

export const portfolioDataStateSchema = z.enum(['live', 'delayed', 'stale', 'unavailable']);
export type PortfolioDataState = z.infer<typeof portfolioDataStateSchema>;

export const portfolioMoneySchema = z.object({
  amount: z.number().finite().nullable(),
  currency: z.literal('USD'),
  asOf: z.string().datetime().nullable(),
  dataState: portfolioDataStateSchema,
}).strict().superRefine((value, context) => {
  if (value.amount === null && value.dataState !== 'unavailable') {
    context.addIssue({ code: 'custom', message: 'Missing money must be unavailable', path: ['dataState'] });
  }
  if (value.amount !== null && value.asOf === null) {
    context.addIssue({ code: 'custom', message: 'Available money requires a timestamp', path: ['asOf'] });
  }
});
export type PortfolioMoney = z.infer<typeof portfolioMoneySchema>;

export const portfolioMetricSchema = z.object({
  value: z.number().finite().nullable(),
  asOf: z.string().datetime().nullable(),
  dataState: portfolioDataStateSchema,
}).strict();
export type PortfolioMetric = z.infer<typeof portfolioMetricSchema>;

export const portfolioWarningSchema = z.object({
  section: z.enum(['wallet', 'valuation', 'perpetuals', 'activity', 'executions']),
  code: z.string().min(1).max(64).regex(/^[A-Z][A-Z0-9_]*$/),
  message: z.string().min(1).max(240),
  retryable: z.boolean(),
}).strict();
export type PortfolioWarning = z.infer<typeof portfolioWarningSchema>;

export const portfolioSupportedAssetStateSchema = z.enum([
  'funded',
  'empty',
  'unsupported_only',
  'unavailable',
  'not_loaded',
]);
export type PortfolioSupportedAssetState = z.infer<typeof portfolioSupportedAssetStateSchema>;

export const portfolioWalletSchema = z.object({
  address: solanaAddressSchema,
  displayAddress: z.string().min(7).max(20),
  network: z.literal('Solana'),
  supportedAssetState: portfolioSupportedAssetStateSchema,
}).strict();
export type PortfolioWallet = z.infer<typeof portfolioWalletSchema>;

export const portfolioPerpetualsSchema = z.object({
  accountState: z.enum(['ready', 'not_initialized', 'unavailable']),
  registration: z.object({
    feePayer: z.literal('user_wallet'),
    mode: z.enum(['non_referral', 'referral']),
  }).strict().nullable(),
}).strict().superRefine((value, context) => {
  if (value.accountState === 'not_initialized' && value.registration === null) {
    context.addIssue({ code: 'custom', message: 'Uninitialized perpetuals require an in-app registration method', path: ['registration'] });
  }
  if (value.accountState !== 'not_initialized' && value.registration !== null) {
    context.addIssue({ code: 'custom', message: 'Only uninitialized perpetuals may include registration metadata', path: ['registration'] });
  }
});
export type PortfolioPerpetuals = z.infer<typeof portfolioPerpetualsSchema>;

export const portfolioCashBalanceSchema = z.object({
  cashId: identifierSchema,
  symbol: z.enum(['USDC', 'SOL']),
  label: z.enum(['Available to trade', 'Network fee balance']),
  mint: solanaAddressSchema.nullable(),
  rawAmount: z.string().regex(/^\d+$/),
  decimals: z.number().int().min(0).max(18),
  quantity: z.string().min(1).max(80),
  unitPriceUsd: portfolioMoneySchema,
  marketValueUsd: portfolioMoneySchema,
}).strict();
export type PortfolioCashBalance = z.infer<typeof portfolioCashBalanceSchema>;

export const portfolioHoldingSchema = z.object({
  holdingId: identifierSchema,
  assetId: assetIdSchema,
  instrumentId: identifierSchema,
  productType: z.enum(['spot', 'prestock']),
  companyName: z.string().min(1).max(160),
  ticker: z.string().min(1).max(32).nullable(),
  symbol: z.string().min(1).max(64),
  logoUrl: nullablePublicHttpUrlSchema,
  provider: z.string().min(1).max(80),
  mint: solanaAddressSchema,
  rawAmount: z.string().regex(/^\d+$/),
  decimals: z.number().int().min(0).max(18),
  quantity: z.string().min(1).max(80),
  unitPriceUsd: portfolioMoneySchema,
  marketValueUsd: portfolioMoneySchema,
  changePercent: portfolioMetricSchema,
  valuationIncluded: z.boolean(),
}).strict();
export type PortfolioHolding = z.infer<typeof portfolioHoldingSchema>;

const nullableMoneyNumberSchema = z.number().finite().nullable();

export const portfolioPositionSchema = z.object({
  positionId: identifierSchema,
  assetId: assetIdSchema,
  instrumentId: identifierSchema,
  companyName: z.string().min(1).max(160),
  ticker: z.string().min(1).max(32).nullable(),
  logoUrl: nullablePublicHttpUrlSchema,
  venue: z.literal('Phoenix'),
  marketSymbol: z.string().min(1).max(64),
  direction: z.enum(['long', 'short']),
  marginMode: z.enum(['isolated', 'cross']),
  traderPdaIndex: z.number().int().nonnegative(),
  subaccountIndex: z.number().int().nonnegative(),
  quantity: z.string().min(1).max(80),
  leverage: z.number().finite().positive().nullable(),
  entryPriceUsd: nullableMoneyNumberSchema,
  markPriceUsd: nullableMoneyNumberSchema,
  collateralUsd: nullableMoneyNumberSchema,
  notionalUsd: nullableMoneyNumberSchema,
  unrealizedPnlUsd: nullableMoneyNumberSchema,
  unrealizedPnlPercent: nullableMoneyNumberSchema,
  liquidationPriceUsd: nullableMoneyNumberSchema,
  liquidationDistancePercent: nullableMoneyNumberSchema,
  fundingRatePercent: nullableMoneyNumberSchema,
  fundingEffect: z.enum(['pay', 'receive']).nullable(),
  nextFundingAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
  dataState: portfolioDataStateSchema,
}).strict();
export type PortfolioPosition = z.infer<typeof portfolioPositionSchema>;

export const portfolioOrderSchema = z.object({
  orderId: identifierSchema,
  assetId: assetIdSchema,
  instrumentId: identifierSchema,
  companyName: z.string().min(1).max(160),
  ticker: z.string().min(1).max(32).nullable(),
  logoUrl: nullablePublicHttpUrlSchema,
  venue: z.literal('Phoenix'),
  marketSymbol: z.string().min(1).max(64),
  side: z.enum(['buy', 'sell']),
  orderType: z.string().min(1).max(64),
  priceUsd: nullableMoneyNumberSchema,
  quantity: z.string().min(1).max(80),
  reduceOnly: z.boolean(),
  status: z.string().min(1).max(64),
  traderPdaIndex: z.number().int().nonnegative(),
  subaccountIndex: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
}).strict();
export type PortfolioOrder = z.infer<typeof portfolioOrderSchema>;

export const portfolioAttentionSchema = z.object({
  attentionId: identifierSchema,
  kind: z.enum(['execution_unknown', 'execution_failed', 'stale_data', 'risk']),
  title: z.string().min(1).max(120),
  message: z.string().min(1).max(240),
  occurredAt: z.string().datetime(),
  executionId: z.string().uuid().nullable(),
  signature: z.string().min(32).max(128).nullable(),
}).strict();
export type PortfolioAttention = z.infer<typeof portfolioAttentionSchema>;

export const portfolioEquitySchema = z.object({
  netAccountEquity: portfolioMoneySchema,
  todayChangeUsd: portfolioMoneySchema,
  todayChangePercent: portfolioMetricSchema,
  pricedHoldings: portfolioMoneySchema,
  perpetualEquity: portfolioMoneySchema,
  cash: portfolioMoneySchema,
  grossPerpetualExposure: portfolioMoneySchema,
  liabilities: portfolioMoneySchema,
}).strict();
export type PortfolioEquity = z.infer<typeof portfolioEquitySchema>;

export const portfolioOverviewResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  wallet: portfolioWalletSchema,
  perpetuals: portfolioPerpetualsSchema,
  equity: portfolioEquitySchema,
  attention: z.array(portfolioAttentionSchema),
  openOrders: z.array(portfolioOrderSchema).max(3),
  openPositions: z.array(portfolioPositionSchema).max(3),
  holdings: z.array(portfolioHoldingSchema).max(5),
  cashBalances: z.array(portfolioCashBalanceSchema),
  counts: z.object({
    openOrders: z.number().int().nonnegative(),
    openPositions: z.number().int().nonnegative(),
    holdings: z.number().int().nonnegative(),
    unpricedHoldings: z.number().int().nonnegative(),
  }).strict(),
  warnings: z.array(portfolioWarningSchema),
}).strict();
export type PortfolioOverviewResponse = z.infer<typeof portfolioOverviewResponseSchema>;

export const portfolioPositionsResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  wallet: portfolioWalletSchema,
  perpetuals: portfolioPerpetualsSchema,
  summary: z.object({
    unrealizedPnlUsd: portfolioMoneySchema,
    grossExposureUsd: portfolioMoneySchema,
  }).strict(),
  openOrders: z.array(portfolioOrderSchema),
  openPositions: z.array(portfolioPositionSchema),
  holdings: z.array(portfolioHoldingSchema),
  cashBalances: z.array(portfolioCashBalanceSchema),
  warnings: z.array(portfolioWarningSchema),
}).strict();
export type PortfolioPositionsResponse = z.infer<typeof portfolioPositionsResponseSchema>;

export const phoenixRegistrationModeSchema = z.enum(['non_referral', 'referral']);
export type PhoenixRegistrationMode = z.infer<typeof phoenixRegistrationModeSchema>;

export const phoenixRegistrationCreateSchema = z.object({
  walletAddress: solanaAddressSchema,
}).strict();
export type PhoenixRegistrationCreate = z.infer<typeof phoenixRegistrationCreateSchema>;

export const phoenixRegistrationParamsSchema = z.object({
  registrationId: z.string().uuid(),
}).strict();

export const phoenixRegistrationSubmitSchema = z.object({
  signedTransaction: z.string().min(32).max(100_000),
}).strict();
export type PhoenixRegistrationSubmit = z.infer<typeof phoenixRegistrationSubmitSchema>;

export const phoenixRegistrationReviewSchema = z.object({
  registrationId: z.string().uuid(),
  state: z.literal('review'),
  venue: z.literal('Phoenix'),
  mode: phoenixRegistrationModeSchema,
  walletAddress: solanaAddressSchema,
  traderAuthority: solanaAddressSchema,
  feePayer: solanaAddressSchema,
  traderPda: solanaAddressSchema,
  traderPdaIndex: z.literal(0),
  traderSubaccountIndex: z.literal(0),
  marginMode: z.literal('cross'),
  maxPositions: z.number().int().min(32).max(128),
  fees: z.object({
    networkFeePaidBy: z.literal('user_wallet'),
    accountRentPaidBy: z.literal('user_wallet'),
  }).strict(),
  expiresAt: z.string().datetime(),
  lastValidBlockHeight: z.number().int().nonnegative(),
  unsignedTransaction: z.string().min(32),
}).strict();
export type PhoenixRegistrationReview = z.infer<typeof phoenixRegistrationReviewSchema>;

export const phoenixRegistrationResultSchema = z.object({
  registrationId: z.string().uuid(),
  state: z.enum(['submitted', 'confirmed', 'failed']),
  venue: z.literal('Phoenix'),
  walletAddress: solanaAddressSchema,
  traderPda: solanaAddressSchema,
  signature: z.string().min(32).max(128),
  explorerUrl: publicHttpUrlSchema,
  message: z.string().min(1).max(240),
  nextAction: z.enum(['wait_for_confirmation', 'refresh_portfolio', 'add_collateral', 'retry']),
}).strict();
export type PhoenixRegistrationResult = z.infer<typeof phoenixRegistrationResultSchema>;

export const portfolioWalletQuerySchema = z.object({
  walletAddress: solanaAddressSchema.optional(),
}).strict();
export type PortfolioWalletQuery = z.infer<typeof portfolioWalletQuerySchema>;

export const portfolioActivityKindSchema = z.enum(['trade', 'perpetual', 'transfer', 'funding']);
export type PortfolioActivityKind = z.infer<typeof portfolioActivityKindSchema>;
export const portfolioActivityStatusSchema = z.enum(['pending', 'confirmed', 'failed', 'unknown']);
export type PortfolioActivityStatus = z.infer<typeof portfolioActivityStatusSchema>;

export const portfolioActivityItemSchema = z.object({
  activityId: identifierSchema,
  kind: portfolioActivityKindSchema,
  productType: z.enum(['spot', 'prestock', 'perpetual', 'cash']),
  action: z.enum([
    'bought', 'sold', 'trade_submitted', 'order_submitted', 'position_changed', 'funding_paid',
    'funding_received', 'received', 'sent', 'execution_failed',
  ]),
  status: portfolioActivityStatusSchema,
  title: z.string().min(1).max(120),
  subtitle: z.string().min(1).max(160),
  assetId: assetIdSchema.nullable(),
  instrumentId: identifierSchema.nullable(),
  companyName: z.string().min(1).max(160).nullable(),
  symbol: z.string().min(1).max(64).nullable(),
  quantity: z.string().min(1).max(80).nullable(),
  valueUsd: z.number().finite().nullable(),
  occurredAt: z.string().datetime(),
  signature: z.string().min(32).max(128).nullable(),
  explorerUrl: nullablePublicHttpUrlSchema,
  executionId: z.string().uuid().nullable(),
  groupId: identifierSchema,
}).strict();
export type PortfolioActivityItem = z.infer<typeof portfolioActivityItemSchema>;

const optionalCursorSchema = z.preprocess(
  (value) => typeof value === 'string' ? value.trim() || undefined : value,
  z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).optional(),
);
const optionalQuerySchema = z.preprocess(
  (value) => typeof value === 'string' ? value.trim() || undefined : value,
  z.string().min(1).max(80).optional(),
);

export const portfolioActivityQuerySchema = z.object({
  walletAddress: solanaAddressSchema.optional(),
  cursor: optionalCursorSchema,
  limit: z.coerce.number().int().min(1).max(50).default(20),
  kind: z.enum(['all', 'trades', 'perpetuals', 'transfers', 'funding']).default('all'),
  status: z.enum(['all', 'pending', 'confirmed', 'failed', 'unknown']).default('all'),
  query: optionalQuerySchema,
}).strict();
export type PortfolioActivityQuery = z.infer<typeof portfolioActivityQuerySchema>;

export const portfolioActivityResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  wallet: portfolioWalletSchema,
  items: z.array(portfolioActivityItemSchema),
  pageInfo: z.object({
    nextCursor: z.string().min(1).max(512).nullable(),
    hasNextPage: z.boolean(),
  }).strict(),
  warnings: z.array(portfolioWarningSchema),
}).strict();
export type PortfolioActivityResponse = z.infer<typeof portfolioActivityResponseSchema>;
