import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { WalletCard } from '@/components/WalletCard';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type AccountWalletMode = 'account' | 'receive' | 'security' | 'export' | 'sign-out';

export type AccountWalletSheetProps = {
  address: string | null;
  mode: AccountWalletMode | null;
  onClose: () => void;
  onModeChange: (mode: AccountWalletMode) => void;
  onSignOut: () => Promise<void>;
  signInLabel?: string | null;
  onExport?: () => Promise<void>;
};

export function AccountWalletSheet({
  address,
  mode,
  onClose,
  onModeChange,
  onSignOut,
  signInLabel,
  onExport,
}: AccountWalletSheetProps) {
  const theme = useTheme();
  const stateKey = `${mode ?? 'closed'}:${address ?? ''}`;
  const [feedbackState, setFeedbackState] = useState<{ busy: boolean; key: string; notice?: string }>({ busy: false, key: stateKey });
  // Keying transient state by mode and address resets it as the parent changes
  // steps or wallet readiness, without carrying feedback from an old address.
  const feedback = feedbackState.key === stateKey ? feedbackState : { busy: false, key: stateKey };
  const updateFeedback = (change: Partial<Omit<typeof feedback, 'key'>>) => {
    setFeedbackState((previous) => ({ ...(previous.key === stateKey ? previous : { busy: false }), ...change, key: stateKey }));
  };
  const notice = feedback.notice;
  const busy = feedback.busy;

  const copyAddress = async () => {
    if (!address) {
      updateFeedback({ notice: 'Your wallet address is still being prepared.' });
      return;
    }
    try {
      await Clipboard.setStringAsync(address);
      updateFeedback({ notice: 'Wallet address copied.' });
    } catch {
      updateFeedback({ notice: 'Could not copy the wallet address. Please try again.' });
    }
  };

  const exportWallet = async () => {
    if (!onExport) return;
    updateFeedback({ busy: true, notice: undefined });
    try {
      await onExport();
    } catch {
      updateFeedback({ notice: 'Secure export is unavailable right now. Please try again later.' });
    } finally {
      updateFeedback({ busy: false });
    }
  };

  const signOut = async () => {
    updateFeedback({ busy: true, notice: undefined });
    try {
      await onSignOut();
    } catch {
      updateFeedback({ notice: 'Warren could not sign out. Check your connection and try again.' });
    } finally {
      updateFeedback({ busy: false });
    }
  };

  const childMode = mode !== null && mode !== 'account';
  const title = mode === 'account'
    ? 'Account & wallet'
    : mode === 'receive'
      ? 'Deposit to Warren'
      : mode === 'security'
        ? 'Security & recovery'
        : mode === 'export'
          ? 'Export your wallet'
          : 'Sign out of Warren?';

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={mode !== null}>
      <View style={styles.layer}>
        <Pressable accessibilityLabel="Close sheet" accessibilityRole="button" onPress={onClose} style={styles.backdrop} />
        <SafeAreaView
          accessibilityViewIsModal
          edges={['bottom', 'left', 'right']}
          style={[styles.sheet, { backgroundColor: theme.canvas, borderColor: theme.outline }]}>
          <View style={[styles.handle, { backgroundColor: theme.outline }]} />
          <View style={styles.header}>
            {childMode ? (
              <Pressable
                accessibilityLabel="Back to account and wallet"
                accessibilityRole="button"
                onPress={() => onModeChange('account')}
                style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
                <Text style={[styles.backText, { color: theme.muted }]}>‹</Text>
              </Pressable>
            ) : null}
            <Text accessibilityRole="header" style={[styles.title, { color: theme.ink }]}>{title}</Text>
            <Pressable
              accessibilityLabel="Close"
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
              <Text style={[styles.closeText, { color: theme.muted }]}>×</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {mode === 'account' ? (
              <AccountStep
                address={address}
                onCopy={() => void copyAddress()}
                onReceive={() => onModeChange('receive')}
                onModeChange={onModeChange}
                exportAvailable={Boolean(onExport)}
                signInLabel={signInLabel}
                theme={theme}
              />
            ) : null}

            {mode === 'receive' ? (
              <ReceiveStep
                address={address}
                onCopy={() => void copyAddress()}
                onDone={() => onModeChange('account')}
                theme={theme}
              />
            ) : null}

            {mode === 'security' ? <SecurityStep signInLabel={signInLabel} theme={theme} /> : null}

            {mode === 'export' ? (
              <ExportStep
                address={address}
                busy={busy}
                onExport={() => void exportWallet()}
                onBack={() => onModeChange('account')}
                available={Boolean(onExport)}
                theme={theme}
              />
            ) : null}

            {mode === 'sign-out' ? (
              <SignOutStep busy={busy} onSignOut={() => void signOut()} theme={theme} />
            ) : null}

            {notice ? <Text accessibilityLiveRegion="polite" style={[styles.notice, { color: theme.proof }]}>{notice}</Text> : null}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

type Theme = ReturnType<typeof useTheme>;

function AccountStep({
  address,
  onCopy,
  onReceive,
  onModeChange,
  exportAvailable,
  signInLabel,
  theme,
}: {
  address: string | null;
  onCopy: () => void;
  onReceive: () => void;
  onModeChange: (mode: AccountWalletMode) => void;
  exportAvailable: boolean;
  signInLabel?: string | null;
  theme: Theme;
}) {
  return (
    <>
      <WalletCard address={address} />
      <View style={styles.walletActions}>
        <View style={styles.walletAction}><ActionButton label="↓ Deposit" onPress={onReceive} primary theme={theme} /></View>
        <View style={styles.walletAction}><ActionButton disabled={!address} label="Copy address" onPress={onCopy} theme={theme} /></View>
      </View>
      {signInLabel ? <Text style={[styles.identity, { color: theme.muted }]}>{signInLabel}</Text> : null}
      <View style={[styles.list, { borderTopColor: `${theme.muted}33` }]}>
        <SheetRow
          detail="Manage access to your account"
          label="Security & recovery"
          onPress={() => onModeChange('security')}
          theme={theme}
        />
        <SheetRow
          detail={exportAvailable ? 'Use this wallet in another app' : 'Unavailable in this build'}
          label="Export wallet"
          onPress={() => onModeChange('export')}
          theme={theme}
        />
        <SheetRow danger label="Sign out" onPress={() => onModeChange('sign-out')} theme={theme} />
      </View>
    </>
  );
}

function ReceiveStep({ address, onCopy, onDone, theme }: { address: string | null; onCopy: () => void; onDone: () => void; theme: Theme }) {
  return (
    <>
      <WalletCard address={address} expanded />
      {address ? (
        <Text style={[styles.networkNote, { color: theme.muted }]}>✓  Send only supported assets on the Solana network to this address.</Text>
      ) : null}
      <View style={styles.stackedActions}>
        <ActionButton disabled={!address} label="Copy address" onPress={onCopy} primary theme={theme} />
        <ActionButton label="Done" onPress={onDone} theme={theme} />
      </View>
    </>
  );
}

function SecurityStep({ signInLabel, theme }: { signInLabel?: string | null; theme: Theme }) {
  return (
    <>
      <Text style={[styles.copy, { color: theme.muted }]}>Use the same email or connected wallet to access your Warren account on another device.</Text>
      {signInLabel ? <Text style={[styles.identity, { color: theme.muted }]}>{signInLabel}</Text> : null}
      <View style={[styles.fact, { backgroundColor: theme.surface }]}>
        <Text style={[styles.factText, { color: theme.ink }]}>Never reveal a seed phrase or private key. Warren support will not ask for either.</Text>
      </View>
    </>
  );
}

function ExportStep({ address, available, busy, onBack, onExport, theme }: { address: string | null; available: boolean; busy: boolean; onBack: () => void; onExport: () => void; theme: Theme }) {
  return (
    <>
      <Text style={[styles.copy, { color: theme.muted }]}>Use your Warren wallet in another compatible app. Your address and funds stay the same.</Text>
      <WalletCard address={address} />
      <View style={[styles.warning, { backgroundColor: theme.cautionWash, borderColor: `${theme.caution}33` }]}>
        <Text style={[styles.warningText, { color: theme.caution }]}>⚠ Anyone with your private key can access your funds. Keep it private.</Text>
      </View>
      <Text style={[styles.factText, styles.exportFact, { color: theme.muted }]}>{available ? 'You’ll verify your identity in Privy’s secure export window. Your private key stays inside that window.' : 'Secure export is unavailable right now. Please try again later.'}</Text>
      <View style={styles.stackedActions}>
        <ActionButton busy={busy} disabled={!available || busy} label={busy ? 'Opening secure export…' : 'Continue to secure export'} onPress={onExport} primary theme={theme} />
        <ActionButton label="Back to wallet" onPress={onBack} theme={theme} />
      </View>
    </>
  );
}

function SignOutStep({ busy, onSignOut, theme }: { busy: boolean; onSignOut: () => void; theme: Theme }) {
  return (
    <>
      <Text style={[styles.copy, { color: theme.muted }]}>Your private session will be removed from this phone. Device-local saved companies remain.</Text>
      <Text style={[styles.factText, styles.signOutFact, { color: theme.muted }]}>Signing out does not move funds, delete the wallet, or cancel a submitted transaction.</Text>
      <View style={styles.stackedActions}>
        <ActionButton busy={busy} disabled={busy} label={busy ? 'Signing out…' : 'Sign out'} onPress={onSignOut} primary theme={theme} danger />
      </View>
    </>
  );
}

function ActionButton({ busy = false, disabled = false, danger = false, label, onPress, primary = false, theme }: { busy?: boolean; disabled?: boolean; danger?: boolean; label: string; onPress: () => void; primary?: boolean; theme: Theme }) {
  const backgroundColor = primary ? (danger ? theme.caution : theme.proof) : 'transparent';
  const borderColor = danger ? theme.caution : theme.outline;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.action, { backgroundColor, borderColor }, disabled && { backgroundColor: theme.disabledSurface, borderColor: theme.disabledSurface }, pressed && styles.pressed]}>
      {busy ? <ActivityIndicator color={primary ? theme.onProof : theme.proof} size="small" /> : <Text style={[styles.actionText, { color: primary ? theme.onProof : danger ? theme.caution : theme.ink }, disabled && { color: theme.disabledInk }]}>{label}</Text>}
    </Pressable>
  );
}

function SheetRow({ danger = false, detail, label, onPress, theme }: { danger?: boolean; detail?: string; label: string; onPress: () => void; theme: Theme }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, { borderBottomColor: `${theme.muted}33` }, pressed && styles.pressed]}>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowLabel, { color: danger ? theme.caution : theme.ink }]}>{label}</Text>
        {detail ? <Text style={[styles.rowDetail, { color: theme.muted }]}>{detail}</Text> : null}
      </View>
      <Text accessible={false} style={[styles.arrow, { color: theme.muted }]}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  layer: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(3,7,6,0.76)' },
  sheet: { borderBottomWidth: 0, borderRadius: 24, borderWidth: 1, maxHeight: '94%', paddingBottom: 12, paddingHorizontal: 20, paddingTop: 10 },
  handle: { alignSelf: 'center', borderRadius: 2, height: 4, marginBottom: 14, width: 40 },
  header: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 44 },
  headerButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  backText: { fontFamily: Fonts.sans, fontSize: 29, lineHeight: 32 },
  closeText: { fontFamily: Fonts.sans, fontSize: 27, lineHeight: 30 },
  title: { flex: 1, fontFamily: Fonts.sans, fontSize: 25, fontWeight: '500', letterSpacing: -1, lineHeight: 30 },
  content: { paddingBottom: 10, paddingTop: 18 },
  walletActions: { flexDirection: 'row', gap: 9, marginTop: 14 },
  walletAction: { flex: 1 },
  stackedActions: { gap: 4, marginTop: 22 },
  action: { alignItems: 'center', borderRadius: 13, borderWidth: 1, justifyContent: 'center', minHeight: 48, paddingHorizontal: 12 },
  actionText: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  identity: { fontFamily: Fonts.sans, fontSize: 11, marginTop: 13 },
  list: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 24 },
  row: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12, minHeight: 63 },
  rowCopy: { flex: 1, minWidth: 0 },
  rowLabel: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '500' },
  rowDetail: { fontFamily: Fonts.sans, fontSize: 10, lineHeight: 14, marginTop: 5 },
  arrow: { fontFamily: Fonts.sans, fontSize: 21 },
  copy: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 20, marginTop: 8 },
  networkNote: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 17, marginTop: 15 },
  fact: { borderRadius: 13, marginTop: 18, padding: 14 },
  factText: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 19 },
  warning: { borderRadius: 12, borderWidth: 1, marginTop: 18, padding: 14 },
  warningText: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 19 },
  exportFact: { marginTop: 18 },
  signOutFact: { marginTop: 18 },
  notice: { fontFamily: Fonts.sans, fontSize: 12, fontWeight: '600', lineHeight: 18, marginTop: 12 },
  pressed: { opacity: 0.72 },
});
