import { useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { Fonts } from '@/constants/theme';
import { usePrivyAuthSheet, useTransactionWallet, useViewerStatus } from '@/features/privy';
import { useTheme } from '@/hooks/use-theme';

type AppAccountButtonProps = {
  appearance?: 'default' | 'outlined';
  onPress?: () => void;
};

export function AppAccountButton({ appearance = 'default', onPress }: AppAccountButtonProps) {
  const router = useRouter();
  const theme = useTheme();
  const viewerStatus = useViewerStatus();
  const wallet = useTransactionWallet();
  const authSheet = usePrivyAuthSheet();
  const signedIn = viewerStatus === 'signed-in';
  const loading = viewerStatus === 'loading' || (signedIn && wallet.status === 'loading');
  let label = 'Sign in';
  if (loading) label = 'Checking';
  else if (signedIn && wallet.status === 'recovery-required') label = 'Recover wallet';
  else if (signedIn && wallet.status === 'error') label = 'Wallet issue';
  else if (signedIn && wallet.address) label = shortenAddress(wallet.address);
  else if (signedIn) label = 'Wallet setup';

  const activate = () => {
    if (loading) return;
    if (onPress) {
      onPress();
      return;
    }
    if (signedIn && wallet.status === 'ready') {
      router.push('/(tabs)/profile' as Href);
      return;
    }
    authSheet.open();
  };

  return (
    <>
      <Pressable
        accessibilityHint={signedIn && wallet.status === 'ready' ? 'Opens Portfolio account and wallet controls' : signedIn ? 'Opens Solana wallet setup' : 'Opens Warren sign-in'}
        accessibilityLabel={loading ? 'Checking Warren account' : signedIn ? `Warren wallet ${label}` : 'Sign in to Warren'}
        accessibilityRole="button"
        accessibilityState={{ busy: loading, disabled: loading }}
        disabled={loading}
        hitSlop={6}
        onPress={activate}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: signedIn ? 'transparent' : theme.proofWash },
          appearance === 'outlined' && { backgroundColor: 'transparent', borderColor: `${theme.muted}33`, borderRadius: 999, borderWidth: 1, paddingHorizontal: 12 },
          pressed && styles.pressed,
          loading && styles.loading,
        ]}>
        {appearance !== 'outlined' || signedIn ? <WalletGlyph color={theme.proof} /> : null}
        <Text numberOfLines={1} style={[styles.label, { color: signedIn || appearance === 'outlined' ? theme.ink : theme.proof }]}>
          {label}
        </Text>
        {signedIn && wallet.address ? (
          <Text accessible={false} style={[styles.chevron, { color: theme.muted }]}>⌄</Text>
        ) : null}
      </Pressable>
    </>
  );
}

function WalletGlyph({ color }: { color: string }) {
  return (
    <Svg fill="none" height={17} viewBox="0 0 24 24" width={17}>
      <Rect height={13} rx={2.5} stroke={color} strokeWidth={1.8} width={17} x={3.5} y={6} />
      <Path d="M3.5 10h17M16.5 13.5H18" stroke={color} strokeLinecap="round" strokeWidth={1.8} />
    </Svg>
  );
}

export function shortenAddress(address: string) {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    maxWidth: 160,
    minHeight: 44,
    paddingHorizontal: 10,
  },
  label: { flexShrink: 1, fontFamily: Fonts.sans, fontSize: 12, fontWeight: '700' },
  chevron: { fontFamily: Fonts.sans, fontSize: 13 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
  loading: { opacity: 0.62 },
});
