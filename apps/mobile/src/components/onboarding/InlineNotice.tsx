import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type InlineNoticeVariant = 'information' | 'caution' | 'unsupported' | 'conflict';

export type InlineNoticeProps = {
  variant: InlineNoticeVariant;
  children: string;
  actionLabel?: string;
  onActionPress?: () => void;
};

const iconByVariant: Record<InlineNoticeVariant, string> = {
  information: 'i',
  caution: '!',
  unsupported: '!',
  conflict: '!',
};

export function InlineNotice({ variant, children, actionLabel, onActionPress }: InlineNoticeProps) {
  const theme = useTheme();
  const isCaution = variant !== 'information';
  const accent = isCaution ? theme.caution : theme.proof;
  const backgroundColor = isCaution ? theme.cautionWash : theme.proofWash;

  return (
    <View accessibilityRole={isCaution ? 'alert' : undefined} style={[styles.notice, { backgroundColor, borderColor: accent }]}>
      <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.icon, { color: accent }]}>{iconByVariant[variant]}</Text>
      <View style={styles.copy}>
        <Text style={[styles.text, { color: theme.ink }]}>{children}</Text>
        {actionLabel && onActionPress ? (
          <Pressable
            accessibilityLabel={actionLabel}
            accessibilityRole="button"
            onPress={onActionPress}
            style={({ pressed }) => [styles.action, { opacity: pressed ? 0.72 : 1 }]}>
            <Text style={[styles.actionText, { color: accent }]}>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    alignItems: 'flex-start',
    borderRadius: 10,
    borderStartWidth: 3,
    flexDirection: 'row',
    gap: Spacing.two,
    padding: Spacing.two,
  },
  icon: {
    fontFamily: Fonts.serif,
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 24,
  },
  copy: {
    flex: 1,
    gap: Spacing.one,
    minWidth: 0,
  },
  text: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    lineHeight: 24,
  },
  action: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    minHeight: 44,
    paddingEnd: Spacing.two,
  },
  actionText: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 20,
  },
});
