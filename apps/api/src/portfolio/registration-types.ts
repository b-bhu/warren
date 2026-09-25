import type { SolanaInstructionDto, SolanaTransactionGateway } from '../execution/types.js';

export type PhoenixRegistrationMode = 'non_referral' | 'referral';

export type PhoenixRegistrationBuild = {
  instructions: SolanaInstructionDto[];
  unsignedTransaction?: string;
  lastValidBlockHeight?: number;
  traderPda: string;
  traderOnboarder: string;
  includeRegisterTrader: boolean;
  maxPositions: number;
};

export type PhoenixRegistrationSubmission = {
  signature: string;
  traderPda: string;
  includeRegisterTrader: boolean;
};

export interface PhoenixRegistrationProvider {
  build(input: {
    mode: PhoenixRegistrationMode;
    referralCode?: string;
    privyToken: string;
    traderAuthority: string;
    txFeePayer: string;
    maxPositions: number;
  }): Promise<PhoenixRegistrationBuild>;
  submit(input: {
    mode: PhoenixRegistrationMode;
    referralCode?: string;
    privyToken: string;
    transaction: string;
    traderAuthority: string;
    txFeePayer: string;
    maxPositions: number;
    traderPdaIndex: 0;
    traderSubaccountIndex: 0;
    recentBlockhash: string;
  }): Promise<PhoenixRegistrationSubmission>;
}

export interface PhoenixRegistrationTransactionGateway extends SolanaTransactionGateway {
  build(
    walletAddress: string,
    instructions: SolanaInstructionDto[],
    options?: { allowedExternalSigners?: readonly string[] },
  ): Promise<{
    unsignedTransaction: string;
    lastValidBlockHeight: number;
  }>;
}

export type PhoenixRegistrationIntent = {
  registrationId: string;
  userId: string;
  walletAddress: string;
  mode: PhoenixRegistrationMode;
  traderPda: string;
  maxPositions: number;
  unsignedTransaction: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  state: 'review' | 'submitted' | 'confirmed' | 'failed' | 'unknown';
  signature?: string;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  expiresAt: string;
};

export interface PhoenixRegistrationIntentStore {
  get(registrationId: string): PhoenixRegistrationIntent | undefined;
  save(intent: PhoenixRegistrationIntent): void;
  update(intent: PhoenixRegistrationIntent): void;
  deleteExpired(before: string): void;
}
