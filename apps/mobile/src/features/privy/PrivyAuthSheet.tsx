import { useEffect, useRef } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrivyEntry } from './PrivyEntry';
import { canResumePrivateIntent } from './auth-navigation';
import { useTransactionWallet } from './transaction-wallet';

type PrivyAuthSheetProps = {
  contextLabel?: string;
  onAuthenticated?: () => void;
  onClose: () => void;
  visible: boolean;
};

export function PrivyAuthSheet({ contextLabel, onAuthenticated, onClose, visible }: PrivyAuthSheetProps) {
  const wallet = useTransactionWallet();
  const completionReported = useRef(false);

  useEffect(() => {
    if (!visible) {
      completionReported.current = false;
      return;
    }
    if (
      completionReported.current
      || !canResumePrivateIntent(wallet.viewerStatus, wallet.status)
    ) return;

    completionReported.current = true;
    onAuthenticated?.();
  }, [onAuthenticated, visible, wallet.status, wallet.viewerStatus]);

  if (!visible) return null;

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible>
      <View style={styles.layer}>
        <Pressable
          accessibilityLabel="Close sign in"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.backdrop}
        />
        <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.sheet}>
          <PrivyEntry
            contextLabel={contextLabel}
            onCancel={onClose}
            presentation="sheet"
          />
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  layer: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(3,7,6,0.76)' },
  sheet: {
    backgroundColor: '#1C2523',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    maxHeight: '88%',
    overflow: 'hidden',
  },
});
