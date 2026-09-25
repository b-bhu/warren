import { z } from 'zod';

const assetIdSchema = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9:_-]*$/);
const instrumentIdSchema = z.string().min(1).max(160).regex(/^[a-zA-Z0-9:_-]+$/);
const solanaAddressSchema = z.string().min(32).max(44).regex(/^[1-9A-HJ-NP-Za-km-z]+$/);
const baseUnitAmountSchema = z.string().min(1).max(80).regex(/^[1-9]\d*$/);
const decimalAmountSchema = z.string().min(1).max(80).regex(/^\d+(?:\.\d+)?$/);
const publicHttpUrlSchema = z.string().url().regex(/^https?:\/\//i);
const base64TransactionSchema = z.string().min(40).max(300_000).regex(/^[A-Za-z0-9+/]+={0,2}$/);

export const executionProductSchema = z.enum(['spot', 'perpetual']);
export type ExecutionProduct = z.infer<typeof executionProductSchema>;

export const executionErrorCodeSchema = z.enum([
  'AUTH_REQUIRED',
  'SESSION_INVALID',
  'WALLET_NOT_READY',
  'WALLET_MISMATCH',
  'INVALID_REQUEST',
  'INSTRUMENT_NOT_EXECUTABLE',
  'QUOTE_UNAVAILABLE',
  'QUOTE_EXPIRED',
  'EXECUTION_NOT_FOUND',
  'EXECUTION_STATE_INVALID',
  'PROVIDER_UNAVAILABLE',
  'SUBMISSION_FAILED',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
]);
export type ExecutionErrorCode = z.infer<typeof executionErrorCodeSchema>;

export const executionApiErrorSchema = z.object({
  error: z.object({
    code: executionErrorCodeSchema,
    message: z.string().min(1).max(240),
    retryable: z.boolean(),
    requestId: z.string().min(1),
    executionId: z.string().uuid().optional(),
  }).strict(),
}).strict();
export type ExecutionApiError = z.infer<typeof executionApiErrorSchema>;

export const executionAssetSchema = z.object({
  mint: solanaAddressSchema,
  name: z.string().min(1).max(120),
  symbol: z.string().min(1).max(24),
  iconUrl: publicHttpUrlSchema.nullable(),
  decimals: z.number().int().min(0).max(18),
  usdPrice: z.number().finite().nonnegative().nullable(),
  verified: z.boolean(),
}).strict();
export type ExecutionAsset = z.infer<typeof executionAssetSchema>;

export const spotAssetSearchQuerySchema = z.object({
  query: z.string().trim().max(120).default(''),
}).strict();

export const spotAssetSearchResponseSchema = z.object({
  items: z.array(executionAssetSchema).max(20),
}).strict();
export type SpotAssetSearchResponse = z.infer<typeof spotAssetSearchResponseSchema>;

export const spotOrderCreateSchema = z.object({
  assetId: assetIdSchema,
  instrumentId: instrumentIdSchema,
  direction: z.enum(['buy', 'sell']),
  settlementMint: solanaAddressSchema,
  amount: baseUnitAmountSchema,
  walletAddress: solanaAddressSchema,
}).strict();
export type SpotOrderCreate = z.infer<typeof spotOrderCreateSchema>;

const executionAmountSchema = z.object({
  mint: solanaAddressSchema,
  symbol: z.string().min(1).max(24),
  decimals: z.number().int().min(0).max(18),
  amount: baseUnitAmountSchema,
  usdValue: z.number().finite().nonnegative().nullable(),
}).strict();

export const spotOrderReviewSchema = z.object({
  executionId: z.string().uuid(),
  state: z.literal('review'),
  product: z.literal('spot'),
  assetId: assetIdSchema,
  instrumentId: instrumentIdSchema,
  direction: z.enum(['buy', 'sell']),
  walletAddress: solanaAddressSchema,
  input: executionAmountSchema,
  output: executionAmountSchema,
  minimumOutputAmount: baseUnitAmountSchema,
  priceImpactPercent: z.number().finite().nullable(),
  router: z.string().min(1).max(48),
  mode: z.string().min(1).max(48),
  feeBps: z.number().int().min(0).max(10_000),
  feeMint: solanaAddressSchema,
  platformFeeAmount: z.string().regex(/^\d+$/).nullable(),
  signatureFeeLamports: z.number().int().nonnegative().nullable(),
  prioritizationFeeLamports: z.number().int().nonnegative().nullable(),
  rentFeeLamports: z.number().int().nonnegative().nullable(),
  expiresAt: z.string().datetime(),
  lastValidBlockHeight: z.number().int().nonnegative().nullable(),
  unsignedTransaction: base64TransactionSchema,
}).strict();
export type SpotOrderReview = z.infer<typeof spotOrderReviewSchema>;

export const orderSubmitSchema = z.object({
  signedTransaction: base64TransactionSchema,
}).strict();
export type OrderSubmit = z.infer<typeof orderSubmitSchema>;

export const executionParamsSchema = z.object({ executionId: z.string().uuid() }).strict();

export const spotExecutionResultSchema = z.object({
  executionId: z.string().uuid(),
  product: z.literal('spot'),
  state: z.enum(['confirmed', 'failed']),
  signature: z.string().min(1).max(128).nullable(),
  inputAmount: z.string().regex(/^\d+$/).nullable(),
  outputAmount: z.string().regex(/^\d+$/).nullable(),
  explorerUrl: publicHttpUrlSchema.nullable(),
  message: z.string().min(1).max(240),
}).strict();
export type SpotExecutionResult = z.infer<typeof spotExecutionResultSchema>;

export const perpetualOrderCreateSchema = z.object({
  assetId: assetIdSchema,
  instrumentId: instrumentIdSchema,
  direction: z.enum(['long', 'short']),
  orderType: z.enum(['market', 'limit']),
  collateralAmount: baseUnitAmountSchema,
  leverage: z.number().int().min(1).max(100),
  limitPrice: decimalAmountSchema.nullable(),
  walletAddress: solanaAddressSchema,
}).strict().superRefine((value, context) => {
  if (value.orderType === 'limit' && value.limitPrice === null) {
    context.addIssue({ code: 'custom', message: 'Limit orders require a limit price', path: ['limitPrice'] });
  }
  if (value.orderType === 'market' && value.limitPrice !== null) {
    context.addIssue({ code: 'custom', message: 'Market orders cannot include a limit price', path: ['limitPrice'] });
  }
});
export type PerpetualOrderCreate = z.infer<typeof perpetualOrderCreateSchema>;

export const perpetualActionRequiredSchema = z.object({
  state: z.literal('action_required'),
  product: z.literal('perpetual'),
  action: z.enum(['phoenix_account_required', 'collateral_required', 'trading_restricted']),
  message: z.string().min(1).max(240),
  providerUrl: publicHttpUrlSchema,
}).strict();
export type PerpetualActionRequired = z.infer<typeof perpetualActionRequiredSchema>;

export const perpetualOrderReviewSchema = z.object({
  executionId: z.string().uuid(),
  state: z.literal('review'),
  product: z.literal('perpetual'),
  assetId: assetIdSchema,
  instrumentId: instrumentIdSchema,
  marketSymbol: z.string().min(1).max(64),
  direction: z.enum(['long', 'short']),
  orderType: z.enum(['market', 'limit']),
  walletAddress: solanaAddressSchema,
  collateralAmount: baseUnitAmountSchema,
  collateralSymbol: z.literal('USDC'),
  leverage: z.number().int().min(1).max(100),
  quantity: decimalAmountSchema,
  notionalUsd: z.number().finite().positive(),
  referencePriceUsd: z.number().finite().positive(),
  estimatedLiquidationPriceUsd: z.number().finite().positive().nullable(),
  fundingRatePercent: z.number().finite().nullable(),
  nextFundingAt: z.string().datetime().nullable(),
  marginMode: z.literal('isolated'),
  expiresAt: z.string().datetime(),
  lastValidBlockHeight: z.number().int().nonnegative(),
  unsignedTransaction: base64TransactionSchema,
}).strict();
export type PerpetualOrderReview = z.infer<typeof perpetualOrderReviewSchema>;

export const perpetualOrderResponseSchema = z.discriminatedUnion('state', [
  perpetualActionRequiredSchema,
  perpetualOrderReviewSchema,
]);
export type PerpetualOrderResponse = z.infer<typeof perpetualOrderResponseSchema>;

export const perpetualExecutionResultSchema = z.object({
  executionId: z.string().uuid(),
  product: z.literal('perpetual'),
  state: z.enum(['submitted', 'confirmed', 'failed']),
  signature: z.string().min(1).max(128).nullable(),
  explorerUrl: publicHttpUrlSchema.nullable(),
  message: z.string().min(1).max(240),
}).strict();
export type PerpetualExecutionResult = z.infer<typeof perpetualExecutionResultSchema>;
