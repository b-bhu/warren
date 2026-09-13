import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type OnboardingScaffoldProps = {
  children: ReactNode;
  /** A persistent action area, usually an ActionDock. */
  actionDock?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * A safe, bounded scroll surface for the ownership flow. The dock remains reachable
 * without covering content when text expands or a keyboard is present.
 */
export function OnboardingScaffold({ children, actionDock, contentStyle, testID }: OnboardingScaffoldProps) {
  const theme = useTheme();

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: theme.canvas }]} testID={testID}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, contentStyle]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={styles.content}>{children}</View>
      </ScrollView>
      {actionDock}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
  },
  content: {
    alignSelf: 'center',
    maxWidth: MaxContentWidth,
    width: '100%',
  },
});
