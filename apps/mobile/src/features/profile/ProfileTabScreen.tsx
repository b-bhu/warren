import { useRouter } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';
import { Text, XStack, YStack } from 'tamagui';

import { useTheme } from '@/hooks/use-theme';
import { MarketHeader, MarketScreen } from '@/features/market/MarketPrimitives';

export function ProfileTabScreen() {
  const router = useRouter();
  const theme = useTheme();

  return (
    <MarketScreen>
      <MarketHeader action="guest" />

      <YStack gap="$3" paddingTop="$4">
        <Text color="$proof" fontFamily="$mono" fontSize={11} letterSpacing={0.9} textTransform="uppercase">
          Private when you need it
        </Text>
        <Text
          role="heading"
          color="$ink"
          fontFamily="$serif"
          fontSize={40}
          fontWeight="700"
          letterSpacing={-1.3}
          lineHeight={45}>
          Your Warren profile.
        </Text>
        <Text color="$muted" fontFamily="$body" fontSize={17} lineHeight={25}>
          Browsing stays open to everyone. Sign in when you want Warren to prepare your
          wallet, positions, and private activity.
        </Text>
      </YStack>

      <YStack
        backgroundColor="$surface"
        borderColor="$outline"
        borderRadius="$card"
        borderWidth={1}
        gap="$4"
        padding="$4">
        <ProfileCapability label="Browse companies" state="Available as guest" />
        <ProfileCapability label="Review instruments" state="Available as guest" />
        <ProfileCapability label="Wallet and portfolio" state="Sign-in required" />
        <ProfileCapability label="Receipts and activity" state="Sign-in required" />
      </YStack>

      <Pressable
        accessibilityHint="Opens Warren account sign-in"
        accessibilityRole="button"
        onPress={() => router.push('/sign-in')}
        style={({ pressed }) => [
          styles.signInButton,
          { backgroundColor: theme.proof },
          pressed && styles.pressed,
        ]}>
        <Text color="$onProof" fontFamily="$body" fontSize={16} fontWeight="800">
          Sign in to Warren
        </Text>
        <Text color="$onProof" fontFamily="$body" fontSize={19}>
          →
        </Text>
      </Pressable>

      <Text color="$muted" fontFamily="$body" fontSize={13} lineHeight={20} textAlign="center">
        Signing in creates or restores your embedded wallets. It never approves a trade.
      </Text>
    </MarketScreen>
  );
}

function ProfileCapability({ label, state }: { label: string; state: string }) {
  return (
    <XStack alignItems="center" gap="$3" justifyContent="space-between">
      <Text color="$ink" flex={1} fontFamily="$body" fontSize={15} fontWeight="700">
        {label}
      </Text>
      <Text color="$muted" fontFamily="$body" fontSize={12} textAlign="right">
        {state}
      </Text>
    </XStack>
  );
}

const styles = StyleSheet.create({
  signInButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: 18,
  },
  pressed: { opacity: 0.78, transform: [{ scale: 0.995 }] },
});
