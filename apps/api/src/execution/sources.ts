import { PrivyClient } from '@privy-io/node';
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { executionAssetSchema, type ExecutionAsset } from '@warren/execution-contract';
import { z } from 'zod';

import type {
  ExecutionIdentityVerifier,
  JupiterExecution,
  JupiterOrder,
  PerpetualExecutionProvider,
  PhoenixBuiltOrder,
  PhoenixSession,
  PhoenixTraderState,
  SolanaInstructionDto,
  SolanaTransactionGateway,
  SpotExecutionProvider,
} from './types.js';

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type SolanaConnectionLike = {
  getLatestBlockhash(commitment: 'confirmed'): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  sendRawTransaction(rawTransaction: Buffer | Uint8Array, options: { maxRetries: number; skipPreflight: boolean }): Promise<string>;
  getSignatureStatuses(signatures: string[], options: { searchTransactionHistory: boolean }): Promise<{
    value: ({ err: unknown; confirmationStatus?: string | null } | null)[];
  }>;
};

const popularMints = [
  'So11111111111111111111111111111111111111112',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD9WJ5L9sksxT7sZNVhPWd',
].join(',');

const tokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  symbol: z.string(),
  icon: z.string().nullable().optional(),
  decimals: z.number().int().min(0).max(18),
  usdPrice: z.number().finite().nonnegative().nullable().optional(),
  isVerified: z.boolean().optional(),
  audit: z.object({ isSus: z.boolean().optional() }).passthrough().nullable().optional(),
}).passthrough();

const jupiterOrderSchema = z.object({
  transaction: z.string().nullable(),
  requestId: z.string().min(1),
  inputMint: z.string().min(1),
  outputMint: z.string().min(1),
  inAmount: z.string().regex(/^\d+$/),
  outAmount: z.string().regex(/^\d+$/),
  inUsdValue: z.number().finite().nonnegative().nullable().optional(),
  outUsdValue: z.number().finite().nonnegative().nullable().optional(),
  otherAmountThreshold: z.string().regex(/^\d+$/),
  priceImpact: z.number().finite().nullable().optional(),
  priceImpactPct: z.string().optional(),
  router: z.string().min(1),
  mode: z.string().min(1),
  feeBps: z.number().int().min(0),
  feeMint: z.string().min(1),
  platformFee: z.object({ amount: z.string().regex(/^\d+$/).optional() }).passthrough().nullable().optional(),
  signatureFeeLamports: z.number().int().nonnegative().nullable().optional(),
  prioritizationFeeLamports: z.number().int().nonnegative().nullable().optional(),
  rentFeeLamports: z.number().int().nonnegative().nullable().optional(),
  lastValidBlockHeight: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).nullable().optional(),
  expireAt: z.string().nullable().optional(),
  errorCode: z.number().optional(),
  errorMessage: z.string().optional(),
}).passthrough();

const jupiterExecuteSchema = z.object({
  status: z.enum(['Success', 'Failed']),
  signature: z.string().nullable().optional(),
  totalInputAmount: z.string().regex(/^\d+$/).nullable().optional(),
  totalOutputAmount: z.string().regex(/^\d+$/).nullable().optional(),
  error: z.string().optional(),
}).passthrough();

const phoenixLoginSchema = z.object({ access_token: z.string().min(1) }).passthrough();
const phoenixMarkSchema = z.object({
  markPrice: z.object({ price: z.number().finite().positive() }).passthrough().nullable(),
}).passthrough();
const instructionSchema = z.object({
  programId: z.string().min(32),
  keys: z.array(z.object({
    pubkey: z.string().min(32),
    isSigner: z.boolean(),
    isWritable: z.boolean(),
  }).strict()),
  data: z.array(z.number().int().min(0).max(255)),
}).strict();
const phoenixBuildSchema = z.object({
  instructions: z.array(instructionSchema).min(1),
  estimatedLiquidationPriceUsd: z.number().finite().positive().nullable().optional(),
}).passthrough();

export class ProviderResponseError extends Error {
  constructor(readonly provider: 'jupiter' | 'phoenix' | 'solana', message: string, readonly status?: number) {
    super(message);
  }
}

export class PhoenixAccountRequiredError extends ProviderResponseError {
  constructor(message = 'A Phoenix trading account must be activated before placing this order.') {
    super('phoenix', message, 403);
  }
}

export class PrivyExecutionIdentityVerifier implements ExecutionIdentityVerifier {
  private readonly client: PrivyClient;

  constructor(appId: string, appSecret: string) {
    this.client = new PrivyClient({ appId, appSecret });
  }

  async verify(accessToken: string) {
    const result = await this.client.utils().auth().verifyAccessToken(accessToken);
    const user = await this.client.users()._get(result.user_id);
    const walletAddresses = user.linked_accounts.flatMap((account) => {
      if (account.type !== 'wallet' || !('chain_type' in account) || account.chain_type !== 'solana') return [];
      return [account.address];
    });
    return { userId: result.user_id, walletAddresses };
  }
}

export class DisabledExecutionIdentityVerifier implements ExecutionIdentityVerifier {
  async verify(): Promise<never> {
    throw new ProviderResponseError('phoenix', 'Privy execution verification is not configured.', 503);
  }
}

export class JupiterExecutionSource implements SpotExecutionProvider {
  private readonly baseUrl: string;

  constructor(private readonly options: { baseUrl: string; apiKey?: string; timeoutMs: number; fetch?: Fetcher }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
  }

  async searchAssets(query: string): Promise<ExecutionAsset[]> {
    const effectiveQuery = query.trim() || popularMints;
    const response = await this.fetch(`/tokens/v2/search?query=${encodeURIComponent(effectiveQuery)}`);
    const parsed = z.array(tokenSchema).safeParse(response);
    if (!parsed.success) throw new ProviderResponseError('jupiter', 'Jupiter returned unreadable token metadata.');

    return parsed.data
      .filter((token) => token.audit?.isSus !== true)
      .slice(0, 20)
      .flatMap((token) => {
        const iconUrl = token.icon && /^https?:\/\//i.test(token.icon) ? token.icon : null;
        const normalized = executionAssetSchema.safeParse({
          mint: token.id,
          name: token.name,
          symbol: token.symbol,
          iconUrl,
          decimals: token.decimals,
          usdPrice: token.usdPrice ?? null,
          verified: token.isVerified ?? false,
        });
        return normalized.success ? [normalized.data] : [];
      });
  }

  async createOrder(input: { inputMint: string; outputMint: string; amount: string; taker: string }): Promise<JupiterOrder> {
    const params = new URLSearchParams(input);
    const parsed = jupiterOrderSchema.safeParse(await this.fetch(`/swap/v2/order?${params.toString()}`));
    if (!parsed.success) throw new ProviderResponseError('jupiter', 'Jupiter returned an unreadable order.');
    const order = parsed.data;
    if (!order.transaction) {
      throw new ProviderResponseError('jupiter', safeProviderMessage(order.errorMessage, 'Jupiter could not build this order.'), 422);
    }
    const legacyPriceImpact = order.priceImpactPct === undefined ? null : Number(order.priceImpactPct) * 100;
    const lastValidBlockHeight = order.lastValidBlockHeight === null || order.lastValidBlockHeight === undefined
      ? null
      : Number(order.lastValidBlockHeight);
    return {
      transaction: order.transaction,
      requestId: order.requestId,
      inputMint: order.inputMint,
      outputMint: order.outputMint,
      inAmount: order.inAmount,
      outAmount: order.outAmount,
      inUsdValue: order.inUsdValue ?? null,
      outUsdValue: order.outUsdValue ?? null,
      minimumOutputAmount: order.otherAmountThreshold,
      priceImpactPercent: order.priceImpact ?? (Number.isFinite(legacyPriceImpact) ? legacyPriceImpact : null),
      router: order.router,
      mode: order.mode,
      feeBps: order.feeBps,
      feeMint: order.feeMint,
      platformFeeAmount: order.platformFee?.amount ?? null,
      signatureFeeLamports: order.signatureFeeLamports ?? null,
      prioritizationFeeLamports: order.prioritizationFeeLamports ?? null,
      rentFeeLamports: order.rentFeeLamports ?? null,
      lastValidBlockHeight: Number.isSafeInteger(lastValidBlockHeight) ? lastValidBlockHeight : null,
      providerExpiresAt: validDate(order.expireAt),
    };
  }

  async execute(input: { signedTransaction: string; requestId: string; lastValidBlockHeight: number | null }): Promise<JupiterExecution> {
    const parsed = jupiterExecuteSchema.safeParse(await this.fetch('/swap/v2/execute', {
      method: 'POST',
      body: JSON.stringify({
        signedTransaction: input.signedTransaction,
        requestId: input.requestId,
        ...(input.lastValidBlockHeight === null ? {} : { lastValidBlockHeight: String(input.lastValidBlockHeight) }),
      }),
    }));
    if (!parsed.success) throw new ProviderResponseError('jupiter', 'Jupiter returned an unreadable execution result.');
    return {
      success: parsed.data.status === 'Success',
      signature: parsed.data.signature ?? null,
      totalInputAmount: parsed.data.totalInputAmount ?? null,
      totalOutputAmount: parsed.data.totalOutputAmount ?? null,
      message: parsed.data.status === 'Success'
        ? 'Swap confirmed on Solana.'
        : safeProviderMessage(parsed.data.error, 'Jupiter could not complete the swap.'),
    };
  }

  private async fetch(path: string, init: RequestInit = {}) {
    return fetchJson(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(this.options.apiKey ? { 'x-api-key': this.options.apiKey } : {}),
      },
    }, this.options.timeoutMs, 'jupiter', this.options.fetch ?? fetch);
  }
}

export class PhoenixExecutionSource implements PerpetualExecutionProvider {
  private readonly baseUrl: string;

  constructor(private readonly options: { baseUrl: string; timeoutMs: number; fetch?: Fetcher }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
  }

  async login(privyToken: string, walletAddress: string): Promise<PhoenixSession> {
    try {
      const parsed = phoenixLoginSchema.safeParse(await this.fetch('/v1/auth/login/privy', {
        method: 'POST',
        body: JSON.stringify({ privy_token: privyToken, wallet_pubkey: walletAddress }),
      }));
      if (!parsed.success) throw new ProviderResponseError('phoenix', 'Phoenix returned an unreadable session.');
      return { accessToken: parsed.data.access_token };
    } catch (error) {
      if (error instanceof ProviderResponseError && [401, 403, 409].includes(error.status ?? 0)) {
        throw new PhoenixAccountRequiredError();
      }
      throw error;
    }
  }

  async getTraderState(session: PhoenixSession, walletAddress: string): Promise<PhoenixTraderState | null> {
    let body: unknown;
    try {
      body = await this.fetch(`/v1/trader/state/${encodeURIComponent(walletAddress)}?traderPdaIndex=0`, {}, session.accessToken);
    } catch (error) {
      if (error instanceof ProviderResponseError && error.status === 404) return null;
      throw error;
    }
    const root = record(body);
    const snapshot = record(root.snapshot);
    const subaccounts = Array.isArray(snapshot.subaccounts) ? snapshot.subaccounts.map(record) : [];
    if (!subaccounts.length) return null;
    const collateralUsd = subaccounts.reduce((sum, subaccount) => {
      const value = Number(subaccount.collateral);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
    const capabilities = record(record(snapshot.capabilities).capabilities);
    return {
      collateralUsd,
      canPlaceMarketOrder: capabilityAvailable(capabilities.placeMarketOrder),
      canPlaceLimitOrder: capabilityAvailable(capabilities.placeLimitOrder),
      canIncreaseRisk: capabilityAvailable(capabilities.riskIncreasingTrade),
    };
  }

  async getMarkPrice(session: PhoenixSession, symbol: string) {
    const parsed = phoenixMarkSchema.safeParse(await this.fetch(
      `/v1/market/${encodeURIComponent(symbol)}/mark-price`,
      {},
      session.accessToken,
    ));
    if (!parsed.success || !parsed.data.markPrice) throw new ProviderResponseError('phoenix', 'Phoenix did not provide a mark price.', 422);
    return parsed.data.markPrice.price;
  }

  async buildOrder(session: PhoenixSession, input: {
    walletAddress: string;
    symbol: string;
    direction: 'long' | 'short';
    orderType: 'market' | 'limit';
    collateralBaseUnits: string;
    quantity: number;
    limitPrice: number | null;
  }): Promise<PhoenixBuiltOrder> {
    const transferAmount = Number(input.collateralBaseUnits);
    if (!Number.isSafeInteger(transferAmount)) throw new ProviderResponseError('phoenix', 'The collateral amount is too large.', 422);
    const path = input.orderType === 'market'
      ? '/v1/ix/place-isolated-market-order-enhanced'
      : '/v1/ix/place-isolated-limit-order-enhanced';
    const parsed = phoenixBuildSchema.safeParse(await this.fetch(path, {
      method: 'POST',
      body: JSON.stringify({
        authority: input.walletAddress,
        feePayer: input.walletAddress,
        positionAuthority: input.walletAddress,
        pdaIndex: 0,
        symbol: input.symbol,
        side: input.direction === 'long' ? 'bid' : 'ask',
        quantity: input.quantity,
        transferAmount,
        ...(input.orderType === 'limit' ? { price: input.limitPrice } : {}),
      }),
    }, session.accessToken));
    if (!parsed.success) throw new ProviderResponseError('phoenix', 'Phoenix returned unreadable order instructions.');
    return {
      instructions: parsed.data.instructions,
      estimatedLiquidationPriceUsd: parsed.data.estimatedLiquidationPriceUsd ?? null,
    };
  }

  private async fetch(path: string, init: RequestInit = {}, accessToken?: string) {
    return fetchJson(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
    }, this.options.timeoutMs, 'phoenix', this.options.fetch ?? fetch);
  }
}

export class SolanaRpcGateway implements SolanaTransactionGateway {
  private readonly connection: SolanaConnectionLike;

  constructor(rpcUrl: string, connection?: SolanaConnectionLike) {
    this.connection = connection ?? new Connection(rpcUrl, 'confirmed');
  }

  async build(
    walletAddress: string,
    instructions: SolanaInstructionDto[],
    options: { allowedExternalSigners?: readonly string[] } = {},
  ) {
    const payerKey = new PublicKey(walletAddress);
    const allowedExternalSigners = new Set((options.allowedExternalSigners ?? [])
      .map((address) => new PublicKey(address).toBase58()));
    const signerAddresses = instructions.flatMap((instruction) => instruction.keys
      .filter((key) => key.isSigner)
      .map((key) => new PublicKey(key.pubkey).toBase58()));
    if (
      !signerAddresses.includes(payerKey.toBase58())
      || signerAddresses.some((address) => address !== payerKey.toBase58() && !allowedExternalSigners.has(address))
    ) {
      throw new ProviderResponseError('solana', 'Phoenix instructions requested an unexpected signer.', 422);
    }
    const converted = instructions.map((instruction) => new TransactionInstruction({
      programId: new PublicKey(instruction.programId),
      keys: instruction.keys.map((key) => ({
        pubkey: new PublicKey(key.pubkey),
        isSigner: key.isSigner,
        isWritable: key.isWritable,
      })),
      data: Buffer.from(instruction.data),
    }));
    const blockhash = await this.connection.getLatestBlockhash('confirmed');
    const message = new TransactionMessage({
      payerKey,
      recentBlockhash: blockhash.blockhash,
      instructions: converted,
    }).compileToV0Message();
    return {
      unsignedTransaction: Buffer.from(new VersionedTransaction(message).serialize()).toString('base64'),
      lastValidBlockHeight: blockhash.lastValidBlockHeight,
    };
  }

  async submit(signedTransaction: string) {
    const signature = await this.connection.sendRawTransaction(Buffer.from(signedTransaction, 'base64'), {
      maxRetries: 3,
      skipPreflight: false,
    });
    return { signature };
  }

  async getSignatureState(signature: string) {
    const response = await this.connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const status = response.value[0];
    if (!status) return 'unknown' as const;
    if (status.err !== null) return 'failed' as const;
    if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') return 'confirmed' as const;
    return 'pending' as const;
  }
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number, provider: 'jupiter' | 'phoenix', fetcher: Fetcher) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const safeStatus = response.status;
      throw new ProviderResponseError(provider, `${providerName(provider)} request failed.`, safeStatus);
    }
    try {
      return await response.json() as unknown;
    } catch {
      throw new ProviderResponseError(provider, `${providerName(provider)} returned unreadable data.`);
    }
  } catch (error) {
    if (error instanceof ProviderResponseError) throw error;
    throw new ProviderResponseError(provider, `Warren could not reach ${providerName(provider)}.`);
  } finally {
    clearTimeout(timer);
  }
}

function providerName(provider: 'jupiter' | 'phoenix') {
  return provider === 'jupiter' ? 'Jupiter' : 'Phoenix';
}

function validDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeProviderMessage(value: string | undefined, fallback: string) {
  if (!value || value.length > 160 || /[{}<>]/.test(value)) return fallback;
  return value;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function capabilityAvailable(value: unknown) {
  const capability = record(value);
  return capability.immediate === true || capability.viaColdActivation === true;
}
