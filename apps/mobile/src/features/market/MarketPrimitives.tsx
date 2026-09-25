import { useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, Text, XStack, YStack } from 'tamagui';

import { AppAccountButton } from '@/components/AppAccountButton';
import { BrandLogo } from '@/components/brand-logo';
import { Spacing } from '@/constants/theme';

import { type MarketStock } from './catalog';

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
  action = 'account',
  showBack = false,
}: {
  action?: 'account' | 'none';
  showBack?: boolean;
}) {
  const router = useRouter();

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
          <BrandLogo decorative />
        )}
      </Pressable>

      {action === 'account' ? <AppAccountButton /> : null}
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
