import { PublicKey } from '@solana/web3.js';
import { perpetualExecutionResultSchema, spotExecutionResultSchema } from '@warren/execution-contract';
import {
  portfolioActivityResponseSchema,
  portfolioOverviewResponseSchema,
  portfolioPositionsResponseSchema,
  type PortfolioActivityItem,
  type PortfolioActivityQuery,
  type PortfolioCashBalance,
  type PortfolioDataState,
  type PortfolioHolding,
  type PortfolioMoney,
  type PortfolioOrder,
  type PortfolioPosition,
  type PortfolioSupportedAssetState,
  type PortfolioWarning,
} from '@warren/portfolio-contract';
import type { MarketInstrument, MarketsWarning, PerpetualInstrument, PrestockInstrument, SpotInstrument } from '@warren/markets-contract';

import type { ExecutionIdentity } from '../execution/types.js';
import type { ExecutionIntent, ExecutionIntentStore } from '../execution/store.js';
import type { MarketsService } from '../markets/service.js';
import type { PortfolioSnapshotStore } from './snapshots.js';
import { PortfolioProviderError } from './types.js';
import type {
  PhoenixFundingActivity,
  PhoenixPortfolioSnapshot,
  PhoenixPortfolioSourceContract,
  PhoenixTradeActivity,
  WalletPortfolioSource,
  WalletSnapshot,
  WalletTransfer,
} from './types.js';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
// Helius uses ...11111 for native SOL when `solMode: "merged"` is enabled.
// ...11112 is the wrapped-SOL token mint and would discard native transfers.
const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111111';

export type PortfolioErrorCode =
  | 'WALLET_REQUIRED'
  | 'WALLET_MISMATCH'
  | 'INVALID_CURSOR'
  | 'INVALID_REQUEST'
  | 'CONTRACT_INVALID'
  | 'REGISTRATION_NOT_FOUND'
  | 'REGISTRATION_STATE_INVALID'
  | 'REGISTRATION_EXPIRED'
  | 'REGISTRATION_PROVIDER_UNAVAILABLE'
  | 'REFERRAL_ONBOARDING_UNAVAILABLE';

export class PortfolioServiceFault extends Error {
  constructor(
    readonly code: PortfolioErrorCode,
    readonly status: number,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

type LoadedPortfolio = {
  generatedAt: string;
  walletAddress: string;
  walletSnapshot: WalletSnapshot | null;
  phoenixSnapshot: PhoenixPortfolioSnapshot | null;
  phoenixScopeComplete: boolean;
  supportedAssetState: PortfolioSupportedAssetState;
  instruments: MarketInstrument[];
  registryAvailable: boolean;
  holdings: PortfolioHolding[];
  cashBalances: PortfolioCashBalance[];
  positions: PortfolioPosition[];
  orders: PortfolioOrder[];
  warnings: PortfolioWarning[];
};

export class PortfolioService {
  private readonly now: () => Date;

  constructor(private readonly options: {
    markets: MarketsService;
    wallet: WalletPortfolioSource;
    phoenix: PhoenixPortfolioSourceContract;
    executions: ExecutionIntentStore;
    snapshots: PortfolioSnapshotStore;
    phoenixRegistrationMode?: 'non_referral' | 'referral';
    now?: () => Date;
  }) {
    this.now = options.now ?? (() => new Date());
  }

  async getOverview(identity: ExecutionIdentity) {
    const state = await this.loadPortfolio(identity);
    const equity = this.buildEquity(identity, state);
    const attention = await this.buildAttention(identity, state.walletAddress);
    try {
      return portfolioOverviewResponseSchema.parse({
        generatedAt: state.generatedAt,
        wallet: walletDto(state.walletAddress, state.supportedAssetState),
        perpetuals: perpetualsDto(state.phoenixSnapshot, this.options.phoenixRegistrationMode ?? 'non_referral'),
        equity,
        attention,
        openOrders: state.orders.slice(0, 3),
        openPositions: state.positions.slice(0, 3),
        holdings: state.holdings.slice(0, 5),
        cashBalances: state.cashBalances,
        counts: {
          openOrders: state.orders.length,
          openPositions: state.positions.length,
          holdings: state.holdings.length,
          unpricedHoldings: state.holdings.filter((holding) => !holding.valuationIncluded).length,
        },
        warnings: state.warnings,
      });
    } catch {
      throw new PortfolioServiceFault('CONTRACT_INVALID', 500, 'The Portfolio overview could not be prepared.', true);
    }
  }

  async getPositions(identity: ExecutionIdentity) {
    const state = await this.loadPortfolio(identity);
    const supportedUnrealized = sumNullable(state.positions.map((position) => position.unrealizedPnlUsd));
    const supportedExposure = sumNullable(state.positions.map((position) => position.notionalUsd));
    const unrealized = state.phoenixSnapshot && supportedUnrealized !== null
      ? money(supportedUnrealized, state.phoenixSnapshot.observedAt, 'live')
      : unavailableMoney();
    const exposure = state.phoenixSnapshot && supportedExposure !== null
      ? money(supportedExposure, state.phoenixSnapshot.observedAt, 'live')
      : unavailableMoney();
    try {
      return portfolioPositionsResponseSchema.parse({
        generatedAt: state.generatedAt,
        wallet: walletDto(state.walletAddress, state.supportedAssetState),
        perpetuals: perpetualsDto(state.phoenixSnapshot, this.options.phoenixRegistrationMode ?? 'non_referral'),
        summary: { unrealizedPnlUsd: unrealized, grossExposureUsd: exposure },
        openOrders: state.orders,
        openPositions: state.positions,
        holdings: state.holdings,
        cashBalances: state.cashBalances,
        warnings: state.warnings,
      });
    } catch {
      throw new PortfolioServiceFault('CONTRACT_INVALID', 500, 'Portfolio positions could not be prepared.', true);
    }
  }

  async getActivity(identity: ExecutionIdentity, query: PortfolioActivityQuery) {
    const walletAddress = primaryWallet(identity);
    const generatedAt = this.now().toISOString();
    const cursor = decodeActivityCursor(query.cursor);
    const warnings: PortfolioWarning[] = [];

    const registryResult = await settled(() => this.options.markets.getPortfolioRegistry());
    const instruments = registryResult.ok ? registryResult.value.instruments : [];
    if (!registryResult.ok) warnings.push(providerWarning('valuation', 'MARKET_REGISTRY_UNAVAILABLE', 'Supported asset identity could not be refreshed.'));
    else warnings.push(...registryResult.value.warnings.map(registryWarning));
    const byMint = supportedMintMap(instruments);
    const bySymbol = perpetualSymbolMap(instruments);
    const activityScope = resolveActivityScope(query.query, instruments);

    const executions = this.options.executions.list({
      userId: identity.userId,
      walletAddresses: [walletAddress],
      limit: 1_000,
    });
    await this.reconcileSubmitted(executions);
    const executionItems = executions
      .filter((intent) => intent.state !== 'review')
      .map(executionActivity);
    const knownSignatures = new Set(executionItems.flatMap((item) => item.signature ? [item.signature] : []));

    const requested = Math.max(100, query.limit * 5);
    const [transfersResult, phoenixResult] = await Promise.all([
      settled(() => this.options.wallet.loadTransfers({
        address: walletAddress,
        before: cursor?.before,
        limit: requested,
        maxPages: 10,
        mintAllowlist: [...byMint.keys(), USDC_MINT, NATIVE_SOL_MINT],
        queryMints: activityScope.mints,
        referenceQuery: activityScope.referenceQuery,
      })),
      settled(() => this.options.phoenix.loadActivity({
        privyToken: identity.rawToken,
        walletAddress,
        before: cursor?.before,
        limit: requested,
        maxPages: 10,
        marketSymbols: activityScope.marketSymbols,
        referenceQuery: activityScope.referenceQuery,
      })),
    ]);

    const transferItems = transfersResult.ok
      ? transfersResult.value.items
        .filter((transfer) => !knownSignatures.has(transfer.signature))
        .flatMap((transfer) => transferActivity(transfer, walletAddress, byMint))
      : [];
    if (!transfersResult.ok) warnings.push(providerWarning('activity', 'WALLET_ACTIVITY_UNAVAILABLE', 'Wallet transfers could not be refreshed.'));
    else if (!transfersResult.value.exhausted && transferItems.length < query.limit) warnings.push(providerWarning('activity', 'WALLET_ACTIVITY_PARTIAL', 'Only part of the wallet history could be searched.', true));

    const phoenixItems = phoenixResult.ok
      ? [
          ...phoenixResult.value.trades.flatMap((trade) => {
            const item = phoenixTradeActivity(trade, bySymbol);
            return item ? [item] : [];
          }),
          ...phoenixResult.value.funding.flatMap((funding) => {
            const item = phoenixFundingActivity(funding, bySymbol);
            return item ? [item] : [];
          }),
        ]
      : [];
    // Phoenix history is optional enrichment. A private-history outage must not
    // turn otherwise valid wallet and Warren activity into an error state or a
    // retry loop that cannot help a newly initialized account.
    if (phoenixResult.ok && !phoenixResult.value.exhausted && phoenixItems.length < query.limit) {
      warnings.push(providerWarning('activity', 'PERPETUAL_ACTIVITY_PARTIAL', 'Only part of the Phoenix history could be searched.', true));
    }

    const deduped = dedupeActivity([...executionItems, ...transferItems, ...phoenixItems])
      .filter((item) => cursorAllows(item, cursor))
      .filter((item) => activityKindAllows(item, query.kind))
      .filter((item) => query.status === 'all' || item.status === query.status)
      .filter((item) => activityQueryAllows(item, query.query))
      .sort(compareActivity);
    const page = deduped.slice(0, query.limit);
    const last = page.at(-1);
    const hasNextPage = deduped.length > query.limit
      || (transfersResult.ok && !transfersResult.value.exhausted)
      || (phoenixResult.ok && !phoenixResult.value.exhausted);

    try {
      return portfolioActivityResponseSchema.parse({
        generatedAt,
        wallet: walletDto(walletAddress, 'not_loaded'),
        items: page,
        pageInfo: {
          nextCursor: hasNextPage && last ? encodeActivityCursor(last) : null,
          hasNextPage: Boolean(hasNextPage && last),
        },
        warnings,
      });
    } catch {
      throw new PortfolioServiceFault('CONTRACT_INVALID', 500, 'Portfolio activity could not be prepared.', true);
    }
  }

  private async loadPortfolio(identity: ExecutionIdentity): Promise<LoadedPortfolio> {
    const walletAddress = primaryWallet(identity);
    const generatedAt = this.now().toISOString();
    const [registryResult, walletResult, phoenixResult] = await Promise.all([
      settled(() => this.options.markets.getPortfolioRegistry()),
      settled(() => this.options.wallet.loadWallet(walletAddress)),
      settled(() => this.options.phoenix.loadAccount(walletAddress)),
    ]);
    const warnings: PortfolioWarning[] = [];
    const instruments = registryResult.ok ? registryResult.value.instruments : [];
    if (!registryResult.ok) warnings.push(providerWarning('valuation', 'MARKET_REGISTRY_UNAVAILABLE', 'Supported asset identity and valuation could not be refreshed.'));
    else warnings.push(...registryResult.value.warnings.map(registryWarning));
    if (!walletResult.ok) warnings.push(providerWarning('wallet', 'WALLET_BALANCES_UNAVAILABLE', 'Wallet balances could not be refreshed.'));
    if (!phoenixResult.ok) warnings.push(phoenixAccountWarning(phoenixResult.error));
    else if (!phoenixResult.value.valuationComplete) warnings.push(providerWarning('perpetuals', 'PHOENIX_MARKS_UNAVAILABLE', 'One or more Phoenix marks are missing, so perpetual totals and net equity are withheld.'));

    const walletSnapshot = walletResult.ok ? walletResult.value : null;
    const phoenixSnapshot = phoenixResult.ok ? phoenixResult.value : null;
    const supportedPerpetualSymbols = perpetualSymbolMap(instruments);
    const phoenixScopeComplete = !phoenixSnapshot || (
      phoenixSnapshot.positions.every((position) => supportedPerpetualSymbols.has(position.marketSymbol))
      && phoenixSnapshot.orders.every((order) => supportedPerpetualSymbols.has(order.marketSymbol))
    );
    if (!phoenixScopeComplete) warnings.push(providerWarning(
      'perpetuals',
      'UNSUPPORTED_PHOENIX_EXPOSURE',
      'Phoenix contains non-stock exposure that Warren omits, so account-wide equity is withheld.',
      false,
    ));
    const holdings = walletSnapshot ? buildHoldings(walletSnapshot, instruments, warnings) : [];
    const cashBalances = walletSnapshot ? buildCash(walletSnapshot, warnings) : [];
    const supportedAssetState = classifySupportedAssets({
      instruments,
      registryAvailable: registryResult.ok
        && !registryResult.value.warnings.some((warning) => warning.code === 'PROVIDER_UNAVAILABLE'),
      walletSnapshot,
    });
    const positions = phoenixSnapshot ? buildPositions(phoenixSnapshot, instruments) : [];
    const orders = phoenixSnapshot ? buildOrders(phoenixSnapshot, instruments) : [];
    return {
      generatedAt,
      walletAddress,
      walletSnapshot,
      phoenixSnapshot,
      phoenixScopeComplete,
      supportedAssetState,
      instruments,
      registryAvailable: registryResult.ok
        && !registryResult.value.warnings.some((warning) => warning.code === 'PROVIDER_UNAVAILABLE'),
      holdings,
      cashBalances,
      positions,
      orders,
      warnings: dedupeWarnings(warnings),
    };
  }

  private buildEquity(identity: ExecutionIdentity, state: LoadedPortfolio) {
    const pricedHoldingsAmount = sumMoney(state.holdings.filter((holding) => holding.valuationIncluded).map((holding) => holding.marketValueUsd));
    const cashAmount = sumMoney(state.cashBalances.map((balance) => balance.marketValueUsd));
    const holdingState = combineState(state.holdings
      .filter((holding) => holding.valuationIncluded)
      .map((holding) => holding.marketValueUsd.dataState));
    const cashState = combineState(state.cashBalances
      .filter((balance) => balance.rawAmount !== '0')
      .map((balance) => balance.marketValueUsd.dataState));
    const walletAsOf = state.walletSnapshot?.observedAt ?? null;
    const walletState = combineState([holdingState, cashState]);
    const pricedHoldings = state.walletSnapshot ? money(pricedHoldingsAmount, walletAsOf!, holdingState) : unavailableMoney();
    const cashComplete = state.cashBalances.every((balance) => balance.rawAmount === '0' || balance.marketValueUsd.amount !== null);
    const cash = state.walletSnapshot && cashComplete ? money(cashAmount, walletAsOf!, cashState) : unavailableMoney();
    const perpetualEquity = state.phoenixScopeComplete
      && state.phoenixSnapshot?.accountEquityUsd !== null
      && state.phoenixSnapshot?.accountEquityUsd !== undefined
      ? money(state.phoenixSnapshot.accountEquityUsd, state.phoenixSnapshot.observedAt, 'live')
      : unavailableMoney();
    const supportedExposure = sumNullable(state.positions.map((position) => position.notionalUsd));
    const grossPerpetualExposure = state.phoenixSnapshot && supportedExposure !== null
      ? money(supportedExposure, state.phoenixSnapshot.observedAt, 'live')
      : unavailableMoney();
    const liabilities = money(0, state.generatedAt, 'live');
    // Holdings are exact-mint allowlisted through the registry. If that authority is down,
    // reporting a lower partial total as complete equity would be materially misleading.
    const phoenixAccountEquity = state.phoenixSnapshot?.accountEquityUsd;
    const complete = state.registryAvailable
      && state.walletSnapshot !== null
      && phoenixAccountEquity !== null
      && phoenixAccountEquity !== undefined
      && state.phoenixSnapshot?.valuationComplete === true
      && state.phoenixScopeComplete
      && cashComplete;
    const netAmount = complete ? pricedHoldingsAmount + cashAmount + phoenixAccountEquity : null;
    const netState = complete ? combineState([walletState, perpetualEquity.dataState]) : 'unavailable';
    const netAccountEquity = netAmount === null ? unavailableMoney() : money(netAmount, state.generatedAt, netState);

    let todayChangeUsd = unavailableMoney();
    let todayChangePercent: ReturnType<typeof metric> = unavailableMetric();
    if (netAmount !== null) {
      const startOfDay = new Date(state.generatedAt);
      startOfDay.setUTCHours(0, 0, 0, 0);
      const prior = this.options.snapshots.latestBefore({
        userId: identity.userId,
        walletAddress: state.walletAddress,
        before: startOfDay.toISOString(),
      });
      if (prior) {
        const delta = netAmount - prior.netEquityUsd;
        todayChangeUsd = money(delta, state.generatedAt, netState);
        todayChangePercent = metric(prior.netEquityUsd === 0 ? null : delta / prior.netEquityUsd * 100, state.generatedAt, netState);
      }
      this.options.snapshots.save({
        userId: identity.userId,
        walletAddress: state.walletAddress,
        capturedAt: state.generatedAt,
        netEquityUsd: netAmount,
      });
    }

    return {
      netAccountEquity,
      todayChangeUsd,
      todayChangePercent,
      pricedHoldings,
      perpetualEquity,
      cash,
      grossPerpetualExposure,
      liabilities,
    };
  }

  private async buildAttention(identity: ExecutionIdentity, walletAddress: string) {
    const intents = this.options.executions.list({ userId: identity.userId, walletAddresses: [walletAddress], limit: 100 });
    await this.reconcileSubmitted(intents);
    return intents.flatMap((intent) => {
      if (intent.state !== 'unknown' && intent.state !== 'failed') return [];
      return [{
        attentionId: `execution:${intent.executionId}`,
        kind: intent.state === 'unknown' ? 'execution_unknown' as const : 'execution_failed' as const,
        title: intent.state === 'unknown'
          ? `${intent.companyName} ${intent.kind === 'spot' ? 'trade' : 'order'} status unknown`
          : `${intent.companyName} ${intent.kind === 'spot' ? 'trade' : 'order'} failed`,
        message: intent.failureMessage ?? (intent.state === 'unknown'
          ? 'Do not resubmit while Warren checks the chain.'
          : 'No confirmed portfolio change was found.'),
        occurredAt: intent.updatedAt,
        executionId: intent.executionId,
        signature: intent.signature ?? null,
      }];
    }).slice(0, 5);
  }

  private async reconcileSubmitted(intents: ExecutionIntent[]) {
    const candidates = intents.filter((intent) =>
      (intent.state === 'submitted' || intent.state === 'unknown') && intent.signature);
    if (!candidates.length) return;
    try {
      const states = await this.options.wallet.getSignatureStates(candidates.map((intent) => intent.signature!));
      for (const intent of candidates) {
        const state = states.get(intent.signature!);
        if (state !== 'confirmed' && state !== 'failed') continue;
        intent.state = state;
        intent.updatedAt = this.now().toISOString();
        intent.failureMessage = state === 'failed' ? 'The transaction failed on Solana.' : undefined;
        if (intent.kind === 'spot') {
          intent.result = spotExecutionResultSchema.parse({
            executionId: intent.executionId,
            product: 'spot',
            state,
            signature: intent.signature!,
            inputAmount: intent.result?.inputAmount ?? null,
            outputAmount: intent.result?.outputAmount ?? null,
            explorerUrl: explorerUrl(intent.signature!),
            message: state === 'confirmed'
              ? 'Spot transaction confirmed on Solana.'
              : 'Spot transaction failed on Solana.',
          });
        } else {
          intent.result = perpetualExecutionResultSchema.parse({
            executionId: intent.executionId,
            product: 'perpetual',
            state,
            signature: intent.signature!,
            explorerUrl: explorerUrl(intent.signature!),
            message: state === 'confirmed'
              ? 'Phoenix order transaction confirmed on Solana.'
              : 'Phoenix order transaction failed on Solana.',
          });
        }
        this.options.executions.update(intent);
      }
    } catch {
      // Reconciliation is best-effort. The original submitted/unknown state remains visible.
    }
  }
}

function buildHoldings(snapshot: WalletSnapshot, instruments: MarketInstrument[], warnings: PortfolioWarning[]) {
  const byMint = supportedMintMap(instruments);
  const holdings: PortfolioHolding[] = [];
  for (const token of snapshot.tokens) {
    if (token.rawAmount === '0' || token.mint === USDC_MINT) continue;
    const instrument = byMint.get(token.mint);
    if (!instrument) continue;
    const quantity = baseUnitsToDecimalString(token.rawAmount, token.decimals);
    const price = instrument.marketValue.amount;
    const priceState = marketState(instrument.marketValue.dataState);
    const priceAsOf = instrument.marketValue.asOf;
    const value = price === null ? null : Number(quantity) * price;
    const valuationIncluded = value !== null
      && Number.isFinite(value)
      && priceAsOf !== null
      && priceState !== 'unavailable';
    if (!valuationIncluded) warnings.push({
      section: 'valuation',
      code: 'HOLDING_UNPRICED',
      message: `${instrument.companyName} is held in the wallet but excluded from priced equity because no reliable value was provided.`,
      retryable: false,
    });
    holdings.push({
      holdingId: `holding:${token.mint}`,
      assetId: instrument.assetId,
      instrumentId: instrument.instrumentId,
      productType: instrument.productType,
      companyName: instrument.companyName,
      ticker: instrument.ticker,
      symbol: instrument.symbol,
      logoUrl: instrument.logoUrl,
      provider: instrument.provider,
      mint: token.mint,
      rawAmount: token.rawAmount,
      decimals: token.decimals,
      quantity,
      unitPriceUsd: price === null || !priceAsOf ? unavailableMoney() : money(price, priceAsOf, priceState),
      marketValueUsd: valuationIncluded && priceAsOf ? money(value!, priceAsOf, priceState) : unavailableMoney(),
      changePercent: isSpot(instrument)
        ? metric(instrument.changePercent.value, instrument.changePercent.asOf, marketState(instrument.changePercent.dataState))
        : unavailableMetric(),
      valuationIncluded,
    });
  }
  return holdings.sort((left, right) => (right.marketValueUsd.amount ?? -1) - (left.marketValueUsd.amount ?? -1) || left.companyName.localeCompare(right.companyName));
}

function buildCash(snapshot: WalletSnapshot, warnings: PortfolioWarning[]) {
  const result: PortfolioCashBalance[] = [];
  const usdc = snapshot.tokens.find((token) => token.mint === USDC_MINT);
  if (usdc) {
    const quantity = baseUnitsToDecimalString(usdc.rawAmount, usdc.decimals);
    result.push({
      cashId: 'cash:usdc',
      symbol: 'USDC',
      label: 'Available to trade',
      mint: USDC_MINT,
      rawAmount: usdc.rawAmount,
      decimals: usdc.decimals,
      quantity,
      unitPriceUsd: money(1, snapshot.observedAt, 'live'),
      marketValueUsd: money(Number(quantity), snapshot.observedAt, 'live'),
    });
  }
  const solQuantity = baseUnitsToDecimalString(snapshot.solLamports, 9);
  const solValue = snapshot.solPriceUsd === null ? null : Number(solQuantity) * snapshot.solPriceUsd;
  if (snapshot.solPriceUsd === null && snapshot.solLamports !== '0') warnings.push(providerWarning('valuation', 'SOL_PRICE_UNAVAILABLE', 'The network fee balance is visible but excluded from priced equity because its USD value was not provided.'));
  result.push({
    cashId: 'cash:sol',
    symbol: 'SOL',
    label: 'Network fee balance',
    mint: null,
    rawAmount: snapshot.solLamports,
    decimals: 9,
    quantity: solQuantity,
    unitPriceUsd: snapshot.solPriceUsd === null ? unavailableMoney() : money(snapshot.solPriceUsd, snapshot.observedAt, 'delayed'),
    marketValueUsd: solValue === null ? unavailableMoney() : money(solValue, snapshot.observedAt, 'delayed'),
  });
  return result;
}

function buildPositions(snapshot: PhoenixPortfolioSnapshot, instruments: MarketInstrument[]) {
  const bySymbol = perpetualSymbolMap(instruments);
  return snapshot.positions.flatMap((position): PortfolioPosition[] => {
    const instrument = bySymbol.get(position.marketSymbol);
    if (!instrument) return [];
    const signedQuantity = Number(position.quantity);
    const direction = signedQuantity < 0 ? 'short' : 'long';
    const fundingRate = instrument.fundingRatePercent.value;
    return [{
      positionId: `phoenix:${position.traderPdaIndex}:${position.subaccountIndex}:${position.marketSymbol}`,
      assetId: instrument.assetId,
      instrumentId: instrument.instrumentId,
      companyName: instrument.companyName,
      ticker: instrument.ticker,
      logoUrl: instrument.logoUrl,
      venue: 'Phoenix',
      marketSymbol: position.marketSymbol,
      direction,
      marginMode: instrument.marginMode,
      traderPdaIndex: position.traderPdaIndex,
      subaccountIndex: position.subaccountIndex,
      quantity: absoluteDecimal(position.quantity),
      leverage: position.leverage,
      entryPriceUsd: position.entryPriceUsd,
      markPriceUsd: position.markPriceUsd,
      collateralUsd: position.collateralUsd,
      notionalUsd: position.notionalUsd,
      unrealizedPnlUsd: position.unrealizedPnlUsd,
      unrealizedPnlPercent: position.collateralUsd && position.unrealizedPnlUsd !== null
        ? position.unrealizedPnlUsd / position.collateralUsd * 100
        : null,
      liquidationPriceUsd: null,
      liquidationDistancePercent: null,
      fundingRatePercent: fundingRate,
      fundingEffect: fundingEffect(direction, fundingRate),
      nextFundingAt: instrument.nextFundingAt,
      updatedAt: snapshot.observedAt,
      // Quantity, entry, mark, and PnL all come from the authenticated Phoenix
      // snapshot. Registry freshness must not downgrade those venue facts.
      dataState: position.markPriceUsd === null ? 'unavailable' : 'live',
    }];
  }).sort((left, right) => (right.notionalUsd ?? 0) - (left.notionalUsd ?? 0));
}

function buildOrders(snapshot: PhoenixPortfolioSnapshot, instruments: MarketInstrument[]) {
  const bySymbol = perpetualSymbolMap(instruments);
  return snapshot.orders.flatMap((order): PortfolioOrder[] => {
    const instrument = bySymbol.get(order.marketSymbol);
    if (!instrument) return [];
    return [{
      orderId: `phoenix-order:${order.traderPdaIndex}:${order.subaccountIndex}:${order.orderSequenceNumber}`,
      assetId: instrument.assetId,
      instrumentId: instrument.instrumentId,
      companyName: instrument.companyName,
      ticker: instrument.ticker,
      logoUrl: instrument.logoUrl,
      venue: 'Phoenix',
      marketSymbol: order.marketSymbol,
      side: order.side === 'bid' ? 'buy' : 'sell',
      orderType: order.orderType,
      priceUsd: order.priceUsd,
      quantity: order.quantity,
      reduceOnly: order.reduceOnly,
      status: order.status,
      traderPdaIndex: order.traderPdaIndex,
      subaccountIndex: order.subaccountIndex,
      updatedAt: snapshot.observedAt,
    }];
  });
}

function executionActivity(intent: ExecutionIntent): PortfolioActivityItem {
  const status: PortfolioActivityItem['status'] = intent.state === 'submitted'
    ? 'pending'
    : intent.state === 'review'
      ? 'unknown'
      : intent.state;
  const action = intent.state === 'failed'
    ? 'execution_failed' as const
    : intent.kind === 'spot'
      ? intent.state === 'confirmed'
        ? intent.direction === 'buy' ? 'bought' as const : 'sold' as const
        : 'trade_submitted' as const
      : 'order_submitted' as const;
  return {
    activityId: `warren:${intent.executionId}`,
    kind: intent.kind === 'spot' ? 'trade' : 'perpetual',
    productType: intent.kind,
    action,
    status,
    title: intent.state === 'failed'
      ? `${intent.companyName} ${intent.kind === 'spot' ? 'trade' : 'order'} failed`
      : intent.kind === 'spot'
        ? intent.state === 'confirmed'
          ? `${intent.direction === 'buy' ? 'Bought' : 'Sold'} ${intent.companyName}`
          : `${intent.companyName} ${intent.direction} status unknown`
        : `${intent.direction === 'long' ? 'Long' : 'Short'} ${intent.companyName} order submitted`,
    subtitle: `${intent.symbol} · ${intent.kind === 'spot' ? 'Jupiter' : 'Phoenix'}`,
    assetId: intent.assetId,
    instrumentId: intent.instrumentId,
    companyName: intent.companyName,
    symbol: intent.symbol,
    quantity: intent.quantity,
    valueUsd: intent.valueUsd,
    occurredAt: intent.submittedAt ?? intent.updatedAt,
    signature: intent.signature ?? null,
    explorerUrl: intent.signature ? explorerUrl(intent.signature) : null,
    executionId: intent.executionId,
    groupId: `execution:${intent.executionId}`,
  };
}

function transferActivity(transfer: WalletTransfer, walletAddress: string, byMint: Map<string, SpotInstrument | PrestockInstrument>): PortfolioActivityItem[] {
  const incoming = transfer.to === walletAddress;
  const outgoing = transfer.from === walletAddress;
  if (!incoming && !outgoing) return [];
  const instrument = byMint.get(transfer.mint);
  const cashSymbol = transfer.mint === USDC_MINT ? 'USDC' : transfer.mint === NATIVE_SOL_MINT ? 'SOL' : null;
  if (!instrument && !cashSymbol) return [];
  const name = instrument?.companyName ?? cashSymbol!;
  const symbol = instrument?.symbol ?? cashSymbol!;
  const value = instrument?.marketValue.amount === null || instrument?.marketValue.amount === undefined
    ? cashSymbol === 'USDC' ? Number(transfer.quantity) : null
    : Number(transfer.quantity) * instrument.marketValue.amount;
  const direction = incoming ? 'received' as const : 'sent' as const;
  return [{
    activityId: `solana:${transfer.signature}:${transfer.mint}:${direction}`,
    kind: 'transfer',
    productType: instrument?.productType ?? 'cash',
    action: direction,
    status: transfer.confirmationStatus === 'confirmed' || transfer.confirmationStatus === 'finalized'
      ? 'confirmed'
      : transfer.confirmationStatus === 'unknown'
        ? 'unknown'
        : 'pending',
    title: `${name} ${direction}`,
    subtitle: `${symbol} · Solana`,
    assetId: instrument?.assetId ?? null,
    instrumentId: instrument?.instrumentId ?? null,
    companyName: instrument?.companyName ?? null,
    symbol,
    quantity: transfer.quantity,
    valueUsd: value,
    occurredAt: transfer.blockTime,
    signature: transfer.signature,
    explorerUrl: explorerUrl(transfer.signature),
    executionId: null,
    groupId: `solana:${transfer.signature}`,
  }];
}

function phoenixTradeActivity(activity: PhoenixTradeActivity, bySymbol: Map<string, PerpetualInstrument>): PortfolioActivityItem | null {
  const instrument = bySymbol.get(activity.marketSymbol);
  if (!instrument) return null;
  const beforeLots = BigInt(activity.baseLotsBefore);
  const afterLots = BigInt(activity.baseLotsAfter);
  const before = absBigInt(beforeLots);
  const after = absBigInt(afterLots);
  const reversed = beforeLots !== 0n && afterLots !== 0n && (beforeLots < 0n) !== (afterLots < 0n);
  const verb = before === 0n && after > 0n
    ? 'Opened'
    : after === 0n
      ? 'Closed'
      : reversed
        ? 'Reversed'
        : after > before
          ? 'Increased'
          : 'Reduced';
  const companyName = instrument.companyName;
  return {
    activityId: activity.activityId,
    kind: 'perpetual',
    productType: 'perpetual',
    action: 'position_changed',
    status: 'confirmed',
    title: `${verb} ${companyName} position`,
    subtitle: `${activity.marketSymbol} · Phoenix`,
    assetId: instrument.assetId,
    instrumentId: instrument.instrumentId,
    companyName,
    symbol: activity.marketSymbol,
    quantity: activity.quantity,
    valueUsd: activity.priceUsd === null ? null : Number(activity.quantity) * activity.priceUsd,
    occurredAt: activity.occurredAt,
    signature: activity.signature,
    explorerUrl: activity.signature ? explorerUrl(activity.signature) : null,
    executionId: null,
    groupId: activity.signature ? `solana:${activity.signature}` : activity.activityId,
  };
}

function absBigInt(value: bigint) {
  return value < 0n ? -value : value;
}

function phoenixFundingActivity(activity: PhoenixFundingActivity, bySymbol: Map<string, PerpetualInstrument>): PortfolioActivityItem | null {
  const instrument = bySymbol.get(activity.marketSymbol);
  if (!instrument) return null;
  const paid = activity.paymentUsd < 0;
  return {
    activityId: activity.activityId,
    kind: 'funding',
    productType: 'perpetual',
    action: paid ? 'funding_paid' : 'funding_received',
    status: 'confirmed',
    title: paid ? 'Funding paid' : 'Funding received',
    subtitle: `${activity.marketSymbol} · Phoenix`,
    assetId: instrument.assetId,
    instrumentId: instrument.instrumentId,
    companyName: instrument.companyName,
    symbol: activity.marketSymbol,
    quantity: null,
    valueUsd: activity.paymentUsd,
    occurredAt: activity.occurredAt,
    signature: null,
    explorerUrl: null,
    executionId: null,
    groupId: activity.activityId,
  };
}

function primaryWallet(identity: ExecutionIdentity) {
  for (const address of identity.walletAddresses) {
    try { return new PublicKey(address).toBase58(); } catch { /* ignore non-Solana values */ }
  }
  throw new PortfolioServiceFault('WALLET_REQUIRED', 422, 'Finish setting up a Solana wallet to view Portfolio.');
}

function walletDto(address: string, supportedAssetState: PortfolioSupportedAssetState) {
  return {
    address,
    displayAddress: `${address.slice(0, 4)}…${address.slice(-4)}`,
    network: 'Solana' as const,
    supportedAssetState,
  };
}

function supportedMintMap(instruments: MarketInstrument[]) {
  return new Map(instruments.flatMap((instrument): [string, SpotInstrument | PrestockInstrument][] =>
    isOwnedInstrument(instrument) ? [[instrument.mint, instrument]] : []));
}

function classifySupportedAssets(input: {
  instruments: MarketInstrument[];
  registryAvailable: boolean;
  walletSnapshot: WalletSnapshot | null;
}): PortfolioSupportedAssetState {
  if (!input.walletSnapshot) return 'unavailable';
  const supportedMints = supportedMintMap(input.instruments);
  const hasSupportedToken = input.walletSnapshot.tokens.some((balance) => (
    rawAmountIsPositive(balance.rawAmount)
    && (balance.mint === USDC_MINT || supportedMints.has(balance.mint))
  ));
  if (hasSupportedToken || rawAmountIsPositive(input.walletSnapshot.solLamports)) return 'funded';
  if (!input.registryAvailable) return 'unavailable';
  const hasUnsupportedToken = input.walletSnapshot.tokens.some((balance) => rawAmountIsPositive(balance.rawAmount));
  return hasUnsupportedToken ? 'unsupported_only' : 'empty';
}

function rawAmountIsPositive(value: string) {
  try {
    return BigInt(value) > 0n;
  } catch {
    return false;
  }
}

function perpetualSymbolMap(instruments: MarketInstrument[]) {
  return new Map(instruments.flatMap((instrument): [string, PerpetualInstrument][] =>
    isPerpetual(instrument) ? [[instrument.symbol.toUpperCase(), instrument]] : []));
}

function isOwnedInstrument(instrument: MarketInstrument): instrument is SpotInstrument | PrestockInstrument {
  return instrument.productType === 'spot' || instrument.productType === 'prestock';
}

function isPerpetual(instrument: MarketInstrument): instrument is PerpetualInstrument {
  return instrument.productType === 'perpetual';
}

function isSpot(instrument: MarketInstrument): instrument is SpotInstrument {
  return instrument.productType === 'spot';
}

function money(amount: number, asOf: string, dataState: PortfolioDataState): PortfolioMoney {
  return { amount: Number.isFinite(amount) ? amount : null, currency: 'USD', asOf: Number.isFinite(amount) ? asOf : null, dataState: Number.isFinite(amount) ? dataState : 'unavailable' };
}

function unavailableMoney(): PortfolioMoney {
  return { amount: null, currency: 'USD', asOf: null, dataState: 'unavailable' };
}

function perpetualsDto(
  snapshot: PhoenixPortfolioSnapshot | null,
  registrationMode: 'non_referral' | 'referral',
) {
  const accountState = snapshot?.accountState ?? 'unavailable';
  return {
    accountState,
    registration: accountState === 'not_initialized'
      ? { feePayer: 'user_wallet' as const, mode: registrationMode }
      : null,
  };
}

function metric(value: number | null, asOf: string | null, dataState: PortfolioDataState) {
  return value === null || !Number.isFinite(value) ? unavailableMetric() : { value, asOf: asOf ?? new Date(0).toISOString(), dataState };
}

function unavailableMetric() {
  return { value: null, asOf: null, dataState: 'unavailable' as const };
}

function marketState(state: string): PortfolioDataState {
  return state === 'live' || state === 'delayed' || state === 'stale' ? state : 'unavailable';
}

function combineState(states: PortfolioDataState[]): PortfolioDataState {
  if (states.includes('unavailable')) return 'unavailable';
  if (states.includes('stale')) return 'stale';
  if (states.includes('delayed')) return 'delayed';
  return 'live';
}

function sumMoney(values: PortfolioMoney[]) {
  return values.reduce((sum, value) => sum + (value.amount ?? 0), 0);
}

function sumNullable(values: (number | null)[]) {
  return values.some((value) => value === null)
    ? null
    : values.reduce<number>((sum, value) => sum + value!, 0);
}

function fundingEffect(direction: 'long' | 'short', rate: number | null) {
  if (rate === null || rate === 0) return null;
  return (direction === 'long') === (rate > 0) ? 'pay' as const : 'receive' as const;
}

function baseUnitsToDecimalString(raw: string, decimals: number) {
  const amount = BigInt(raw);
  if (decimals === 0) return amount.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function absoluteDecimal(value: string) {
  return value.startsWith('-') ? value.slice(1) : value;
}

function registryWarning(warning: MarketsWarning): PortfolioWarning {
  return {
    section: 'valuation',
    code: warning.code,
    message: warning.message,
    retryable: warning.retryable,
  };
}

function providerWarning(section: PortfolioWarning['section'], code: string, message: string, retryable = true): PortfolioWarning {
  return { section, code, message, retryable };
}

function phoenixAccountWarning(error: unknown): PortfolioWarning {
  return providerWarning(
    'perpetuals',
    'PHOENIX_ACCOUNT_UNAVAILABLE',
    'Phoenix data could not be loaded. Your wallet balances are still available.',
    !(error instanceof PortfolioProviderError) || error.retryable,
  );
}

function dedupeWarnings(warnings: PortfolioWarning[]) {
  return [...new Map(warnings.map((warning) => [`${warning.section}:${warning.code}:${warning.message}`, warning])).values()];
}

async function settled<T>(load: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try { return { ok: true, value: await load() }; }
  catch (error) { return { ok: false, error }; }
}

type ActivityCursor = { before: string; id: string };

function encodeActivityCursor(item: PortfolioActivityItem) {
  return Buffer.from(JSON.stringify({ before: item.occurredAt, id: item.activityId } satisfies ActivityCursor)).toString('base64url');
}

function decodeActivityCursor(value: string | undefined): ActivityCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as ActivityCursor;
    if (!parsed || typeof parsed.before !== 'string' || Number.isNaN(new Date(parsed.before).getTime()) || typeof parsed.id !== 'string') throw new Error();
    return parsed;
  } catch {
    throw new PortfolioServiceFault('INVALID_CURSOR', 400, 'This Portfolio activity cursor is not valid.');
  }
}

function cursorAllows(item: PortfolioActivityItem, cursor: ActivityCursor | undefined) {
  return !cursor || item.occurredAt < cursor.before || (item.occurredAt === cursor.before && item.activityId < cursor.id);
}

function activityKindAllows(item: PortfolioActivityItem, kind: PortfolioActivityQuery['kind']) {
  if (kind === 'all') return true;
  if (kind === 'trades') return item.kind === 'trade';
  if (kind === 'perpetuals') return item.kind === 'perpetual';
  if (kind === 'transfers') return item.kind === 'transfer';
  return item.kind === 'funding';
}

function activityQueryAllows(item: PortfolioActivityItem, query: string | undefined) {
  if (!query) return true;
  const needle = query.toLocaleLowerCase();
  return [item.title, item.subtitle, item.companyName, item.symbol, item.signature]
    .some((value) => value?.toLocaleLowerCase().includes(needle));
}

function resolveActivityScope(query: string | undefined, instruments: MarketInstrument[]) {
  const supportedPerpetuals = [...perpetualSymbolMap(instruments).keys()];
  if (!query) return {
    mints: undefined,
    marketSymbols: supportedPerpetuals,
    referenceQuery: undefined,
  };
  const needle = query.toLocaleLowerCase();
  const matches = instruments.filter((instrument) => [
    instrument.assetId,
    instrument.instrumentId,
    instrument.companyName,
    instrument.ticker,
    instrument.symbol,
  ].some((value) => value?.toLocaleLowerCase().includes(needle)));
  const cashMints = [
    ...(USDC_MINT.toLocaleLowerCase().includes(needle) || 'usdc'.includes(needle) ? [USDC_MINT] : []),
    ...(NATIVE_SOL_MINT.toLocaleLowerCase().includes(needle) || 'sol'.includes(needle) ? [NATIVE_SOL_MINT] : []),
  ];
  if (matches.length || cashMints.length) {
    return {
      mints: [...new Set([
        ...matches.flatMap((instrument) => isOwnedInstrument(instrument) ? [instrument.mint] : []),
        ...cashMints,
      ])],
      marketSymbols: [...new Set(matches.flatMap((instrument) => isPerpetual(instrument) ? [instrument.symbol] : []))],
      referenceQuery: undefined,
    };
  }
  return { mints: undefined, marketSymbols: supportedPerpetuals, referenceQuery: needle };
}

function compareActivity(left: PortfolioActivityItem, right: PortfolioActivityItem) {
  return right.occurredAt.localeCompare(left.occurredAt) || right.activityId.localeCompare(left.activityId);
}

function dedupeActivity(items: PortfolioActivityItem[]) {
  const priority = (item: PortfolioActivityItem) => item.kind === 'perpetual' && item.action === 'position_changed' ? 3 : item.executionId ? 2 : 1;
  const byKey = new Map<string, PortfolioActivityItem>();
  for (const item of items) {
    const key = item.signature ? `signature:${item.signature}` : `activity:${item.activityId}`;
    const prior = byKey.get(key);
    if (!prior || priority(item) > priority(prior)) byKey.set(key, item);
  }
  return [...byKey.values()];
}

function explorerUrl(signature: string) {
  return `https://solscan.io/tx/${encodeURIComponent(signature)}`;
}
