import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type RegisterHeaderProps = {
  label?: string;
  title: string;
  status?: string;
  onBack?: () => void;
  backLabel?: string;
};

export function RegisterHeader({ label = 'Sign-in record', title, status, onBack, backLabel = 'Back' }: RegisterHeaderProps) {
  const theme = useTheme();

  return (
    <View style={styles.container}>
      <View style={styles.topLine}>
        {onBack ? (
          <Pressable
            accessibilityHint="Returns to the previous sign-in step"
            accessibilityLabel={backLabel}
            accessibilityRole="button"
            hitSlop={Spacing.two}
            onPress={onBack}
            style={({ pressed }) => [styles.back, { opacity: pressed ? 0.72 : 1 }]}>
            <Text style={[styles.backText, { color: theme.proof }]}>‹ {backLabel}</Text>
          </Pressable>
        ) : null}
        <Text style={[styles.label, { color: theme.muted }]}>{label}</Text>
      </View>
      <Text accessibilityRole="header" style={[styles.title, { color: theme.ink }]}>{title}</Text>
      {status ? <Text accessibilityLiveRegion="polite" style={[styles.status, { color: theme.muted }]}>{status}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.one,
  },
  topLine: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    minHeight: 44,
  },
  back: {
    justifyContent: 'center',
    minHeight: 44,
    paddingEnd: Spacing.one,
  },
  backText: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 20,
  },
  label: {
    fontFamily: Fonts.mono,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.4,
    lineHeight: 18,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: Fonts.serif,
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 34,
  },
  status: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    lineHeight: 24,
  },
});
