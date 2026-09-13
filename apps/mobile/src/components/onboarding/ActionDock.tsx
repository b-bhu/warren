import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Fonts, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ActionDockProps = {
  primaryLabel: string;
  onPrimaryPress: () => void;
  primaryDisabled?: boolean;
  primaryBusy?: boolean;
  primaryAccessibilityHint?: string;
  secondaryLabel?: string;
  onSecondaryPress?: () => void;
};

/** A single primary action and optional text escape hatch, safely docked below the scroll content. */
export function ActionDock({
  primaryLabel,
  onPrimaryPress,
  primaryDisabled = false,
  primaryBusy = false,
  primaryAccessibilityHint,
  secondaryLabel,
  onSecondaryPress,
}: ActionDockProps) {
  const theme = useTheme();
  const unavailable = primaryDisabled || primaryBusy;

  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={[styles.safeArea, { backgroundColor: theme.surface, borderColor: theme.outline }]}>
      <View style={styles.content}>
        <Pressable
          accessibilityHint={primaryAccessibilityHint}
          accessibilityLabel={primaryLabel}
          accessibilityRole="button"
          accessibilityState={{ busy: primaryBusy, disabled: unavailable }}
          disabled={unavailable}
          onPress={onPrimaryPress}
          style={({ pressed }) => [
            styles.primary,
            { backgroundColor: unavailable ? theme.disabledSurface : theme.proof },
            pressed && !unavailable ? styles.pressed : undefined,
          ]}>
          <Text style={[styles.primaryText, { color: unavailable ? theme.disabledInk : theme.onProof }]}>{primaryLabel}</Text>
        </Pressable>
        {secondaryLabel && onSecondaryPress ? (
          <Pressable
            accessibilityLabel={secondaryLabel}
            accessibilityRole="button"
            hitSlop={Spacing.two}
            onPress={onSecondaryPress}
            style={({ pressed }) => [styles.secondary, { opacity: pressed ? 0.72 : 1 }]}>
            <Text style={[styles.secondaryText, { color: theme.proof }]}>{secondaryLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    borderTopWidth: 1,
  },
  content: {
    alignSelf: 'center',
    gap: Spacing.one,
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    width: '100%',
  },
  primary: {
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  pressed: {
    opacity: 0.84,
  },
  primaryText: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 20,
    textAlign: 'center',
  },
  secondary: {
    alignSelf: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: Spacing.two,
  },
  secondaryText: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 20,
    textAlign: 'center',
  },
});
