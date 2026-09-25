import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import type { ExecutionAsset } from '@warren/execution-contract';
import bs58 from 'bs58';
import type { MarketsService } from '../src/markets/service.js';
import { ExecutionService, ExecutionServiceFault } from '../src/execution/service.js';
import { MemoryExecutionIntentStore, SqliteExecutionIntentStore, type ExecutionIntentStore } from '../src/execution/store.js';
import { JupiterExecutionSource, PhoenixExecutionSource, SolanaRpcGateway } from '../src/execution/sources.js';
import { openDatabase } from '../src/db.js';
import type {
  JupiterExecution,
  JupiterOrder,
  PerpetualExecutionProvider,
  PhoenixBuiltOrder,
  PhoenixSession,
  PhoenixTraderState,
  SolanaTransactionGateway,
  SpotExecutionProvider,
} from '../src/execution/types.js';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

class FakeSpotProvider implements SpotExecutionProvider {
  orderCalls: { inputMint: string; outputMint: string; amount: string; taker: string }[] = [];
  executeCalls = 0;
  failExecute = false;
  returnedSignature: string | null | undefined;

  constructor(private readonly transaction: string, private readonly stockMint: string) {}

  async searchAssets(query: string): Promise<ExecutionAsset[]> {
    const requested = new Set(query.split(','));
    return [asset(USDC, 'USDC', 6), asset(this.stockMint, 'NVDAx', 8)].filter((item) => requested.has(item.mint));
  }

  async createOrder(input: { inputMint: string; outputMint: string; amount: string; taker: string }): Promise<JupiterOrder> {
    this.orderCalls.push(input);
    return {
      transaction: this.transaction,
      requestId: 'jupiter-request-1',
      inputMint: input.inputMint,
      outputMint: input.outputMint,
      inAmount: input.amount,
      outAmount: '123400000',
      inUsdValue: 100,
      outUsdValue: 99.5,
      minimumOutputAmount: '122000000',
      priceImpactPercent: -0.1,
      router: 'metis',
      mode: 'ultra',
      feeBps: 10,
      feeMint: input.inputMint,
      platformFeeAmount: '1000',
      signatureFeeLamports: 5_000,
      prioritizationFeeLamports: 1_000,
      rentFeeLamports: 0,
      lastValidBlockHeight: 123,
      providerExpiresAt: null,
    };
  }

  async execute(input: { signedTransaction: string }): Promise<JupiterExecution> {
    this.executeCalls += 1;
    if (this.failExecute) throw new Error('response lost after broadcast');
    return {
      success: true,
      signature: this.returnedSignature === undefined
        ? transactionSignature(input.signedTransaction)
        : this.returnedSignature,
      totalInputAmount: '100000000',
      totalOutputAmount: '123400000',
      message: 'Swap confirmed on Solana.',
    };
  }
}

class FakePerpetualProvider implements PerpetualExecutionProvider {
  state: PhoenixTraderState | null = {
    collateralUsd: 1_000,
    canPlaceLimitOrder: true,
    canPlaceMarketOrder: true,
    canIncreaseRisk: true,
  };
  built?: { quantity: number; direction: 'long' | 'short' };

  async login(): Promise<PhoenixSession> { return { accessToken: 'phoenix-token' }; }
  async getTraderState(): Promise<PhoenixTraderState | null> { return this.state; }
  async getMarkPrice(): Promise<number> { return 200; }
  async buildOrder(_session: PhoenixSession, input: { direction: 'long' | 'short'; quantity: number }): Promise<PhoenixBuiltOrder> {
    this.built = { direction: input.direction, quantity: input.quantity };
    return { instructions: [], estimatedLiquidationPriceUsd: 165 };
  }
}

class FakeSolanaGateway implements SolanaTransactionGateway {
  submits = 0;
  signatureState: 'confirmed' | 'failed' | 'pending' | 'unknown' = 'unknown';
  returnedSignature: string | undefined;
  constructor(private readonly transaction: string) {}
  async build(): Promise<{ unsignedTransaction: string; lastValidBlockHeight: number }> {
    return { unsignedTransaction: this.transaction, lastValidBlockHeight: 456 };
  }
  async submit(signedTransaction: string): Promise<{ signature: string }> {
    this.submits += 1;
    return { signature: this.returnedSignature ?? transactionSignature(signedTransaction) };
  }
  async getSignatureState() { return this.signatureState; }
}

test('spot execution locks the stock mint, verifies the wallet signature, and submits idempotently', async () => {
  const wallet = Keypair.generate();
  const stockMint = Keypair.generate().publicKey.toBase58();
  const unsignedTransaction = unsigned(wallet);
  const spot = new FakeSpotProvider(unsignedTransaction, stockMint);
  const perpetual = new FakePerpetualProvider();
  const solana = new FakeSolanaGateway(unsignedTransaction);
  const service = executionService(wallet, stockMint, spot, perpetual, solana);
  const identity = { userId: 'did:privy:test', rawToken: 'privy-token', walletAddresses: [wallet.publicKey.toBase58()] };

  const review = await service.createSpotOrder(identity, {
    assetId: 'nvidia',
    instrumentId: 'spot:nvidia:xstocks',
    direction: 'buy',
    settlementMint: USDC,
    amount: '100000000',
    walletAddress: wallet.publicKey.toBase58(),
  });
  assert.equal(spot.orderCalls[0]?.inputMint, USDC);
  assert.equal(spot.orderCalls[0]?.outputMint, stockMint);
  assert.equal(review.output.mint, stockMint);

  const signedTransaction = sign(unsignedTransaction, wallet);
  const first = await service.submitSpotOrder(identity, review.executionId, signedTransaction, 'spot-submit-key-0001');
  const replay = await service.submitSpotOrder(identity, review.executionId, signedTransaction, 'spot-submit-key-0001');
  assert.equal(first.state, 'confirmed');
  assert.equal(first.signature, transactionSignature(signedTransaction));
  assert.deepEqual(replay, first);
  assert.equal(spot.executeCalls, 1);

  await assert.rejects(
    service.submitSpotOrder(identity, review.executionId, signedTransaction, 'different-submit-key'),
    (error: unknown) => error instanceof ExecutionServiceFault && error.code === 'EXECUTION_STATE_INVALID',
  );
});

test('submission retains the verified local signature and rejects a mismatched provider signature', async () => {
  const wallet = Keypair.generate();
  const stockMint = Keypair.generate().publicKey.toBase58();
  const transaction = unsigned(wallet);
  const signedTransaction = sign(transaction, wallet);
  const spot = new FakeSpotProvider(transaction, stockMint);
  const perpetual = new FakePerpetualProvider();
  const solana = new FakeSolanaGateway(transaction);
  const store = new MemoryExecutionIntentStore();
  const identity = { userId: 'did:privy:signatures', rawToken: 'privy-token', walletAddresses: [wallet.publicKey.toBase58()] };
  const service = executionService(wallet, stockMint, spot, perpetual, solana, { store });

  spot.returnedSignature = null;
  const spotReview = await service.createSpotOrder(identity, {
    assetId: 'nvidia', instrumentId: 'spot:nvidia:xstocks', direction: 'buy', settlementMint: USDC,
    amount: '100000000', walletAddress: wallet.publicKey.toBase58(),
  });
  const spotResult = await service.submitSpotOrder(identity, spotReview.executionId, signedTransaction, 'null-provider-signature');
  assert.equal(spotResult.signature, transactionSignature(signedTransaction));
  assert.equal(store.get(spotReview.executionId)?.signature, transactionSignature(signedTransaction));

  const mismatchSpot = new FakeSpotProvider(transaction, stockMint);
  mismatchSpot.returnedSignature = '5'.repeat(88);
  const mismatchStore = new MemoryExecutionIntentStore();
  const mismatchService = executionService(wallet, stockMint, mismatchSpot, perpetual, solana, { store: mismatchStore });
  const mismatchReview = await mismatchService.createSpotOrder(identity, {
    assetId: 'nvidia', instrumentId: 'spot:nvidia:xstocks', direction: 'buy', settlementMint: USDC,
    amount: '100000000', walletAddress: wallet.publicKey.toBase58(),
  });
  await assert.rejects(mismatchService.submitSpotOrder(
    identity,
    mismatchReview.executionId,
    signedTransaction,
    'mismatched-provider-signature',
  ));
  assert.equal(mismatchStore.get(mismatchReview.executionId)?.signature, transactionSignature(signedTransaction));
  assert.equal(mismatchStore.get(mismatchReview.executionId)?.state, 'unknown');

  const mismatchSolana = new FakeSolanaGateway(transaction);
  mismatchSolana.returnedSignature = '4'.repeat(88);
  const perpStore = new MemoryExecutionIntentStore();
  const perpService = executionService(wallet, stockMint, new FakeSpotProvider(transaction, stockMint), perpetual, mismatchSolana, { store: perpStore });
  const perpReview = await perpService.createPerpetualOrder(identity, {
    assetId: 'nvidia', instrumentId: 'perpetual:phoenix:nvda', direction: 'long', orderType: 'market',
    collateralAmount: '100000000', leverage: 5, limitPrice: null, walletAddress: wallet.publicKey.toBase58(),
  });
  assert.equal(perpReview.state, 'review');
  if (perpReview.state !== 'review') return;
  await assert.rejects(perpService.submitPerpetualOrder(
    identity,
    perpReview.executionId,
    signedTransaction,
    'mismatched-rpc-signature',
  ));
  assert.equal(perpStore.get(perpReview.executionId)?.signature, transactionSignature(signedTransaction));
  assert.equal(perpStore.get(perpReview.executionId)?.state, 'unknown');
});

test('a terminal execution remains idempotent across a service restart and review expiry', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'warren-execution-ledger-'));
  const db = openDatabase(`file:${join(directory, 'test.db')}`);
  try {
    const wallet = Keypair.generate();
    const stockMint = Keypair.generate().publicKey.toBase58();
    const transaction = unsigned(wallet);
    const spot = new FakeSpotProvider(transaction, stockMint);
    const perpetual = new FakePerpetualProvider();
    const solana = new FakeSolanaGateway(transaction);
    const identity = { userId: 'did:privy:persisted', rawToken: 'privy-token', walletAddresses: [wallet.publicKey.toBase58()] };
    const first = executionService(wallet, stockMint, spot, perpetual, solana, {
      store: new SqliteExecutionIntentStore(db),
      now: () => new Date('2026-09-23T10:00:00.000Z'),
    });
    const review = await first.createSpotOrder(identity, {
      assetId: 'nvidia', instrumentId: 'spot:nvidia:xstocks', direction: 'buy', settlementMint: USDC,
      amount: '100000000', walletAddress: wallet.publicKey.toBase58(),
    });
    const signed = sign(transaction, wallet);
    const submitted = await first.submitSpotOrder(identity, review.executionId, signed, 'persistent-submit-key');

    const restarted = executionService(wallet, stockMint, spot, perpetual, solana, {
      store: new SqliteExecutionIntentStore(db),
      now: () => new Date('2026-09-23T10:02:00.000Z'),
    });
    const replay = await restarted.submitSpotOrder(identity, review.executionId, signed, 'persistent-submit-key');
    assert.deepEqual(replay, submitted);
    assert.equal(spot.executeCalls, 1);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a crash-window retry reconciles the persisted Solana signature without resubmitting', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'warren-execution-reconcile-'));
  const db = openDatabase(`file:${join(directory, 'test.db')}`);
  try {
    const wallet = Keypair.generate();
    const stockMint = Keypair.generate().publicKey.toBase58();
    const transaction = unsigned(wallet);
    const spot = new FakeSpotProvider(transaction, stockMint);
    const perpetual = new FakePerpetualProvider();
    const solana = new FakeSolanaGateway(transaction);
    const identity = { userId: 'did:privy:reconcile', rawToken: 'privy-token', walletAddresses: [wallet.publicKey.toBase58()] };
    const first = executionService(wallet, stockMint, spot, perpetual, solana, {
      store: new SqliteExecutionIntentStore(db),
      now: () => new Date('2026-09-23T10:00:00.000Z'),
    });
    const review = await first.createSpotOrder(identity, {
      assetId: 'nvidia', instrumentId: 'spot:nvidia:xstocks', direction: 'buy', settlementMint: USDC,
      amount: '100000000', walletAddress: wallet.publicKey.toBase58(),
    });
    const signed = sign(transaction, wallet);
    spot.failExecute = true;
    await assert.rejects(first.submitSpotOrder(identity, review.executionId, signed, 'crash-window-key'));

    spot.failExecute = false;
    solana.signatureState = 'confirmed';
    const restarted = executionService(wallet, stockMint, spot, perpetual, solana, {
      store: new SqliteExecutionIntentStore(db),
      now: () => new Date('2026-09-23T10:02:00.000Z'),
    });
    const recovered = await restarted.submitSpotOrder(identity, review.executionId, signed, 'crash-window-key');
    assert.equal(recovered.state, 'confirmed');
    assert.equal(spot.executeCalls, 1);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('spot execution rejects an address outside the authenticated Privy account', async () => {
  const wallet = Keypair.generate();
  const other = Keypair.generate();
  const stockMint = Keypair.generate().publicKey.toBase58();
  const transaction = unsigned(wallet);
  const service = executionService(wallet, stockMint, new FakeSpotProvider(transaction, stockMint), new FakePerpetualProvider(), new FakeSolanaGateway(transaction));

  await assert.rejects(
    service.createSpotOrder(
      { userId: 'did:privy:test', rawToken: 'token', walletAddresses: [other.publicKey.toBase58()] },
      { assetId: 'nvidia', instrumentId: 'spot:nvidia:xstocks', direction: 'buy', settlementMint: USDC, amount: '1', walletAddress: wallet.publicKey.toBase58() },
    ),
    (error: unknown) => error instanceof ExecutionServiceFault && error.code === 'WALLET_MISMATCH',
  );
});

test('perpetual execution returns truthful setup states, then builds and submits an isolated order', async () => {
  const wallet = Keypair.generate();
  const stockMint = Keypair.generate().publicKey.toBase58();
  const transaction = unsigned(wallet);
  const perpetual = new FakePerpetualProvider();
  const solana = new FakeSolanaGateway(transaction);
  const service = executionService(wallet, stockMint, new FakeSpotProvider(transaction, stockMint), perpetual, solana);
  const identity = { userId: 'did:privy:test', rawToken: 'privy-token', walletAddresses: [wallet.publicKey.toBase58()] };
  const order = {
    assetId: 'nvidia',
    instrumentId: 'perpetual:phoenix:nvda',
    direction: 'long' as const,
    orderType: 'market' as const,
    collateralAmount: '100000000',
    leverage: 5,
    limitPrice: null,
    walletAddress: wallet.publicKey.toBase58(),
  };

  perpetual.state = null;
  const setup = await service.createPerpetualOrder(identity, order);
  assert.equal(setup.state, 'action_required');
  if (setup.state === 'action_required') assert.equal(setup.action, 'phoenix_account_required');

  perpetual.state = { collateralUsd: 1_000, canPlaceLimitOrder: true, canPlaceMarketOrder: true, canIncreaseRisk: true };
  const review = await service.createPerpetualOrder(identity, order);
  assert.equal(review.state, 'review');
  if (review.state !== 'review') return;
  assert.equal(review.marginMode, 'isolated');
  assert.equal(review.notionalUsd, 500);
  assert.equal(perpetual.built?.quantity, 2.5);

  const result = await service.submitPerpetualOrder(identity, review.executionId, sign(transaction, wallet), 'perp-submit-key-0001');
  assert.equal(result.state, 'submitted');
  assert.equal(solana.submits, 1);
});

test('Jupiter adapter normalizes Tokens and Swap V2 without leaking provider shapes', async () => {
  const wallet = Keypair.generate();
  const stockMint = Keypair.generate().publicKey.toBase58();
  const transaction = unsigned(wallet);
  const calls: { url: string; init?: RequestInit }[] = [];
  const source = new JupiterExecutionSource({
    baseUrl: 'https://api.jup.test',
    apiKey: 'jupiter-key',
    timeoutMs: 1_000,
    fetch: async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes('/tokens/')) return json([
        { id: USDC, name: 'USD Coin', symbol: 'USDC', icon: null, decimals: 6, usdPrice: 1, isVerified: true, audit: {} },
        { id: stockMint, name: 'NVIDIA xStock', symbol: 'NVDAx', icon: 'https://images.test/nvda.png', decimals: 8, usdPrice: 200, isVerified: true, audit: {} },
        { id: Keypair.generate().publicKey.toBase58(), name: 'Suspicious', symbol: 'SUS', decimals: 6, audit: { isSus: true } },
      ]);
      if (url.endsWith('/swap/v2/execute')) return json({ status: 'Success', signature: '5'.repeat(88), code: 0, totalInputAmount: '1000000', totalOutputAmount: '500000' });
      return json({
        transaction, requestId: 'request-1', inputMint: USDC, outputMint: stockMint, inAmount: '1000000', outAmount: '500000',
        inUsdValue: 1, outUsdValue: 0.99, priceImpact: -0.02, otherAmountThreshold: '490000', router: 'metis', mode: 'ultra',
        feeBps: 10, feeMint: USDC, platformFee: { amount: '100' }, signatureFeeLamports: 5_000, prioritizationFeeLamports: 1_000,
        rentFeeLamports: 0, lastValidBlockHeight: '1234',
      });
    },
  });

  const assets = await source.searchAssets(`${USDC},${stockMint}`);
  assert.equal(assets.length, 2);
  assert.equal(assets[1]?.symbol, 'NVDAx');
  const order = await source.createOrder({ inputMint: USDC, outputMint: stockMint, amount: '1000000', taker: wallet.publicKey.toBase58() });
  assert.equal(order.minimumOutputAmount, '490000');
  assert.equal(order.lastValidBlockHeight, 1234);
  const result = await source.execute({ signedTransaction: sign(transaction, wallet), requestId: order.requestId, lastValidBlockHeight: order.lastValidBlockHeight });
  assert.equal(result.success, true);
  assert.equal(new Headers(calls[0]?.init?.headers).get('x-api-key'), 'jupiter-key');
});

test('Phoenix and Solana adapters preserve provider instructions and reject unexpected signers', async () => {
  const wallet = Keypair.generate();
  const other = Keypair.generate();
  const programId = SystemProgram.programId.toBase58();
  let buildBody: Record<string, unknown> | undefined;
  const phoenix = new PhoenixExecutionSource({
    baseUrl: 'https://phoenix.test',
    timeoutMs: 1_000,
    fetch: async (input, init) => {
      const url = String(input);
      if (url.endsWith('/v1/auth/login/privy')) return json({ access_token: 'phoenix-access' });
      if (url.includes('/v1/trader/state/')) return json({ snapshot: {
        subaccounts: [{ collateral: '25.5' }],
        capabilities: { capabilities: {
          placeMarketOrder: { immediate: true }, placeLimitOrder: { immediate: true }, riskIncreasingTrade: { immediate: true },
        } },
      } });
      if (url.includes('/mark-price')) return json({ markPrice: { price: 200, slot: 1 }, slot: 1, slotIndex: 0, symbol: 'NVDA' });
      buildBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return json({ instructions: [{ programId, keys: [{ pubkey: wallet.publicKey.toBase58(), isSigner: true, isWritable: true }], data: [1, 2, 3] }], estimatedLiquidationPriceUsd: 165 });
    },
  });
  const session = await phoenix.login('privy-token', wallet.publicKey.toBase58());
  const state = await phoenix.getTraderState(session, wallet.publicKey.toBase58());
  assert.equal(state?.collateralUsd, 25.5);
  assert.equal(await phoenix.getMarkPrice(session, 'NVDA'), 200);
  const built = await phoenix.buildOrder(session, {
    walletAddress: wallet.publicKey.toBase58(), symbol: 'NVDA', direction: 'long', orderType: 'market',
    collateralBaseUnits: '1000000', quantity: 0.025, limitPrice: null,
  });
  assert.equal(buildBody?.side, 'bid');
  assert.equal(built.estimatedLiquidationPriceUsd, 165);

  let sent = false;
  const gateway = new SolanaRpcGateway('https://rpc.test', {
    async getLatestBlockhash() { return { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 999 }; },
    async sendRawTransaction() { sent = true; return '4'.repeat(88); },
    async getSignatureStatuses() { return { value: [{ err: null, confirmationStatus: 'confirmed' }] }; },
  });
  const assembled = await gateway.build(wallet.publicKey.toBase58(), built.instructions);
  assert.equal(assembled.lastValidBlockHeight, 999);
  await gateway.submit(sign(assembled.unsignedTransaction, wallet));
  assert.equal(sent, true);

  await assert.rejects(gateway.build(wallet.publicKey.toBase58(), [{
    programId,
    keys: [{ pubkey: other.publicKey.toBase58(), isSigner: true, isWritable: false }],
    data: [1],
  }]));
});

function executionService(
  wallet: Keypair,
  stockMint: string,
  spot: SpotExecutionProvider,
  perpetual: PerpetualExecutionProvider,
  solana: SolanaTransactionGateway,
  options: { store?: ExecutionIntentStore; now?: () => Date } = {},
) {
  const markets = {
    async getCompany() {
      return {
        instruments: [
          {
            instrumentId: 'spot:nvidia:xstocks', assetId: 'nvidia', productType: 'spot', availability: 'available', verificationState: 'verified', mint: stockMint,
            symbol: 'NVDAx', provider: 'xStocks', providerUrl: 'https://xstocks.test', companyName: 'NVIDIA', ticker: 'NVDA', logoUrl: null,
            exactIdentifier: stockMint, description: 'NVIDIA token', marketValue: { label: 'Token price', amount: 200, currency: 'USD', asOf: null, dataState: 'live' },
            network: 'Solana', issuer: 'xStocks', stockVariantTier: 'share_redeemable', changePercent: metric(1), volume24hUsd: metric(1_000), liquidityUsd: 1_000,
          },
          {
            instrumentId: 'perpetual:phoenix:nvda', assetId: 'nvidia', productType: 'perpetual', availability: 'available', verificationState: 'verified',
            symbol: 'NVDA', provider: 'Phoenix', providerUrl: 'https://phoenix.test', companyName: 'NVIDIA', ticker: 'NVDA', logoUrl: null,
            exactIdentifier: wallet.publicKey.toBase58(), description: 'NVIDIA perpetual', marketValue: { label: 'Mark price', amount: 200, currency: 'USD', asOf: null, dataState: 'live' },
            venue: 'Phoenix', marketPubkey: wallet.publicKey.toBase58(), marginMode: 'isolated', maxLeverage: 20,
            fundingRatePercent: metric(0.01), nextFundingAt: null, openInterestBase: 1, oracleLabel: 'NVDA/USD',
          },
        ],
      };
    },
  } as unknown as MarketsService;
  return new ExecutionService({ markets, spot, perpetual, solana, store: options.store, now: options.now, intentTtlMs: 90_000 });
}

function unsigned(wallet: Keypair) {
  const instruction = SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: wallet.publicKey, lamports: 0 });
  const message = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [instruction],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString('base64');
}

function sign(transaction: string, wallet: Keypair) {
  const value = VersionedTransaction.deserialize(Buffer.from(transaction, 'base64'));
  value.sign([wallet]);
  return Buffer.from(value.serialize()).toString('base64');
}

function transactionSignature(transaction: string) {
  const signature = VersionedTransaction.deserialize(Buffer.from(transaction, 'base64')).signatures[0];
  if (!signature) throw new Error('transaction signature missing');
  return bs58.encode(signature);
}

function asset(mint: string, symbol: string, decimals: number): ExecutionAsset {
  return { mint, symbol, decimals, name: symbol, iconUrl: null, usdPrice: 1, verified: true };
}

function metric(value: number) {
  return { value, asOf: null, dataState: 'live' as const };
}

function json(value: unknown) {
  return Promise.resolve(new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
}
