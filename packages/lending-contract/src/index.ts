import { z } from 'zod';

export const LENDING_MARKET_ID = 'kamino:xstocks:mainnet';
export const KAMINO_MARKET_ADDRESS = '5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua';
export const KAMINO_PROGRAM_ADDRESS = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
export const USDC_MINT_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDC_RESERVE_ADDRESS = '97zoywd8mPZsGTg8q1wdD2Wgkdrs2tqusp1Qqcxbyj7E';

export const lendingAssetSchema = z.object({
  assetId: z.string().regex(/^xstocks:[a-z0-9]+x$/),
  symbol: z.string().min(1).max(12),
  name: z.string().min(1).max(80),
  mintAddress: z.string().min(32).max(64),
  reserveAddress: z.string().min(32).max(64),
  lendingMarketAddress: z.literal(KAMINO_MARKET_ADDRESS),
  debtMintAddress: z.literal(USDC_MINT_ADDRESS),
  debtReserveAddress: z.literal(USDC_RESERVE_ADDRESS),
  marketStatus: z.string().max(32).nullable(),
  routeAvailable: z.boolean(),
  dataAsOf: z.string().datetime().nullable(),
  supplyApy: z.string().regex(/^\d+(\.\d+)?$/).nullable(),
  borrowApy: z.string().regex(/^\d+(\.\d+)?$/).nullable(),
  availableLiquidity: z.string().regex(/^\d+(\.\d+)?$/).nullable(),
  maxLtv: z.string().regex(/^\d+(\.\d+)?$/).nullable(),
  liquidationLtv: z.string().regex(/^\d+(\.\d+)?$/).nullable(),
  actionsPaused: z.boolean(),
  actionPauseReason: z.string().max(160).nullable(),
}).strict();
export type LendingAsset = z.infer<typeof lendingAssetSchema>;

export const lendingCatalogResponseSchema = z.object({
  marketId: z.literal(LENDING_MARKET_ID),
  network: z.literal('solana-mainnet'),
  protocol: z.literal('Kamino'),
  lendingMarketAddress: z.literal(KAMINO_MARKET_ADDRESS),
  programAddress: z.literal(KAMINO_PROGRAM_ADDRESS),
  debtSymbol: z.literal('USDC'),
  actionsEnabled: z.boolean(),
  newRiskEnabled: z.boolean(),
  generatedAt: z.string().datetime(),
  assets: z.array(lendingAssetSchema).length(9),
}).strict();
export type LendingCatalogResponse = z.infer<typeof lendingCatalogResponseSchema>;

export const lendingActionKindSchema = z.enum(['supply', 'borrow', 'repay', 'withdraw', 'supply-borrow', 'repay-withdraw']);
export type LendingActionKind = z.infer<typeof lendingActionKindSchema>;
export const lendingStepKindSchema = z.enum(['supply', 'borrow', 'repay', 'withdraw']);
export type LendingStepKind = z.infer<typeof lendingStepKindSchema>;
export const lendingStepStateSchema = z.enum(['review', 'submitted', 'confirmed', 'failed', 'unknown', 'expired']);
export type LendingStepState = z.infer<typeof lendingStepStateSchema>;
export const lendingActionStateSchema = z.enum(['review', 'in_progress', 'confirmed', 'failed', 'unknown', 'refresh_required']);
export type LendingActionState = z.infer<typeof lendingActionStateSchema>;
const rawAmountSchema = z.string().regex(/^\d+$/);
const actionAmountSchema = z.string().regex(/^(?:ALL|\d+)$/);
const walletSchema = z.string().min(32).max(64);

export const lendingWalletQuerySchema = z.object({ walletAddress: walletSchema }).strict();
export const lendingActionCreateSchema = z.object({
  action: lendingActionKindSchema,
  walletAddress: walletSchema,
  assetId: z.string().regex(/^xstocks:[a-z0-9]+x$/),
  amountRaw: actionAmountSchema.optional(),
  secondaryAmountRaw: actionAmountSchema.optional(),
}).strict().superRefine((value, context) => {
  const needsTwoAmounts = value.action === 'supply-borrow' || value.action === 'repay-withdraw';
  if (!needsTwoAmounts && !value.amountRaw) context.addIssue({ code: 'custom', message: 'A raw token amount is required.', path: ['amountRaw'] });
  if (needsTwoAmounts && (!value.amountRaw || !value.secondaryAmountRaw)) {
    context.addIssue({ code: 'custom', message: 'Both raw token amounts are required for this action.', path: ['secondaryAmountRaw'] });
  }
  if (!needsTwoAmounts && value.secondaryAmountRaw !== undefined) {
    context.addIssue({ code: 'custom', message: 'This action accepts only one token amount.', path: ['secondaryAmountRaw'] });
  }
  if (value.action !== 'repay' && value.action !== 'withdraw' && value.action !== 'repay-withdraw'
    && (value.amountRaw === 'ALL' || value.secondaryAmountRaw === 'ALL')) {
    context.addIssue({ code: 'custom', message: 'ALL is available only for repayment or withdrawal.', path: ['amountRaw'] });
  }
  if (value.action === 'supply-borrow' && (value.amountRaw === 'ALL' || value.secondaryAmountRaw === 'ALL')) {
    context.addIssue({ code: 'custom', message: 'Supply and borrow require exact raw token amounts.', path: ['amountRaw'] });
  }
});
export type LendingActionCreate = z.infer<typeof lendingActionCreateSchema>;

export const lendingWalletHoldingSchema = z.object({
  assetId: z.string().regex(/^xstocks:[a-z0-9]+x$/), symbol: z.string(), mintAddress: z.string(),
  rawAmount: rawAmountSchema, spendableRawAmount: rawAmountSchema, decimals: z.number().int().min(0).max(18),
  displayAmount: z.string().regex(/^\d+(\.\d+)?$/), scaledUiMultiplier: z.string().nullable(), sourceAccountAddress: z.string().nullable(),
  accountCount: z.number().int().nonnegative(), frozenAccountCount: z.number().int().nonnegative(),
  tokenProgram: z.enum(['spl-token', 'token-2022']), extensionState: z.enum(['verified', 'unsupported', 'unavailable']),
  eligibility: z.enum(['no-holding', 'supported-balance', 'unsupported-account']),
}).strict();
export type LendingWalletHolding = z.infer<typeof lendingWalletHoldingSchema>;

export const lendingPositionLegSchema = z.object({
  reserveAddress: z.string(), mintAddress: z.string(), rawAmount: rawAmountSchema, decimals: z.number().int().min(0).max(18),
  amount: z.string().regex(/^\d+(\.\d+)?$/), displayAmount: z.string().regex(/^\d+(\.\d+)?$/),
  scaledUiMultiplier: z.string().nullable(), marketValueUsd: z.string().regex(/^\d+(\.\d+)?$/),
}).strict();
export const lendingObligationSchema = z.object({
  obligationAddress: z.string(), obligationType: z.string(), elevationGroup: z.number().int().nonnegative(),
  collateral: z.array(lendingPositionLegSchema), debt: z.array(lendingPositionLegSchema),
  netAccountValueUsd: z.string(), ltv: z.string(), liquidationLtv: z.string(),
  maxBorrowUsd: z.string(), borrowLimitUsd: z.string(), liquidationLimitUsd: z.string(),
  supportedForActions: z.boolean(), actionBlockReason: z.string().nullable(),
}).strict();
export type LendingObligation = z.infer<typeof lendingObligationSchema>;
export const lendingWalletResponseSchema = z.object({
  walletAddress: walletSchema, network: z.literal('solana-mainnet'), observedAt: z.string().datetime(),
  holdings: z.array(lendingWalletHoldingSchema), obligations: z.array(lendingObligationSchema),
  usdcBalance: z.object({ mintAddress: z.literal(USDC_MINT_ADDRESS), rawAmount: rawAmountSchema,
    spendableRawAmount: rawAmountSchema, decimals: z.literal(6), displayAmount: z.string(),
    sourceAccountAddress: z.string().nullable() }).strict(),
}).strict();
export type LendingWalletResponse = z.infer<typeof lendingWalletResponseSchema>;

export const lendingRiskPreviewSchema = z.object({
  walletAddress: walletSchema, assetId: z.string(), action: lendingActionKindSchema, observedAt: z.string().datetime(),
  obligationAddress: z.string().nullable(),
  collateralRawBefore: rawAmountSchema, collateralRawAfter: rawAmountSchema,
  debtRawBefore: rawAmountSchema, debtRawAfter: rawAmountSchema,
  maxBorrowRaw: rawAmountSchema, maxWithdrawRaw: rawAmountSchema,
  currentLtv: z.string(), projectedLtv: z.string(), liquidationLtv: z.string(),
  liquidationHeadroomUsd: z.string(), supplyApy: z.string().nullable(), borrowApy: z.string().nullable(),
  availableLiquidity: z.string().nullable(), healthBufferBps: z.number().int().min(1).max(10_000),
  approvalCount: z.number().int().min(1).max(4), newRiskPaused: z.boolean(),
  actionAvailable: z.boolean(), blockReason: z.string().nullable(),
}).strict();
export type LendingRiskPreview = z.infer<typeof lendingRiskPreviewSchema>;

export const lendingReviewSchema = z.object({
  actionId: z.string().uuid(), state: lendingActionStateSchema,
  action: lendingActionKindSchema, walletAddress: walletSchema, assetId: z.string(),
  steps: z.array(z.object({
    stepId: z.string().uuid(), sequence: z.number().int().positive(), kind: lendingStepKindSchema,
    state: lendingStepStateSchema, unsignedTransaction: z.string().min(1),
    expiresAt: z.string().datetime(), lastValidBlockHeight: z.number().int().nonnegative(),
    amountRaw: rawAmountSchema, amount: z.string(), displayAmount: z.string(), symbol: z.string(),
    feeEstimateLamports: rawAmountSchema.nullable(), rentEstimateLamports: rawAmountSchema.nullable(),
    simulation: z.object({ ok: z.boolean(), unitsConsumed: z.number().int().nonnegative().nullable(),
      logs: z.array(z.string()).max(40), error: z.string().nullable() }).strict(),
  }).strict()), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
export type LendingReview = z.infer<typeof lendingReviewSchema>;

export const lendingActionParamsSchema = z.object({ actionId: z.string().uuid() }).strict();
export const lendingStepParamsSchema = z.object({ actionId: z.string().uuid(), stepId: z.string().uuid() }).strict();
export const lendingSignedStepSchema = z.object({ signedTransaction: z.string().min(1).max(64_000) }).strict();
export const lendingStepResultSchema = z.object({
  actionId: z.string().uuid(), stepId: z.string().uuid(), state: lendingStepStateSchema,
  signature: z.string().nullable(), explorerUrl: z.string().url().nullable(),
  message: z.string().max(240), updatedAt: z.string().datetime(),
}).strict();
export type LendingStepResult = z.infer<typeof lendingStepResultSchema>;

export const lendingActionHistoryResponseSchema = z.object({
  walletAddress: walletSchema,
  items: z.array(z.object({
    actionId: z.string().uuid(), action: lendingActionKindSchema, assetId: z.string(),
    state: lendingActionStateSchema, createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  }).strict()).max(50),
}).strict();
export type LendingActionHistoryResponse = z.infer<typeof lendingActionHistoryResponseSchema>;
