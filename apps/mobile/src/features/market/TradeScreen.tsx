import type {
  ExecutionAsset,
  PerpetualExecutionResult,
  PerpetualOrderReview,
  SpotExecutionResult,
  SpotOrderReview,
} from '@warren/execution-contract';
import type { MarketCompanyResponse, PerpetualInstrument, SpotInstrument } from '@warren/markets-contract';
import * as Crypto from 'expo-crypto';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fonts, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTransactionWallet } from '@/features/privy';

import {
  createPerpetualOrder,
  createSpotOrder,
  ExecutionRequestError,
  searchExecutionAssets,
  submitPerpetualOrder,
  submitSpotOrder,
} from './execution-api';
import { loadMarketCompany } from './markets-api';
import { decimalToBaseUnits, normalizeLimitPrice, validateBaseUnitAmount, validateLimitPrice } from './trade-validation';

type Product = 'spot' | 'perpetual';
type Phase = 'configure' | 'review' | 'signing' | 'result' | 'action-required';
type Review = SpotOrderReview | PerpetualOrderReview;
type Result = SpotExecutionResult | PerpetualExecutionResult;

const USDC: ExecutionAsset = {
  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  name: 'USD Coin',
  symbol: 'USDC',
  iconUrl: null,
  decimals: 6,
  usdPrice: 1,
  verified: true,
};

export function TradeScreen() {
  const params = useLocalSearchParams<{
    assetId?: string | string[];
    product?: string | string[];
    instrumentId?: string | string[];
    direction?: string | string[];
    amount?: string | string[];
    settlementMint?: string | string[];
    orderType?: string | string[];
    leverage?: string | string[];
    limitPrice?: string | string[];
  }>();
  const assetId = first(params.assetId);
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const wallet = useTransactionWallet();
  const initialProduct: Product = first(params.product) === 'perpetual' ? 'perpetual' : 'spot';
  const initialSpotDirection = first(params.direction) === 'sell' ? 'sell' : 'buy';
  const initialPerpDirection = first(params.direction) === 'short' ? 'short' : 'long';
  const initialAmount = first(params.amount) ?? '';
  const requestedSettlementMint = first(params.settlementMint);
  const [company, setCompany] = useState<MarketCompanyResponse>();
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [product, setProduct] = useState<Product>(initialProduct);
  const [spotDirection, setSpotDirection] = useState<'buy' | 'sell'>(initialSpotDirection);
  const [perpDirection, setPerpDirection] = useState<'long' | 'short'>(initialPerpDirection);
  const [spotBuyAmount, setSpotBuyAmount] = useState(initialProduct === 'spot' && initialSpotDirection === 'buy' ? initialAmount : '');
  const [spotSellAmount, setSpotSellAmount] = useState(initialProduct === 'spot' && initialSpotDirection === 'sell' ? initialAmount : '');
  const [perpetualAmount, setPerpetualAmount] = useState(initialProduct === 'perpetual' ? initialAmount : '');
  const [settlementAsset, setSettlementAsset] = useState<ExecutionAsset>(USDC);
  const [settlementRestoreState, setSettlementRestoreState] = useState<'idle' | 'loading' | 'failed'>(
    requestedSettlementMint && requestedSettlementMint !== USDC.mint ? 'loading' : 'idle',
  );
  const [stockAsset, setStockAsset] = useState<ExecutionAsset>();
  const [pickerVisible, setPickerVisible] = useState(false);
  const [orderType, setOrderType] = useState<'market' | 'limit'>(first(params.orderType) === 'limit' ? 'limit' : 'market');
  const [leverage, setLeverage] = useState(normalizeLeverage(first(params.leverage)));
  const [limitPrice, setLimitPrice] = useState(first(params.limitPrice) ?? '');
  const [phase, setPhase] = useState<Phase>('configure');
  const [isReviewing, setIsReviewing] = useState(false);
  const [review, setReview] = useState<Review>();
  const [submitKey, setSubmitKey] = useState<string>();
  const [result, setResult] = useState<Result>();
  const [actionRequired, setActionRequired] = useState<{ message: string; providerUrl: string }>();
  const [error, setError] = useState<string>();
  const amount = product === 'perpetual'
    ? perpetualAmount
    : spotDirection === 'buy'
      ? spotBuyAmount
      : spotSellAmount;

  const setCurrentAmount = (value: string) => {
    if (product === 'perpetual') setPerpetualAmount(value);
    else if (spotDirection === 'buy') setSpotBuyAmount(value);
    else setSpotSellAmount(value);
  };

  useEffect(() => {
    if (!assetId) return;
    const controller = new AbortController();
    loadMarketCompany(assetId, controller.signal)
      .then((value) => {
        setCompany(value);
        setLoadError(undefined);
        const hasSpot = value.instruments.some(isAvailableSpot);
        const hasPerp = value.instruments.some(isAvailablePerpetual);
        const requested = first(params.product);
        setProduct(requested === 'perpetual' && hasPerp ? 'perpetual' : hasSpot ? 'spot' : 'perpetual');
      })
      .catch((cause) => {
        if (cause instanceof Error && cause.name === 'AbortError') return;
        setLoadError(cause instanceof Error ? cause.message : 'This company could not be loaded.');
      })
      .finally(() => setIsLoading(false));
    return () => controller.abort();
  }, [assetId, params.product]);

  const spotInstruments = useMemo(
    () => company?.instruments.filter(isAvailableSpot) ?? [],
    [company],
  );
  const perpetualInstruments = useMemo(
    () => company?.instruments.filter(isAvailablePerpetual) ?? [],
    [company],
  );
  const spotInstrument = chooseInstrument(spotInstruments, first(params.instrumentId));
  const perpetualInstrument = chooseInstrument(perpetualInstruments, first(params.instrumentId));
  const effectiveLeverage = perpetualInstrument
    ? Math.max(1, Math.min(Math.floor(perpetualInstrument.maxLeverage), leverage))
    : leverage;
  const spotInputDecimals = spotDirection === 'buy' ? settlementAsset.decimals : stockAsset?.decimals;
  const amountValidation = validateBaseUnitAmount(amount, product === 'spot' ? spotInputDecimals : 6);
  const limitPriceValidation = product === 'perpetual' && orderType === 'limit'
    ? validateLimitPrice(limitPrice)
    : { state: 'valid' as const };

  useEffect(() => {
    if (!spotInstrument) return;
    const controller = new AbortController();
    searchExecutionAssets(spotInstrument.mint, controller.signal)
      .then((response) => setStockAsset(response.items.find((asset) => asset.mint === spotInstrument.mint)))
      .catch(() => setStockAsset(undefined));
    return () => controller.abort();
  }, [spotInstrument]);

  useEffect(() => {
    const requestedMint = requestedSettlementMint;
    if (!requestedMint || requestedMint === USDC.mint) return;
    const controller = new AbortController();
    searchExecutionAssets(requestedMint, controller.signal)
      .then((response) => {
        const exact = response.items.find((asset) => asset.mint === requestedMint);
        if (!exact) throw new Error('The saved settlement asset could not be restored.');
        setSettlementAsset(exact);
        setSettlementRestoreState('idle');
      })
      .catch((cause) => {
        if (cause instanceof Error && cause.name === 'AbortError') return;
        setSettlementRestoreState('failed');
      });
    return () => controller.abort();
  }, [requestedSettlementMint]);

  const resetReview = useCallback(() => {
    setPhase('configure');
    setIsReviewing(false);
    setReview(undefined);
    setSubmitKey(undefined);
    setResult(undefined);
    setActionRequired(undefined);
    setError(undefined);
  }, []);

  const selectProduct = (next: Product) => {
    if (next === product) return;
    setProduct(next);
    resetReview();
  };

  const continueToReview = async () => {
    setError(undefined);
    if (amountValidation.state !== 'valid') {
      setError(amountValidation.message ?? (product === 'spot' ? 'Enter an amount greater than zero.' : 'Enter a USDC collateral amount greater than zero.'));
      return;
    }
    if (limitPriceValidation.state !== 'valid') {
      setError(limitPriceValidation.message ?? 'Enter a valid limit price.');
      return;
    }
    if (wallet.status !== 'ready' || !wallet.address) {
      if (wallet.status === 'loading') {
        setError('Your embedded Solana wallet is still preparing.');
        return;
      }
      router.push(signInHref({
        assetId: assetId!,
        product,
        instrumentId: product === 'spot' ? spotInstrument?.instrumentId : perpetualInstrument?.instrumentId,
        direction: product === 'spot' ? spotDirection : perpDirection,
        amount,
        settlementMint: settlementAsset.mint,
        orderType,
        leverage: effectiveLeverage,
        limitPrice,
      }));
      return;
    }

    try {
      setIsReviewing(true);
      const accessToken = await wallet.getAccessToken();
      if (product === 'spot') {
        if (!spotInstrument) throw new Error('A verified Spot instrument is not available.');
        const inputAsset = spotDirection === 'buy' ? settlementAsset : stockAsset;
        if (!inputAsset) throw new Error('The stock token metadata could not be loaded. Try again shortly.');
        const created = await createSpotOrder(accessToken, {
          assetId: assetId!,
          instrumentId: spotInstrument.instrumentId,
          direction: spotDirection,
          settlementMint: settlementAsset.mint,
          amount: decimalToBaseUnits(amount, inputAsset.decimals),
          walletAddress: wallet.address,
        });
        setReview(created);
        setSubmitKey(Crypto.randomUUID());
        setPhase('review');
      } else {
        if (!perpetualInstrument) throw new Error('A verified Perpetual instrument is not available.');
        const created = await createPerpetualOrder(accessToken, {
          assetId: assetId!,
          instrumentId: perpetualInstrument.instrumentId,
          direction: perpDirection,
          orderType,
          collateralAmount: decimalToBaseUnits(amount, 6),
          leverage: effectiveLeverage,
          limitPrice: orderType === 'limit' ? normalizeLimitPrice(limitPrice) : null,
          walletAddress: wallet.address,
        });
        if (created.state === 'action_required') {
          setActionRequired({ message: created.message, providerUrl: created.providerUrl });
          setPhase('action-required');
          return;
        }
        setReview(created);
        setSubmitKey(Crypto.randomUUID());
        setPhase('review');
      }
    } catch (cause) {
      setPhase('configure');
      setError(messageFor(cause));
    } finally {
      setIsReviewing(false);
    }
  };

  const approve = async () => {
    if (!review || wallet.status !== 'ready') return;
    if (new Date(review.expiresAt).getTime() <= Date.now()) {
      setReview(undefined);
      setPhase('configure');
      setError('This review expired. Get a fresh order.');
      return;
    }
    setError(undefined);
    setPhase('signing');
    try {
      const signedTransaction = await wallet.signTransaction(review.unsignedTransaction);
      const accessToken = await wallet.getAccessToken();
      const idempotencyKey = submitKey ?? Crypto.randomUUID();
      if (!submitKey) setSubmitKey(idempotencyKey);
      const executionResult = review.product === 'spot'
        ? await submitSpotOrder(accessToken, review.executionId, signedTransaction, idempotencyKey)
        : await submitPerpetualOrder(accessToken, review.executionId, signedTransaction, idempotencyKey);
      setResult(executionResult);
      setPhase('result');
    } catch (cause) {
      setPhase('review');
      setError(isRejected(cause)
        ? 'You rejected the wallet approval. Nothing was submitted.'
        : messageFor(cause));
    }
  };

  const goBack = () => {
    if (phase !== 'configure') {
      resetReview();
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/markets' as Href);
  };

  if (!assetId) return <TradeState title="This trade link is incomplete." onBack={goBack} />;
  if (isLoading) return <TradeState title="Preparing trade ticket" onBack={goBack} loading />;
  if (!company || loadError) return <TradeState title={loadError ?? 'Company could not be loaded'} onBack={goBack} />;

  const canSpot = Boolean(spotInstrument);
  const canPerpetual = Boolean(perpetualInstrument);
  const activeInstrument = product === 'spot' ? spotInstrument : perpetualInstrument;
  const actionDirection = review?.direction ?? (product === 'spot' ? spotDirection : perpDirection);
  const cautionAction = actionDirection === 'sell' || actionDirection === 'short';
  const settlementLoading = product === 'spot' && settlementRestoreState === 'loading';
  const settlementFailed = product === 'spot' && settlementRestoreState === 'failed';
  const amountReady = amountValidation.state === 'valid';
  const limitPriceReady = limitPriceValidation.state === 'valid';
  const walletPreparing = wallet.status === 'loading';
  const walletUnsupported = wallet.status === 'unsupported';
  const configureLabel = !activeInstrument
    ? 'Trading not supported'
    : settlementLoading
      ? 'Restoring asset…'
      : settlementFailed
        ? 'Choose another asset'
        : amountValidation.state === 'pending'
          ? 'Preparing stock asset…'
          : !amountReady
            ? amountValidation.state === 'empty' || amountValidation.state === 'zero' ? 'Enter an amount' : 'Check amount'
            : !limitPriceReady
              ? limitPriceValidation.state === 'empty' || limitPriceValidation.state === 'zero' ? 'Enter limit price' : 'Check limit price'
              : walletPreparing
                ? 'Preparing wallet…'
                : walletUnsupported
                  ? 'Trading not supported'
                  : wallet.status === 'ready'
                    ? `Review ${product === 'spot' ? spotDirection : perpDirection}`
                    : 'Sign in to review';
  const configureDisabled = !activeInstrument
    || settlementLoading
    || (!settlementFailed && (!amountReady || !limitPriceReady || walletPreparing || walletUnsupported));

  return (
    <View style={[styles.screen, { backgroundColor: theme.canvas }]}>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboardFrame}>
          <View style={[styles.header, { borderBottomColor: theme.outline }]}>
            <Pressable accessibilityLabel="Go back" accessibilityRole="button" hitSlop={10} onPress={goBack} style={styles.backButton}>
              <Text style={[styles.backGlyph, { color: theme.ink }]}>‹</Text>
            </Pressable>
            <View style={styles.headerCopy}>
              <Text numberOfLines={1} style={[styles.headerTitle, { color: theme.ink }]}>{company.company.companyName}</Text>
              <Text numberOfLines={1} style={[styles.headerMeta, { color: theme.muted }]}>
                {activeInstrument ? `${activeInstrument.symbol} · ${formatMoney(activeInstrument.marketValue.amount)}` : 'No executable instrument'}
              </Text>
            </View>
            <Text numberOfLines={1} style={[styles.headerStatus, { color: theme.muted }]}>
              {phase === 'configure' ? (wallet.status === 'ready' ? shortAddress(wallet.address) : 'Sign in') : phaseLabel(phase)}
            </Text>
          </View>

          <ScrollView
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
            contentContainerStyle={styles.content}
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.scroll}>
            {canSpot && canPerpetual ? (
              <ProductTabs
                selected={product}
                onSelect={(value) => selectProduct(value as Product)}
              />
            ) : null}

            {phase === 'configure' ? (
              <>
                {product === 'spot' && spotInstrument ? (
                  <SpotTicket
                    amount={amount}
                    direction={spotDirection}
                    onAmount={setCurrentAmount}
                    onDirection={setSpotDirection}
                    onOpenPicker={() => setPickerVisible(true)}
                    settlementAsset={settlementAsset}
                    stockAsset={stockAsset}
                    stockSymbol={spotInstrument.symbol}
                    validationMessage={amount && amountValidation.state !== 'valid' && amountValidation.state !== 'pending' ? amountValidation.message : undefined}
                  />
                ) : null}
                {product === 'perpetual' && perpetualInstrument ? (
                  <PerpetualTicket
                    amount={amount}
                    direction={perpDirection}
                    instrument={perpetualInstrument}
                    leverage={effectiveLeverage}
                    limitPrice={limitPrice}
                    onAmount={setCurrentAmount}
                    onDirection={setPerpDirection}
                    onLeverage={setLeverage}
                    onLimitPrice={setLimitPrice}
                    onOrderType={setOrderType}
                    orderType={orderType}
                    amountValidationMessage={amount && amountValidation.state !== 'valid' ? amountValidation.message : undefined}
                    limitValidationMessage={limitPrice && limitPriceValidation.state !== 'valid' ? limitPriceValidation.message : undefined}
                  />
                ) : null}
                {!activeInstrument ? <Notice text="This company has no verified executable instrument right now." /> : null}
                {product === 'spot' && settlementRestoreState === 'loading' ? <Notice text="Restoring your saved settlement asset…" /> : null}
                {product === 'spot' && settlementRestoreState === 'failed' ? <Notice text="Your saved settlement asset could not be restored. Choose another asset before review." tone="caution" /> : null}
              </>
            ) : null}

            {(phase === 'review' || phase === 'signing') && review ? <ReviewLedger review={review} /> : null}

            {phase === 'action-required' && actionRequired ? (
              <View style={[styles.stateCard, { backgroundColor: theme.surface, borderColor: theme.outline }]}>
                <Text style={[styles.stateEyebrow, { color: theme.caution }]}>PHOENIX ACTION REQUIRED</Text>
                <Text style={[styles.stateTitle, { color: theme.ink }]}>Prepare the trading account</Text>
                <Text style={[styles.stateBody, { color: theme.muted }]}>{actionRequired.message}</Text>
                <Pressable onPress={() => void openBrowserAsync(actionRequired.providerUrl)} style={[styles.secondaryButton, { borderColor: theme.outline }]}>
                  <Text style={[styles.secondaryButtonText, { color: theme.ink }]}>Open Phoenix ↗</Text>
                </Pressable>
              </View>
            ) : null}

            {phase === 'result' && result ? <ResultCard result={result} review={review} /> : null}

            {error ? <Notice text={error} tone="caution" /> : null}

            <View style={[styles.disclosure, { borderTopColor: theme.outline }]}>
              <Text style={[styles.disclosureText, { color: theme.muted }]}>
                {product === 'spot'
                  ? 'The stock mint is locked to Warren’s verified market registry. Jupiter chooses the route; you approve the exact transaction shown in review.'
                  : 'Phoenix perpetuals use isolated margin here. Leverage magnifies gains and losses; liquidation can occur before the underlying stock reaches zero.'}
              </Text>
            </View>
          </ScrollView>

          <View style={[styles.actionDock, { backgroundColor: theme.canvas, borderTopColor: theme.outline, paddingBottom: insets.bottom + 12 }]}>
            {phase === 'configure' ? (
              <PrimaryButton
                disabled={configureDisabled}
                label={configureLabel}
                loading={isReviewing || settlementLoading}
                onPress={() => settlementFailed ? setPickerVisible(true) : void continueToReview()}
                tone={cautionAction ? 'caution' : 'proof'}
              />
            ) : null}
            {phase === 'review' || phase === 'signing' ? (
              <View style={styles.reviewActions}>
                <Pressable disabled={phase === 'signing'} onPress={resetReview} style={[styles.editButton, { borderColor: theme.outline }]}>
                  <Text style={[styles.editButtonText, { color: theme.ink }]}>Edit</Text>
                </Pressable>
                <View style={styles.approveButtonWrap}>
                  <PrimaryButton label={review ? approveLabel(review) : 'Approve'} loading={phase === 'signing'} onPress={() => void approve()} tone={cautionAction ? 'caution' : 'proof'} />
                </View>
              </View>
            ) : null}
            {phase === 'action-required' ? <PrimaryButton label="Back to ticket" onPress={resetReview} /> : null}
            {phase === 'result' && result ? (
              <PrimaryButton
                label={result.state === 'failed' ? 'Back to ticket' : 'Done'}
                onPress={result.state === 'failed' ? resetReview : () => router.back()}
              />
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <AssetPicker
        context={spotDirection === 'buy' ? 'payment' : 'receiving'}
        excludedMint={spotInstrument?.mint}
        onClose={() => setPickerVisible(false)}
        onSelect={(asset) => {
          setSettlementAsset(asset);
          setSettlementRestoreState('idle');
          if (spotDirection === 'buy') setSpotBuyAmount('');
          setPickerVisible(false);
          resetReview();
        }}
        selectedMint={settlementAsset.mint}
        visible={pickerVisible}
      />
    </View>
  );
}

function SpotTicket({
  amount,
  direction,
  onAmount,
  onDirection,
  onOpenPicker,
  settlementAsset,
  stockAsset,
  stockSymbol,
  validationMessage,
}: {
  amount: string;
  direction: 'buy' | 'sell';
  onAmount: (value: string) => void;
  onDirection: (value: 'buy' | 'sell') => void;
  onOpenPicker: () => void;
  settlementAsset: ExecutionAsset;
  stockAsset?: ExecutionAsset;
  stockSymbol: string;
  validationMessage?: string;
}) {
  const theme = useTheme();
  const inputSymbol = direction === 'buy' ? settlementAsset.symbol : stockAsset?.symbol ?? stockSymbol;
  const outputSymbol = direction === 'buy' ? stockAsset?.symbol ?? stockSymbol : settlementAsset.symbol;
  return (
    <View style={styles.ticketStack}>
      <DirectionToggle
        items={[{ id: 'buy', label: 'Buy' }, { id: 'sell', label: 'Sell' }]}
        selected={direction}
        onSelect={(value) => onDirection(value as 'buy' | 'sell')}
      />
      <View style={[styles.amountStage, { borderBottomColor: theme.outline }]}>
        <View style={styles.amountHeader}>
          <Text style={[styles.amountLabel, { color: theme.ink }]}>You send</Text>
          <Text style={[styles.amountHint, { color: theme.muted }]}>Quote fetched at review</Text>
        </View>
        <View style={styles.amountEntry}>
          <TextInput
            accessibilityLabel={`Amount of ${inputSymbol}`}
            autoCorrect={false}
            keyboardType="decimal-pad"
            onChangeText={onAmount}
            placeholder="0"
            placeholderTextColor={theme.outline}
            selectionColor={theme.proof}
            style={[styles.amountInput, { color: theme.ink }]}
            value={amount}
          />
          <AssetUnit
            onPress={direction === 'buy' ? onOpenPicker : undefined}
            symbol={inputSymbol}
          />
        </View>
        {validationMessage ? <Text accessibilityLiveRegion="polite" style={[styles.fieldError, { color: theme.caution }]}>{validationMessage}</Text> : null}
      </View>
      <View style={styles.conversionSpine}>
        <View style={[styles.spineLine, { backgroundColor: theme.outline }]} />
        <Text style={[styles.spineText, { backgroundColor: theme.canvas, color: theme.proof }]}>{inputSymbol}  →  Jupiter  →  {outputSymbol}</Text>
      </View>
      <View style={styles.receiveBlock}>
        <Text style={[styles.receiveLabel, { color: theme.muted }]}>You receive</Text>
        <View style={styles.receiveValueRow}>
          <Text style={[styles.receivePending, { color: theme.ink }]}>Calculated at review</Text>
          <AssetUnit
            onPress={direction === 'sell' ? onOpenPicker : undefined}
            symbol={outputSymbol}
          />
        </View>
        <Text style={[styles.contextOnly, { color: theme.muted }]}>A fresh Jupiter quote will show the exact route, fees and minimum received before wallet approval.</Text>
      </View>
      <View style={[styles.executionSummary, { borderBottomColor: theme.outline, borderTopColor: theme.outline }]}>
        <Text style={[styles.executionSummaryText, { color: theme.ink }]}>Best route</Text>
        <Text style={[styles.executionSummaryMeta, { color: theme.muted }]}>Jupiter · Solana · shown at review</Text>
      </View>
    </View>
  );
}

function PerpetualTicket({
  amount,
  direction,
  instrument,
  leverage,
  limitPrice,
  onAmount,
  onDirection,
  onLeverage,
  onLimitPrice,
  onOrderType,
  orderType,
  amountValidationMessage,
  limitValidationMessage,
}: {
  amount: string;
  direction: 'long' | 'short';
  instrument: PerpetualInstrument;
  leverage: number;
  limitPrice: string;
  onAmount: (value: string) => void;
  onDirection: (value: 'long' | 'short') => void;
  onLeverage: (value: number) => void;
  onLimitPrice: (value: string) => void;
  onOrderType: (value: 'market' | 'limit') => void;
  orderType: 'market' | 'limit';
  amountValidationMessage?: string;
  limitValidationMessage?: string;
}) {
  const theme = useTheme();
  const maxLeverage = Math.max(1, Math.floor(instrument.maxLeverage));
  const leverageOptions = [1, 2, 3, 5, maxLeverage]
    .filter((value, index, values) => value <= maxLeverage && values.indexOf(value) === index);
  if (!leverageOptions.includes(leverage)) {
    if (leverageOptions.length === 5) leverageOptions[leverageOptions.length - 1] = leverage;
    else leverageOptions.push(leverage);
    leverageOptions.sort((left, right) => left - right);
  }
  return (
    <View style={styles.ticketStack}>
      <DirectionToggle
        items={[{ id: 'long', label: 'Long' }, { id: 'short', label: 'Short' }]}
        selected={direction}
        onSelect={(value) => onDirection(value as 'long' | 'short')}
      />
      <View style={[styles.amountStage, { borderBottomColor: theme.outline }]}>
        <View style={styles.amountHeader}>
          <Text style={[styles.amountLabel, { color: theme.ink }]}>You provide</Text>
          <Text style={[styles.amountHint, { color: theme.muted }]}>Isolated collateral</Text>
        </View>
        <View style={styles.amountEntry}>
          <TextInput
            accessibilityLabel="USDC collateral amount"
            autoCorrect={false}
            keyboardType="decimal-pad"
            onChangeText={onAmount}
            placeholder="0"
            placeholderTextColor={theme.outline}
            selectionColor={theme.proof}
            style={[styles.amountInput, { color: theme.ink }]}
            value={amount}
          />
          <AssetUnit symbol="USDC" />
        </View>
        {amountValidationMessage ? <Text accessibilityLiveRegion="polite" style={[styles.fieldError, { color: theme.caution }]}>{amountValidationMessage}</Text> : null}
      </View>
      <View style={styles.conversionSpine}>
        <View style={[styles.spineLine, { backgroundColor: theme.outline }]} />
        <Text style={[styles.spineText, { backgroundColor: theme.canvas, color: theme.proof }]}>{amount || '0'} USDC collateral  ×  {leverage}  →  exposure at review</Text>
      </View>
      <View style={[styles.perpConfig, { borderBottomColor: theme.outline, borderTopColor: theme.outline }]}>
        <View style={styles.orderTypeGroup}>
          <Text style={[styles.parameterLabel, { color: theme.muted }]}>Order</Text>
          <View style={styles.orderTypeOptions}>
            {(['market', 'limit'] as const).map((value) => (
              <Pressable key={value} onPress={() => onOrderType(value)} style={[styles.orderTypeOption, { backgroundColor: orderType === value ? theme.proofWash : theme.surface, borderColor: orderType === value ? theme.proof : 'transparent' }]}>
                <Text style={[styles.orderTypeOptionText, { color: orderType === value ? theme.proof : theme.muted }]}>{title(value)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.marginCopy}>
          <Text style={[styles.parameterLabel, { color: theme.muted }]}>Margin</Text>
          <Text style={[styles.marginValue, { color: theme.ink }]}>Isolated</Text>
        </View>
      </View>
      {orderType === 'limit' ? (
        <View style={[styles.limitComposer, { borderBottomColor: theme.outline }]}>
          <View style={styles.amountHeader}>
            <Text style={[styles.amountLabel, { color: theme.ink }]}>Limit price</Text>
            <Text style={[styles.amountHint, { color: theme.muted }]}>USD</Text>
          </View>
          <View style={styles.amountEntry}>
            <TextInput
              accessibilityLabel="Limit price in US dollars"
              autoCorrect={false}
              keyboardType="decimal-pad"
              onChangeText={onLimitPrice}
              placeholder="0.00"
              placeholderTextColor={theme.outline}
              style={[styles.limitInput, { color: theme.ink }]}
              value={limitPrice}
            />
            <AssetUnit symbol="USD" />
          </View>
          {limitValidationMessage ? <Text accessibilityLiveRegion="polite" style={[styles.fieldError, { color: theme.caution }]}>{limitValidationMessage}</Text> : null}
        </View>
      ) : null}
      <View style={styles.leverageSection}>
        <View style={styles.leverageHeading}>
          <Text style={[styles.leverageTitle, { color: theme.ink }]}>Leverage</Text>
          <Text style={[styles.leverageMeta, { color: theme.muted }]}>{leverage}× selected · {maxLeverage}× max</Text>
        </View>
        <View style={styles.leverageOptions}>
          {leverageOptions.map((value) => {
            const active = leverage === value;
            return (
              <Pressable key={value} accessibilityState={{ selected: active }} onPress={() => onLeverage(value)} style={[styles.leverageOption, { backgroundColor: active ? theme.proof : theme.surface }]}>
                <Text style={[styles.leverageOptionText, { color: active ? theme.onProof : theme.muted }]}>{value}×</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={[styles.riskLedger, { borderTopColor: theme.outline }]}>
        <View style={[styles.riskFocus, { borderBottomColor: theme.outline }]}>
          <Text style={[styles.riskFocusLabel, { color: theme.muted }]}>Estimated liquidation</Text>
          <Text style={[styles.riskFocusValue, { color: theme.caution }]}>Calculated at review</Text>
          <Text style={[styles.riskFocusMeta, { color: theme.muted }]}>Phoenix supplies the executable risk estimate.</Text>
        </View>
        <RiskRow label="Position" value={`${instrument.symbol} · ${title(direction)}`} />
        <RiskRow label="Entry" value={orderType === 'market' ? 'Market price at review' : `${limitPrice || '—'} USD limit`} />
        <RiskRow label="Margin" value={`Isolated · ${leverage}×`} />
      </View>
    </View>
  );
}

function ReviewLedger({ review }: { review: Review }) {
  const theme = useTheme();
  const rows: [string, string][] = review.product === 'spot'
    ? [
      ['You send', formatToken(review.input.amount, review.input.decimals, review.input.symbol)],
      ['Expected output', formatToken(review.output.amount, review.output.decimals, review.output.symbol)],
      ['Minimum output', formatToken(review.minimumOutputAmount, review.output.decimals, review.output.symbol)],
      ['Price impact', review.priceImpactPercent === null ? 'Not supplied' : `${review.priceImpactPercent.toFixed(3)}%`],
      ['Route', `${review.router} · ${review.mode}`],
      ['Platform fee', review.platformFeeAmount === null ? `${review.feeBps} bps` : `${review.platformFeeAmount} base units · ${review.feeBps} bps`],
      ['Fee mint', shortAddress(review.feeMint)],
      ['Network fees', formatNetworkFees(review.signatureFeeLamports, review.prioritizationFeeLamports, review.rentFeeLamports)],
      ['Last valid block', review.lastValidBlockHeight === null ? 'Not supplied' : String(review.lastValidBlockHeight)],
    ]
    : [
      ['Direction', `${title(review.direction)} ${review.marketSymbol}`],
      ['Order type', title(review.orderType)],
      ['Collateral', formatToken(review.collateralAmount, 6, review.collateralSymbol)],
      ['Notional', formatMoney(review.notionalUsd)],
      ['Quantity', review.quantity],
      ['Mark price', formatMoney(review.referencePriceUsd)],
      ['Funding', formatFunding(review.fundingRatePercent, review.nextFundingAt, review.direction)],
      ['Margin', `${title(review.marginMode)} · ${review.leverage}×`],
      ['Last valid block', String(review.lastValidBlockHeight)],
    ];
  return (
    <View style={[styles.reviewCard, { borderColor: theme.outline }]}>
      <View style={styles.reviewHeading}>
        <View>
          <Text style={[styles.reviewEyebrow, { color: theme.proof }]}>EXECUTABLE REVIEW</Text>
          <Text style={[styles.reviewTitle, { color: theme.ink }]}>{review.product === 'spot' ? 'Jupiter conversion' : 'Phoenix risk review'}</Text>
        </View>
        <Text style={[styles.reviewExpiry, { color: theme.muted }]}>Expires {formatTime(review.expiresAt)}</Text>
      </View>
      {review.product === 'perpetual' ? (
        <View style={[styles.reviewRiskFocus, { backgroundColor: theme.cautionWash }]}>
          <Text style={[styles.riskFocusLabel, { color: theme.muted }]}>Estimated liquidation</Text>
          <Text style={[styles.reviewRiskValue, { color: theme.caution }]}>{formatMoney(review.estimatedLiquidationPriceUsd)}</Text>
          <Text style={[styles.riskFocusMeta, { color: theme.muted }]}>Based on the current Phoenix review. It can change before execution.</Text>
        </View>
      ) : null}
      {rows.map(([label, value]) => (
        <View key={label} style={[styles.ledgerRow, { borderTopColor: theme.outline }]}>
          <Text style={[styles.ledgerLabel, { color: theme.muted }]}>{label}</Text>
          <Text numberOfLines={2} style={[styles.ledgerValue, { color: theme.ink }]}>{value}</Text>
        </View>
      ))}
      <View style={[styles.signatureRail, { backgroundColor: theme.proofWash }]}>
        <Text style={[styles.signatureRailLabel, { color: theme.proof }]}>WALLET SIGNER</Text>
        <Text style={[styles.signatureRailValue, { color: theme.ink }]}>{shortAddress(review.walletAddress)}</Text>
      </View>
    </View>
  );
}

function ResultCard({ result, review }: { result: Result; review?: Review }) {
  const theme = useTheme();
  const successful = result.state === 'confirmed' || result.state === 'submitted';
  const titleText = result.state === 'confirmed'
    ? 'Transaction confirmed'
    : result.state === 'submitted'
      ? 'Transaction submitted'
      : 'Transaction failed';
  return (
    <View style={[styles.stateCard, { backgroundColor: theme.surface, borderColor: theme.outline }]}>
      <Text style={[styles.stateEyebrow, { color: successful ? theme.proof : theme.caution }]}>{result.state.toUpperCase()}</Text>
      <Text style={[styles.stateTitle, { color: theme.ink }]}>{titleText}</Text>
      <Text style={[styles.stateBody, { color: theme.muted }]}>{result.message}</Text>
      {result.product === 'spot' && review?.product === 'spot' && result.inputAmount && result.outputAmount ? (
        <View style={[styles.resultAmounts, { borderColor: theme.outline }]}>
          <RiskRow label="Executed input" value={formatToken(result.inputAmount, review.input.decimals, review.input.symbol)} />
          <RiskRow label="Executed output" value={formatToken(result.outputAmount, review.output.decimals, review.output.symbol)} />
        </View>
      ) : null}
      {result.product === 'perpetual' && review?.product === 'perpetual' ? (
        <View style={[styles.resultAmounts, { borderColor: theme.outline }]}>
          <RiskRow label="Position" value={`${title(review.direction)} ${review.marketSymbol}`} />
          <RiskRow label="Order" value={`${title(review.orderType)} · ${review.leverage}× isolated`} />
          <RiskRow label="Quantity" value={review.quantity} />
          <RiskRow label="Notional" value={formatMoney(review.notionalUsd)} />
        </View>
      ) : null}
      {result.signature ? <Text selectable style={[styles.signatureText, { color: theme.ink }]}>{result.signature}</Text> : null}
      {result.explorerUrl ? (
        <Pressable onPress={() => void openBrowserAsync(result.explorerUrl!)} style={[styles.secondaryButton, { borderColor: theme.outline }]}>
          <Text style={[styles.secondaryButtonText, { color: theme.ink }]}>View on Solscan ↗</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function AssetPicker({ visible, onClose, onSelect, selectedMint, excludedMint, context }: {
  visible: boolean;
  onClose: () => void;
  onSelect: (asset: ExecutionAsset) => void;
  selectedMint: string;
  excludedMint?: string;
  context: 'payment' | 'receiving';
}) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<ExecutionAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError(undefined);
      searchExecutionAssets(query, controller.signal)
        .then((response) => setItems(response.items.filter((asset) => asset.mint !== excludedMint)))
        .catch((cause) => {
          if (cause instanceof Error && cause.name === 'AbortError') return;
          setError(messageFor(cause));
        })
        .finally(() => setLoading(false));
    }, query ? 260 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [excludedMint, query, visible]);

  return (
    <Modal animationType="slide" onRequestClose={onClose} onShow={() => setQuery('')} transparent visible={visible}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
        <SafeAreaView edges={['bottom']} style={[styles.pickerSheet, { backgroundColor: theme.canvas, borderColor: theme.outline }]}>
          <View style={styles.pickerHeader}>
            <View><Text style={[styles.pickerEyebrow, { color: theme.proof }]}>JUPITER ASSETS</Text><Text style={[styles.pickerTitle, { color: theme.ink }]}>Choose {context} asset</Text></View>
            <Pressable accessibilityLabel="Close asset picker" onPress={onClose} style={[styles.closeButton, { borderColor: theme.outline }]}><Text style={[styles.closeGlyph, { color: theme.ink }]}>×</Text></Pressable>
          </View>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setQuery}
            placeholder="Search symbol, name or mint"
            placeholderTextColor={theme.muted}
            selectionColor={theme.proof}
            style={[styles.searchInput, { backgroundColor: theme.surface, borderColor: theme.outline, color: theme.ink }]}
            value={query}
          />
          {loading ? <ActivityIndicator color={theme.proof} style={styles.pickerLoader} /> : null}
          {error ? <Notice text={error} tone="caution" /> : null}
          <ScrollView automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'} keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} keyboardShouldPersistTaps="handled" style={styles.assetList}>
            {items.map((asset) => (
              <Pressable key={asset.mint} onPress={() => onSelect(asset)} style={[styles.assetRow, { borderBottomColor: theme.outline }]}>
                <AssetLogo asset={asset} />
                <View style={styles.assetRowCopy}><Text style={[styles.assetName, { color: theme.ink }]}>{asset.name}</Text><Text style={[styles.assetMint, { color: theme.muted }]}>{shortAddress(asset.mint)}</Text></View>
                <View style={styles.assetRowEnd}><Text style={[styles.assetSymbol, { color: theme.ink }]}>{asset.symbol}</Text><Text style={[styles.assetVerified, { color: asset.verified ? theme.proof : theme.muted }]}>{asset.mint === selectedMint ? 'Selected' : asset.verified ? 'Verified' : 'Jupiter asset'}</Text></View>
              </Pressable>
            ))}
            {!loading && !items.length && !error ? <Text style={[styles.emptyText, { color: theme.muted }]}>No matching Jupiter assets.</Text> : null}
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ProductTabs({ selected, onSelect }: { selected: Product; onSelect: (id: Product) => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.productTabs, { borderBottomColor: theme.outline }]}>
      {([{ id: 'spot', label: 'Spot' }, { id: 'perpetual', label: 'Perpetual' }] as const).map((item) => {
        const active = item.id === selected;
        return (
          <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => onSelect(item.id)} style={[styles.productTab, active && { borderBottomColor: theme.proof }]}>
            <Text style={[styles.productTabText, { color: active ? theme.ink : theme.muted }]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function DirectionToggle({ items, selected, onSelect }: { items: { id: string; label: string }[]; selected: string; onSelect: (id: string) => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.directionToggle, { backgroundColor: theme.surface }]}>
      {items.map((item) => {
        const active = item.id === selected;
        const caution = item.id === 'sell' || item.id === 'short';
        return (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(item.id)}
            style={[styles.directionOption, active && { backgroundColor: caution ? theme.caution : theme.proof }]}>
            <Text style={[styles.directionOptionText, { color: active ? (caution ? theme.canvas : theme.onProof) : theme.muted }]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function AssetUnit({ symbol, onPress }: { symbol: string; onPress?: () => void }) {
  const theme = useTheme();
  const content = <Text numberOfLines={1} style={[styles.assetUnitText, { color: onPress ? theme.ink : theme.muted }]}>{symbol}{onPress ? ' ⌄' : ''}</Text>;
  return onPress
    ? <Pressable accessibilityLabel={`Choose asset, currently ${symbol}`} accessibilityRole="button" onPress={onPress} style={[styles.assetUnit, { backgroundColor: theme.surface }]}>{content}</Pressable>
    : <View style={[styles.assetUnit, { backgroundColor: theme.surface }]}>{content}</View>;
}

function RiskRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return <View style={styles.riskRow}><Text style={[styles.riskRowLabel, { color: theme.muted }]}>{label}</Text><Text numberOfLines={2} style={[styles.riskRowValue, { color: theme.ink }]}>{value}</Text></View>;
}

function AssetLogo({ asset }: { asset: ExecutionAsset }) {
  const theme = useTheme();
  return <View style={[styles.assetLogo, { backgroundColor: theme.proofWash }]}>{asset.iconUrl ? <Image contentFit="cover" source={{ uri: asset.iconUrl }} style={styles.assetLogoImage} /> : <Text style={[styles.assetLogoText, { color: theme.proof }]}>{asset.symbol.slice(0, 2)}</Text>}</View>;
}

function Notice({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'caution' }) {
  const theme = useTheme();
  return <View accessibilityLiveRegion="polite" style={[styles.notice, { backgroundColor: tone === 'caution' ? theme.cautionWash : theme.surface, borderColor: tone === 'caution' ? theme.caution : theme.outline }]}><Text style={[styles.noticeText, { color: tone === 'caution' ? theme.caution : theme.muted }]}>{text}</Text></View>;
}

function PrimaryButton({ label, onPress, loading = false, disabled = false, tone = 'proof' }: { label: string; onPress: () => void; loading?: boolean; disabled?: boolean; tone?: 'proof' | 'caution' }) {
  const theme = useTheme();
  const backgroundColor = disabled ? theme.disabledSurface : tone === 'caution' ? theme.caution : theme.proof;
  const foregroundColor = disabled ? theme.disabledInk : tone === 'caution' ? theme.canvas : theme.onProof;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || loading, busy: loading }} disabled={disabled || loading} onPress={onPress} style={({ pressed }) => [styles.primaryButton, { backgroundColor }, pressed && styles.pressed]}>{loading ? <ActivityIndicator color={foregroundColor} /> : <Text style={[styles.primaryButtonText, { color: foregroundColor }]}>{label}</Text>}</Pressable>;
}

function TradeState({ title, onBack, loading = false }: { title: string; onBack: () => void; loading?: boolean }) {
  const theme = useTheme();
  return <View style={[styles.screen, { backgroundColor: theme.canvas }]}><SafeAreaView style={styles.stateFill}><Pressable onPress={onBack} style={styles.stateBack}><Text style={[styles.backGlyph, { color: theme.ink }]}>‹</Text></Pressable><View style={styles.centerState}>{loading ? <ActivityIndicator color={theme.proof} /> : null}<Text style={[styles.centerStateText, { color: theme.ink }]}>{title}</Text></View></SafeAreaView></View>;
}

function signInHref(input: { assetId: string; product: Product; instrumentId?: string; direction: string; amount: string; settlementMint: string; orderType: string; leverage: number; limitPrice: string }): Href {
  return {
    pathname: '/sign-in',
    params: {
      returnAssetId: input.assetId,
      returnProduct: input.product,
      returnInstrumentId: input.instrumentId ?? '',
      returnDirection: input.direction,
      returnAmount: input.amount,
      returnSettlementMint: input.settlementMint,
      returnOrderType: input.orderType,
      returnLeverage: String(input.leverage),
      returnLimitPrice: input.limitPrice,
      returnMode: 'back',
    },
  } as Href;
}

function isAvailableSpot(instrument: MarketCompanyResponse['instruments'][number]): instrument is SpotInstrument {
  return instrument.productType === 'spot' && instrument.availability === 'available' && instrument.verificationState === 'verified';
}

function isAvailablePerpetual(instrument: MarketCompanyResponse['instruments'][number]): instrument is PerpetualInstrument {
  return instrument.productType === 'perpetual' && instrument.availability === 'available' && instrument.verificationState === 'verified';
}

function chooseInstrument<T extends { instrumentId: string }>(items: T[], requested?: string) {
  return items.find((item) => item.instrumentId === requested) ?? items[0];
}

function formatToken(value: string, decimals: number, symbol: string) {
  const padded = value.padStart(decimals + 1, '0');
  const whole = decimals ? padded.slice(0, -decimals) : padded;
  const fraction = decimals ? padded.slice(-decimals).replace(/0+$/, '').slice(0, 6) : '';
  return `${whole}${fraction ? `.${fraction}` : ''} ${symbol}`;
}

function approveLabel(review: Review) {
  if (review.product === 'spot') return `Approve ${review.direction}`;
  return `Approve ${review.direction}`;
}

function phaseLabel(phase: Phase) {
  if (phase === 'configure') return 'Configure · no transaction yet';
  if (phase === 'review') return 'Review before wallet approval';
  if (phase === 'signing') return 'Waiting for wallet approval';
  if (phase === 'action-required') return 'Provider setup needed';
  return 'Execution result';
}

function messageFor(error: unknown) {
  if (error instanceof ExecutionRequestError) return error.message;
  return error instanceof Error ? error.message : 'The trade request could not be completed.';
}

function isRejected(error: unknown) {
  return error instanceof Error && /reject|denied|cancel/i.test(error.message);
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeLeverage(value?: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 2;
}

function shortAddress(value: string | null) {
  if (!value) return 'Wallet not connected';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function formatMoney(value: number | null) {
  return value === null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function formatNetworkFees(...fees: (number | null)[]) {
  const supplied = fees.filter((fee): fee is number => fee !== null);
  if (!supplied.length) return 'Not supplied';
  const totalSol = supplied.reduce((sum, fee) => sum + fee, 0) / 1_000_000_000;
  return `${totalSol.toFixed(6)} SOL`;
}

function formatFunding(rate: number | null, nextFundingAt: string | null, direction: 'long' | 'short') {
  if (rate === null) return 'Not supplied';
  const timeLabel = nextFundingAt ? ` · ${formatTime(nextFundingAt)}` : '';
  if (rate === 0) return `No transfer expected${timeLabel}`;
  const pays = direction === 'long' ? rate > 0 : rate < 0;
  return `You ${pays ? 'pay' : 'receive'} ${Math.abs(rate).toFixed(4)}%${timeLabel}`;
}

function title(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safeArea: { flex: 1 },
  keyboardFrame: { flex: 1 },
  scroll: { flex: 1 },
  header: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 64, paddingHorizontal: Spacing.three },
  backButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 38 },
  backGlyph: { fontFamily: Fonts.sans, fontSize: 35, fontWeight: '300', lineHeight: 38 },
  headerCopy: { flex: 1, paddingHorizontal: Spacing.two },
  headerTitle: { fontFamily: Fonts.sans, fontSize: 16, fontWeight: '700' },
  headerMeta: { fontFamily: Fonts.mono, fontSize: 10, marginTop: 4 },
  headerStatus: { fontFamily: Fonts.mono, fontSize: 9, maxWidth: 104, textAlign: 'right' },
  walletBadge: { alignItems: 'center', borderRadius: Radii.pill, borderWidth: 1, flexDirection: 'row', gap: 6, minHeight: 32, paddingHorizontal: 10 },
  walletDot: { borderRadius: 4, height: 7, width: 7 },
  walletText: { fontFamily: Fonts.mono, fontSize: 10, fontWeight: '700' },
  content: { paddingBottom: 28, paddingHorizontal: 20 },
  identityRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  companyMark: { alignItems: 'center', borderRadius: Radii.control, height: 46, justifyContent: 'center', overflow: 'hidden', width: 46 },
  companyLogo: { height: 34, width: 34 },
  companyInitial: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '800' },
  identityCopy: { flex: 1 },
  companyName: { fontFamily: Fonts.serif, fontSize: 19, fontWeight: '700' },
  instrumentMeta: { fontFamily: Fonts.mono, fontSize: 10, marginTop: 3, textTransform: 'uppercase' },
  referenceCopy: { alignItems: 'flex-end' },
  referenceLabel: { fontFamily: Fonts.sans, fontSize: 10 },
  referenceValue: { fontFamily: Fonts.mono, fontSize: 14, fontWeight: '700', marginTop: 3 },
  segmented: { borderRadius: Radii.control, borderWidth: 1, flexDirection: 'row', overflow: 'hidden', padding: 3 },
  segment: { alignItems: 'center', borderRadius: 7, flex: 1, justifyContent: 'center', minHeight: 42 },
  segmentText: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '800' },
  productTabs: { borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row' },
  productTab: { alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent', flex: 1, justifyContent: 'center', minHeight: 50 },
  productTabText: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '800' },
  directionToggle: { alignSelf: 'center', borderRadius: Radii.pill, flexDirection: 'row', gap: 3, marginTop: 18, padding: 3, width: 176 },
  directionOption: { alignItems: 'center', borderRadius: Radii.pill, flex: 1, justifyContent: 'center', minHeight: 38 },
  directionOptionText: { fontFamily: Fonts.sans, fontSize: 12, fontWeight: '800' },
  ticketStack: { paddingBottom: 6 },
  amountStage: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 22, paddingTop: 30 },
  amountHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  amountLabel: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '700' },
  amountHint: { fontFamily: Fonts.mono, fontSize: 9 },
  amountEntry: { alignItems: 'center', flexDirection: 'row', gap: 12, marginTop: 12 },
  fieldError: { fontFamily: Fonts.sans, fontSize: 10, lineHeight: 15, marginTop: 7 },
  amountAsset: { fontFamily: Fonts.mono, fontSize: 13, fontWeight: '800' },
  amountInput: { flex: 1, fontFamily: Fonts.mono, fontSize: 46, fontWeight: '700', letterSpacing: -2, minHeight: 62, padding: 0 },
  assetUnit: { alignItems: 'center', borderRadius: Radii.pill, justifyContent: 'center', minHeight: 38, maxWidth: 118, paddingHorizontal: 12 },
  assetUnitText: { fontFamily: Fonts.mono, fontSize: 10, fontWeight: '800' },
  conversionSpine: { alignItems: 'center', justifyContent: 'center', marginBottom: 21, marginTop: 24 },
  spineLine: { height: StyleSheet.hairlineWidth, left: 0, position: 'absolute', right: 0 },
  spineText: { fontFamily: Fonts.mono, fontSize: 9, fontWeight: '700', paddingHorizontal: 12 },
  receiveBlock: { paddingBottom: 24 },
  receiveLabel: { fontFamily: Fonts.sans, fontSize: 11 },
  receiveValueRow: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between', marginTop: 8 },
  receivePending: { flex: 1, fontFamily: Fonts.mono, fontSize: 19, fontWeight: '700' },
  executionSummary: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', minHeight: 50 },
  executionSummaryText: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '700' },
  executionSummaryMeta: { fontFamily: Fonts.mono, fontSize: 9, textAlign: 'right' },
  spine: { alignItems: 'stretch', borderRadius: Radii.card, borderWidth: 1, flexDirection: 'row', minHeight: 82, padding: 10 },
  assetNode: { flex: 1, justifyContent: 'center' },
  assetNodeSymbol: { fontFamily: Fonts.mono, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  assetNodeAction: { fontFamily: Fonts.sans, fontSize: 10, marginTop: 5, textAlign: 'center' },
  routeNode: { alignItems: 'center', flexDirection: 'row', justifyContent: 'center', width: 108 },
  routeArrow: { fontFamily: Fonts.mono, fontSize: 14 },
  routeLabel: { fontFamily: Fonts.mono, fontSize: 8, marginHorizontal: 5 },
  contextOnly: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 17, marginTop: 9 },
  perpConfig: { alignItems: 'flex-end', borderBottomWidth: StyleSheet.hairlineWidth, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 16, justifyContent: 'space-between', marginTop: 24, paddingVertical: 15 },
  orderTypeGroup: { flex: 1 },
  orderTypeOptions: { flexDirection: 'row', gap: 6, marginTop: 8 },
  orderTypeOption: { alignItems: 'center', borderRadius: 8, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 36 },
  orderTypeOptionText: { fontFamily: Fonts.sans, fontSize: 10, fontWeight: '800' },
  marginCopy: { alignItems: 'flex-end', minWidth: 88 },
  marginValue: { fontFamily: Fonts.mono, fontSize: 11, fontWeight: '700', marginTop: 12 },
  parameterGrid: { flexDirection: 'row', gap: 10 },
  parameterCard: { borderRadius: Radii.card, borderWidth: 1, flex: 1, padding: 12 },
  parameterLabel: { fontFamily: Fonts.mono, fontSize: 9, letterSpacing: 0.7 },
  inlineOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 10 },
  inlineOption: { borderRadius: 7, minWidth: 46, paddingHorizontal: 8, paddingVertical: 8 },
  inlineOptionText: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '800', textAlign: 'center' },
  limitRow: { alignItems: 'center', borderRadius: Radii.card, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 62, paddingHorizontal: 14 },
  limitComposer: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 18, paddingTop: 20 },
  limitInput: { flex: 1, fontFamily: Fonts.mono, fontSize: 30, fontWeight: '700', padding: 0 },
  leverageSection: { marginTop: 22 },
  leverageHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  leverageTitle: { fontFamily: Fonts.sans, fontSize: 12, fontWeight: '700' },
  leverageMeta: { fontFamily: Fonts.mono, fontSize: 9 },
  leverageOptions: { flexDirection: 'row', gap: 7, marginTop: 12 },
  leverageOption: { alignItems: 'center', borderRadius: 8, flex: 1, justifyContent: 'center', minHeight: 40 },
  leverageOptionText: { fontFamily: Fonts.mono, fontSize: 10, fontWeight: '800' },
  riskLedger: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 26 },
  riskFocus: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 16, paddingTop: 18 },
  riskFocusLabel: { fontFamily: Fonts.sans, fontSize: 11 },
  riskFocusValue: { fontFamily: Fonts.mono, fontSize: 24, fontWeight: '700', letterSpacing: -0.8, marginTop: 7 },
  riskFocusMeta: { fontFamily: Fonts.sans, fontSize: 10, lineHeight: 15, marginTop: 7 },
  riskRow: { alignItems: 'center', flexDirection: 'row', gap: 16, justifyContent: 'space-between', minHeight: 44 },
  riskRowLabel: { flex: 1, fontFamily: Fonts.sans, fontSize: 11 },
  riskRowValue: { flex: 1.4, fontFamily: Fonts.mono, fontSize: 10, fontWeight: '700', textAlign: 'right' },
  riskStrip: { borderRadius: Radii.card, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', padding: 14 },
  riskLabel: { fontFamily: Fonts.mono, fontSize: 8 },
  riskValue: { fontFamily: Fonts.sans, fontSize: 12, fontWeight: '700', marginTop: 5 },
  reviewCard: { borderBottomWidth: StyleSheet.hairlineWidth, borderTopWidth: StyleSheet.hairlineWidth, overflow: 'hidden', paddingVertical: 18 },
  reviewHeading: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 12 },
  reviewEyebrow: { fontFamily: Fonts.mono, fontSize: 9, letterSpacing: 1 },
  reviewTitle: { fontFamily: Fonts.sans, fontSize: 20, fontWeight: '700', marginTop: 5 },
  reviewExpiry: { fontFamily: Fonts.mono, fontSize: 9, marginTop: 2 },
  reviewRiskFocus: { borderRadius: Radii.control, marginBottom: 12, padding: 14 },
  reviewRiskValue: { fontFamily: Fonts.mono, fontSize: 28, fontWeight: '700', marginTop: 7 },
  ledgerRow: { alignItems: 'flex-start', borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12 },
  ledgerLabel: { flex: 1, fontFamily: Fonts.sans, fontSize: 12 },
  ledgerValue: { flex: 1.3, fontFamily: Fonts.mono, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  signatureRail: { alignItems: 'center', borderRadius: Radii.control, flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, padding: 12 },
  signatureRailLabel: { fontFamily: Fonts.mono, fontSize: 9, letterSpacing: 0.8 },
  signatureRailValue: { fontFamily: Fonts.mono, fontSize: 12, fontWeight: '700' },
  stateCard: { borderRadius: Radii.card, borderWidth: 1, padding: 18 },
  stateEyebrow: { fontFamily: Fonts.mono, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  stateTitle: { fontFamily: Fonts.serif, fontSize: 23, fontWeight: '700', marginTop: 8 },
  stateBody: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 20, marginTop: 9 },
  signatureText: { fontFamily: Fonts.mono, fontSize: 10, lineHeight: 16, marginTop: 14 },
  resultAmounts: { borderBottomWidth: StyleSheet.hairlineWidth, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 16 },
  secondaryButton: { alignItems: 'center', borderRadius: Radii.control, borderWidth: 1, justifyContent: 'center', marginTop: 16, minHeight: 46 },
  secondaryButtonText: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '800' },
  notice: { borderRadius: Radii.control, borderWidth: 1, padding: 12 },
  noticeText: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18 },
  disclosure: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 20, paddingTop: 14 },
  disclosureText: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 17 },
  actionDock: { borderTopWidth: StyleSheet.hairlineWidth, flexShrink: 0, paddingHorizontal: 18, paddingTop: 10 },
  primaryButton: { alignItems: 'center', borderRadius: Radii.card, justifyContent: 'center', minHeight: 56, paddingHorizontal: 18 },
  primaryButtonText: { fontFamily: Fonts.sans, fontSize: 15, fontWeight: '800' },
  reviewActions: { flexDirection: 'row', gap: 10 },
  editButton: { alignItems: 'center', borderRadius: Radii.card, borderWidth: 1, justifyContent: 'center', minHeight: 56, width: 88 },
  editButtonText: { fontFamily: Fonts.sans, fontSize: 14, fontWeight: '800' },
  approveButtonWrap: { flex: 1 },
  pressed: { opacity: 0.78 },
  modalBackdrop: { backgroundColor: 'rgba(0,0,0,0.52)', flex: 1, justifyContent: 'flex-end' },
  pickerSheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, height: '82%', padding: 16 },
  pickerHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  pickerEyebrow: { fontFamily: Fonts.mono, fontSize: 9, letterSpacing: 1 },
  pickerTitle: { fontFamily: Fonts.serif, fontSize: 22, fontWeight: '700', marginTop: 4 },
  closeButton: { alignItems: 'center', borderRadius: Radii.pill, borderWidth: 1, height: 38, justifyContent: 'center', width: 38 },
  closeGlyph: { fontFamily: Fonts.sans, fontSize: 24, lineHeight: 26 },
  searchInput: { borderRadius: Radii.control, borderWidth: 1, fontFamily: Fonts.sans, fontSize: 15, height: 54, marginTop: 16, paddingHorizontal: 15 },
  pickerLoader: { marginVertical: 12 },
  assetList: { marginTop: 8 },
  assetRow: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 11, minHeight: 68 },
  assetLogo: { alignItems: 'center', borderRadius: 10, height: 40, justifyContent: 'center', overflow: 'hidden', width: 40 },
  assetLogoImage: { height: 40, width: 40 },
  assetLogoText: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '800' },
  assetRowCopy: { flex: 1 },
  assetName: { fontFamily: Fonts.sans, fontSize: 14, fontWeight: '700' },
  assetMint: { fontFamily: Fonts.mono, fontSize: 9, marginTop: 3 },
  assetRowEnd: { alignItems: 'flex-end' },
  assetSymbol: { fontFamily: Fonts.mono, fontSize: 13, fontWeight: '700' },
  assetVerified: { fontFamily: Fonts.sans, fontSize: 9, marginTop: 3 },
  emptyText: { fontFamily: Fonts.sans, fontSize: 13, paddingVertical: 28, textAlign: 'center' },
  stateFill: { flex: 1 },
  stateBack: { marginLeft: 14, marginTop: 8, width: 44 },
  centerState: { alignItems: 'center', flex: 1, gap: 14, justifyContent: 'center', padding: 24 },
  centerStateText: { fontFamily: Fonts.serif, fontSize: 20, textAlign: 'center' },
});
