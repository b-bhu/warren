import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Input, Separator, Text, XStack, YStack } from 'tamagui';

import { useTheme } from '@/hooks/use-theme';

import { findMarketStock, formatUsd } from './catalog';
import { FactRow, MarketHeader, MarketScreen, StockMark } from './MarketPrimitives';

const MINIMUM_SAMPLE_BUDGET = 1;

export function BuyIntentScreen() {
  const params = useLocalSearchParams<{ symbol?: string | string[]; budget?: string | string[] }>();
  const router = useRouter();
  const theme = useTheme();
  const stock = findMarketStock(params.symbol);
  const initialBudget = Array.isArray(params.budget) ? params.budget[0] : params.budget;
  const [budget, setBudget] = useState(initialBudget ?? '50');
  const numericBudget = Number(budget);
  const validBudget = Number.isFinite(numericBudget) && numericBudget >= MINIMUM_SAMPLE_BUDGET;
  const indicativeAmount = useMemo(() => {
    if (!stock || !validBudget) return 0;
    return numericBudget / stock.price;
  }, [numericBudget, stock, validBudget]);

  if (!stock) {
    return (
      <MarketScreen>
        <MarketHeader showBack />
        <Text color="$ink" fontFamily="$serif" fontSize={30} fontWeight="700" paddingTop="$6">
          Purchase not supported
        </Text>
      </MarketScreen>
    );
  }

  return (
    <MarketScreen>
      <MarketHeader showBack />

      <YStack gap="$5" paddingTop="$3">
        <YStack gap="$3">
          <Text color="$proof" fontFamily="$mono" fontSize={11} letterSpacing={0.8} textTransform="uppercase">
            Purchase preview
          </Text>
          <Text color="$ink" fontFamily="$serif" fontSize={36} fontWeight="700" letterSpacing={-1} lineHeight={41}>
            Choose your budget.
          </Text>
          <Text color="$muted" fontFamily="$body" fontSize={16} lineHeight={24}>
            Set the amount first. Warren will keep this intent while you sign in, and
            signing in will not approve the purchase.
          </Text>
        </YStack>

        <XStack
          alignItems="center"
          backgroundColor="$surface"
          borderColor="$outline"
          borderRadius="$card"
          borderWidth={1}
          gap="$3"
          padding="$4">
          <StockMark stock={stock} />
          <YStack flex={1} gap="$1">
            <Text color="$ink" fontFamily="$body" fontSize={16} fontWeight="800">
              {stock.company}
            </Text>
            <Text color="$muted" fontFamily="$body" fontSize={13}>
              {stock.instrument.symbol} · {stock.instrument.issuer} · {stock.instrument.network}
            </Text>
          </YStack>
        </XStack>

        <YStack gap="$2">
          <Text color="$ink" fontFamily="$body" fontSize={14} fontWeight="700">
            USDC budget
          </Text>
          <Input
            aria-label="USDC purchase budget"
            backgroundColor="$surface"
            borderColor={validBudget ? '$outline' : '$caution'}
            borderRadius="$control"
            color="$ink"
            fontFamily="$mono"
            fontSize={24}
            height={58}
            inputMode="decimal"
            keyboardType="decimal-pad"
            onChangeText={(value) => setBudget(value.replace(/[^0-9.]/g, ''))}
            placeholder="50.00"
            placeholderTextColor="$muted"
            value={budget}
          />
          {!validBudget ? (
            <Text color="$caution" fontFamily="$body" fontSize={13}>
              Enter a budget of at least {formatUsd(MINIMUM_SAMPLE_BUDGET)}.
            </Text>
          ) : null}
        </YStack>

        <YStack
          backgroundColor="$surface"
          borderColor="$outline"
          borderRadius="$card"
          borderWidth={1}
          overflow="hidden"
          paddingHorizontal="$4">
          <FactRow label="Budget" value={validBudget ? `${formatUsd(numericBudget)} USDC` : '—'} />
          <Separator borderColor="$outline" />
          <FactRow
            label="Indicative amount"
            value={validBudget ? `≈ ${indicativeAmount.toFixed(5)} ${stock.instrument.symbol}` : '—'}
          />
          <Separator borderColor="$outline" />
          <FactRow label="Current status" value="Sample estimate · not executable" />
        </YStack>

        <Pressable
          accessibilityHint="Signs in and preserves this purchase budget"
          accessibilityRole="button"
          disabled={!validBudget}
          onPress={() =>
            router.push({
              pathname: '/sign-in',
              params: {
                intent: 'buy',
                symbol: stock.ticker,
                budget: numericBudget.toFixed(2),
              },
            } as Href)
          }
          style={({ pressed }) => [
            styles.continueButton,
            {
              backgroundColor: validBudget ? theme.proof : theme.disabledSurface,
            },
            pressed && validBudget && styles.pressed,
          ]}>
          <Text
            color={validBudget ? '$onProof' : '$disabledInk'}
            fontFamily="$body"
            fontSize={16}
            fontWeight="800">
            Continue to sign in
          </Text>
          <Text color={validBudget ? '$onProof' : '$disabledInk'} fontFamily="$body" fontSize={19}>
            →
          </Text>
        </Pressable>

        <Text color="$muted" fontFamily="$body" fontSize={13} lineHeight={20} textAlign="center">
          Executable price, fees, slippage, and minimum received will come from a fresh
          quote after authentication. No transaction is created on this screen.
        </Text>
      </YStack>
    </MarketScreen>
  );
}

const styles = StyleSheet.create({
  continueButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: 18,
  },
  pressed: { opacity: 0.78, transform: [{ scale: 0.995 }] },
});
