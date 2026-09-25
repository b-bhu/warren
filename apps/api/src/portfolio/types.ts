export type WalletTokenBalance = {
  mint: string;
  rawAmount: string;
  decimals: number;
};

export type WalletSnapshot = {
  address: string;
  solLamports: string;
  solPriceUsd: number | null;
  tokens: WalletTokenBalance[];
  observedAt: string;
};

export type WalletTransfer = {
  signature: string;
  blockTime: string;
  from: string | null;
  to: string | null;
  mint: string;
  rawAmount: string;
  decimals: number;
  quantity: string;
  confirmationStatus: 'processed' | 'confirmed' | 'finalized' | 'unknown';
};

export type SignatureState = 'confirmed' | 'failed' | 'pending' | 'unknown';

export interface WalletPortfolioSource {
  loadWallet(address: string): Promise<WalletSnapshot>;
  loadTransfers(input: {
    address: string;
    before?: string;
    limit: number;
    maxPages: number;
    mintAllowlist?: readonly string[];
    queryMints?: readonly string[];
    referenceQuery?: string;
  }): Promise<{ items: WalletTransfer[]; exhausted: boolean }>;
  getSignatureStates(signatures: readonly string[]): Promise<Map<string, SignatureState>>;
}

export type PhoenixPortfolioPosition = {
  marketSymbol: string;
  traderPdaIndex: number;
  subaccountIndex: number;
  positionSequenceNumber: string;
  quantity: string;
  entryPriceUsd: number | null;
  markPriceUsd: number | null;
  collateralUsd: number | null;
  notionalUsd: number | null;
  unrealizedPnlUsd: number | null;
  leverage: number | null;
};

export type PhoenixPortfolioOrder = {
  marketSymbol: string;
  traderPdaIndex: number;
  subaccountIndex: number;
  orderSequenceNumber: string;
  side: 'bid' | 'ask';
  orderType: string;
  priceUsd: number | null;
  quantity: string;
  reduceOnly: boolean;
  status: string;
};

export type PhoenixPortfolioSnapshot = {
  accountState: 'ready' | 'not_initialized';
  observedAt: string;
  valuationComplete: boolean;
  collateralUsd: number;
  accountEquityUsd: number | null;
  grossExposureUsd: number | null;
  unrealizedPnlUsd: number | null;
  positions: PhoenixPortfolioPosition[];
  orders: PhoenixPortfolioOrder[];
};

export type PhoenixTradeActivity = {
  activityId: string;
  marketSymbol: string;
  occurredAt: string;
  quantity: string;
  priceUsd: number | null;
  realizedPnlUsd: number | null;
  signature: string | null;
  instructionType: string;
  baseLotsBefore: string;
  baseLotsAfter: string;
};

export type PhoenixFundingActivity = {
  activityId: string;
  marketSymbol: string;
  occurredAt: string;
  paymentUsd: number;
  ratePercent: number | null;
  positionSide: string;
};

export interface PhoenixPortfolioSourceContract {
  loadAccount(walletAddress: string): Promise<PhoenixPortfolioSnapshot>;
  loadActivity(input: {
    privyToken: string;
    walletAddress: string;
    before?: string;
    limit: number;
    maxPages: number;
    marketSymbols?: readonly string[];
    referenceQuery?: string;
  }): Promise<{ trades: PhoenixTradeActivity[]; funding: PhoenixFundingActivity[]; exhausted: boolean }>;
}

export class PortfolioProviderError extends Error {
  constructor(
    readonly provider: 'helius' | 'phoenix',
    message: string,
    readonly status?: number,
    readonly retryable = true,
  ) {
    super(message);
  }
}
