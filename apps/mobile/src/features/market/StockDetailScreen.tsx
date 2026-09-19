import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';
import { Separator, Text, XStack, YStack } from 'tamagui';

import { useTheme } from '@/hooks/use-theme';

import { findMarketStock, formatPercent, formatUsd } from './catalog';
import { FactRow, MarketHeader, MarketScreen, Sparkline, StockMark } from './MarketPrimitives';

export function StockDetailScreen() {
  const { symbol } = useLocalSearchParams<{ symbol?: string | string[] }>();
  const router = useRouter();
  const theme = useTheme();
  const stock = findMarketStock(symbol);

  if (!stock) {
    return (
      <MarketScreen>
        <MarketHeader showBack />
        <YStack gap="$3" paddingTop="$6">
          <Text color="$ink" fontFamily="$serif" fontSize={30} fontWeight="700">
            Company not found
          </Text>
          <Text color="$muted" fontFamily="$body" fontSize={16} lineHeight={24}>
            This company is not in Warren’s current demo catalog.
          </Text>
        </YStack>
      </MarketScreen>
    );
  }

  return (
    <MarketScreen>
      <MarketHeader showBack />

      <YStack gap="$5" paddingTop="$3">
        <XStack alignItems="center" gap="$3">
          <StockMark size={58} stock={stock} />
          <YStack flex={1} gap="$1">
            <Text color="$ink" fontFamily="$serif" fontSize={27} fontWeight="700">
              {stock.company}
            </Text>
            <Text color="$muted" fontFamily="$body" fontSize={14}>
              {stock.ticker} · {stock.sector}
            </Text>
          </YStack>
          <YStack alignItems="flex-end">
            <Text color="$ink" fontFamily="$mono" fontSize={21} fontWeight="700">
              {formatUsd(stock.price)}
            </Text>
            <Text color={stock.changePercent >= 0 ? '$proof' : '$caution'} fontFamily="$mono" fontSize={13}>
              {formatPercent(stock.changePercent)} sample
            </Text>
          </YStack>
        </XStack>

        <YStack
          alignItems="center"
          backgroundColor="$surface"
          borderColor="$outline"
          borderRadius="$card"
          borderWidth={1}
          minHeight={150}
          justifyContent="center"
          padding="$4">
          <Sparkline height={112} points={stock.chart} width={240} />
        </YStack>

        <Text color="$muted" fontFamily="$body" fontSize={16} lineHeight={24}>
          {stock.description}
        </Text>

        <YStack gap="$3">
          <Text color="$ink" fontFamily="$serif" fontSize={24} fontWeight="700">
            Supported instrument
          </Text>
          <YStack
            backgroundColor="$surface"
            borderColor="$outline"
            borderRadius="$card"
            borderWidth={1}
            overflow="hidden"
            paddingHorizontal="$4">
            <XStack alignItems="center" justifyContent="space-between" paddingVertical="$4">
              <YStack gap="$1">
                <Text color="$ink" fontFamily="$body" fontSize={18} fontWeight="800">
                  {stock.instrument.symbol}
                </Text>
                <Text color="$muted" fontFamily="$body" fontSize={13}>
                  {stock.instrument.type} · {stock.instrument.issuer}
                </Text>
              </YStack>
              <YStack backgroundColor="$proofWash" borderRadius="$pill" paddingHorizontal="$3" paddingVertical="$2">
                <Text color="$proof" fontFamily="$body" fontSize={12} fontWeight="700">
                  Spot
                </Text>
              </YStack>
            </XStack>
            <Separator borderColor="$outline" />
            <FactRow label="Network" value={stock.instrument.network} />
            <Separator borderColor="$outline" />
            <FactRow label="Price basis" value="USD per displayed token" />
            <Separator borderColor="$outline" />
            <FactRow label="Catalog status" value="Demo registry fixture" />
          </YStack>
        </YStack>

        <Pressable
          accessibilityHint="Opens a USDC budget ticket before sign-in"
          accessibilityRole="button"
          onPress={() =>
            router.push({
              pathname: '/buy/[symbol]',
              params: { symbol: stock.ticker },
            } as Href)
          }
          style={({ pressed }) => [
            styles.buyButton,
            { backgroundColor: theme.proof },
            pressed && styles.pressed,
          ]}>
          <Text color="$onProof" fontFamily="$body" fontSize={16} fontWeight="800">
            Buy {stock.instrument.symbol}
          </Text>
          <Text color="$onProof" fontFamily="$body" fontSize={19}>
            →
          </Text>
        </Pressable>

        <Text color="$muted" fontFamily="$body" fontSize={13} lineHeight={20} textAlign="center">
          You can inspect the company and instrument as a guest. Warren asks you to sign
          in only after you choose a budget.
        </Text>
      </YStack>
    </MarketScreen>
  );
}

const styles = StyleSheet.create({
  buyButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: 18,
  },
  pressed: { opacity: 0.78, transform: [{ scale: 0.995 }] },
});
