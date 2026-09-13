import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type WalletEvidenceCardProps = {
  chain: string;
  address: string;
  /** The address shown by default. Supply a shortened form to preserve privacy in the visual UI. */
  shortenedAddress: string;
  network?: string;
  onCopyAddress?: (address: string) => void;
  copyLabel?: string;
  showFullAddress?: boolean;
};

export function WalletEvidenceCard({
  chain,
  address,
  shortenedAddress,
  network,
  onCopyAddress,
  copyLabel = 'Copy full address',
  showFullAddress = false,
}: WalletEvidenceCardProps) {
  const theme = useTheme();
  const visibleAddress = showFullAddress ? address : shortenedAddress;

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.outline }]}>
      <View style={styles.header}>
        <Text style={[styles.eyebrow, { color: theme.muted }]}>Connected wallet</Text>
        <Text style={[styles.chain, { color: theme.ink }]}>{chain}</Text>
      </View>
      <Text selectable style={[styles.address, { color: theme.ink }]}>{visibleAddress}</Text>
      {network ? <Text style={[styles.network, { color: theme.muted }]}>{network}</Text> : null}
      {onCopyAddress ? (
        <Pressable
          accessibilityHint="Copies the complete wallet address"
          accessibilityLabel={copyLabel}
          accessibilityRole="button"
          hitSlop={Spacing.two}
          onPress={() => onCopyAddress(address)}
          style={({ pressed }) => [styles.copyAction, { opacity: pressed ? 0.72 : 1 }]}>
          <Text style={[styles.copyText, { color: theme.proof }]}>{copyLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    gap: Spacing.one,
    padding: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    justifyContent: 'space-between',
  },
  eyebrow: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
  },
  chain: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  address: {
    fontFamily: Fonts.mono,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
    lineHeight: 18,
  },
  network: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    lineHeight: 20,
  },
  copyAction: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    minHeight: 44,
    paddingEnd: Spacing.two,
  },
  copyText: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 20,
  },
});
