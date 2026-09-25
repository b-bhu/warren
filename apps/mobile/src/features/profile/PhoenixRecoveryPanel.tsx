import type {
  PhoenixRegistrationResult,
  PhoenixRegistrationReview,
  PortfolioOverviewResponse,
  PortfolioPositionsResponse,
} from '@warren/portfolio-contract';
import * as Crypto from 'expo-crypto';
import { openBrowserAsync } from 'expo-web-browser';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import {
  createPhoenixRegistration,
  loadPhoenixRegistration,
  submitPhoenixRegistration,
} from './portfolio-api';
import {
  phoenixRegistrationErrorMessage,
  waitForPhoenixRegistration,
} from './phoenix-registration';
import { launchPhoenixSetup, PHOENIX_APP_URL, phoenixRecoveryModel } from './phoenix-recovery';

type RegistrationPhase = 'idle' | 'preparing' | 'review' | 'signing' | 'confirming' | 'result';

type PhoenixRecoveryPanelProps = {
  compact?: boolean;
  data: PortfolioOverviewResponse | PortfolioPositionsResponse;
  getAccessToken: () => Promise<string>;
  onRefresh: () => void;
  refreshing: boolean;
  signTransaction: (unsignedTransaction: string) => Promise<string>;
};

export function PhoenixRecoveryPanel(props: PhoenixRecoveryPanelProps) {
  const { data } = props;
  const model = useMemo(() => phoenixRecoveryModel(data), [data]);
  if (!model) return null;
  return <PhoenixRecoveryContent key={`${data.wallet.address}:${model.kind}`} {...props} model={model} />;
}

function PhoenixRecoveryContent({
  compact = false,
  data,
  getAccessToken,
  model,
  onRefresh,
  refreshing,
  signTransaction,
}: PhoenixRecoveryPanelProps & { model: NonNullable<ReturnType<typeof phoenixRecoveryModel>> }) {
  const theme = useTheme();
  const [phase, setPhase] = useState<RegistrationPhase>('idle');
  const [review, setReview] = useState<PhoenixRegistrationReview>();
  const [result, setResult] = useState<PhoenixRegistrationResult>();
  const [submitKey, setSubmitKey] = useState<string>();
  const [error, setError] = useState<string>();
  const [opening, setOpening] = useState(false);

  const openPhoenix = async () => {
    setOpening(true);
    const opened = await launchPhoenixSetup(PHOENIX_APP_URL, openBrowserAsync);
    setOpening(false);
    if (!opened) setError('Phoenix could not be opened. Check your connection and try again.');
  };

  const beginRegistration = async () => {
    setError(undefined);
    setResult(undefined);
    setPhase('preparing');
    try {
      const created = await createPhoenixRegistration({
        getAccessToken,
        walletAddress: data.wallet.address,
      });
      setReview(created);
      setSubmitKey(Crypto.randomUUID());
      setPhase('review');
    } catch (cause) {
      setError(phoenixRegistrationErrorMessage(cause));
      setPhase('idle');
    }
  };

  const readUntilSettled = async (registrationId: string) => waitForPhoenixRegistration({
    read: () => loadPhoenixRegistration({ getAccessToken, registrationId }),
  });

  const approveRegistration = async () => {
    if (!review) return;
    setError(undefined);
    setPhase('signing');
    try {
      const signedTransaction = await signTransaction(review.unsignedTransaction);
      setPhase('confirming');
      const submitted = await submitPhoenixRegistration({
        getAccessToken,
        idempotencyKey: submitKey ?? Crypto.randomUUID(),
        registrationId: review.registrationId,
        signedTransaction,
      });
      const settled = submitted.state === 'submitted'
        ? await readUntilSettled(review.registrationId)
        : submitted;
      setResult(settled);
      setPhase('result');
      if (settled.state === 'confirmed') onRefresh();
    } catch (cause) {
      setError(phoenixRegistrationErrorMessage(cause));
      setPhase('review');
    }
  };

  const checkAgain = async () => {
    if (!review) return;
    setError(undefined);
    setPhase('confirming');
    try {
      const settled = await readUntilSettled(review.registrationId);
      setResult(settled);
      setPhase('result');
      if (settled.state === 'confirmed') onRefresh();
    } catch (cause) {
      setError(phoenixRegistrationErrorMessage(cause));
      setPhase('result');
    }
  };

  const closeRegistration = () => {
    if (phase === 'signing' || phase === 'confirming') return;
    const confirmed = result?.state === 'confirmed';
    setPhase('idle');
    setReview(undefined);
    setResult(undefined);
    setSubmitKey(undefined);
    setError(undefined);
    if (confirmed) onRefresh();
  };

  const runPrimaryAction = () => {
    setError(undefined);
    if (model.primaryAction === 'create-in-warren') void beginRegistration();
    else onRefresh();
  };
  const primaryLabel = model.primaryAction === 'create-in-warren'
    ? phase === 'preparing' ? 'Preparing…' : 'Create account'
    : refreshing ? 'Retrying…' : 'Retry';
  const showFallback = model.secondaryAction === 'open-phoenix' || Boolean(error && model.kind === 'onboarding');

  return (
    <>
      {compact && model.kind === 'onboarding' ? (
        <View accessibilityLiveRegion="polite" style={[styles.route, { borderBottomColor: theme.outline }]}>
          <View style={styles.routeCopy}>
            <Text style={[styles.routeEyebrow, { color: theme.proof }]}>TRADE</Text>
            <Text style={[styles.routeTitle, { color: theme.ink }]}>Stock perpetuals</Text>
            <Text style={[styles.routeMeta, { color: theme.muted }]}>Phoenix not created</Text>
          </View>
          <Pressable
            accessibilityLabel="Create Phoenix account"
            accessibilityRole="button"
            disabled={phase === 'preparing'}
            onPress={() => void beginRegistration()}
            style={({ pressed }) => [styles.routeButton, { borderColor: theme.outline }, pressed && styles.pressed]}>
            <Text style={[styles.routeButtonText, { color: theme.ink }]}>{phase === 'preparing' ? 'Preparing…' : 'Create'}</Text>
          </Pressable>
          {error ? <Text style={[styles.routeError, { color: theme.caution }]}>{error}</Text> : null}
        </View>
      ) : (
      <View accessibilityLiveRegion="polite" style={[styles.panel, { backgroundColor: theme.surface }]}>
        <View style={styles.providerRow}>
          <View style={[styles.providerMark, { backgroundColor: model.kind === 'onboarding' ? theme.proof : theme.caution }]} />
          <Text style={[styles.providerLabel, { color: theme.muted }]}>PHOENIX · STOCK PERPETUALS</Text>
        </View>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.ink }]}>{model.title}</Text>
        <Text style={[styles.body, { color: theme.muted }]}>{model.body}</Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={phase === 'preparing' || refreshing}
            onPress={runPrimaryAction}
            style={({ pressed }) => [styles.primaryButton, { backgroundColor: theme.proof }, pressed && styles.pressed]}>
            {phase === 'preparing' ? <ActivityIndicator color={theme.onProof} size="small" /> : null}
            <Text style={[styles.primaryButtonText, { color: theme.onProof }]}>{primaryLabel}</Text>
          </Pressable>
          {showFallback ? (
            <Pressable
              accessibilityHint="Opens Phoenix in your browser as a fallback"
              accessibilityRole="button"
              disabled={opening}
              onPress={() => void openPhoenix()}
              style={({ pressed }) => [styles.secondaryButton, { backgroundColor: theme.canvas }, pressed && styles.pressed]}>
              <Text style={[styles.secondaryButtonText, { color: theme.muted }]}>{opening ? 'Opening…' : 'Open Phoenix'}</Text>
            </Pressable>
          ) : null}
        </View>
        {error && phase === 'idle' ? <Text style={[styles.error, { color: theme.caution }]}>{error}</Text> : null}
      </View>
      )}

      <RegistrationSheet
        error={error}
        onApprove={() => void approveRegistration()}
        onCheck={() => void checkAgain()}
        onClose={closeRegistration}
        phase={phase}
        result={result}
        review={review}
      />
    </>
  );
}

function RegistrationSheet({
  error,
  onApprove,
  onCheck,
  onClose,
  phase,
  result,
  review,
}: {
  error?: string;
  onApprove: () => void;
  onCheck: () => void;
  onClose: () => void;
  phase: RegistrationPhase;
  result?: PhoenixRegistrationResult;
  review?: PhoenixRegistrationReview;
}) {
  const theme = useTheme();
  const visible = phase === 'review' || phase === 'signing' || phase === 'confirming' || phase === 'result';
  const busy = phase === 'signing' || phase === 'confirming';
  return (
    <Modal animationType="slide" onRequestClose={onClose} statusBarTranslucent transparent visible={visible}>
      <View style={styles.modalLayer}>
        <Pressable accessibilityLabel="Close Phoenix setup" accessibilityRole="button" disabled={busy} onPress={onClose} style={styles.backdrop} />
        <SafeAreaView edges={['bottom', 'left', 'right']} style={[styles.sheet, { backgroundColor: theme.surface }]}>
          <View style={[styles.handle, { backgroundColor: theme.outline }]} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleCopy}>
              <Text style={[styles.sheetEyebrow, { color: theme.proof }]}>PHOENIX ACCOUNT</Text>
              <Text accessibilityRole="header" style={[styles.sheetTitle, { color: theme.ink }]}>
                {result ? result.state === 'confirmed' ? 'Account created' : result.state === 'failed' ? 'Creation failed' : 'Waiting for Solana' : 'Review account creation'}
              </Text>
            </View>
            <Pressable accessibilityLabel="Close" accessibilityRole="button" disabled={busy} onPress={onClose} style={({ pressed }) => [styles.close, { backgroundColor: theme.canvas }, pressed && styles.pressed]}>
              <Text style={[styles.closeText, { color: theme.muted }]}>×</Text>
            </Pressable>
          </View>

          {result ? (
            <View style={styles.resultBody}>
              <View style={[styles.resultMark, { backgroundColor: result.state === 'confirmed' ? theme.proofWash : result.state === 'failed' ? theme.cautionWash : theme.canvas }]}>
                <Text style={[styles.resultMarkText, { color: result.state === 'failed' ? theme.caution : theme.proof }]}>{result.state === 'confirmed' ? '✓' : result.state === 'failed' ? '!' : '…'}</Text>
              </View>
              <Text style={[styles.resultMessage, { color: theme.muted }]}>{result.message}</Text>
              {result.state === 'submitted' ? (
                <Pressable accessibilityRole="button" onPress={onCheck} style={({ pressed }) => [styles.sheetPrimary, { backgroundColor: theme.proof }, pressed && styles.pressed]}>
                  <Text style={[styles.sheetPrimaryText, { color: theme.onProof }]}>Check status</Text>
                </Pressable>
              ) : (
                <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.sheetPrimary, { backgroundColor: theme.proof }, pressed && styles.pressed]}>
                  <Text style={[styles.sheetPrimaryText, { color: theme.onProof }]}>{result.state === 'confirmed' ? 'Back to Portfolio' : 'Try again'}</Text>
                </Pressable>
              )}
            </View>
          ) : review ? (
            <>
              <Text style={[styles.sheetCopy, { color: theme.muted }]}>Your Warren wallet creates the default Phoenix cross-margin account. Review what this approval does before signing.</Text>
              <View style={[styles.reviewCard, { backgroundColor: theme.canvas }]}>
                <ReviewRow label="Account" value="Default cross-margin" />
                <ReviewRow label="Can hold" value={`Up to ${review.maxPositions} positions`} />
                <ReviewRow label="Paid by" value="Your Warren wallet" />
                <ReviewRow label="Cost" value="Solana fee + account rent" last />
              </View>
              <View style={[styles.safetyNote, { backgroundColor: theme.proofWash }]}>
                <Text style={[styles.safetyTitle, { color: theme.ink }]}>No trade is opened</Text>
                <Text style={[styles.safetyBody, { color: theme.muted }]}>This transaction only creates the account. Your wallet needs enough SOL for account rent and the network fee; collateral is added separately before trading.</Text>
              </View>
              {busy ? (
                <View accessibilityLiveRegion="polite" style={styles.busyRow}>
                  <ActivityIndicator color={theme.proof} size="small" />
                  <Text style={[styles.busyText, { color: theme.muted }]}>{phase === 'signing' ? 'Waiting for wallet approval…' : 'Confirming on Solana…'}</Text>
                </View>
              ) : (
                <Pressable accessibilityRole="button" onPress={onApprove} style={({ pressed }) => [styles.sheetPrimary, { backgroundColor: theme.proof }, pressed && styles.pressed]}>
                  <Text style={[styles.sheetPrimaryText, { color: theme.onProof }]}>Approve and create</Text>
                </Pressable>
              )}
              {error ? <Text accessibilityLiveRegion="polite" style={[styles.error, { color: theme.caution }]}>{error}</Text> : null}
            </>
          ) : null}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function ReviewRow({ label, last = false, value }: { label: string; last?: boolean; value: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.reviewRow, !last && { borderBottomColor: theme.outline, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      <Text style={[styles.reviewLabel, { color: theme.muted }]}>{label}</Text>
      <Text style={[styles.reviewValue, { color: theme.ink }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderRadius: 17, marginTop: 24, padding: 16 },
  route: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', flexWrap: 'wrap', gap: 10, minHeight: 78, paddingLeft: 28, paddingVertical: 13 },
  routeCopy: { flex: 1, minWidth: 0 },
  routeEyebrow: { fontFamily: Fonts.mono, fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
  routeTitle: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '700', marginTop: 5 },
  routeMeta: { fontFamily: Fonts.sans, fontSize: 10, marginTop: 3 },
  routeButton: { alignItems: 'center', borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center', minHeight: 42, minWidth: 82, paddingHorizontal: 11 },
  routeButtonText: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '800' },
  routeError: { flexBasis: '100%', fontFamily: Fonts.sans, fontSize: 10, lineHeight: 15 },
  providerRow: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  providerMark: { borderRadius: 4, height: 7, width: 7 },
  providerLabel: { fontFamily: Fonts.mono, fontSize: 9, fontWeight: '700', letterSpacing: 0.7 },
  title: { fontFamily: Fonts.sans, fontSize: 18, fontWeight: '800', letterSpacing: -0.5, marginTop: 14 },
  body: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 9, marginTop: 16 },
  primaryButton: { alignItems: 'center', borderRadius: 13, flex: 1, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 48, paddingHorizontal: 14 },
  primaryButtonText: { fontFamily: Fonts.sans, fontSize: 12, fontWeight: '800' },
  secondaryButton: { alignItems: 'center', borderRadius: 13, flex: 1, justifyContent: 'center', minHeight: 48, paddingHorizontal: 14 },
  secondaryButtonText: { fontFamily: Fonts.sans, fontSize: 12, fontWeight: '800' },
  error: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 16, marginTop: 10 },
  modalLayer: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(3,7,6,0.76)' },
  sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingBottom: 12, paddingHorizontal: 20, paddingTop: 10 },
  handle: { alignSelf: 'center', borderRadius: 2, height: 4, marginBottom: 14, width: 40 },
  sheetHeader: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  sheetTitleCopy: { flex: 1, minWidth: 0 },
  sheetEyebrow: { fontFamily: Fonts.mono, fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
  sheetTitle: { fontFamily: Fonts.sans, fontSize: 23, fontWeight: '800', letterSpacing: -0.8, marginTop: 5 },
  close: { alignItems: 'center', borderRadius: 14, height: 44, justifyContent: 'center', width: 44 },
  closeText: { fontFamily: Fonts.sans, fontSize: 25, lineHeight: 27 },
  sheetCopy: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 20, marginTop: 14 },
  reviewCard: { borderRadius: 16, marginTop: 17, paddingHorizontal: 14 },
  reviewRow: { alignItems: 'center', flexDirection: 'row', gap: 16, justifyContent: 'space-between', minHeight: 49 },
  reviewLabel: { fontFamily: Fonts.sans, fontSize: 12 },
  reviewValue: { flex: 1, fontFamily: Fonts.sans, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  safetyNote: { borderRadius: 14, marginTop: 13, padding: 13 },
  safetyTitle: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '700' },
  safetyBody: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 17, marginTop: 4 },
  sheetPrimary: { alignItems: 'center', borderRadius: 14, justifyContent: 'center', marginTop: 16, minHeight: 52, paddingHorizontal: 16 },
  sheetPrimaryText: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '800' },
  busyRow: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'center', minHeight: 52, marginTop: 16 },
  busyText: { fontFamily: Fonts.sans, fontSize: 12 },
  resultBody: { alignItems: 'center', paddingBottom: 8, paddingTop: 26 },
  resultMark: { alignItems: 'center', borderRadius: 22, height: 58, justifyContent: 'center', width: 58 },
  resultMarkText: { fontFamily: Fonts.sans, fontSize: 24, fontWeight: '800' },
  resultMessage: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 20, marginTop: 15, textAlign: 'center' },
  pressed: { opacity: 0.72 },
});
