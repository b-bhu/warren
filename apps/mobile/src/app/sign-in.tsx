import { useLocalSearchParams, useRouter } from 'expo-router';

import { findMarketStock, formatUsd } from '@/features/market/catalog';
import { PrivyEntry } from '@/features/privy';

export default function SignInRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    budget?: string | string[];
    intent?: string | string[];
    symbol?: string | string[];
  }>();
  const stock = findMarketStock(params.symbol);
  const rawBudget = Array.isArray(params.budget) ? params.budget[0] : params.budget;
  const parsedBudget = Number(rawBudget);
  const hasBuyIntent = params.intent === 'buy' && stock && Number.isFinite(parsedBudget);
  const contextLabel = hasBuyIntent
    ? `${formatUsd(parsedBudget)} USDC for ${stock.instrument.symbol} is saved. Sign-in does not approve it.`
    : undefined;

  return <PrivyEntry contextLabel={contextLabel} onCancel={() => router.back()} />;
}
