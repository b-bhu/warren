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
  const [productPickerVisible, setProductPickerVisible] = useState(false);
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
  const requestedInstrumentId = first(params.instrumentId);
  const requestedInstrument = company?.instruments.find((instrument) => instrument.instrumentId === requestedInstrumentId);
  const requestedProduct = first(params.product);
  // Reject stale or mismatched entry links before choosing either trade product.
  const invalidInstrumentLink = Boolean(requestedInstrumentId && company && (
    !requestedInstrument
    || (!isAvailableSpot(requestedInstrument) && !isAvailablePerpetual(requestedInstrument))
    || ((requestedProduct === 'spot' || requestedProduct === 'perpetual') && requestedInstrument.productType !== requestedProduct)
  ));
  const spotInstrument = invalidInstrumentLink ? undefined : chooseInstrument(spotInstruments, requestedInstrumentId);
  const perpetualInstrument = invalidInstrumentLink ? undefined : chooseInstrument(perpetualInstruments, requestedInstrumentId);
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
    if (next === product || isReviewing || phase === 'signing') return;
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
  const reviewVisible = Boolean(review) && (phase === 'review' || phase === 'signing');

  return (
    <View style={[styles.screen, { backgroundColor: theme.canvas }]}>
      <SafeAreaView aria-hidden={pickerVisible || productPickerVisible || reviewVisible} edges={['top', 'left', 'right']} style={styles.safeArea}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboardFrame}>
          <View style={[styles.header, { borderBottomColor: `${theme.muted}33` }]}>
            <Pressable accessibilityLabel="Go back" accessibilityRole="button" hitSlop={10} onPress={goBack} style={styles.backButton}>
              <Text style={[styles.backGlyph, { color: theme.ink }]}>‹</Text>
            </Pressable>
            <View style={styles.headerCopy}>
              <Text numberOfLines={1} style={[styles.headerTitle, { color: theme.ink }]}>{company.company.companyName}</Text>
              <Text numberOfLines={1} style={[styles.headerMeta, { color: theme.muted }]}>
                {activeInstrument ? `${activeInstrument.symbol} · ${formatMoney(activeInstrument.marketValue.amount)}` : 'No executable instrument'}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Choose trade product"
              accessibilityRole="button"
              accessibilityState={{ disabled: (!canSpot && !canPerpetual) || isReviewing || phase === 'signing', expanded: productPickerVisible }}
              disabled={(!canSpot && !canPerpetual) || isReviewing || phase === 'signing'}
              onPress={() => setProductPickerVisible(true)}
              style={[styles.headerProductSwitch, { backgroundColor: theme.surface, borderColor: theme.outline }]}>
              <Text style={[styles.headerProductText, { color: theme.proof }]}>{product === 'perpetual' ? 'Perpetual' : 'Spot'}</Text>
              <Text style={[styles.headerProductChevron, { color: theme.proof }]}>⌄</Text>
            </Pressable>
          </View>

          <ScrollView
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
            contentContainerStyle={styles.content}
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.scroll}>
            {phase === 'configure' || reviewVisible ? (
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
                {!activeInstrument ? <Notice text={invalidInstrumentLink ? 'The instrument in this trade link is unavailable. Return to Markets to choose an available instrument.' : 'This company has no verified executable instrument right now.'} /> : null}
                {product === 'spot' && settlementRestoreState === 'loading' ? <Notice text="Restoring your saved settlement asset…" /> : null}
                {product === 'spot' && settlementRestoreState === 'failed' ? <Notice text="Your saved settlement asset could not be restored. Choose another asset before review." tone="caution" /> : null}
              </>
            ) : null}

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

          <View style={[styles.actionDock, { backgroundColor: theme.canvas, borderTopColor: `${theme.muted}33`, paddingBottom: insets.bottom + 12 }]}>
            {phase === 'configure' ? (
              <PrimaryButton
                disabled={configureDisabled}
                label={configureLabel}
                loading={isReviewing || settlementLoading}
                onPress={() => settlementFailed ? setPickerVisible(true) : void continueToReview()}
                tone={cautionAction ? 'caution' : 'proof'}
              />
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
      <ProductPicker
        canPerpetual={canPerpetual}
        canSpot={canSpot}
        onClose={() => setProductPickerVisible(false)}
        onSelect={(next) => {
          setProductPickerVisible(false);
          selectProduct(next);
        }}
        selected={product}
        visible={productPickerVisible}
      />
      {review && (phase === 'review' || phase === 'signing') ? (
        <ReviewSheet
          companyName={company.company.companyName}
          error={error}
          onApprove={() => void approve()}
          onClose={resetReview}
          phase={phase}
          review={review}
        />
      ) : null}
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
      <View style={styles.amountCard}>
        <View style={styles.amountHeader}>
          <Text style={[styles.amountLabel, { color: theme.ink }]}>{direction === 'buy' ? 'You pay' : 'You sell'}</Text>
          <Text style={[styles.amountHint, { color: theme.muted }]}>Quote fetched at review</Text>
        </View>
        <View style={styles.amountEntry}>
          <TextInput
            accessibilityLabel={`Amount of ${inputSymbol}`}
            autoCorrect={false}
            keyboardType="decimal-pad"
            onChangeText={onAmount}
            placeholder="0.00"
            placeholderTextColor={theme.outline}
            selectionColor={theme.proof}
            style={[styles.amountInput, { borderBottomColor: theme.outline, color: theme.ink }]}
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
        <Text style={[styles.conversionArrow, { backgroundColor: theme.canvas, borderColor: theme.outline, color: theme.muted }]}>↓</Text>
      </View>
      <View style={[styles.receiveCard, { backgroundColor: theme.surface, borderColor: theme.outline }]}>
        <Text style={[styles.receiveLabel, { color: theme.muted }]}>You receive</Text>
        <View style={styles.receiveValueRow}>
          <Text style={[styles.receivePending, { color: theme.ink }]}>Quote at confirmation</Text>
          <AssetUnit
            onPress={direction === 'sell' ? onOpenPicker : undefined}
            symbol={outputSymbol}
          />
        </View>
        <Text style={[styles.contextOnly, { color: theme.muted }]}>A fresh Jupiter quote will show the exact route, fees and minimum received before wallet approval.</Text>
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
  const exposure = validateBaseUnitAmount(amount, 6).state === 'valid' ? Number(amount) * leverage : null;
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
      <Text style={[styles.directionHelp, { color: theme.muted }]}>{direction === 'long' ? 'Long benefits when the price rises.' : 'Short benefits when the price falls.'}</Text>
      <View style={styles.amountCard}>
        <View style={styles.amountHeader}>
          <Text style={[styles.amountLabel, { color: theme.ink }]}>Your collateral</Text>
          <Text style={[styles.amountHint, { color: theme.muted }]}>Isolated collateral</Text>
        </View>
        <View style={styles.amountEntry}>
          <TextInput
            accessibilityLabel="USDC collateral amount"
            autoCorrect={false}
            keyboardType="decimal-pad"
            onChangeText={onAmount}
            placeholder="0.00"
            placeholderTextColor={theme.outline}
            selectionColor={theme.proof}
            style={[styles.amountInput, { borderBottomColor: theme.outline, color: theme.ink }]}
            value={amount}
          />
          <AssetUnit symbol="USDC" />
        </View>
        {amountValidationMessage ? <Text accessibilityLiveRegion="polite" style={[styles.fieldError, { color: theme.caution }]}>{amountValidationMessage}</Text> : null}
      </View>
      <View style={styles.perpConfig}>
        <View style={styles.orderTypeGroup}>
          <Text style={[styles.parameterLabel, { color: theme.ink }]}>Order type</Text>
          <View style={styles.orderTypeOptions}>
            {(['market', 'limit'] as const).map((value) => (
              <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: orderType === value }} onPress={() => onOrderType(value)} style={[styles.orderTypeOption, { backgroundColor: orderType === value ? theme.proofWash : theme.surface, borderColor: orderType === value ? theme.proof : `${theme.muted}33` }]}>
                <Text style={[styles.orderTypeOptionText, { color: orderType === value ? theme.proof : theme.muted }]}>{title(value)}</Text>
              </Pressable>
            ))}
          </View>
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
              <Pressable key={value} accessibilityRole="button" accessibilityLabel={`${value} times leverage`} accessibilityState={{ selected: active }} onPress={() => onLeverage(value)} style={[styles.leverageOption, { backgroundColor: active ? theme.proofWash : theme.surface, borderColor: active ? theme.proof : `${theme.muted}33` }]}>
                <Text style={[styles.leverageOptionText, { color: active ? theme.proof : theme.ink }]}>{value}×</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <Text style={[styles.exposureLine, { color: theme.proof }]}>{exposure !== null && Number.isFinite(exposure) ? `${formatMoney(exposure)} estimated position · ${leverage}× your collateral` : 'Enter collateral to see your position size'}</Text>
      <View style={[styles.riskLedger, { borderTopColor: theme.outline }]}>
        <View style={styles.riskFocus}>
          <Text style={[styles.riskFocusLabel, { color: theme.muted }]}>Estimated liquidation</Text>
          <Text style={[styles.riskFocusValue, { color: theme.ink }]}>Shown at confirmation</Text>
          <Text style={[styles.riskFocusMeta, { color: theme.muted }]}>Leverage increases gains and losses. You can lose your collateral.</Text>
        </View>
      </View>
    </View>
  );
}

function ReviewLedger({ review }: { review: Review }) {
  const theme = useTheme();
  const spot = review.product === 'spot';
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
    <View style={styles.reviewCard}>
      <View style={styles.reviewHero}>
        <Text style={[styles.reviewHeroLabel, { color: theme.muted }]}>{spot ? (review.direction === 'buy' ? 'You pay' : 'You sell') : `Position · ${review.leverage}×`}</Text>
        <Text style={[styles.reviewHeroValue, { color: theme.ink }]}>{spot ? formatToken(review.input.amount, review.input.decimals, review.input.symbol) : formatMoney(review.notionalUsd)}</Text>
        {!spot ? <Text style={[styles.reviewHeroMeta, { color: theme.muted }]}>{review.quantity} {review.marketSymbol} exposure</Text> : null}
      </View>
      {spot ? (
        <View style={[styles.reviewReceive, { backgroundColor: theme.surface, borderColor: theme.outline }]}>
          <Text style={[styles.reviewReceiveLabel, { color: theme.muted }]}>You receive · estimated</Text>
          <Text style={[styles.reviewReceiveValue, { color: theme.ink }]}>{formatToken(review.output.amount, review.output.decimals, review.output.symbol)}</Text>
          <Text style={[styles.reviewReceiveMeta, { color: theme.muted }]}>Minimum {formatToken(review.minimumOutputAmount, review.output.decimals, review.output.symbol)}</Text>
        </View>
      ) : (
        <View style={[styles.reviewRiskFocus, { backgroundColor: theme.cautionWash, borderColor: theme.caution }]}>
          <Text style={[styles.riskFocusLabel, { color: theme.caution }]}>Estimated liquidation</Text>
          <Text style={[styles.reviewRiskValue, { color: theme.caution }]}>{formatMoney(review.estimatedLiquidationPriceUsd)}</Text>
          <Text style={[styles.riskFocusMeta, { color: theme.muted }]}>Based on the current Phoenix review. It can change before execution.</Text>
        </View>
      )}
      <View style={[styles.reviewLedger, { backgroundColor: theme.surface, borderColor: theme.outline }]}>
        {rows.map(([label, value]) => (
          <View key={label} style={[styles.ledgerRow, { borderBottomColor: theme.outline }]}>
            <Text style={[styles.ledgerLabel, { color: theme.muted }]}>{label}</Text>
            <Text style={[styles.ledgerValue, { color: theme.ink }]}>{value}</Text>
          </View>
        ))}
      </View>
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
            <View style={styles.sheetTitleCopy}>
              <Text style={[styles.pickerEyebrow, { color: theme.proof }]}>Jupiter assets</Text>
              <Text style={[styles.pickerTitle, { color: theme.ink }]}>Choose {context} asset</Text>
            </View>
            <Pressable accessibilityLabel="Close asset picker" accessibilityRole="button" onPress={onClose} style={[styles.closeButton, { borderColor: theme.outline }]}><Text style={[styles.closeGlyph, { color: theme.ink }]}>×</Text></Pressable>
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
              <Pressable key={asset.mint} accessibilityRole="button" accessibilityLabel={`${asset.symbol}, ${asset.name}`} accessibilityState={{ selected: asset.mint === selectedMint }} onPress={() => onSelect(asset)} style={[styles.assetRow, { borderBottomColor: theme.outline }]}>
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

function ProductPicker({ canPerpetual, canSpot, onClose, onSelect, selected, visible }: {
  canPerpetual: boolean;
  canSpot: boolean;
  onClose: () => void;
  onSelect: (product: Product) => void;
  selected: Product;
  visible: boolean;
}) {
  const theme = useTheme();
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalBackdrop}>
        <SafeAreaView edges={['bottom']} style={[styles.productSheet, { backgroundColor: theme.canvas, borderColor: theme.outline }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.pickerHeader}>
            <View style={styles.sheetTitleCopy}>
              <Text style={[styles.pickerEyebrow, { color: theme.proof }]}>Trade product</Text>
              <Text style={[styles.pickerTitle, { color: theme.ink }]}>Choose a market</Text>
            </View>
            <Pressable accessibilityLabel="Close product picker" accessibilityRole="button" onPress={onClose} style={[styles.closeButton, { borderColor: theme.outline }]}>
              <Text style={[styles.closeGlyph, { color: theme.ink }]}>×</Text>
            </Pressable>
          </View>
          <View style={styles.productSheetOptions}>
            {canSpot ? <ProductChoice active={selected === 'spot'} label="Spot" note="Buy or sell the verified stock token" onPress={() => onSelect('spot')} /> : null}
            {canPerpetual ? <ProductChoice active={selected === 'perpetual'} label="Perpetual" note="Long or short with isolated collateral" onPress={() => onSelect('perpetual')} /> : null}
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function ProductChoice({ active, label, note, onPress }: { active: boolean; label: string; note: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.productChoice, { backgroundColor: active ? theme.proofWash : theme.surface, borderColor: active ? theme.proof : theme.outline }]}>
      <View style={styles.productChoiceCopy}>
        <Text style={[styles.productChoiceTitle, { color: theme.ink }]}>{label}</Text>
        <Text style={[styles.productChoiceNote, { color: theme.muted }]}>{note}</Text>
      </View>
      <Text style={[styles.productChoiceMark, { color: active ? theme.proof : theme.muted }]}>{active ? '✓' : '›'}</Text>
    </Pressable>
  );
}

function ReviewSheet({ companyName, error, onApprove, onClose, phase, review }: {
  companyName: string;
  error?: string;
  onApprove: () => void;
  onClose: () => void;
  phase: Phase;
  review: Review;
}) {
  const theme = useTheme();
  const caution = review.direction === 'sell' || review.direction === 'short';
  const signing = phase === 'signing';
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const secondsRemaining = Math.max(0, Math.ceil((new Date(review.expiresAt).getTime() - now) / 1_000));
  const requestClose = signing ? () => undefined : onClose;
  return (
    <Modal animationType="slide" onRequestClose={requestClose} transparent visible={phase === 'review' || signing}>
      <View style={styles.modalBackdrop}>
        <SafeAreaView edges={['bottom']} style={[styles.reviewSheet, { backgroundColor: theme.canvas, borderColor: theme.outline }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.reviewSheetHeader}>
            <View style={styles.sheetTitleCopy}>
              <Text style={[styles.pickerEyebrow, { color: theme.proof }]}>Review order</Text>
              <Text style={[styles.reviewSheetTitle, { color: theme.ink }]}>{title(review.direction)} {companyName}</Text>
            </View>
            <Pressable accessibilityLabel="Edit trade" accessibilityRole="button" disabled={signing} onPress={onClose} style={[styles.editButton, { borderColor: theme.outline, opacity: signing ? 0.45 : 1 }]}>
              <Text style={[styles.editButtonText, { color: theme.ink }]}>Edit</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.reviewSheetContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <ReviewLedger review={review} />
            {error ? <Notice text={error} tone="caution" /> : null}
          </ScrollView>
          <View style={[styles.reviewSheetFooter, { borderTopColor: `${theme.muted}33` }]}>
            <Text style={[styles.reviewSheetHint, { color: secondsRemaining ? theme.muted : theme.caution }]}>{secondsRemaining ? `Quote expires in ${secondsRemaining}s · ${formatTime(review.expiresAt)}` : 'Quote expired. Edit the trade to get a fresh review.'}</Text>
            <PrimaryButton label={signing ? 'Waiting for wallet…' : approveLabel(review)} loading={signing} onPress={onApprove} tone={caution ? 'caution' : 'proof'} />
          </View>
        </SafeAreaView>
      </View>
    </Modal>
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
            style={[styles.directionOption, active && { backgroundColor: caution ? theme.cautionWash : theme.proofWash, borderColor: caution ? theme.caution : theme.proof }]}>
            <Text style={[styles.directionOptionText, { color: active ? theme.ink : theme.muted }]}>{item.label}</Text>
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
    ? <Pressable accessibilityLabel={`Choose asset, currently ${symbol}`} accessibilityRole="button" onPress={onPress} style={[styles.assetUnit, { backgroundColor: theme.surface, borderColor: `${theme.muted}33` }]}>{content}</Pressable>
    : <View style={[styles.assetUnit, { backgroundColor: theme.surface, borderColor: `${theme.muted}33` }]}>{content}</View>;
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
  return `Confirm ${review.direction}`;
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
  sheetTitleCopy: { flex: 1, minWidth: 0, paddingRight: 12 },
  screen: { flex: 1 },
  safeArea: { alignSelf: 'center', flex: 1, maxWidth: 680, width: '100%' },
  keyboardFrame: { flex: 1 },
  scroll: { flex: 1 },
  header: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 60, paddingHorizontal: Spacing.three },
  backButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 38 },
  backGlyph: { fontFamily: Fonts.sans, fontSize: 35, fontWeight: '300', lineHeight: 38 },
  headerCopy: { flex: 1, minWidth: 0, paddingHorizontal: 8 },
  headerTitle: { fontFamily: Fonts.sans, fontSize: 18, fontWeight: '500', letterSpacing: -0.3 },
  headerMeta: { fontFamily: Fonts.sans, fontSize: 11, marginTop: 2 },
  headerProductSwitch: { alignItems: 'center', borderRadius: Radii.control, borderWidth: 1, flexDirection: 'row', gap: 7, minHeight: 44, paddingHorizontal: 12 },
  headerProductText: { fontFamily: Fonts.sans, fontSize: 12 },
  headerProductChevron: { fontFamily: Fonts.sans, fontSize: 15, lineHeight: 16 },
  content: { paddingBottom: 28, paddingHorizontal: 18 },
  directionToggle: { borderRadius: 12, flexDirection: 'row', gap: 4, marginTop: 18, padding: 4 },
  directionOption: { alignItems: 'center', borderRadius: 9, borderWidth: 1, borderColor: 'transparent', flex: 1, justifyContent: 'center', minHeight: 42 },
  directionOptionText: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '500' },
  ticketStack: { paddingBottom: 6 },
  amountCard: { marginTop: 22 },
  amountHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  amountLabel: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18 },
  amountHint: { flexShrink: 1, fontFamily: Fonts.sans, fontSize: 11, marginLeft: 12 },
  amountEntry: { alignItems: 'center', flexDirection: 'row', gap: 12, marginTop: 10 },
  fieldError: { fontFamily: Fonts.sans, fontSize: 10, lineHeight: 15, marginTop: 7 },
  amountInput: { borderBottomWidth: 1, flex: 1, minWidth: 0, fontFamily: Fonts.mono, fontSize: 36, fontWeight: '500', letterSpacing: -1.5, minHeight: 62, paddingVertical: 10, paddingHorizontal: 0 },
  assetUnit: { alignItems: 'center', borderRadius: 999, borderWidth: 1, flexShrink: 0, justifyContent: 'center', minHeight: 44, maxWidth: 118, paddingHorizontal: 13 },
  assetUnitText: { fontFamily: Fonts.sans, fontSize: 13 },
  conversionSpine: { alignItems: 'center', height: 42, justifyContent: 'center', marginVertical: 5 },
  conversionArrow: { alignItems: 'center', borderRadius: Radii.pill, borderWidth: 1, fontFamily: Fonts.sans, fontSize: 16, height: 30, lineHeight: 27, textAlign: 'center', width: 30 },
  receiveCard: { borderRadius: 14, borderWidth: 1, padding: 18 },
  receiveLabel: { fontFamily: Fonts.sans, fontSize: 11 },
  receiveValueRow: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between', marginTop: 8 },
  receivePending: { flex: 1, fontFamily: Fonts.sans, fontSize: 15, fontWeight: '500', lineHeight: 22 },
  contextOnly: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 17, marginTop: 9 },
  perpConfig: { marginTop: 22 },
  orderTypeGroup: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  orderTypeOptions: { flexDirection: 'row', gap: 6 },
  orderTypeOption: { alignItems: 'center', borderRadius: 10, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 14 },
  orderTypeOptionText: { fontFamily: Fonts.sans, fontSize: 12 },
  parameterLabel: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '500' },
  limitComposer: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 18, paddingTop: 20 },
  limitInput: { flex: 1, minWidth: 0, fontFamily: Fonts.mono, fontSize: 25, fontWeight: '500', padding: 0 },
  leverageSection: { marginTop: 22 },
  leverageHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  leverageTitle: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '500' },
  leverageMeta: { fontFamily: Fonts.sans, fontSize: 11 },
  leverageOptions: { flexDirection: 'row', gap: 7, marginTop: 12 },
  leverageOption: { alignItems: 'center', borderRadius: 10, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 44 },
  leverageOptionText: { fontFamily: Fonts.mono, fontSize: 13 },
  riskLedger: { borderTopColor: '#51615C', borderTopWidth: StyleSheet.hairlineWidth, marginTop: 26, paddingTop: 17 },
  riskFocus: { paddingBottom: 2 },
  riskFocusLabel: { fontFamily: Fonts.sans, fontSize: 11 },
  riskFocusValue: { fontFamily: Fonts.sans, fontSize: 16, fontWeight: '500', marginTop: 7 },
  riskFocusMeta: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 19, marginTop: 13 },
  riskRow: { alignItems: 'center', flexDirection: 'row', gap: 16, justifyContent: 'space-between', minHeight: 44 },
  riskRowLabel: { flex: 1, fontFamily: Fonts.sans, fontSize: 11 },
  riskRowValue: { flex: 1.4, fontFamily: Fonts.mono, fontSize: 10, fontWeight: '700', textAlign: 'right' },
  reviewCard: { overflow: 'hidden', paddingBottom: 5, paddingTop: 3 },
  reviewHero: { marginBottom: 14, paddingVertical: 4 },
  reviewHeroLabel: { fontFamily: Fonts.sans, fontSize: 11 },
  reviewHeroValue: { fontFamily: Fonts.mono, fontSize: 25, fontWeight: '500', letterSpacing: -0.7, marginTop: 7 },
  reviewHeroMeta: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 16, marginTop: 4 },
  reviewReceive: { borderRadius: Radii.card, borderWidth: 1, marginBottom: 14, padding: 16 },
  reviewReceiveLabel: { fontFamily: Fonts.sans, fontSize: 11 },
  reviewReceiveValue: { fontFamily: Fonts.mono, fontSize: 24, fontWeight: '500', letterSpacing: -0.6, marginTop: 7 },
  reviewReceiveMeta: { fontFamily: Fonts.sans, fontSize: 11, marginTop: 5 },
  reviewLedger: { borderRadius: Radii.card, borderWidth: 1, marginBottom: 14, overflow: 'hidden' },
  reviewRiskFocus: { borderRadius: Radii.card, borderWidth: 1, marginBottom: 14, padding: 14 },
  reviewRiskValue: { fontFamily: Fonts.mono, fontSize: 28, fontWeight: '700', marginTop: 7 },
  ledgerRow: { alignItems: 'flex-start', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12 },
  ledgerLabel: { flex: 1, fontFamily: Fonts.sans, fontSize: 12 },
  ledgerValue: { flex: 1.3, fontFamily: Fonts.sans, fontSize: 12, fontWeight: '500', lineHeight: 18, textAlign: 'right' },
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
  primaryButton: { alignItems: 'center', borderRadius: 12, justifyContent: 'center', minHeight: 49, paddingHorizontal: 18 },
  primaryButtonText: { fontFamily: Fonts.sans, fontSize: 14, fontWeight: '600' },
  editButton: { alignItems: 'center', borderRadius: 12, borderWidth: 1, justifyContent: 'center', minHeight: 44, width: 64 },
  editButtonText: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.78 },
  modalBackdrop: { backgroundColor: 'rgba(0,0,0,0.52)', flex: 1, justifyContent: 'flex-end' },
  sheetHandle: { alignSelf: 'center', backgroundColor: '#51615C', borderRadius: Radii.pill, height: 4, marginBottom: 8, width: 36 },
  productSheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, padding: 16 },
  productSheetOptions: { gap: 10, paddingBottom: 8, paddingTop: 8 },
  productChoice: { alignItems: 'center', borderRadius: Radii.card, borderWidth: 1, flexDirection: 'row', minHeight: 72, paddingHorizontal: 14 },
  productChoiceCopy: { flex: 1 },
  productChoiceTitle: { fontFamily: Fonts.sans, fontSize: 14, fontWeight: '500' },
  productChoiceNote: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 16, marginTop: 4 },
  productChoiceMark: { fontFamily: Fonts.sans, fontSize: 22, marginLeft: 10 },
  reviewSheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, maxHeight: '88%', paddingHorizontal: 18, paddingTop: 9 },
  reviewSheetHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  reviewSheetTitle: { fontFamily: Fonts.sans, fontSize: 20, fontWeight: '500', marginTop: 4 },
  reviewSheetContent: { paddingBottom: 8 },
  reviewSheetFooter: { borderTopWidth: StyleSheet.hairlineWidth, paddingBottom: 12, paddingTop: 11 },
  reviewSheetHint: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 16, marginBottom: 9 },
  pickerSheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, height: '82%', padding: 16 },
  pickerHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  pickerEyebrow: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '600', letterSpacing: 0.2 },
  pickerTitle: { fontFamily: Fonts.sans, fontSize: 20, fontWeight: '500', marginTop: 4 },
  closeButton: { alignItems: 'center', borderRadius: 12, borderWidth: 1, height: 44, justifyContent: 'center', width: 44 },
  closeGlyph: { fontFamily: Fonts.sans, fontSize: 24, lineHeight: 26 },
  searchInput: { borderRadius: Radii.control, borderWidth: 1, fontFamily: Fonts.sans, fontSize: 15, height: 54, marginTop: 16, paddingHorizontal: 15 },
  pickerLoader: { marginVertical: 12 },
  assetList: { marginTop: 8 },
  assetRow: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 11, minHeight: 73 },
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
  exposureLine: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 19, marginTop: 15 },
  directionHelp: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18, marginTop: 11 },
});
