import type {
  ExecutionAsset,
  PerpetualExecutionResult,
  PerpetualOrderCreate,
  PerpetualOrderResponse,
  SpotExecutionResult,
  SpotOrderCreate,
  SpotOrderReview,
} from '@warren/execution-contract';

export type ExecutionIdentity = {
  userId: string;
  rawToken: string;
  walletAddresses: readonly string[];
};

export interface ExecutionIdentityVerifier {
  verify(accessToken: string): Promise<{ userId: string; walletAddresses: readonly string[] }>;
}

export type JupiterOrder = {
  transaction: string;
  requestId: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  inUsdValue: number | null;
  outUsdValue: number | null;
  minimumOutputAmount: string;
  priceImpactPercent: number | null;
  router: string;
  mode: string;
  feeBps: number;
  feeMint: string;
  platformFeeAmount: string | null;
  signatureFeeLamports: number | null;
  prioritizationFeeLamports: number | null;
  rentFeeLamports: number | null;
  lastValidBlockHeight: number | null;
  providerExpiresAt: string | null;
};

export type JupiterExecution = {
  success: boolean;
  signature: string | null;
  totalInputAmount: string | null;
  totalOutputAmount: string | null;
  message: string;
};

export interface SpotExecutionProvider {
  searchAssets(query: string): Promise<ExecutionAsset[]>;
  createOrder(input: {
    inputMint: string;
    outputMint: string;
    amount: string;
    taker: string;
  }): Promise<JupiterOrder>;
  execute(input: {
    signedTransaction: string;
    requestId: string;
    lastValidBlockHeight: number | null;
  }): Promise<JupiterExecution>;
}

export type SolanaInstructionDto = {
  programId: string;
  keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: number[];
};

export type PhoenixSession = { accessToken: string };
export type PhoenixTraderState = {
  collateralUsd: number;
  canPlaceMarketOrder: boolean;
  canPlaceLimitOrder: boolean;
  canIncreaseRisk: boolean;
};
export type PhoenixBuiltOrder = {
  instructions: SolanaInstructionDto[];
  estimatedLiquidationPriceUsd: number | null;
};

export interface PerpetualExecutionProvider {
  login(privyToken: string, walletAddress: string): Promise<PhoenixSession>;
  getTraderState(session: PhoenixSession, walletAddress: string): Promise<PhoenixTraderState | null>;
  getMarkPrice(session: PhoenixSession, symbol: string): Promise<number>;
  buildOrder(session: PhoenixSession, input: {
    walletAddress: string;
    symbol: string;
    direction: 'long' | 'short';
    orderType: 'market' | 'limit';
    collateralBaseUnits: string;
    quantity: number;
    limitPrice: number | null;
  }): Promise<PhoenixBuiltOrder>;
}

export interface SolanaTransactionGateway {
  build(walletAddress: string, instructions: SolanaInstructionDto[], options?: {
    allowedExternalSigners?: readonly string[];
  }): Promise<{
    unsignedTransaction: string;
    lastValidBlockHeight: number;
  }>;
  submit(signedTransaction: string): Promise<{ signature: string }>;
  getSignatureState(signature: string): Promise<'confirmed' | 'failed' | 'pending' | 'unknown'>;
}

export interface ExecutionServiceContract {
  searchSpotAssets(query: string): Promise<{ items: ExecutionAsset[] }>;
  createSpotOrder(identity: ExecutionIdentity, input: SpotOrderCreate): Promise<SpotOrderReview>;
  submitSpotOrder(identity: ExecutionIdentity, executionId: string, signedTransaction: string, idempotencyKey: string): Promise<SpotExecutionResult>;
  createPerpetualOrder(identity: ExecutionIdentity, input: PerpetualOrderCreate): Promise<PerpetualOrderResponse>;
  submitPerpetualOrder(identity: ExecutionIdentity, executionId: string, signedTransaction: string, idempotencyKey: string): Promise<PerpetualExecutionResult>;
}
