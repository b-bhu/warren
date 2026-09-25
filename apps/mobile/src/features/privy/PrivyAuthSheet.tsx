import { useEffect, useRef } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';

import { PrivyEntry } from './PrivyEntry';
import { canResumePrivateIntent } from './auth-navigation';
import { useTransactionWallet } from './transaction-wallet';

type PrivyAuthSheetProps = {
  contextLabel?: string;
  continueLabel?: string;
  onAuthenticated?: () => void;
  onClose: () => void;
  visible: boolean;
};

export function PrivyAuthSheet({ contextLabel, continueLabel, onAuthenticated, onClose, visible }: PrivyAuthSheetProps) {
  const wallet = useTransactionWallet();
  const theme = useTheme();
  const completionReported = useRef(false);

  useEffect(() => {
    if (!visible) completionReported.current = false;
  }, [visible]);

  const continueAfterReady = () => {
    if (
      !visible || completionReported.current
      || !canResumePrivateIntent(wallet.viewerStatus, wallet.status)
    ) return;

    completionReported.current = true;
    (onAuthenticated ?? onClose)();
  };

  if (!visible) return null;

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.layer}>
        <Pressable
          accessibilityLabel="Close sign in"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.backdrop}
        />
        <SafeAreaView edges={['bottom', 'left', 'right']} style={[styles.sheet, { backgroundColor: theme.canvas, borderColor: theme.outline }]}>
          <PrivyEntry
            contextLabel={contextLabel}
            continueLabel={continueLabel}
            onContinue={continueAfterReady}
            onCancel={onClose}
            presentation="sheet"
          />
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  layer: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(3,7,6,0.76)' },
  sheet: {
    borderWidth: 1,
    borderBottomWidth: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '94%',
    overflow: 'hidden',
  },
});
