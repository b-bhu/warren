import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  PortfolioProviderError,
  type PhoenixFundingActivity,
  type PhoenixPortfolioOrder,
  type PhoenixPortfolioPosition,
  type PhoenixPortfolioSnapshot,
  type PhoenixPortfolioSourceContract,
  type PhoenixTradeActivity,
  type SignatureState,
  type WalletPortfolioSource,
  type WalletSnapshot,
  type WalletTokenBalance,
  type WalletTransfer,
} from './types.js';

type Fetcher = typeof fetch;

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';
const decimalStringSchema = z.string()
  .regex(/^-?\d+(?:\.\d+)?$/)
  .refine((value) => Number.isFinite(Number(value)));
const nonnegativeDecimalStringSchema = decimalStringSchema.refine((value) => Number(value) >= 0);
const positiveDecimalStringSchema = decimalStringSchema.refine((value) => Number(value) > 0);
const integerStringSchema = z.string()
  .regex(/^-?\d+$/)
  .refine((value) => Number.isSafeInteger(Number(value)));

const rpcEnvelopeSchema = z.object({
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).passthrough().optional(),
}).passthrough();

const tokenAccountsResultSchema = z.object({
  value: z.array(z.object({
    account: z.object({
      data: z.object({
        parsed: z.object({
          info: z.object({
            mint: z.string(),
            tokenAmount: z.object({
              amount: z.string().regex(/^\d+$/),
              decimals: z.number().int().min(0).max(18),
            }).passthrough(),
          }).passthrough(),
        }).passthrough(),
      }).passthrough(),
    }).passthrough(),
  }).passthrough()),
}).passthrough();

const transferResultSchema = z.object({
  data: z.array(z.object({
    signature: z.string(),
    blockTime: z.number().finite().positive(),
    fromUserAccount: z.string().nullable().optional(),
    toUserAccount: z.string().nullable().optional(),
    mint: z.string(),
    amount: z.string().regex(/^\d+$/),
    decimals: z.number().int().min(0).max(18),
    uiAmount: z.union([z.string(), z.number()]).optional(),
    confirmationStatus: z.string().optional(),
  }).passthrough()),
  paginationToken: z.string().nullable().optional(),
}).passthrough();

export class HeliusPortfolioSource implements WalletPortfolioSource {
  constructor(private readonly options: { rpcUrl: string; timeoutMs: number; fetch?: Fetcher }) {}

  async loadWallet(address: string): Promise<WalletSnapshot> {
    const [balanceBody, classicBody, token2022Body, solAssetBody] = await Promise.all([
      this.rpc('getBalance', [address, { commitment: 'confirmed' }]),
      this.rpc('getTokenAccountsByOwner', [address, { programId: TOKEN_PROGRAM }, { encoding: 'jsonParsed', commitment: 'confirmed' }]),
      this.rpc('getTokenAccountsByOwner', [address, { programId: TOKEN_2022_PROGRAM }, { encoding: 'jsonParsed', commitment: 'confirmed' }]),
      this.rpc('getAsset', { id: WRAPPED_SOL_MINT, options: { showFungible: true } }),
    ]);

    const balance = z.object({
      value: z.number().int().nonnegative().refine(Number.isSafeInteger, 'Lamport balance exceeds safe integer precision.'),
    }).passthrough().parse(balanceBody);
    const tokenRows = [classicBody, token2022Body].flatMap((body) => tokenAccountsResultSchema.parse(body).value);
    const balances = new Map<string, WalletTokenBalance>();
    for (const row of tokenRows) {
      const token = row.account.data.parsed.info;
      const prior = balances.get(token.mint);
      if (prior && prior.decimals !== token.tokenAmount.decimals) {
        throw new PortfolioProviderError('helius', 'One wallet mint returned conflicting decimals.', undefined, false);
      }
      balances.set(token.mint, {
        mint: token.mint,
        rawAmount: (BigInt(prior?.rawAmount ?? '0') + BigInt(token.tokenAmount.amount)).toString(),
        decimals: token.tokenAmount.decimals,
      });
    }

    const solAsset = z.object({
      token_info: z.object({
        price_info: z.object({ price_per_token: z.number().finite().positive() }).passthrough().nullable().optional(),
      }).passthrough().optional(),
    }).passthrough().safeParse(solAssetBody);

    return {
      address,
      solLamports: String(balance.value),
      solPriceUsd: solAsset.success ? solAsset.data.token_info?.price_info?.price_per_token ?? null : null,
      tokens: [...balances.values()],
      observedAt: new Date().toISOString(),
    };
  }

  async loadTransfers(input: {
    address: string;
    before?: string;
    limit: number;
    maxPages: number;
    mintAllowlist?: readonly string[];
    queryMints?: readonly string[];
    referenceQuery?: string;
  }) {
    const items: WalletTransfer[] = [];
    let paginationToken: string | undefined;
    let exhausted = false;
    const beforeEpoch = input.before ? Math.floor(new Date(input.before).getTime() / 1_000) : undefined;
    const mintAllowlist = input.mintAllowlist ? new Set(input.mintAllowlist) : null;
    const queryMints = input.queryMints ? new Set(input.queryMints) : null;
    const referenceQuery = input.referenceQuery?.toLocaleLowerCase();

    for (let page = 0; page < input.maxPages && items.length < input.limit; page += 1) {
      const result = transferResultSchema.parse(await this.rpc('getTransfersByAddress', [input.address, {
        limit: Math.min(100, Math.max(input.limit, 20)),
        solMode: 'merged',
        ...(paginationToken ? { paginationToken } : {}),
        // Include the cursor second. The service applies the opaque ID tie-breaker,
        // preventing same-second transactions from being skipped between pages.
        ...(beforeEpoch ? { filters: { blockTime: { lt: beforeEpoch + 1 } } } : {}),
      }]));
      items.push(...result.data.flatMap((transfer): WalletTransfer[] => {
        if (mintAllowlist && !mintAllowlist.has(transfer.mint)) return [];
        if (queryMints && !queryMints.has(transfer.mint)) return [];
        if (referenceQuery && !transfer.signature.toLocaleLowerCase().includes(referenceQuery)) return [];
        return [{
          signature: transfer.signature,
          blockTime: new Date(transfer.blockTime * 1_000).toISOString(),
          from: transfer.fromUserAccount ?? null,
          to: transfer.toUserAccount ?? null,
          mint: transfer.mint,
          rawAmount: transfer.amount,
          decimals: transfer.decimals,
          quantity: baseUnitsToDecimalString(transfer.amount, transfer.decimals),
          confirmationStatus: normalizeConfirmationStatus(transfer.confirmationStatus),
        }];
      }));
      paginationToken = result.paginationToken ?? undefined;
      if (!paginationToken || result.data.length === 0) {
        exhausted = true;
        break;
      }
    }
    return { items: items.slice(0, input.limit), exhausted };
  }

  async getSignatureStates(signatures: readonly string[]) {
    const states = new Map<string, SignatureState>();
    for (let offset = 0; offset < signatures.length; offset += 256) {
      const batch = signatures.slice(offset, offset + 256);
      const result = z.object({
        value: z.array(z.object({
          err: z.unknown().nullable(),
          confirmationStatus: z.string().nullable().optional(),
        }).passthrough().nullable()),
      }).passthrough().parse(await this.rpc('getSignatureStatuses', [batch, { searchTransactionHistory: true }]));
      batch.forEach((signature, index) => {
        const status = result.value[index];
        if (!status) states.set(signature, 'unknown');
        else if (status.err !== null) states.set(signature, 'failed');
        else if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') states.set(signature, 'confirmed');
        else states.set(signature, 'pending');
      });
    }
    return states;
  }

  private async rpc(method: string, params: unknown) {
    const response = await fetchWithTimeout(this.options.rpcUrl, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
    }, this.options.timeoutMs, this.options.fetch ?? fetch);
    if (!response.ok) throw new PortfolioProviderError('helius', `Helius request failed with ${response.status}.`, response.status);
    const envelope = rpcEnvelopeSchema.parse(await response.json());
    if (envelope.error) throw new PortfolioProviderError('helius', envelope.error.message, response.status, envelope.error.code !== -32602);
    if (envelope.result === undefined) throw new PortfolioProviderError('helius', 'Helius returned no result.');
    return envelope.result;
  }
}

export class UnavailableWalletPortfolioSource implements WalletPortfolioSource {
  private unavailable(): never {
    throw new PortfolioProviderError('helius', 'Wallet portfolio data is not configured.', 503, true);
  }

  async loadWallet(): Promise<WalletSnapshot> { return this.unavailable(); }
  async loadTransfers(): Promise<{ items: WalletTransfer[]; exhausted: boolean }> { return this.unavailable(); }
  async getSignatureStates(): Promise<Map<string, SignatureState>> { return this.unavailable(); }
}

const phoenixLoginSchema = z.object({ access_token: z.string().min(1) }).passthrough();
const phoenixMarketSchema = z.object({
  symbol: z.string(),
  baseLotsDecimals: z.number().int().min(-18).max(18),
}).passthrough();
const phoenixPositionSchema = z.object({
  symbol: z.string(),
  positionSequenceNumber: z.string(),
  basePositionLots: integerStringSchema,
  entryPriceUsd: positiveDecimalStringSchema.nullable().optional(),
}).passthrough();
const phoenixOrderGroupSchema = z.object({
  symbol: z.string(),
  orders: z.array(z.object({
    orderSequenceNumber: z.string(),
    side: z.enum(['bid', 'ask']),
    orderType: z.string(),
    priceUsd: positiveDecimalStringSchema,
    sizeRemainingLots: integerStringSchema,
    reduceOnly: z.boolean(),
    status: z.string(),
  }).passthrough()),
}).passthrough();
const phoenixStateSchema = z.object({
  traderPdaIndex: z.number().int().nonnegative().optional(),
  slotIndex: z.number().int().nonnegative().optional(),
  snapshot: z.object({
    capabilities: z.object({
      state: z.string(),
    }).passthrough().optional(),
    subaccounts: z.array(z.object({
      subaccountIndex: z.number().int().nonnegative(),
      collateral: nonnegativeDecimalStringSchema,
      positions: z.array(phoenixPositionSchema).optional().default([]),
      orders: z.array(phoenixOrderGroupSchema).optional().default([]),
    }).passthrough()),
  }).passthrough(),
}).passthrough().transform((state) => ({
  ...state,
  // Warren currently requests only Phoenix's default trader PDA. Some valid
  // snapshots identify the response with slotIndex but omit traderPdaIndex.
  traderPdaIndex: state.traderPdaIndex ?? 0,
}));
const phoenixMarkSchema = z.object({
  markPrice: z.object({ price: z.number().finite().positive() }).passthrough().nullable(),
}).passthrough();
const phoenixTradesSchema = z.object({
  data: z.array(z.object({
    marketSymbol: z.string(),
    timestamp: z.string().datetime(),
    slot: z.number().int().nonnegative(),
    slotIndex: z.number().int().nonnegative(),
    eventIndex: z.number().int().nonnegative(),
    instructionType: z.string(),
    baseLotsBefore: integerStringSchema,
    baseLotsAfter: integerStringSchema,
    baseLotsDelta: integerStringSchema,
    price: positiveDecimalStringSchema,
    realizedPnl: decimalStringSchema,
    signature: z.string().nullable().optional(),
  }).passthrough()),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable().optional(),
}).passthrough();
const phoenixFundingSchema = z.object({
  events: z.array(z.object({
    timestamp: z.string().datetime(),
    symbol: z.string(),
    fundingPayment: decimalStringSchema,
    fundingRatePercentage: decimalStringSchema,
    positionSize: decimalStringSchema,
    positionSide: z.string(),
  }).passthrough()),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable().optional(),
}).passthrough();

export class PhoenixPortfolioSource implements PhoenixPortfolioSourceContract {
  private readonly baseUrl: string;

  constructor(private readonly options: { baseUrl: string; timeoutMs: number; fetch?: Fetcher }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
  }

  async loadAccount(walletAddress: string): Promise<PhoenixPortfolioSnapshot> {
    const observedAt = new Date().toISOString();
    const state = await this.loadTraderState(walletAddress);
    if (!state || state.snapshot.capabilities?.state === 'uninitialized') {
      return emptyPhoenixSnapshot(observedAt, 'not_initialized');
    }
    const marketsBody = await this.request('/v1/view/exchange/markets');
    const markets = z.array(phoenixMarketSchema).parse(marketsBody);
    const decimals = new Map(markets.map((market) => [market.symbol.toUpperCase(), market.baseLotsDecimals]));
    const symbols = [...new Set(state.snapshot.subaccounts.flatMap((subaccount) => [
      ...subaccount.positions.map((position) => position.symbol.toUpperCase()),
      ...subaccount.orders.map((order) => order.symbol.toUpperCase()),
    ]))];
    const marks = new Map<string, number | null>(await Promise.all(symbols.map(async (symbol) => {
      try {
        const mark = phoenixMarkSchema.parse(await this.request(`/v1/market/${encodeURIComponent(symbol)}/mark-price`));
        return [symbol, mark.markPrice?.price ?? null] as const;
      } catch {
        return [symbol, null] as const;
      }
    })));

    const positions: PhoenixPortfolioPosition[] = [];
    const orders: PhoenixPortfolioOrder[] = [];
    let collateralUsd = 0;
    for (const subaccount of state.snapshot.subaccounts) {
      const collateral = safeNumber(subaccount.collateral) ?? 0;
      collateralUsd += collateral;
      const activePositions = subaccount.positions.filter((position) => (safeNumber(position.basePositionLots) ?? 0) !== 0);
      for (const position of activePositions) {
        const symbol = position.symbol.toUpperCase();
        const quantityNumber = scaleLots(position.basePositionLots, decimals.get(symbol));
        const entry = safeNumber(position.entryPriceUsd);
        const mark = marks.get(symbol) ?? null;
        const notional = quantityNumber === null || mark === null ? null : Math.abs(quantityNumber * mark);
        const pnl = quantityNumber === null || mark === null || entry === null ? null : quantityNumber * (mark - entry);
        const assignedCollateral = activePositions.length === 1 ? collateral : null;
        positions.push({
          marketSymbol: symbol,
          traderPdaIndex: state.traderPdaIndex,
          subaccountIndex: subaccount.subaccountIndex,
          positionSequenceNumber: position.positionSequenceNumber,
          quantity: quantityNumber === null ? position.basePositionLots : trimDecimal(quantityNumber),
          entryPriceUsd: entry,
          markPriceUsd: mark,
          collateralUsd: assignedCollateral,
          notionalUsd: notional,
          unrealizedPnlUsd: pnl,
          leverage: assignedCollateral && notional !== null && assignedCollateral > 0 ? notional / assignedCollateral : null,
        });
      }
      for (const group of subaccount.orders) {
        const symbol = group.symbol.toUpperCase();
        for (const order of group.orders) {
          const quantity = scaleLots(order.sizeRemainingLots, decimals.get(symbol));
          orders.push({
            marketSymbol: symbol,
            traderPdaIndex: state.traderPdaIndex,
            subaccountIndex: subaccount.subaccountIndex,
            orderSequenceNumber: order.orderSequenceNumber,
            side: order.side,
            orderType: order.orderType,
            priceUsd: safeNumber(order.priceUsd),
            quantity: quantity === null ? order.sizeRemainingLots : trimDecimal(Math.abs(quantity)),
            reduceOnly: order.reduceOnly,
            status: order.status,
          });
        }
      }
    }
    const valuationComplete = positions.every((position) =>
      position.markPriceUsd !== null
      && position.notionalUsd !== null
      && position.unrealizedPnlUsd !== null);
    const unrealizedPnlUsd = valuationComplete
      ? positions.reduce((sum, position) => sum + position.unrealizedPnlUsd!, 0)
      : null;
    const grossExposureUsd = valuationComplete
      ? positions.reduce((sum, position) => sum + position.notionalUsd!, 0)
      : null;
    return {
      accountState: 'ready',
      observedAt,
      valuationComplete,
      collateralUsd,
      accountEquityUsd: unrealizedPnlUsd === null ? null : collateralUsd + unrealizedPnlUsd,
      grossExposureUsd,
      unrealizedPnlUsd,
      positions,
      orders,
    };
  }

  async loadActivity(input: {
    privyToken: string;
    walletAddress: string;
    before?: string;
    limit: number;
    maxPages: number;
    marketSymbols?: readonly string[];
    referenceQuery?: string;
  }) {
    const state = await this.loadTraderState(input.walletAddress);
    if (!state || state.snapshot.capabilities?.state === 'uninitialized') {
      return { trades: [], funding: [], exhausted: true };
    }
    const session = await this.login(input.privyToken, input.walletAddress);
    const markets = z.array(phoenixMarketSchema).parse(await this.request('/v1/view/exchange/markets'));
    const decimals = new Map(markets.map((market) => [market.symbol.toUpperCase(), market.baseLotsDecimals]));
    const [trades, funding] = await Promise.all([
      this.loadTrades(session, input, decimals),
      input.referenceQuery
        ? Promise.resolve({ items: [] as PhoenixFundingActivity[], exhausted: true })
        : this.loadFunding(session, input),
    ]);
    return {
      trades: trades.items,
      funding: funding.items,
      exhausted: trades.exhausted && funding.exhausted,
    };
  }

  private async loadTrades(
    session: string,
    input: { walletAddress: string; before?: string; limit: number; maxPages: number; marketSymbols?: readonly string[]; referenceQuery?: string },
    decimals: ReadonlyMap<string, number>,
  ) {
    const items: PhoenixTradeActivity[] = [];
    let cursor: string | undefined;
    let exhausted = false;
    const marketSymbols = input.marketSymbols ? new Set(input.marketSymbols.map((symbol) => symbol.toUpperCase())) : null;
    const referenceQuery = input.referenceQuery?.toLocaleLowerCase();
    for (let page = 0; page < input.maxPages && items.length < input.limit; page += 1) {
      const query = new URLSearchParams({ pdaIndex: '0', limit: String(Math.min(100, Math.max(input.limit, 20))) });
      if (cursor) query.set('cursor', cursor);
      const result = phoenixTradesSchema.parse(await this.request(
        `/v1/trader/${encodeURIComponent(input.walletAddress)}/trades-history?${query}`,
        {},
        session,
      ));
      items.push(...result.data
        .filter((item) => !input.before || item.timestamp <= input.before)
        .filter((item) => !marketSymbols || marketSymbols.has(item.marketSymbol.toUpperCase()))
        .filter((item) => !referenceQuery || item.signature?.toLocaleLowerCase().includes(referenceQuery))
        .map((item) => ({
          activityId: `phoenix-trade:${item.slot}:${item.slotIndex}:${item.eventIndex}`,
          marketSymbol: item.marketSymbol.toUpperCase(),
          occurredAt: item.timestamp,
          quantity: scaledActivityQuantity(item.baseLotsDelta, decimals.get(item.marketSymbol.toUpperCase())),
          priceUsd: safeNumber(item.price),
          realizedPnlUsd: safeNumber(item.realizedPnl),
          signature: item.signature ?? null,
          instructionType: item.instructionType,
          baseLotsBefore: item.baseLotsBefore,
          baseLotsAfter: item.baseLotsAfter,
        })));
      cursor = result.nextCursor ?? undefined;
      if (!result.hasMore || !cursor || result.data.length === 0) {
        exhausted = true;
        break;
      }
    }
    return { items: items.slice(0, input.limit), exhausted };
  }

  private async loadFunding(session: string, input: { walletAddress: string; before?: string; limit: number; maxPages: number; marketSymbols?: readonly string[]; referenceQuery?: string }) {
    const items: PhoenixFundingActivity[] = [];
    let cursor: string | undefined;
    let exhausted = false;
    const marketSymbols = input.marketSymbols ? new Set(input.marketSymbols.map((symbol) => symbol.toUpperCase())) : null;
    for (let page = 0; page < input.maxPages && items.length < input.limit; page += 1) {
      const query = new URLSearchParams({ traderPdaIndex: '0', limit: String(Math.min(100, Math.max(input.limit, 20))) });
      if (cursor) query.set('cursor', cursor);
      if (input.before) query.set('endTime', String(new Date(input.before).getTime() + 1));
      const result = phoenixFundingSchema.parse(await this.request(
        `/v1/trader/${encodeURIComponent(input.walletAddress)}/funding-history?${query}`,
        {},
        session,
      ));
      items.push(...result.events
        .filter((item) => !input.before || item.timestamp <= input.before)
        .filter((item) => !marketSymbols || marketSymbols.has(item.symbol.toUpperCase()))
        .map((item) => ({
          activityId: stableFundingActivityId(item),
          marketSymbol: item.symbol.toUpperCase(),
          occurredAt: item.timestamp,
          paymentUsd: safeNumber(item.fundingPayment)!,
          ratePercent: safeNumber(item.fundingRatePercentage),
          positionSide: item.positionSide,
        })));
      cursor = result.nextCursor ?? undefined;
      if (!result.hasMore || !cursor || result.events.length === 0) {
        exhausted = true;
        break;
      }
    }
    return { items: items.slice(0, input.limit), exhausted };
  }

  private async login(privyToken: string, walletAddress: string) {
    const body = phoenixLoginSchema.parse(await this.request('/v1/auth/login/privy', {
      method: 'POST',
      body: JSON.stringify({ privy_token: privyToken, wallet_pubkey: walletAddress }),
    }));
    return body.access_token;
  }

  private async loadTraderState(walletAddress: string) {
    try {
      // Phoenix currently activates user accounts only at trader PDA index 0;
      // the snapshot itself includes cross and every isolated subaccount.
      const body = await this.request(
        `/v1/trader/state/${encodeURIComponent(walletAddress)}?traderPdaIndex=0`,
      );
      return phoenixStateSchema.parse(body);
    } catch (error) {
      // A 404 is an account-missing signal only on the trader-state resource.
      // Provider authorization, network and malformed-response failures remain errors.
      if (isPhoenixAccountMissing(error)) return null;
      throw error;
    }
  }

  private async request(path: string, init: RequestInit = {}, accessToken?: string) {
    const response = await fetchWithTimeout(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
    }, this.options.timeoutMs, this.options.fetch ?? fetch);
    if (!response.ok) {
      throw new PortfolioProviderError(
        'phoenix',
        `Phoenix request to ${path} failed with ${response.status}.`,
        response.status,
        response.status >= 500 || response.status === 429,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new PortfolioProviderError('phoenix', 'Phoenix returned unreadable data.');
    }
  }
}

function stableFundingActivityId(event: z.infer<typeof phoenixFundingSchema>['events'][number]) {
  const identity = JSON.stringify([
    event.timestamp,
    event.symbol.toUpperCase(),
    event.fundingPayment,
    event.fundingRatePercentage,
    event.positionSize,
    event.positionSide,
  ]);
  return `phoenix-funding:${createHash('sha256').update(identity).digest('hex').slice(0, 32)}`;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, fetcher: Fetcher) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, { ...init, signal: controller.signal });
  } catch {
    throw new PortfolioProviderError(url.includes('helius') ? 'helius' : 'phoenix', 'The provider could not be reached.');
  } finally {
    clearTimeout(timer);
  }
}

function normalizeConfirmationStatus(value: string | undefined): WalletTransfer['confirmationStatus'] {
  return value === 'processed' || value === 'confirmed' || value === 'finalized' ? value : 'unknown';
}

function safeNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function scaleLots(value: string, decimals: number | undefined) {
  const lots = safeNumber(value);
  return lots === null || decimals === undefined ? null : lots / (10 ** decimals);
}

function trimDecimal(value: number) {
  if (!Number.isFinite(value)) return '0';
  return value.toFixed(12).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

function emptyPhoenixSnapshot(
  observedAt: string,
  accountState: PhoenixPortfolioSnapshot['accountState'],
): PhoenixPortfolioSnapshot {
  return {
    accountState,
    observedAt,
    valuationComplete: true,
    collateralUsd: 0,
    accountEquityUsd: 0,
    grossExposureUsd: 0,
    unrealizedPnlUsd: 0,
    positions: [],
    orders: [],
  };
}

function isPhoenixAccountMissing(error: unknown) {
  return error instanceof PortfolioProviderError && error.status === 404;
}

function baseUnitsToDecimalString(raw: string, decimals: number) {
  const amount = BigInt(raw);
  if (decimals === 0) return amount.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function scaledActivityQuantity(rawLots: string, decimals: number | undefined) {
  const scaled = scaleLots(rawLots, decimals);
  if (scaled === null) throw new PortfolioProviderError('phoenix', 'Phoenix returned an activity market without lot metadata.');
  return trimDecimal(Math.abs(scaled));
}
