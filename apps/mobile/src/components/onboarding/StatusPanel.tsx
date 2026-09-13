import { StyleSheet, Text, View } from 'react-native';

import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type StatusPanelVariant = 'pending' | 'verifying' | 'verified' | 'error' | 'blocked';

export type StatusPanelProps = {
  variant: StatusPanelVariant;
  heading: string;
  children: string;
  /** Set false when the parent owns the single announcement for a returned external handoff. */
  announce?: boolean;
};

const iconByVariant: Record<StatusPanelVariant, string> = {
  pending: '…',
  verifying: '·',
  verified: '✓',
  error: '!',
  blocked: '!',
};

export function StatusPanel({ variant, heading, children, announce = true }: StatusPanelProps) {
  const theme = useTheme();
  const isCaution = variant === 'error' || variant === 'blocked';
  const isVerified = variant === 'verified';
  const accent = isCaution ? theme.caution : isVerified ? theme.proof : theme.muted;
  const wash = isCaution ? theme.cautionWash : isVerified ? theme.proofWash : theme.surface;

  return (
    <View
      accessibilityLiveRegion={announce ? 'polite' : 'none'}
      accessibilityRole={isCaution ? 'alert' : undefined}
      accessibilityState={{ busy: variant === 'pending' || variant === 'verifying' }}
      style={[styles.panel, { backgroundColor: wash, borderColor: accent }]}>
      <View accessibilityElementsHidden importantForAccessibility="no" style={[styles.icon, { borderColor: accent }]}>
        <Text style={[styles.iconText, { color: accent }]}>{iconByVariant[variant]}</Text>
      </View>
      <View style={styles.copy}>
        <Text accessibilityRole="header" style={[styles.heading, { color: theme.ink }]}>{heading}</Text>
        <Text style={[styles.body, { color: theme.ink }]}>{children}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    alignItems: 'flex-start',
    borderRadius: 12,
    borderStartWidth: 3,
    flexDirection: 'row',
    gap: Spacing.two,
    padding: Spacing.three,
  },
  icon: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  iconText: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 20,
  },
  copy: {
    flex: 1,
    gap: Spacing.half,
    minWidth: 0,
  },
  heading: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 24,
  },
  body: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    lineHeight: 24,
  },
});
