import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect } from 'react';

import { findMarketStock, formatUsd } from '@/features/market/catalog';
import { PrivyEntry, useTransactionWallet, useViewerStatus } from '@/features/privy';
import { canResumePrivateIntent } from '@/features/privy/auth-navigation';

export default function SignInRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    budget?: string | string[];
    intent?: string | string[];
    symbol?: string | string[];
    returnAssetId?: string | string[];
    returnProduct?: string | string[];
    returnInstrumentId?: string | string[];
    returnDirection?: string | string[];
    returnAmount?: string | string[];
    returnSettlementMint?: string | string[];
    returnOrderType?: string | string[];
    returnLeverage?: string | string[];
    returnLimitPrice?: string | string[];
    returnMode?: string | string[];
    returnPortfolioView?: string | string[];
  }>();
  const viewerStatus = useViewerStatus();
  const wallet = useTransactionWallet();
  const stock = findMarketStock(params.symbol);
  const rawBudget = Array.isArray(params.budget) ? params.budget[0] : params.budget;
  const parsedBudget = Number(rawBudget);
  const hasBuyIntent = params.intent === 'buy' && stock && Number.isFinite(parsedBudget);
  const returnAssetId = first(params.returnAssetId);
  const hasTradeReturn = Boolean(returnAssetId);
  const returnPortfolioView = first(params.returnPortfolioView);
  const contextLabel = hasTradeReturn
    ? 'Your trade ticket is saved. Signing in does not approve or submit it.'
    : hasBuyIntent
    ? `${formatUsd(parsedBudget)} USDC for ${stock.instrument.symbol} is saved. Sign-in does not approve it.`
    : undefined;

  useEffect(() => {
    // A Privy session can exist before its embedded Solana wallet is usable.
    // Keep the recovery/setup screen mounted until that wallet is truly ready.
    if (!canResumePrivateIntent(viewerStatus, wallet.status)) return;
    if (returnAssetId) {
      if (first(params.returnMode) === 'back' && router.canGoBack()) {
        router.back();
        return;
      }
      router.replace({
        pathname: '/trade/[assetId]',
        params: {
          assetId: returnAssetId,
          product: first(params.returnProduct) ?? 'spot',
          instrumentId: first(params.returnInstrumentId) ?? '',
          direction: first(params.returnDirection) ?? '',
          amount: first(params.returnAmount) ?? '',
          settlementMint: first(params.returnSettlementMint) ?? '',
          orderType: first(params.returnOrderType) ?? 'market',
          leverage: first(params.returnLeverage) ?? '2',
          limitPrice: first(params.returnLimitPrice) ?? '',
        },
      } as unknown as Href);
      return;
    }
    if (returnPortfolioView === 'positions' || returnPortfolioView === 'activity') {
      router.replace({ pathname: '/(tabs)/profile', params: { view: returnPortfolioView } } as Href);
    }
  }, [params.returnAmount, params.returnDirection, params.returnInstrumentId, params.returnLeverage, params.returnLimitPrice, params.returnMode, params.returnOrderType, params.returnProduct, params.returnSettlementMint, returnAssetId, returnPortfolioView, router, viewerStatus, wallet.status]);

  return <PrivyEntry contextLabel={contextLabel} onCancel={() => router.back()} />;
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
