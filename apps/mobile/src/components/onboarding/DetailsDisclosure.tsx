import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type DetailsDisclosureProps = {
  fullAddress?: string;
  network?: string;
  errorCategory?: string;
  attemptReference?: string;
  onCopyAddress?: (address: string) => void;
  expanded?: boolean;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  label?: string;
};

/**
 * Only renders support-safe fields. Challenges, signatures, credentials, and other
 * sensitive artifacts intentionally have no API here.
 */
export function DetailsDisclosure({
  fullAddress,
  network,
  errorCategory,
  attemptReference,
  onCopyAddress,
  expanded,
  defaultExpanded = false,
  onExpandedChange,
  label = 'Details',
}: DetailsDisclosureProps) {
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(defaultExpanded);
  const theme = useTheme();
  const isExpanded = expanded ?? uncontrolledExpanded;
  const contentId = 'onboarding-details';

  const toggle = () => {
    const next = !isExpanded;
    if (expanded === undefined) setUncontrolledExpanded(next);
    onExpandedChange?.(next);
  };

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ expanded: isExpanded }}
        onPress={toggle}
        style={({ pressed }) => [styles.trigger, { opacity: pressed ? 0.72 : 1 }]}>
        <Text style={[styles.triggerText, { color: theme.proof }]}>{label}</Text>
        <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.chevron, { color: theme.proof }]}>{isExpanded ? '⌃' : '⌄'}</Text>
      </Pressable>
      {isExpanded ? (
        <View nativeID={contentId} style={[styles.details, { backgroundColor: theme.surface, borderColor: theme.outline }]}>
          {fullAddress ? <Detail label="Full address" value={fullAddress} evidence /> : null}
          {network ? <Detail label="Network" value={network} /> : null}
          {errorCategory ? <Detail label="Error category" value={errorCategory} /> : null}
          {attemptReference ? <Detail label="Attempt reference" value={attemptReference} evidence /> : null}
          {fullAddress && onCopyAddress ? (
            <Pressable
              accessibilityHint="Copies the complete wallet address"
              accessibilityLabel="Copy full address"
              accessibilityRole="button"
              onPress={() => onCopyAddress(fullAddress)}
              style={({ pressed }) => [styles.copy, { opacity: pressed ? 0.72 : 1 }]}>
              <Text style={[styles.copyText, { color: theme.proof }]}>Copy full address</Text>
            </Pressable>
          ) : null}
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
      <Text selectable style={[evidence ? styles.evidence : styles.value, { color: theme.ink }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
  },
  trigger: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.one,
    justifyContent: 'center',
    minHeight: 44,
    paddingEnd: Spacing.two,
  },
  triggerText: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 20,
  },
  chevron: {
    fontSize: 16,
    lineHeight: 20,
  },
  details: {
    borderRadius: 10,
    borderWidth: 1,
    gap: Spacing.two,
    padding: Spacing.three,
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
  value: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    lineHeight: 24,
  },
  evidence: {
    fontFamily: Fonts.mono,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
    lineHeight: 18,
  },
  copy: {
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
