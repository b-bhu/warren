import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ChainChoiceCardProps = {
  chain: string;
  description: string;
  selected?: boolean;
  disabled?: boolean;
  unsupported?: boolean;
  mark?: ReactNode;
  onPress: () => void;
};

export function ChainChoiceCard({ chain, description, selected = false, disabled = false, unsupported = false, mark, onPress }: ChainChoiceCardProps) {
  const theme = useTheme();
  const unavailable = disabled || unsupported;
  const stateText = unsupported ? 'Unsupported on this device' : disabled ? 'Not ready' : selected ? 'Selected' : undefined;

  return (
    <Pressable
      accessibilityHint={unavailable ? stateText : `Choose ${chain}`}
      accessibilityLabel={`${chain}. ${description}${stateText ? `. ${stateText}.` : ''}`}
      accessibilityRole="radio"
      accessibilityState={{ disabled: unavailable, selected }}
      disabled={unavailable}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.surface,
          borderColor: selected ? theme.proof : theme.outline,
          borderWidth: selected ? 2 : 1,
          opacity: pressed && !unavailable ? 0.84 : 1,
        },
      ]}>
      <View style={styles.content}>
        <View style={[styles.mark, { borderColor: selected ? theme.proof : theme.outline }]} accessible={false}>
          {mark ?? <Text style={[styles.markFallback, { color: theme.proof }]}>{chain.slice(0, 1)}</Text>}
        </View>
        <View style={styles.copy}>
          {selected ? <Text style={[styles.selected, { color: theme.proof }]}>Selected</Text> : null}
          <Text style={[styles.chain, { color: unavailable ? theme.disabledInk : theme.ink }]}>{chain}</Text>
          <Text style={[styles.description, { color: unavailable ? theme.disabledInk : theme.muted }]}>{description}</Text>
          {stateText && !selected ? <Text style={[styles.state, { color: unavailable ? theme.caution : theme.proof }]}>{stateText}</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    minHeight: 88,
    padding: Spacing.three,
  },
  content: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.three,
  },
  mark: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  markFallback: {
    fontFamily: Fonts.serif,
    fontSize: 20,
    fontWeight: '700',
  },
  copy: {
    flex: 1,
    gap: Spacing.half,
    minWidth: 0,
  },
  selected: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
  },
  chain: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 24,
  },
  description: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    lineHeight: 24,
  },
  state: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
});
