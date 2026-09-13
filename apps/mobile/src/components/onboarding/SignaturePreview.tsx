import { StyleSheet, Text, View } from 'react-native';

import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export const PRE_SIGN_SAFETY_COPY = 'This signature is free. It cannot move funds or approve a trade.';

export type SignaturePreviewProps = {
  domain: string;
  chain: string;
  shortenedAddress: string;
  validityWindow?: string;
  /** A server-provided, human-readable challenge preview. It is visual only and never editable. */
  messagePreview?: string;
  safetyCopy?: string;
};

export function SignaturePreview({
  domain,
  chain,
  shortenedAddress,
  validityWindow,
  messagePreview,
  safetyCopy = PRE_SIGN_SAFETY_COPY,
}: SignaturePreviewProps) {
  const theme = useTheme();

  return (
    <View accessibilityLabel={`Sign in to ${domain} with ${shortenedAddress} on ${chain}. ${safetyCopy}`} accessible style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.outline }]}>
      <Text style={[styles.heading, { color: theme.ink }]}>Sign-in details</Text>
      <View style={styles.detailList}>
        <Detail label="Stocklana domain" value={domain} />
        <Detail label="Wallet" value={shortenedAddress} evidence />
        <Detail label="Chain" value={chain} />
        {validityWindow ? <Detail label="Valid for" value={validityWindow} /> : null}
      </View>
      <View style={[styles.safety, { backgroundColor: theme.proofWash, borderColor: theme.proof }]}>
        <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.safetyMark, { color: theme.proof }]}>i</Text>
        <Text style={[styles.safetyCopy, { color: theme.ink }]}>{safetyCopy}</Text>
      </View>
      {messagePreview ? (
        <View style={[styles.message, { borderColor: theme.outline }]}>
          <Text style={[styles.messageLabel, { color: theme.muted }]}>What your wallet will show</Text>
          <Text selectable style={[styles.messageText, { color: theme.ink }]}>{messagePreview}</Text>
        </View>
      ) : null}
    </View>
  );
}

function Detail({ label, value, evidence = false }: { label: string; value: string; evidence?: boolean }) {
  const theme = useTheme();

  return (
    <View style={styles.detail}>
      <Text style={[styles.detailLabel, { color: theme.muted }]}>{label}</Text>
      <Text style={[evidence ? styles.detailEvidence : styles.detailValue, { color: theme.ink }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    gap: Spacing.three,
    padding: Spacing.three,
  },
  heading: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 24,
  },
  detailList: {
    gap: Spacing.two,
  },
  detail: {
    gap: Spacing.half,
  },
  detailLabel: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
  },
  detailValue: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    lineHeight: 24,
  },
  detailEvidence: {
    fontFamily: Fonts.mono,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
    lineHeight: 18,
  },
  safety: {
    alignItems: 'flex-start',
    borderRadius: 10,
    borderStartWidth: 3,
    flexDirection: 'row',
    gap: Spacing.two,
    padding: Spacing.two,
  },
  safetyMark: {
    fontFamily: Fonts.serif,
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 24,
  },
  safetyCopy: {
    flex: 1,
    fontFamily: Fonts.sans,
    fontSize: 16,
    lineHeight: 24,
  },
  message: {
    borderStartWidth: 1,
    gap: Spacing.one,
    paddingStart: Spacing.two,
  },
  messageLabel: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
  },
  messageText: {
    fontFamily: Fonts.mono,
    fontSize: 13,
    lineHeight: 18,
  },
});
