import { useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { ScrollView, Text, XStack, YStack } from 'tamagui';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { formatPercent, formatUsd, type MarketStock } from './catalog';

export function MarketScreen({ children }: { children: React.ReactNode }) {
  return (
    <YStack backgroundColor="$canvas" flex={1}>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
        <ScrollView
          alwaysBounceVertical={false}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <YStack alignSelf="center" gap="$5" maxWidth={680} width="100%">
            {children}
          </YStack>
        </ScrollView>
      </SafeAreaView>
    </YStack>
  );
}

export function MarketHeader({
  action = 'sign-in',
  showBack = false,
}: {
  action?: 'guest' | 'none' | 'sign-in';
  showBack?: boolean;
}) {
  const router = useRouter();
  const theme = useTheme();

  return (
    <XStack alignItems="center" justifyContent="space-between" minHeight={48}>
      <Pressable
        accessibilityLabel={showBack ? 'Go back' : 'Warren home'}
        accessibilityRole="button"
        hitSlop={8}
        onPress={() => {
          if (!showBack) {
            router.replace('/' as Href);
            return;
          }
          if (router.canGoBack()) router.back();
          else router.replace('/' as Href);
        }}
        style={({ pressed }) => [styles.brandButton, pressed && styles.pressed]}>
        {showBack ? (
          <>
            <Text color="$ink" fontFamily="$body" fontSize={20}>
              ‹
            </Text>
            <Text color="$ink" fontFamily="$body" fontSize={14} fontWeight="600">
              Back
            </Text>
          </>
        ) : (
          <>
            <YStack
              alignItems="center"
              backgroundColor="$proofWash"
              borderColor="$outline"
              borderRadius="$control"
              borderWidth={1}
              height={30}
              justifyContent="center"
              transform={[{ rotate: '-9deg' }]}
              width={30}>
              <Text
                color="$proof"
                fontFamily="$serif"
                fontSize={15}
                transform={[{ rotate: '9deg' }]}>
                W
              </Text>
            </YStack>
            <Text color="$ink" fontFamily="$serif" fontSize={19} fontWeight="700">
              Warren
            </Text>
          </>
        )}
      </Pressable>

      {action === 'sign-in' ? (
        <Pressable
          accessibilityHint="Opens account sign-in"
          accessibilityRole="button"
          onPress={() => router.push('/sign-in' as Href)}
          style={({ pressed }) => [
            styles.signInButton,
            { borderColor: theme.outline, backgroundColor: theme.surface },
            pressed && styles.pressed,
          ]}>
          <Text color="$ink" fontFamily="$body" fontSize={14} fontWeight="700">
            Sign in
          </Text>
        </Pressable>
      ) : null}
      {action === 'guest' ? (
        <XStack
          alignItems="center"
          backgroundColor="$surface"
          borderColor="$outline"
          borderRadius="$pill"
          borderWidth={1}
          gap="$2"
          minHeight={36}
          paddingHorizontal="$3">
          <YStack backgroundColor="$proof" borderRadius="$pill" height={7} width={7} />
          <Text color="$muted" fontFamily="$body" fontSize={13} fontWeight="700">
            Guest
          </Text>
        </XStack>
      ) : null}
    </XStack>
  );
}

export function GuestMarker() {
  return (
    <XStack alignItems="center" gap="$2">
      <YStack backgroundColor="$proof" borderRadius="$pill" height={7} width={7} />
      <Text
        color="$muted"
        fontFamily="$mono"
        fontSize={11}
        letterSpacing={0.8}
        textTransform="uppercase">
        Guest browsing
      </Text>
    </XStack>
  );
}

export function StockMark({ stock, size = 46 }: { stock: MarketStock; size?: number }) {
  return (
    <YStack
      alignItems="center"
      borderRadius={Math.round(size * 0.28)}
      height={size}
      justifyContent="center"
      style={{ backgroundColor: stock.accent }}
      width={size}>
      <Text color="#FFFFFF" fontFamily="$body" fontSize={size * 0.26} fontWeight="800">
        {stock.ticker.slice(0, 2)}
      </Text>
    </YStack>
  );
}

export function Sparkline({
  points,
  width = 88,
  height = 34,
}: {
  points: readonly number[];
  width?: number;
  height?: number;
}) {
  const theme = useTheme();
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = Math.max(max - min, 1);
  const inset = 2;
  const path = points
    .map((point, index) => {
      const x = inset + (index / Math.max(points.length - 1, 1)) * (width - inset * 2);
      const y = height - inset - ((point - min) / range) * (height - inset * 2);
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <Svg height={height} width={width}>
      <Path
        d={path}
        fill="none"
        stroke={theme.proof}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
      />
    </Svg>
  );
}

export function StockRow({ stock }: { stock: MarketStock }) {
  const router = useRouter();
  const theme = useTheme();

  return (
    <Pressable
      accessibilityHint={`Shows ${stock.company} and its supported stock instrument`}
      accessibilityLabel={`${stock.company}, ${formatUsd(stock.price)}, ${formatPercent(stock.changePercent)} sample change`}
      accessibilityRole="button"
      onPress={() =>
        router.push({
          pathname: '/stocks/[symbol]',
          params: { symbol: stock.ticker },
        } as Href)
      }
      style={({ pressed }) => [
        styles.stockRow,
        { backgroundColor: theme.surface, borderColor: theme.outline },
        pressed && styles.rowPressed,
      ]}>
      <StockMark stock={stock} />
      <YStack flex={1} gap={2}>
        <Text color="$ink" fontFamily="$body" fontSize={16} fontWeight="700">
          {stock.company}
        </Text>
        <Text color="$muted" fontFamily="$body" fontSize={13}>
          {stock.ticker} · {stock.sector}
        </Text>
      </YStack>
      <Sparkline points={stock.chart} width={56} />
      <YStack alignItems="flex-end" minWidth={66}>
        <Text color="$ink" fontFamily="$mono" fontSize={14} fontWeight="700">
          {formatUsd(stock.price)}
        </Text>
        <Text color={stock.changePercent >= 0 ? '$proof' : '$caution'} fontFamily="$mono" fontSize={12}>
          {formatPercent(stock.changePercent)}
        </Text>
      </YStack>
    </Pressable>
  );
}

export function CompactStockRow({ stock }: { stock: MarketStock }) {
  const router = useRouter();
  const theme = useTheme();

  return (
    <Pressable
      accessibilityLabel={`Open ${stock.company}, ${formatUsd(stock.price)}, ${formatPercent(stock.changePercent)} sample change`}
      accessibilityRole="button"
      onPress={() =>
        router.push({
          pathname: '/stocks/[symbol]',
          params: { symbol: stock.ticker },
        } as Href)
      }
      style={({ pressed }) => [
        styles.compactRow,
        { borderBottomColor: theme.outline },
        pressed && styles.pressed,
      ]}>
      <StockMark size={38} stock={stock} />
      <YStack flex={1} gap={1}>
        <Text color="$ink" fontFamily="$body" fontSize={15} fontWeight="700">
          {stock.company}
        </Text>
        <Text color="$muted" fontFamily="$body" fontSize={12}>
          {stock.ticker}
        </Text>
      </YStack>
      <YStack alignItems="flex-end" gap={1}>
        <Text color="$ink" fontFamily="$mono" fontSize={14} fontWeight="700">
          {formatUsd(stock.price)}
        </Text>
        <Text color={stock.changePercent >= 0 ? '$proof' : '$caution'} fontFamily="$mono" fontSize={12}>
          {formatPercent(stock.changePercent)}
        </Text>
      </YStack>
    </Pressable>
  );
}

export function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <XStack alignItems="flex-start" gap="$4" justifyContent="space-between" paddingVertical="$3">
      <Text color="$muted" flex={1} fontFamily="$body" fontSize={14} lineHeight={20}>
        {label}
      </Text>
      <Text
        color="$ink"
        flex={1.2}
        fontFamily="$body"
        fontSize={14}
        fontWeight="600"
        lineHeight={20}
        textAlign="right">
        {value}
      </Text>
    </XStack>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: Spacing.five,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.one,
  },
  brandButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 44,
  },
  signInButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 15,
  },
  pressed: { opacity: 0.72 },
  stockRow: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 78,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  compactRow: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    minHeight: 66,
    paddingVertical: 10,
  },
  rowPressed: { opacity: 0.78, transform: [{ scale: 0.995 }] },
});
