import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { LendingActionKind, LendingActionCreate, LendingActionHistoryResponse, LendingAsset, LendingReview, LendingRiskPreview, LendingWalletResponse } from '@warren/lending-contract';
import { useTransactionWallet } from '@/features/privy';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  createLendingAction, getLendingAction, loadLendingCatalog, loadLendingHistory, loadLendingWallet,
  previewLendingAction, refreshLendingStep, submitLendingStep,
} from './lending-api';
import { cleanLendingAmountInput, lendingAmountToRaw } from './lending-validation';

const actionChoices: { id: LendingActionKind; title: string; description: string }[] = [
  { id: 'supply', title: 'Supply', description: 'Deposit xStock collateral' },
  { id: 'borrow', title: 'Borrow', description: 'Borrow USDC against collateral' },
  { id: 'repay', title: 'Repay', description: 'Reduce USDC debt' },
  { id: 'withdraw', title: 'Withdraw', description: 'Remove available xStock collateral' },
];

export function LendingDetailScreen() {
  const { assetId: rawAssetId } = useLocalSearchParams<{ assetId?: string | string[] }>();
  const assetId = Array.isArray(rawAssetId) ? rawAssetId[0] : rawAssetId;
  const router = useRouter();
  const theme = useTheme();
  const wallet = useTransactionWallet();
  const [asset, setAsset] = useState<Awaited<ReturnType<typeof loadLendingCatalog>>['assets'][number]>();
  const [catalogAssets, setCatalogAssets] = useState<LendingAsset[]>([]);
  const [positions, setPositions] = useState<LendingWalletResponse>();
  const [history, setHistory] = useState<LendingActionHistoryResponse>();
  const [selectedAction, setSelectedAction] = useState<LendingActionKind>('supply');
  const [amount, setAmount] = useState('');
  const [useMax, setUseMax] = useState(false);
  const [preview, setPreview] = useState<LendingRiskPreview>();
  const [review, setReview] = useState<LendingReview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [submitKey, setSubmitKey] = useState<string>();
  const [createKey, setCreateKey] = useState<string>();
  const [submissionAttempted, setSubmissionAttempted] = useState(false);
  const [clockNow, setClockNow] = useState(0);

  const refreshPositions = useCallback(async () => {
    if (wallet.status !== 'ready' || !wallet.address) return;
    const token = await wallet.getAccessToken();
    const [snapshot, activity] = await Promise.all([loadLendingWallet(wallet.address, token), loadLendingHistory(wallet.address, token)]);
    setPositions(snapshot); setHistory(activity);
  }, [wallet]);

  useEffect(() => {
    let active = true;
    void loadLendingCatalog().then((catalog) => {
      if (active) { setCatalogAssets(catalog.assets); setAsset(catalog.assets.find((item) => item.assetId === assetId)); }
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Lending market data is unavailable.'); });
    return () => { active = false; };
  }, [assetId]);

  useEffect(() => {
    let active = true;
    if (wallet.status !== 'ready' || !wallet.address) return;
    const timer = setTimeout(() => {
      void refreshPositions().catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Warren could not load this wallet.'); });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [refreshPositions, wallet.address, wallet.status]);

  useEffect(() => {
    if (wallet.status !== 'ready' || !wallet.address || !assetId) return;
    let active = true;
    const storageKey = `warren.lending.last-action.${wallet.address}`;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const actionId = await SecureStore.getItemAsync(storageKey);
          if (!actionId) return;
          const token = await wallet.getAccessToken();
          const restored = await getLendingAction(actionId, token);
          if (active && restored.assetId === assetId) setReview(restored);
        } catch { /* Keep the journal reference so a later refresh can resume it. */ }
      })();
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [assetId, wallet]);

  const currentStepExpiry = review?.steps.at(-1)?.expiresAt;
  useEffect(() => {
    if (!currentStepExpiry) return;
    const remainingMs = Date.parse(currentStepExpiry) - Date.now();
    const timer = setTimeout(() => setClockNow(Date.now()), Math.max(0, remainingMs));
    return () => clearTimeout(timer);
  }, [currentStepExpiry]);

  const walletPositions = positions?.walletAddress === wallet.address ? positions : undefined;
  const holding = walletPositions?.holdings.find((item) => item.assetId === assetId);
  const currentStep = review?.steps.at(-1);
  const recoveryAction = selectedAction === 'repay' || selectedAction === 'withdraw';
  const buildActionInput = (): LendingActionCreate => {
    if (!assetId || !wallet.address) throw new Error('Connect the selected Privy wallet first.');
    if (recoveryAction && useMax) return { action: selectedAction, walletAddress: wallet.address, assetId, amountRaw: 'ALL' };
    const decimals = selectedAction === 'borrow' || selectedAction === 'repay' ? 6 : holding?.decimals ?? 8;
    const multiplier = selectedAction === 'supply' || selectedAction === 'withdraw' ? holding?.scaledUiMultiplier ?? '1' : '1';
    return { action: selectedAction, walletAddress: wallet.address, assetId, amountRaw: lendingAmountToRaw(amount, decimals, multiplier) };
  };

  const estimate = async () => {
    if (!assetId || !wallet.address) return;
    try {
      setBusy(true); setError(undefined); setReview(undefined); setSubmitKey(undefined);
      const token = await wallet.getAccessToken();
      const result = await previewLendingAction(buildActionInput(), token);
      setPreview(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Warren could not estimate this action.'); }
    finally { setBusy(false); }
  };

  const prepareReview = async () => {
    if (!assetId || !wallet.address || !preview?.actionAvailable) return;
    try {
      setBusy(true); setError(undefined);
      const token = await wallet.getAccessToken();
      const key = createKey ?? Crypto.randomUUID();
      setCreateKey(key);
      const created = await createLendingAction(buildActionInput(), token, key);
      setReview(created);
      if (wallet.address) {
        try { await SecureStore.setItemAsync(`warren.lending.last-action.${wallet.address}`, created.actionId); }
        catch { /* API journal remains authoritative if this platform has no secure local store. */ }
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Warren could not prepare the review.'); }
    finally { setBusy(false); }
  };

  const signAndSubmit = async () => {
    if (!review || !currentStep || !wallet.address || !submitKey && currentStep.state !== 'review') return;
    try {
      setBusy(true); setError(undefined);
      const token = await wallet.getAccessToken();
      const key = submitKey ?? Crypto.randomUUID();
      setSubmitKey(key);
      const signed = await wallet.signTransaction(currentStep.unsignedTransaction);
      setSubmissionAttempted(true);
      try {
        await submitLendingStep(review.actionId, currentStep.stepId, signed, token, key);
        setReview(await getLendingAction(review.actionId, token));
        await refreshPositions();
      } catch (submitError) {
        try {
          const latest = await getLendingAction(review.actionId, token);
          setReview(latest);
          if (latest.steps.at(-1)?.state === 'review') setSubmissionAttempted(false);
        } catch { /* Keep signing locked until the server can reconcile the submission. */ }
        throw submitError;
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Signing was cancelled or could not be completed. Your review is still available.'); }
    finally { setBusy(false); }
  };

  const checkStatus = async () => {
    if (!review) return;
    try {
      setBusy(true); setError(undefined);
      const token = await wallet.getAccessToken();
      const latest = await getLendingAction(review.actionId, token);
      setReview(latest);
      if (latest.steps.at(-1)?.state === 'review') setSubmissionAttempted(false);
      await refreshPositions();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Warren could not check transaction status.'); }
    finally { setBusy(false); }
  };

  const refreshReview = async () => {
    if (!review || !currentStep) return;
    try {
      setBusy(true); setError(undefined);
      const token = await wallet.getAccessToken();
      setReview(await refreshLendingStep(review.actionId, currentStep.stepId, token));
      setSubmitKey(undefined); setSubmissionAttempted(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Warren could not refresh this review.'); }
    finally { setBusy(false); }
  };

  const finishReview = async () => {
    if (wallet.address) {
      try { await SecureStore.deleteItemAsync(`warren.lending.last-action.${wallet.address}`); }
      catch { /* The transaction journal remains on the server. */ }
    }
    setReview(undefined); setPreview(undefined); setAmount(''); setUseMax(false); setSubmissionAttempted(false); setCreateKey(undefined);
    await refreshPositions();
  };

  const choose = (action: LendingActionKind) => {
    setSelectedAction(action); setAmount(''); setUseMax(false); setPreview(undefined); setReview(undefined); setError(undefined); setSubmitKey(undefined); setCreateKey(undefined); setSubmissionAttempted(false);
  };

  if (!asset) return <SafeAreaView style={[styles.safe, { backgroundColor: theme.canvas }]}><View style={styles.center}><ActivityIndicator color={theme.proof} /><Text style={[styles.muted, { color: theme.muted }]}>Loading Kamino market…</Text></View></SafeAreaView>;
  const actionText = currentStep ? `${currentStep.kind[0]!.toUpperCase()}${currentStep.kind.slice(1)} ${currentStep.symbol}` : '';
  const canEdit = !review;
  const canEstimate = canEdit && wallet.status === 'ready' && Boolean(wallet.address) && (useMax || amount.trim().length > 0);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.canvas }]} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityRole="button" onPress={() => router.back()}><Text style={[styles.back, { color: theme.proof }]}>‹  Markets</Text></Pressable>
        <Text style={[styles.title, { color: theme.ink }]}>{asset.symbol} lending</Text>
        <Text style={[styles.subtitle, { color: theme.muted }]}>Kamino · Solana mainnet · xStock collateral, USDC debt</Text>
        <InfoCard label="Asset identity" value={`${asset.name}\n${asset.mintAddress}`} theme={theme} mono />
        <InfoCard label="Current terms" value={`Supply ${percent(asset.supplyApy)} APY   ·   Borrow ${percent(asset.borrowApy)} APY\nUSDC liquidity ${asset.availableLiquidity ?? 'Unavailable'}\n${asset.routeAvailable ? 'USDC route active' : 'No active USDC route'}`} theme={theme} />
        {wallet.status === 'guest' ? <><InfoCard label="Wallet" value="Sign in with Privy to view your balances and lending positions." theme={theme} /><Pressable onPress={() => router.push('/sign-in')} style={[styles.primaryButton, { backgroundColor: theme.proof }]}><Text style={styles.primaryText}>Sign in with Privy</Text></Pressable></>
          : wallet.status !== 'ready' ? <InfoCard label="Wallet" value={wallet.status === 'loading' ? 'Connecting to your embedded Solana wallet…' : `Wallet state: ${wallet.status}`} theme={theme} />
          : <InfoCard label="Selected wallet" value={`${wallet.address}\n${walletPositions ? `${holding?.displayAmount ?? '0'} ${asset.symbol} · ${walletPositions.usdcBalance.displayAmount} USDC` : 'Refreshing balances…'}`} theme={theme} mono />}
        {walletPositions?.obligations.map((item) => <InfoCard key={item.obligationAddress} label={`Kamino obligation · LTV ${percent(item.ltv)}`} value={`${item.collateral.map((leg) => `${leg.displayAmount} ${catalogAssets.find((candidate) => candidate.mintAddress === leg.mintAddress)?.symbol ?? leg.mintAddress}`).join(', ') || 'No supported collateral'}\n${item.debt.map((leg) => `${leg.displayAmount} ${leg.mintAddress === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' ? 'USDC' : leg.mintAddress}`).join(', ') || 'No debt'}\n${item.supportedForActions ? 'Actions supported for this position' : item.actionBlockReason}`} theme={theme} />)}
        {history?.items.length ? <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.outline }]}><Text style={[styles.cardLabel, { color: theme.muted }]}>Warren lending activity</Text>{history.items.slice(0, 8).map((item) => <Text key={item.actionId} style={[styles.small, { color: theme.ink }]}>{item.action.replace('-', ' ')} · {catalogAssets.find((candidate) => candidate.assetId === item.assetId)?.symbol ?? item.assetId} · {item.state} · {new Date(item.updatedAt).toLocaleString()}</Text>)}</View> : null}

        <Text style={[styles.section, { color: theme.ink }]}>Choose an action</Text>
        <View style={styles.actionGrid}>{actionChoices.map((choice) => <Pressable key={choice.id} onPress={() => canEdit && choose(choice.id)} style={[styles.actionChoice, { borderColor: selectedAction === choice.id ? theme.proof : theme.outline, backgroundColor: selectedAction === choice.id ? theme.proofWash : theme.surface }]}>
          <Text style={[styles.actionTitle, { color: theme.ink }]}>{choice.title}</Text><Text style={[styles.small, { color: theme.muted }]}>{choice.description}</Text>
        </Pressable>)}</View>
        <View style={styles.amountHeader}><Text style={[styles.section, { color: theme.ink }]}>{selectedAction === 'borrow' || selectedAction === 'repay' ? 'USDC amount' : `${asset.symbol} amount`}</Text>
          {(recoveryAction) ? <Pressable disabled={!canEdit} onPress={() => { setUseMax(!useMax); setPreview(undefined); setCreateKey(undefined); }}><Text style={[styles.max, { color: theme.proof }]}>{useMax ? 'Enter amount' : 'Use max'}</Text></Pressable> : null}</View>
        {!useMax && <TextInput editable={canEdit} keyboardType="decimal-pad" onChangeText={(value) => { setAmount(cleanLendingAmountInput(value)); setPreview(undefined); setCreateKey(undefined); }} placeholder="0.00" placeholderTextColor={theme.muted} style={[styles.input, { backgroundColor: theme.surface, borderColor: theme.outline, color: theme.ink }]} value={amount} />}
        {useMax && <Text style={[styles.maxValue, { color: theme.ink }]}>{selectedAction === 'repay' ? `${walletPositions?.usdcBalance.displayAmount ?? '0'} USDC available` : `${holding?.displayAmount ?? '0'} ${asset.symbol} wallet balance · protocol limit applied in preview`}</Text>}
        {selectedAction === 'borrow' || selectedAction === 'supply' ? <Text style={[styles.small, { color: theme.muted }]}>New-risk actions follow Warren’s market-level risk control. Borrowed USDC must be repaid; collateral can be liquidated if the position becomes unsafe.</Text> : null}
        {error ? <Text accessibilityRole="alert" style={[styles.error, { color: theme.caution }]}>{error}</Text> : null}
        {busy ? <ActivityIndicator color={theme.proof} style={styles.spinner} /> : null}
        {!review ? <Pressable disabled={!canEstimate || busy} onPress={() => void estimate()} style={[styles.primaryButton, { backgroundColor: canEstimate && !busy ? theme.proof : theme.outline }]}><Text style={styles.primaryText}>Preview action</Text></Pressable> : null}

        {preview ? <View style={[styles.preview, { borderColor: theme.outline, backgroundColor: theme.surface }]}>
          <Text style={[styles.section, { color: theme.ink }]}>Risk preview</Text>
          <Text style={[styles.body, { color: theme.ink }]}>Wallet {preview.walletAddress}\nCurrent collateral {preview.collateralRawBefore} raw · projected {preview.collateralRawAfter} raw\nCurrent debt {preview.debtRawBefore} raw · projected {preview.debtRawAfter} raw\nSafe USDC borrow limit {preview.maxBorrowRaw} raw · safe withdrawal limit {preview.maxWithdrawRaw} raw\nCurrent LTV {percent(preview.currentLtv)} · projected LTV {percent(preview.projectedLtv)}\nLiquidation LTV {percent(preview.liquidationLtv)} · headroom ${preview.liquidationHeadroomUsd}\n${preview.approvalCount} wallet approval${preview.approvalCount === 1 ? '' : 's'} required</Text>
          {!preview.actionAvailable ? <Text style={[styles.error, { color: theme.caution }]}>{preview.blockReason ?? 'This action is unavailable.'}</Text> : null}
          {preview.actionAvailable ? <Pressable disabled={busy} onPress={() => void prepareReview()} style={[styles.primaryButton, { backgroundColor: busy ? theme.outline : theme.proof }]}><Text style={styles.primaryText}>Review transaction</Text></Pressable> : null}
        </View> : null}

        {review && currentStep ? <View style={[styles.preview, { borderColor: theme.outline, backgroundColor: theme.surface }]}>
          <Text style={[styles.section, { color: theme.ink }]}>{review.state === 'confirmed' ? 'Confirmed' : review.state === 'unknown' || currentStep.state === 'unknown' || currentStep.state === 'submitted' ? 'Checking transaction' : 'Review transaction'}</Text>
          <Text style={[styles.body, { color: theme.ink }]}>{actionText} · {currentStep.displayAmount}\nWallet {review.walletAddress}\nNetwork Solana mainnet\nNetwork and priority fee estimate {currentStep.feeEstimateLamports === null ? 'unavailable' : `${currentStep.feeEstimateLamports} lamports`}\nToken-account rent estimate {currentStep.rentEstimateLamports === null ? 'unavailable' : `${currentStep.rentEstimateLamports} lamports`}\nSimulation {currentStep.simulation.ok ? `passed · ${currentStep.simulation.unitsConsumed ?? '—'} units` : 'failed'}\nApproval 1 of {review.steps.length} · expiry {new Date(currentStep.expiresAt).toLocaleTimeString()}\nMarket, oracle prices and liquidation headroom can change before confirmation.</Text>
          {currentStep.state === 'review' && !submissionAttempted && currentStepExpiry && clockNow < Date.parse(currentStepExpiry) ? <Pressable disabled={busy || wallet.status !== 'ready' || !wallet.address || wallet.address !== review.walletAddress} onPress={() => void signAndSubmit()} style={[styles.primaryButton, { backgroundColor: busy ? theme.outline : theme.proof }]}><Text style={styles.primaryText}>Sign with embedded wallet</Text></Pressable> : null}
          {currentStep.state === 'expired' || (currentStep.state === 'review' && Boolean(currentStepExpiry) && clockNow >= Date.parse(currentStepExpiry!)) ? <Pressable disabled={busy} onPress={() => void refreshReview()} style={[styles.primaryButton, { backgroundColor: theme.proof }]}><Text style={styles.primaryText}>Refresh expired review</Text></Pressable> : null}
          {currentStep.state === 'unknown' || currentStep.state === 'submitted' || submissionAttempted ? <Pressable disabled={busy} onPress={() => void checkStatus()} style={[styles.primaryButton, { backgroundColor: theme.proof }]}><Text style={styles.primaryText}>Check transaction status</Text></Pressable> : null}
          {currentStep.state === 'confirmed' ? <Pressable disabled={busy} onPress={() => void finishReview()} style={[styles.primaryButton, { backgroundColor: theme.proof }]}><Text style={styles.primaryText}>Done</Text></Pressable> : null}
          {currentStep.state === 'failed' ? <><Text style={[styles.error, { color: theme.caution }]}>The network confirmed this transaction failed. Refresh balances before creating a new action.</Text><Pressable disabled={busy} onPress={() => void finishReview()} style={[styles.primaryButton, { backgroundColor: theme.proof }]}><Text style={styles.primaryText}>Close failed action</Text></Pressable></> : null}
        </View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoCard({ label, value, theme, mono = false }: { label: string; value: string; theme: ReturnType<typeof useTheme>; mono?: boolean }) {
  return <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.outline }]}><Text style={[styles.cardLabel, { color: theme.muted }]}>{label}</Text><Text selectable style={[mono ? styles.mono : styles.body, { color: theme.ink }]}>{value}</Text></View>;
}
function percent(value: string | null) { if (value === null || !Number.isFinite(Number(value))) return '—'; return `${(Number(value) * 100).toFixed(2)}%`; }

const styles = StyleSheet.create({
  safe: { flex: 1 }, page: { gap: 12, padding: 16, paddingBottom: 36 }, center: { alignItems: 'center', flex: 1, gap: 10, justifyContent: 'center' },
  back: { fontFamily: Fonts.mono, fontSize: 12, fontWeight: '700', paddingVertical: 5 }, title: { fontFamily: Fonts.serif, fontSize: 28, fontWeight: '700' },
  subtitle: { fontFamily: Fonts.sans, fontSize: 12 }, card: { borderRadius: Radii.card, borderWidth: StyleSheet.hairlineWidth, gap: 6, padding: 12 },
  cardLabel: { fontFamily: Fonts.mono, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' }, body: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 19 }, mono: { fontFamily: Fonts.mono, fontSize: 9, lineHeight: 16 },
  muted: { fontFamily: Fonts.sans, fontSize: 12 }, section: { fontFamily: Fonts.serif, fontSize: 19, fontWeight: '700', marginTop: 4 }, actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionChoice: { borderRadius: Radii.card, borderWidth: 1, flexBasis: '48%', flexGrow: 1, gap: 3, padding: 10 }, actionTitle: { fontFamily: Fonts.mono, fontSize: 12, fontWeight: '800' }, small: { fontFamily: Fonts.sans, fontSize: 10, lineHeight: 15 },
  amountHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, max: { fontFamily: Fonts.mono, fontSize: 11, fontWeight: '800' }, maxValue: { fontFamily: Fonts.mono, fontSize: 12, padding: 12 },
  input: { borderRadius: Radii.card, borderWidth: 1, fontFamily: Fonts.mono, fontSize: 16, padding: 12 }, error: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18 }, spinner: { marginVertical: 4 },
  primaryButton: { alignItems: 'center', borderRadius: Radii.card, minHeight: 46, justifyContent: 'center', marginTop: 6, paddingHorizontal: 12 }, primaryText: { color: 'white', fontFamily: Fonts.mono, fontSize: 12, fontWeight: '800' },
  preview: { borderRadius: Radii.card, borderWidth: 1, gap: 9, marginTop: 6, padding: Spacing.four },
});
