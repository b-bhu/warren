import { randomUUID } from 'node:crypto';

import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import {
  perpetualExecutionResultSchema,
  perpetualOrderResponseSchema,
  spotAssetSearchResponseSchema,
  spotExecutionResultSchema,
  spotOrderReviewSchema,
  type ExecutionErrorCode,
  type PerpetualExecutionResult,
  type PerpetualOrderCreate,
  type PerpetualOrderResponse,
  type SpotExecutionResult,
  type SpotOrderCreate,
  type SpotOrderReview,
} from '@warren/execution-contract';
import type { MarketsService } from '../markets/service.js';
import type { MarketInstrument, PerpetualInstrument, SpotInstrument } from '@warren/markets-contract';
import nacl from 'tweetnacl';

import { PhoenixAccountRequiredError, ProviderResponseError } from './sources.js';
import type {
  ExecutionIdentity,
  ExecutionServiceContract,
  PerpetualExecutionProvider,
  SolanaTransactionGateway,
  SpotExecutionProvider,
} from './types.js';
import {
  MemoryExecutionIntentStore,
  type ExecutionIntent,
  type ExecutionIntentStore,
} from './store.js';

export class ExecutionServiceFault extends Error {
  constructor(
    readonly code: ExecutionErrorCode,
    readonly status: number,
    message: string,
    readonly retryable = false,
    readonly executionId?: string,
  ) {
    super(message);
  }
}

export class ExecutionService implements ExecutionServiceContract {
  private readonly now: () => Date;
  private readonly store: ExecutionIntentStore;

  constructor(private readonly options: {
    markets: MarketsService;
    spot: SpotExecutionProvider;
    perpetual: PerpetualExecutionProvider;
    solana: SolanaTransactionGateway;
    store?: ExecutionIntentStore;
    intentTtlMs: number;
    now?: () => Date;
  }) {
    this.now = options.now ?? (() => new Date());
    this.store = options.store ?? new MemoryExecutionIntentStore();
  }

  async searchSpotAssets(query: string) {
    try {
      return spotAssetSearchResponseSchema.parse({ items: await this.options.spot.searchAssets(query) });
    } catch (error) {
      throw this.providerFault(error, 'Assets could not be refreshed.');
    }
  }

  async createSpotOrder(identity: ExecutionIdentity, input: SpotOrderCreate): Promise<SpotOrderReview> {
    const walletAddress = this.requireOwnedWallet(identity, input.walletAddress);
    const instrument = await this.resolveInstrument(input.assetId, input.instrumentId, 'spot');
    const stockMint = canonicalAddress(instrument.mint);
    const settlementMint = canonicalAddress(input.settlementMint);
    if (stockMint === settlementMint) {
      throw new ExecutionServiceFault('INVALID_REQUEST', 400, 'Choose an asset different from the stock token.');
    }
    const inputMint = input.direction === 'buy' ? settlementMint : stockMint;
    const outputMint = input.direction === 'buy' ? stockMint : settlementMint;

    try {
      const [order, metadata] = await Promise.all([
        this.options.spot.createOrder({ inputMint, outputMint, amount: input.amount, taker: walletAddress }),
        this.options.spot.searchAssets(`${inputMint},${outputMint}`),
      ]);
      if (
        canonicalAddress(order.inputMint) !== inputMint
        || canonicalAddress(order.outputMint) !== outputMint
        || order.inAmount !== input.amount
      ) {
        throw new ExecutionServiceFault('QUOTE_UNAVAILABLE', 502, 'Jupiter returned an order that does not match the request.', true);
      }
      const inputAsset = metadata.find((asset) => canonicalAddress(asset.mint) === inputMint);
      const outputAsset = metadata.find((asset) => canonicalAddress(asset.mint) === outputMint);
      if (!inputAsset || !outputAsset) {
        throw new ExecutionServiceFault('INSTRUMENT_NOT_EXECUTABLE', 422, 'Token metadata is missing for this pair.');
      }

      const executionId = randomUUID();
      const expiresAt = this.intentExpiry(order.providerExpiresAt);
      const createdAt = this.now().toISOString();
      const review = spotOrderReviewSchema.parse({
        executionId,
        state: 'review',
        product: 'spot',
        assetId: input.assetId,
        instrumentId: input.instrumentId,
        direction: input.direction,
        walletAddress,
        input: {
          mint: inputAsset.mint,
          symbol: inputAsset.symbol,
          decimals: inputAsset.decimals,
          amount: order.inAmount,
          usdValue: order.inUsdValue,
        },
        output: {
          mint: outputAsset.mint,
          symbol: outputAsset.symbol,
          decimals: outputAsset.decimals,
          amount: order.outAmount,
          usdValue: order.outUsdValue,
        },
        minimumOutputAmount: order.minimumOutputAmount,
        priceImpactPercent: order.priceImpactPercent,
        router: order.router,
        mode: order.mode,
        feeBps: order.feeBps,
        feeMint: order.feeMint,
        platformFeeAmount: order.platformFeeAmount,
        signatureFeeLamports: order.signatureFeeLamports,
        prioritizationFeeLamports: order.prioritizationFeeLamports,
        rentFeeLamports: order.rentFeeLamports,
        expiresAt,
        lastValidBlockHeight: order.lastValidBlockHeight,
        unsignedTransaction: order.transaction,
      });
      this.storeIntent({
        kind: 'spot',
        executionId,
        userId: identity.userId,
        walletAddress,
        assetId: input.assetId,
        instrumentId: input.instrumentId,
        companyName: instrument.companyName,
        symbol: instrument.symbol,
        direction: input.direction,
        unsignedTransaction: order.transaction,
        providerRequestId: order.requestId,
        lastValidBlockHeight: order.lastValidBlockHeight,
        expiresAt,
        createdAt,
        updatedAt: createdAt,
        state: 'review',
        valueUsd: input.direction === 'buy' ? order.inUsdValue : order.outUsdValue,
        quantity: input.direction === 'buy'
          ? baseUnitsToDecimalString(order.outAmount, outputAsset.decimals)
          : baseUnitsToDecimalString(order.inAmount, inputAsset.decimals),
      });
      return review;
    } catch (error) {
      if (error instanceof ExecutionServiceFault) throw error;
      throw this.providerFault(error, 'Jupiter did not return a fresh order.');
    }
  }

  async submitSpotOrder(
    identity: ExecutionIdentity,
    executionId: string,
    signedTransaction: string,
    idempotencyKey: string,
  ): Promise<SpotExecutionResult> {
    const intent = this.requireIntent(executionId, 'spot', identity, idempotencyKey);
    if (intent.result) return intent.result;
    if (intent.state !== 'review') return this.reconcileSpotAttempt(intent);
    const transactionSignature = this.validateSignedTransaction(intent, signedTransaction);
    this.markSubmissionAttempted(intent, transactionSignature);
    try {
      const providerResult = await this.options.spot.execute({
        signedTransaction,
        requestId: intent.providerRequestId,
        lastValidBlockHeight: intent.lastValidBlockHeight,
      });
      this.assertProviderSignature(providerResult.signature, transactionSignature);
      const result = spotExecutionResultSchema.parse({
        executionId,
        product: 'spot',
        state: providerResult.success ? 'confirmed' : 'failed',
        signature: transactionSignature,
        inputAmount: providerResult.totalInputAmount,
        outputAmount: providerResult.totalOutputAmount,
        explorerUrl: explorerUrl(transactionSignature),
        message: providerResult.message,
      });
      intent.result = result;
      intent.signature = transactionSignature;
      intent.state = result.state;
      intent.updatedAt = this.now().toISOString();
      intent.failureMessage = undefined;
      if (result.state === 'failed') intent.failureMessage = result.message;
      this.store.update(intent);
      return result;
    } catch (error) {
      intent.state = 'unknown';
      intent.failureMessage = 'Submission status could not be confirmed. Do not resubmit while Warren checks the chain.';
      intent.updatedAt = this.now().toISOString();
      this.store.update(intent);
      throw this.providerFault(error, 'Jupiter could not submit this transaction.', executionId);
    }
  }

  async createPerpetualOrder(identity: ExecutionIdentity, input: PerpetualOrderCreate): Promise<PerpetualOrderResponse> {
    const walletAddress = this.requireOwnedWallet(identity, input.walletAddress);
    const instrument = await this.resolveInstrument(input.assetId, input.instrumentId, 'perpetual');
    if (input.leverage > Math.floor(instrument.maxLeverage)) {
      throw new ExecutionServiceFault('INVALID_REQUEST', 400, `Maximum leverage for ${instrument.symbol} is ${Math.floor(instrument.maxLeverage)}×.`);
    }
    const collateralUsd = baseUnitsToNumber(input.collateralAmount, 6);
    if (collateralUsd <= 0) throw new ExecutionServiceFault('INVALID_REQUEST', 400, 'Enter a collateral amount greater than zero.');

    try {
      const session = await this.options.perpetual.login(identity.rawToken, walletAddress);
      const trader = await this.options.perpetual.getTraderState(session, walletAddress);
      if (!trader) return this.actionRequired('phoenix_account_required', 'Activate a Phoenix trader account before placing a perpetual order.');
      if (trader.collateralUsd < collateralUsd) {
        return this.actionRequired('collateral_required', `Add at least ${formatUsd(collateralUsd)} of Phoenix collateral to place this order.`);
      }
      const canPlace = input.orderType === 'market' ? trader.canPlaceMarketOrder : trader.canPlaceLimitOrder;
      if (!canPlace || !trader.canIncreaseRisk) {
        return this.actionRequired('trading_restricted', 'Phoenix currently restricts this account from increasing risk.');
      }

      const markPrice = await this.options.perpetual.getMarkPrice(session, instrument.symbol);
      const orderPrice = input.orderType === 'limit' ? Number(input.limitPrice) : markPrice;
      if (!Number.isFinite(orderPrice) || orderPrice <= 0) {
        throw new ExecutionServiceFault('INVALID_REQUEST', 400, 'Enter a valid limit price.');
      }
      const notionalUsd = collateralUsd * input.leverage;
      const quantity = notionalUsd / orderPrice;
      const built = await this.options.perpetual.buildOrder(session, {
        walletAddress,
        symbol: instrument.symbol,
        direction: input.direction,
        orderType: input.orderType,
        collateralBaseUnits: input.collateralAmount,
        quantity,
        limitPrice: input.orderType === 'limit' ? orderPrice : null,
      });
      const transaction = await this.options.solana.build(walletAddress, built.instructions);
      const executionId = randomUUID();
      const expiresAt = this.intentExpiry(null);
      const createdAt = this.now().toISOString();
      const review = perpetualOrderResponseSchema.parse({
        executionId,
        state: 'review',
        product: 'perpetual',
        assetId: input.assetId,
        instrumentId: input.instrumentId,
        marketSymbol: instrument.symbol,
        direction: input.direction,
        orderType: input.orderType,
        walletAddress,
        collateralAmount: input.collateralAmount,
        collateralSymbol: 'USDC',
        leverage: input.leverage,
        quantity: trimDecimal(quantity),
        notionalUsd,
        referencePriceUsd: markPrice,
        estimatedLiquidationPriceUsd: built.estimatedLiquidationPriceUsd,
        fundingRatePercent: instrument.fundingRatePercent.value,
        nextFundingAt: instrument.nextFundingAt,
        marginMode: 'isolated',
        expiresAt,
        lastValidBlockHeight: transaction.lastValidBlockHeight,
        unsignedTransaction: transaction.unsignedTransaction,
      });
      if (review.state !== 'review') throw new Error('Unexpected perpetual review state');
      this.storeIntent({
        kind: 'perpetual',
        executionId,
        userId: identity.userId,
        walletAddress,
        assetId: input.assetId,
        instrumentId: input.instrumentId,
        companyName: instrument.companyName,
        symbol: instrument.symbol,
        direction: input.direction,
        unsignedTransaction: transaction.unsignedTransaction,
        expiresAt,
        createdAt,
        updatedAt: createdAt,
        state: 'review',
        valueUsd: notionalUsd,
        quantity: trimDecimal(quantity),
      });
      return review;
    } catch (error) {
      if (error instanceof PhoenixAccountRequiredError) {
        return this.actionRequired('phoenix_account_required', error.message);
      }
      if (error instanceof ExecutionServiceFault) throw error;
      throw this.providerFault(error, 'Phoenix did not return a fresh order.');
    }
  }

  async submitPerpetualOrder(
    identity: ExecutionIdentity,
    executionId: string,
    signedTransaction: string,
    idempotencyKey: string,
  ): Promise<PerpetualExecutionResult> {
    const intent = this.requireIntent(executionId, 'perpetual', identity, idempotencyKey);
    if (intent.result) return intent.result;
    if (intent.state !== 'review') return this.reconcilePerpetualAttempt(intent);
    const transactionSignature = this.validateSignedTransaction(intent, signedTransaction);
    this.markSubmissionAttempted(intent, transactionSignature);
    try {
      const submitted = await this.options.solana.submit(signedTransaction);
      this.assertProviderSignature(submitted.signature, transactionSignature);
      const result = perpetualExecutionResultSchema.parse({
        executionId,
        product: 'perpetual',
        state: 'submitted',
        signature: transactionSignature,
        explorerUrl: explorerUrl(transactionSignature),
        message: 'Phoenix order submitted to Solana.',
      });
      intent.result = result;
      intent.signature = transactionSignature;
      intent.state = 'submitted';
      intent.updatedAt = this.now().toISOString();
      intent.failureMessage = undefined;
      this.store.update(intent);
      return result;
    } catch (error) {
      intent.state = 'unknown';
      intent.failureMessage = 'Submission status could not be confirmed. Do not resubmit while Warren checks the chain.';
      intent.updatedAt = this.now().toISOString();
      this.store.update(intent);
      throw this.providerFault(error, 'Solana could not submit this Phoenix order.', executionId);
    }
  }

  private resolveInstrument(assetId: string, instrumentId: string, product: 'spot'): Promise<SpotInstrument>;
  private resolveInstrument(assetId: string, instrumentId: string, product: 'perpetual'): Promise<PerpetualInstrument>;
  private async resolveInstrument(assetId: string, instrumentId: string, product: 'spot' | 'perpetual'): Promise<MarketInstrument> {
    let company;
    try {
      company = await this.options.markets.getCompany(assetId);
    } catch {
      throw new ExecutionServiceFault('INSTRUMENT_NOT_EXECUTABLE', 404, 'This company is not executable.');
    }
    const instrument = company.instruments.find((candidate) => candidate.instrumentId === instrumentId);
    if (!instrument || instrument.productType !== product) {
      throw new ExecutionServiceFault('INSTRUMENT_NOT_EXECUTABLE', 422, `This ${product} instrument is not executable.`);
    }
    if (instrument.availability !== 'available' || instrument.verificationState !== 'verified') {
      throw new ExecutionServiceFault('INSTRUMENT_NOT_EXECUTABLE', 422, 'This instrument is not verified and available.');
    }
    return instrument;
  }

  private requireOwnedWallet(identity: ExecutionIdentity, address: string) {
    const canonical = canonicalAddress(address);
    if (!identity.walletAddresses.some((candidate) => canonicalAddress(candidate) === canonical)) {
      throw new ExecutionServiceFault('WALLET_MISMATCH', 403, 'This wallet does not belong to the signed-in account.');
    }
    return canonical;
  }

  private requireIntent<TKind extends ExecutionIntent['kind']>(
    executionId: string,
    kind: TKind,
    identity: ExecutionIdentity,
    idempotencyKey: string,
  ): Extract<ExecutionIntent, { kind: TKind }> {
    const intent = this.store.get(executionId);
    if (!intent || intent.kind !== kind) throw new ExecutionServiceFault('EXECUTION_NOT_FOUND', 404, 'This execution could not be found.', false, executionId);
    if (intent.userId !== identity.userId || !identity.walletAddresses.some((address) => canonicalAddress(address) === intent.walletAddress)) {
      throw new ExecutionServiceFault('WALLET_MISMATCH', 403, 'This execution belongs to a different wallet.', false, executionId);
    }
    if (intent.idempotencyKey && intent.idempotencyKey !== idempotencyKey) {
      throw new ExecutionServiceFault('EXECUTION_STATE_INVALID', 409, 'This execution was already submitted with a different key.', false, executionId);
    }
    // A completed submission remains replayable with the same idempotency key even when
    // the provider review window has elapsed. This is what makes retries safe after a restart.
    if (intent.result && intent.idempotencyKey === idempotencyKey) {
      return intent as Extract<ExecutionIntent, { kind: TKind }>;
    }
    if (intent.state === 'review' && new Date(intent.expiresAt).getTime() <= this.now().getTime()) {
      throw new ExecutionServiceFault('QUOTE_EXPIRED', 410, 'This review expired. Get a fresh order.', false, executionId);
    }
    intent.idempotencyKey = idempotencyKey;
    intent.updatedAt = this.now().toISOString();
    this.store.update(intent);
    return intent as Extract<ExecutionIntent, { kind: TKind }>;
  }

  private validateSignedTransaction(intent: ExecutionIntent, signedTransaction: string) {
    try {
      const unsigned = VersionedTransaction.deserialize(Buffer.from(intent.unsignedTransaction, 'base64'));
      const signed = VersionedTransaction.deserialize(Buffer.from(signedTransaction, 'base64'));
      const unsignedMessage = Buffer.from(unsigned.message.serialize());
      const signedMessage = Buffer.from(signed.message.serialize());
      if (!unsignedMessage.equals(signedMessage)) throw new Error('message mismatch');

      const signerIndex = signed.message.staticAccountKeys
        .slice(0, signed.message.header.numRequiredSignatures)
        .findIndex((key) => key.toBase58() === intent.walletAddress);
      if (signerIndex < 0) throw new Error('wallet signer missing');
      const signature = signed.signatures[signerIndex];
      if (!signature || signature.every((byte) => byte === 0)) throw new Error('wallet signature missing');
      if (!nacl.sign.detached.verify(signedMessage, signature, new PublicKey(intent.walletAddress).toBytes())) {
        throw new Error('wallet signature invalid');
      }
      const transactionSignature = signed.signatures[0];
      if (!transactionSignature || transactionSignature.every((byte) => byte === 0)) {
        throw new Error('transaction signature missing');
      }
      return bs58.encode(transactionSignature);
    } catch {
      throw new ExecutionServiceFault('INVALID_REQUEST', 400, 'The signed transaction does not match this review.', false, intent.executionId);
    }
  }

  private assertProviderSignature(providerSignature: string | null, transactionSignature: string) {
    if (providerSignature !== null && providerSignature !== transactionSignature) {
      throw new Error('provider returned a mismatched transaction signature');
    }
  }

  private markSubmissionAttempted(intent: ExecutionIntent, signature: string) {
    // Persist the deterministic Solana signature before the network call. If the
    // process dies after broadcasting, Portfolio can reconcile without resubmitting.
    intent.signature = signature;
    intent.state = 'unknown';
    intent.failureMessage = 'Submission is being confirmed. Do not resubmit while Warren checks Solana.';
    intent.updatedAt = this.now().toISOString();
    intent.submittedAt ??= intent.updatedAt;
    this.store.update(intent);
  }

  private async reconcileSpotAttempt(intent: Extract<ExecutionIntent, { kind: 'spot' }>): Promise<SpotExecutionResult> {
    const state = await this.readTerminalSignatureState(intent);
    const result = spotExecutionResultSchema.parse({
      executionId: intent.executionId,
      product: 'spot',
      state,
      signature: intent.signature!,
      inputAmount: null,
      outputAmount: null,
      explorerUrl: explorerUrl(intent.signature!),
      message: state === 'confirmed'
        ? 'Spot transaction confirmed on Solana.'
        : 'Spot transaction failed on Solana.',
    });
    intent.result = result;
    intent.state = state;
    intent.failureMessage = state === 'failed' ? result.message : undefined;
    intent.updatedAt = this.now().toISOString();
    this.store.update(intent);
    return result;
  }

  private async reconcilePerpetualAttempt(intent: Extract<ExecutionIntent, { kind: 'perpetual' }>): Promise<PerpetualExecutionResult> {
    const state = await this.readTerminalSignatureState(intent);
    const result = perpetualExecutionResultSchema.parse({
      executionId: intent.executionId,
      product: 'perpetual',
      state,
      signature: intent.signature!,
      explorerUrl: explorerUrl(intent.signature!),
      message: state === 'confirmed'
        ? 'Phoenix order transaction confirmed on Solana.'
        : 'Phoenix order transaction failed on Solana.',
    });
    intent.result = result;
    intent.state = state;
    intent.failureMessage = state === 'failed' ? result.message : undefined;
    intent.updatedAt = this.now().toISOString();
    this.store.update(intent);
    return result;
  }

  private async readTerminalSignatureState(intent: ExecutionIntent): Promise<'confirmed' | 'failed'> {
    if (!intent.signature) {
      throw new ExecutionServiceFault('EXECUTION_STATE_INVALID', 409, 'This submission is still being reconciled.', true, intent.executionId);
    }
    if (intent.state === 'confirmed' || intent.state === 'failed') return intent.state;
    try {
      const state = await this.options.solana.getSignatureState(intent.signature);
      if (state === 'confirmed' || state === 'failed') return state;
    } catch {
      // A status read failure is recoverable; never resubmit an already-attempted transaction.
    }
    throw new ExecutionServiceFault(
      'EXECUTION_STATE_INVALID',
      409,
      'This submission was already attempted. Wait while Warren reconciles its Solana status.',
      true,
      intent.executionId,
    );
  }

  private actionRequired(action: 'phoenix_account_required' | 'collateral_required' | 'trading_restricted', message: string) {
    return perpetualOrderResponseSchema.parse({
      state: 'action_required',
      product: 'perpetual',
      action,
      message,
      providerUrl: 'https://www.phoenix.trade/',
    });
  }

  private intentExpiry(providerExpiresAt: string | null) {
    const localExpiry = this.now().getTime() + this.options.intentTtlMs;
    const providerExpiry = providerExpiresAt ? new Date(providerExpiresAt).getTime() : Number.POSITIVE_INFINITY;
    return new Date(Math.min(localExpiry, providerExpiry)).toISOString();
  }

  private storeIntent(intent: ExecutionIntent) {
    this.store.deleteExpired(this.now().toISOString());
    this.store.save(intent);
  }

  private providerFault(error: unknown, fallback: string, executionId?: string) {
    if (error instanceof ExecutionServiceFault) return error;
    if (error instanceof ProviderResponseError && error.status === 422) {
      return new ExecutionServiceFault('QUOTE_UNAVAILABLE', 422, error.message, false, executionId);
    }
    return new ExecutionServiceFault('PROVIDER_UNAVAILABLE', 502, fallback, true, executionId);
  }
}

function canonicalAddress(address: string) {
  try {
    return new PublicKey(address).toBase58();
  } catch {
    throw new ExecutionServiceFault('INVALID_REQUEST', 400, 'The wallet or mint address is not valid.');
  }
}

function baseUnitsToNumber(value: string, decimals: number) {
  const amount = BigInt(value);
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = amount % scale;
  return Number(whole) + Number(fraction) / Number(scale);
}

function baseUnitsToDecimalString(value: string, decimals: number) {
  const amount = BigInt(value);
  if (decimals === 0) return amount.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function trimDecimal(value: number) {
  return value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}

function formatUsd(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}

function explorerUrl(signature: string) {
  return `https://solscan.io/tx/${encodeURIComponent(signature)}`;
}
