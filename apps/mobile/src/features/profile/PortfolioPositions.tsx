import type {
  PortfolioCashBalance,
  PortfolioHolding,
  PortfolioOrder,
  PortfolioPosition,
  PortfolioPositionsResponse,
  PortfolioWarning,
} from '@warren/portfolio-contract';
import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
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

import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { loadPortfolioPositions, PortfolioRequestError } from './portfolio-api';
import { PhoenixRecoveryPanel } from './PhoenixRecoveryPanel';
import { isPhoenixRecoveryWarning } from './phoenix-recovery';
import { portfolioFailureState, type PortfolioLoadState } from './portfolio-load-state';
import {
  fundingSummary,
  holdingsCountLabel,
  liquidationSummary,
  positionsIsEmpty,
} from './portfolio-positions-view-model';
import {
  dataStateLabel,
  formatNullableUsd,
  formatPortfolioMoney,
  formatPortfolioPercent,
  formatUpdatedAt,
  portfolioAccountPresentationState,
} from './portfolio-view-model';

type PositionDetail =
  | { kind: 'order'; value: PortfolioOrder }
  | { kind: 'position'; value: PortfolioPosition }
  | null;

type PositionFilter = 'all' | 'holdings' | 'perpetuals' | 'orders';

const POSITION_FILTERS: { label: string; value: PositionFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Holdings', value: 'holdings' },
  { label: 'Perpetuals', value: 'perpetuals' },
  { label: 'Orders', value: 'orders' },
];

export function PortfolioPositions({
  getAccessToken,
  onOpenCompany,
  onSignInAgain,
  onRefreshSettled,
  refreshVersion = 0,
  signTransaction,
  walletAddress,
}: {
  getAccessToken: () => Promise<string>;
  onOpenCompany: (assetId: string) => void;
  onSignInAgain: () => void;
  onRefreshSettled?: () => void;
  refreshVersion?: number;
  signTransaction: (unsignedTransaction: string) => Promise<string>;
  walletAddress: string;
}) {
  const theme = useTheme();
  const [requestVersion, setRequestVersion] = useState(0);
  const [state, setState] = useState<PortfolioLoadState<PortfolioPositionsResponse>>({ phase: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    void loadPortfolioPositions({ getAccessToken, signal: controller.signal, walletAddress })
      .then((data) => {
        if (!controller.signal.aborted) {
          setState({ data, phase: 'ready', refreshing: false });
          onRefreshSettled?.();
        }
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') return;
        const safeError = error instanceof PortfolioRequestError
          ? error
          : new PortfolioRequestError('Warren could not refresh your positions. Pull down to try again.', 'service', true);
        if (!controller.signal.aborted) {
          setState((current) => portfolioFailureState(current, safeError));
          onRefreshSettled?.();
        }
      });
    return () => controller.abort();
  }, [getAccessToken, onRefreshSettled, refreshVersion, requestVersion, walletAddress]);

  const refresh = useCallback(() => {
    setState((current) => current.phase === 'ready' ? { ...current, refreshing: true } : { phase: 'loading' });
    setRequestVersion((current) => current + 1);
  }, []);

  if (state.phase === 'loading') {
    return (
      <View accessibilityLiveRegion="polite" style={styles.statePanel}>
        <ActivityIndicator color={theme.proof} size="small" />
        <Text style={[styles.stateTitle, { color: theme.ink }]}>Loading current positions</Text>
        <Text style={[styles.stateBody, { color: theme.muted }]}>Checking Phoenix, supported holdings, and wallet balances.</Text>
      </View>
    );
  }
  if (state.phase === 'error') {
    const reconnect = state.error.failure === 'session' || state.error.failure === 'wallet';
    return (
      <View accessibilityLiveRegion="polite" style={styles.statePanel}>
        <View style={[styles.stateMark, { backgroundColor: theme.cautionWash }]}><Text style={[styles.stateMarkText, { color: theme.caution }]}>!</Text></View>
        <Text style={[styles.stateTitle, { color: theme.ink }]}>{reconnect ? 'Reconnect Portfolio' : 'Positions need a refresh'}</Text>
        <Text style={[styles.stateBody, { color: theme.muted }]}>{state.error.message}</Text>
        <PrimaryButton label={reconnect ? 'Sign in again' : 'Try again'} onPress={reconnect ? onSignInAgain : refresh} />
      </View>
    );
  }

  return (
    <PositionsContent
      data={state.data}
      getAccessToken={getAccessToken}
      onOpenCompany={onOpenCompany}
      onRefresh={refresh}
      refreshError={state.refreshError}
      refreshing={state.refreshing}
      signTransaction={signTransaction}
    />
  );
}

function PositionsContent({
  data,
  getAccessToken,
  onOpenCompany,
  onRefresh,
  refreshError,
  refreshing,
  signTransaction,
}: {
  data: PortfolioPositionsResponse;
  getAccessToken: () => Promise<string>;
  onOpenCompany: (assetId: string) => void;
  onRefresh: () => void;
  refreshError?: string;
  refreshing: boolean;
  signTransaction: (unsignedTransaction: string) => Promise<string>;
}) {
  const theme = useTheme();
  const [detail, setDetail] = useState<PositionDetail>(null);
  const [filter, setFilter] = useState<PositionFilter>('all');
  const gainColor = theme.canvas === '#131918' ? '#8BC4A1' : '#286440';
  const pnlPositive = (data.summary.unrealizedPnlUsd.amount ?? 0) >= 0;
  const hasPhoenixRecovery = data.perpetuals.accountState !== 'ready';
  const visibleWarnings = data.warnings.filter((warning) => !isPhoenixRecoveryWarning(warning));
  const presentationState = portfolioAccountPresentationState(data);

  if (positionsIsEmpty(data) && (presentationState === 'new_wallet' || presentationState === 'phoenix_only')) {
    return (
      <View style={styles.cleanEmpty}>
        <Text style={[styles.emptyKicker, { color: theme.proof }]}>POSITIONS</Text>
        <Text accessibilityRole="header" style={[styles.cleanEmptyTitle, { color: theme.ink }]}>No positions yet.</Text>
        <Text style={[styles.cleanEmptyBody, { color: theme.muted }]}>Owned tokenized stocks, Phoenix positions, and orders waiting to fill will appear here after your first action.</Text>
      </View>
    );
  }

  return (
    <>
      <View accessibilityLabel="Position categories" accessibilityRole="tablist" style={styles.positionFilters}>
        {POSITION_FILTERS.map((option) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: filter === option.value }}
            key={option.value}
            onPress={() => setFilter(option.value)}
            style={({ pressed }) => [
              styles.positionFilter,
              { backgroundColor: filter === option.value ? theme.proofWash : 'transparent', borderColor: filter === option.value ? theme.proof : `${theme.muted}33` },
              pressed && styles.rowPressed,
            ]}>
            <Text style={[styles.positionFilterText, { color: filter === option.value ? theme.proof : theme.muted }]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>

      {presentationState === 'full' && (filter === 'all' || filter === 'perpetuals') ? <View style={styles.exposureBlock}>
        <View style={styles.exposureHeading}>
          <View style={styles.exposureCopy}>
            <Text accessibilityRole="header" style={[styles.exposureTitle, { color: theme.ink }]}>Current exposure</Text>
            <Text style={[styles.exposureBody, { color: theme.muted }]}>Perpetual risk and owned assets stay distinct, even when they belong to the same company.</Text>
          </View>
          <Pressable accessibilityRole="button" disabled={refreshing} onPress={onRefresh}>
            <Text style={[styles.textButton, { color: theme.proof }]}>{refreshing ? 'Refreshing…' : 'Refresh'}</Text>
          </Pressable>
        </View>
        <View style={[styles.summaryGrid, { backgroundColor: theme.surface, borderColor: `${theme.muted}33` }]}>
          <SummaryMetric
            color={data.summary.unrealizedPnlUsd.amount === null ? theme.muted : pnlPositive ? gainColor : theme.caution}
            label="Unrealized PnL"
            state={data.summary.unrealizedPnlUsd.dataState}
            value={formatPortfolioMoney(data.summary.unrealizedPnlUsd, { signed: true })}
          />
          <SummaryMetric
            color={theme.ink}
            label="Gross exposure"
            state={data.summary.grossExposureUsd.dataState}
            value={formatPortfolioMoney(data.summary.grossExposureUsd)}
          />
        </View>
        <Text style={[styles.updatedText, { color: theme.muted }]}>{formatUpdatedAt(data.generatedAt)} · Gross exposure is not owned value.</Text>
      </View> : null}

      {refreshError ? <RefreshNotice error={refreshError} onRefresh={onRefresh} refreshing={refreshing} /> : null}
      {visibleWarnings.length ? <Warnings onRefresh={onRefresh} refreshing={refreshing} warnings={visibleWarnings} /> : null}

      <PhoenixRecoveryPanel
        data={data}
        getAccessToken={getAccessToken}
        onRefresh={onRefresh}
        refreshing={refreshing}
        signTransaction={signTransaction}
      />

      {positionsIsEmpty(data) && !hasPhoenixRecovery ? (
        <View style={[styles.emptyState, { backgroundColor: theme.surface }]}>
          <Text style={[styles.emptyTitle, { color: theme.ink }]}>No current stock exposure</Text>
          <Text style={[styles.emptyBody, { color: theme.muted }]}>Open Phoenix stock positions, orders waiting to fill, and supported Spot or PreStock holdings will appear here.</Text>
        </View>
      ) : null}

      {filter === 'all' || filter === 'orders' ? <Section count={countLabel(data.openOrders.length, 'order')} title="Open orders">
        {data.openOrders.length
          ? data.openOrders.map((order) => <OrderRow key={order.orderId} onPress={() => setDetail({ kind: 'order', value: order })} order={order} />)
          : <EmptyRow message="No orders waiting to fill · not counted as positions" />}
      </Section> : null}

      {filter === 'all' || filter === 'perpetuals' ? <Section count={countLabel(data.openPositions.length, 'perpetual')} title="Open positions">
        {data.openPositions.length
          ? data.openPositions.map((position) => <PositionCard key={position.positionId} onPress={() => setDetail({ kind: 'position', value: position })} position={position} />)
          : <EmptyRow message="No open Phoenix stock positions" />}
      </Section> : null}

      {filter === 'all' || filter === 'holdings' ? <Section count={holdingsCountLabel(data)} title="Holdings">
        {data.holdings.length
          ? <View style={[styles.register, { borderTopColor: `${theme.muted}33` }]}>{data.holdings.map((holding) => <HoldingRow holding={holding} key={holding.holdingId} onPress={() => onOpenCompany(holding.assetId)} />)}</View>
          : <EmptyRow message="No supported Spot or PreStock holdings" />}
      </Section> : null}

      {filter === 'all' || filter === 'holdings' ? <Section count={countLabel(data.cashBalances.length, 'balance')} title="Cash & network balance">
        {data.cashBalances.length
          ? <View style={[styles.register, { borderTopColor: `${theme.muted}33` }]}>{data.cashBalances.map((balance) => <CashRow balance={balance} key={balance.cashId} />)}</View>
          : <EmptyRow message="No cash or network balance yet" />}
      </Section> : null}

      <Text style={[styles.disclosure, { color: theme.muted }]}>Position and order details are read-only in this release.</Text>

      <PositionDetailSheet detail={detail} onClose={() => setDetail(null)} />
    </>
  );
}

function SummaryMetric({ color, label, state, value }: { color: string; label: string; state: PortfolioPositionsResponse['summary']['grossExposureUsd']['dataState']; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.summaryMetric}>
      <Text style={[styles.metricLabel, { color: theme.muted }]}>{label}</Text>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
      <Text style={[styles.metricState, { color: state === 'live' ? theme.proof : theme.caution }]}>{dataStateLabel(state)}</Text>
    </View>
  );
}

function RefreshNotice({ error, onRefresh, refreshing }: { error: string; onRefresh: () => void; refreshing: boolean }) {
  const theme = useTheme();
  return (
    <View accessibilityLiveRegion="polite" style={[styles.noticeRow, { backgroundColor: theme.cautionWash }]}>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: theme.ink }]}>Latest refresh did not finish</Text>
        <Text style={[styles.rowSubtitle, { color: theme.muted }]}>{error} Showing the last successful update.</Text>
      </View>
      <Pressable accessibilityRole="button" disabled={refreshing} onPress={onRefresh}><Text style={[styles.textButton, { color: theme.proof }]}>{refreshing ? 'Refreshing…' : 'Retry'}</Text></Pressable>
    </View>
  );
}

function Warnings({ onRefresh, refreshing, warnings }: { onRefresh: () => void; refreshing: boolean; warnings: PortfolioWarning[] }) {
  const theme = useTheme();
  return (
    <View style={styles.notices}>
      <View style={styles.sectionHeading}>
        <Text style={[styles.noticeTitle, { color: theme.ink }]}>Data notices</Text>
        {warnings.some((warning) => warning.retryable) ? <Pressable accessibilityRole="button" disabled={refreshing} onPress={onRefresh}><Text style={[styles.textButton, { color: theme.proof }]}>{refreshing ? 'Refreshing…' : 'Retry'}</Text></Pressable> : null}
      </View>
      {warnings.map((warning) => (
        <View key={`${warning.section}:${warning.code}`} style={[styles.warningRow, { backgroundColor: theme.cautionWash }]}>
          <Text style={[styles.warningScope, { color: theme.caution }]}>{warningScope(warning)}</Text>
          <Text style={[styles.warningMessage, { color: theme.ink }]}>{warning.message}</Text>
        </View>
      ))}
    </View>
  );
}

function Section({ children, count, title }: { children: React.ReactNode; count: string; title: string }) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.ink }]}>{title}</Text>
        <Text style={[styles.sectionCount, { color: theme.muted }]}>{count}</Text>
      </View>
      {children}
    </View>
  );
}

function OrderRow({ onPress, order }: { onPress: () => void; order: PortfolioOrder }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityLabel={`View ${order.companyName} open order`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.orderRow, { borderColor: `${theme.muted}33` }, pressed && styles.rowPressed]}>
      <Logo logoUrl={order.logoUrl} name={order.companyName} />
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: theme.ink }]}>{capitalize(order.side)} {order.companyName} perpetual</Text>
        <Text style={[styles.rowSubtitle, { color: theme.muted }]}>{order.orderType} · {order.quantity} · {order.priceUsd === null ? 'Market price' : formatNullableUsd(order.priceUsd)}</Text>
      </View>
      <View style={[styles.statusBadge, { backgroundColor: theme.proofWash }]}><Text style={[styles.statusText, { color: theme.proof }]}>{order.status}</Text></View>
    </Pressable>
  );
}

function PositionCard({ onPress, position }: { onPress: () => void; position: PortfolioPosition }) {
  const theme = useTheme();
  const gainColor = theme.canvas === '#131918' ? '#8BC4A1' : '#286440';
  const pnlPositive = (position.unrealizedPnlUsd ?? 0) >= 0;
  return (
    <Pressable
      accessibilityLabel={`View ${position.companyName} ${position.direction} position`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.positionCard, { backgroundColor: theme.surface, borderColor: `${theme.muted}33` }, pressed && styles.rowPressed]}>
      <View style={styles.positionHeader}>
        <Logo logoUrl={position.logoUrl} name={position.companyName} />
        <View style={styles.rowCopy}>
          <Text style={[styles.rowTitle, { color: theme.ink }]}>{position.companyName}</Text>
          <Text style={[styles.rowSubtitle, { color: theme.muted }]}>{position.marketSymbol} · {position.direction.toUpperCase()} · {position.leverage ? `${position.leverage}× ` : ''}{position.marginMode.toUpperCase()}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: theme.proofWash }]}><Text style={[styles.statusText, { color: theme.proof }]}>Open</Text></View>
      </View>
      <View style={styles.positionNumbers}>
        <View style={styles.positionPnlGroup}>
          <Text adjustsFontSizeToFit minimumFontScale={0.75} numberOfLines={1} style={[styles.positionPnl, { color: position.unrealizedPnlUsd === null ? theme.muted : pnlPositive ? gainColor : theme.caution }]}>{formatNullableUsd(position.unrealizedPnlUsd, { signed: true })}</Text>
          {position.unrealizedPnlPercent === null ? null : <Text numberOfLines={1} style={[styles.positionPnlPercent, { color: position.unrealizedPnlUsd === null ? theme.muted : pnlPositive ? gainColor : theme.caution }]}>· {signedPercent(position.unrealizedPnlPercent)}</Text>}
        </View>
        <View style={styles.positionExposure}>
          <Text adjustsFontSizeToFit minimumFontScale={0.8} numberOfLines={1} style={[styles.positionExposureValue, { color: theme.ink }]}>{formatNullableUsd(position.notionalUsd)}</Text>
          <Text style={[styles.positionExposureLabel, { color: theme.muted }]}>exposure</Text>
        </View>
      </View>
      <Text style={[styles.riskLine, { color: theme.muted }]}>Liquidation {liquidationSummary(position)} · {fundingSummary(position)}</Text>
      <Text style={[styles.viewDetail, { color: theme.proof }]}>View position</Text>
    </Pressable>
  );
}

function HoldingRow({ holding, onPress }: { holding: PortfolioHolding; onPress: () => void }) {
  const theme = useTheme();
  const gainColor = theme.canvas === '#131918' ? '#8BC4A1' : '#286440';
  const unpriced = !holding.valuationIncluded || holding.marketValueUsd.amount === null;
  const positive = (holding.changePercent.value ?? 0) >= 0;
  return (
    <Pressable accessibilityLabel={`Open ${holding.companyName} holding`} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.registerRow, { borderBottomColor: `${theme.muted}33` }, pressed && styles.rowPressed]}>
      <Logo logoUrl={holding.logoUrl} name={holding.companyName} />
      <View style={styles.rowCopy}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.ink }]}>{holding.companyName}</Text>
        <Text numberOfLines={1} style={[styles.rowSubtitle, { color: theme.muted }]}>{holding.productType === 'prestock' ? 'PRESTOCK' : 'OWN'} · {holding.quantity} {holding.symbol}</Text>
      </View>
      <View style={styles.registerValue}>
        <Text style={[styles.registerAmount, { color: theme.ink }]}>{unpriced ? 'Unpriced' : formatPortfolioMoney(holding.marketValueUsd)}</Text>
        <Text style={[styles.registerMeta, { color: unpriced || holding.changePercent.value === null ? theme.muted : positive ? gainColor : theme.caution }]}>{unpriced ? 'Excluded from equity' : formatPortfolioPercent(holding.changePercent, { signed: true })}</Text>
      </View>
    </Pressable>
  );
}

function CashRow({ balance }: { balance: PortfolioCashBalance }) {
  const theme = useTheme();
  return (
    <View style={[styles.registerRow, { borderBottomColor: `${theme.muted}33` }]}>
      <View style={[styles.cashLogo, { backgroundColor: theme.proofWash }]}><Text style={[styles.cashLogoText, { color: theme.proof }]}>{balance.symbol}</Text></View>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: theme.ink }]}>{balance.label}</Text>
        <Text style={[styles.rowSubtitle, { color: theme.muted }]}>{balance.quantity} {balance.symbol}</Text>
      </View>
      <View style={styles.registerValue}>
        <Text style={[styles.registerAmount, { color: theme.ink }]}>{formatPortfolioMoney(balance.marketValueUsd)}</Text>
        <Text style={[styles.registerMeta, { color: balance.marketValueUsd.dataState === 'live' ? theme.proof : theme.caution }]}>{dataStateLabel(balance.marketValueUsd.dataState)}</Text>
      </View>
    </View>
  );
}

function Logo({ logoUrl, name }: { logoUrl: string | null; name: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.logo, { backgroundColor: theme.proofWash }]}>
      {logoUrl && !logoUrl.toLowerCase().endsWith('.svg')
        ? <Image contentFit="contain" source={{ uri: logoUrl }} style={styles.logoImage} />
        : <Text style={[styles.logoText, { color: theme.proof }]}>{initials(name)}</Text>}
    </View>
  );
}

function EmptyRow({ message }: { message: string }) {
  const theme = useTheme();
  return <View style={[styles.emptyRow, { borderColor: `${theme.muted}33` }]}><Text style={[styles.emptyRowText, { color: theme.muted }]}>{message}</Text></View>;
}

function PositionDetailSheet({ detail, onClose }: { detail: PositionDetail; onClose: () => void }) {
  const theme = useTheme();
  const position = detail?.kind === 'position' ? detail.value : null;
  const order = detail?.kind === 'order' ? detail.value : null;
  return (
    <Modal animationType="slide" onRequestClose={onClose} statusBarTranslucent transparent visible={detail !== null}>
      <View style={styles.modalLayer}>
        <Pressable accessibilityLabel="Close details" accessibilityRole="button" onPress={onClose} style={styles.backdrop} />
        <SafeAreaView edges={['bottom', 'left', 'right']} style={[styles.sheet, { backgroundColor: theme.canvas, borderTopColor: theme.outline }]}>
          <View style={[styles.sheetHandle, { backgroundColor: theme.outline }]} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleRow}>
              <Text accessibilityRole="header" style={[styles.sheetTitle, { color: theme.ink }]}>{position ? 'Position details' : 'Order details'}</Text>
              <View style={[styles.readOnlyBadge, { backgroundColor: theme.proofWash }]}><Text style={[styles.readOnlyText, { color: theme.proof }]}>Read-only</Text></View>
            </View>
            <Pressable accessibilityLabel="Close" accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.closeButton, { backgroundColor: theme.canvas }, pressed && styles.pressed]}><Text style={[styles.closeText, { color: theme.muted }]}>×</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
            {position ? <PositionFacts position={position} /> : null}
            {order ? <OrderFacts order={order} /> : null}
            <View style={[styles.readOnlyNotice, { backgroundColor: theme.canvas }]}><Text style={[styles.readOnlyNoticeText, { color: theme.muted }]}>This view reports current venue state. Position management and order cancellation are not available in this release.</Text></View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function PositionFacts({ position }: { position: PortfolioPosition }) {
  return (
    <>
      <DetailIdentity logoUrl={position.logoUrl} name={position.companyName} subtitle={`${position.marketSymbol} · ${position.venue}`} />
      <DetailRow label="Direction" value={capitalize(position.direction)} />
      <DetailRow label="Quantity" value={position.quantity} />
      <DetailRow label="Margin" value={`${capitalize(position.marginMode)}${position.leverage ? ` · ${position.leverage}×` : ''}`} />
      <DetailRow label="Entry price" value={formatNullableUsd(position.entryPriceUsd)} />
      <DetailRow label="Mark price" value={formatNullableUsd(position.markPriceUsd)} />
      <DetailRow label="Collateral" value={formatNullableUsd(position.collateralUsd)} />
      <DetailRow label="Gross exposure" value={formatNullableUsd(position.notionalUsd)} />
      <DetailRow label="Unrealized PnL" value={formatNullableUsd(position.unrealizedPnlUsd, { signed: true })} />
      <DetailRow label="Liquidation" value={liquidationSummary(position)} />
      <DetailRow label="Funding" value={fundingSummary(position)} />
      <DetailRow label="Subaccount" value={`${position.traderPdaIndex} / ${position.subaccountIndex}`} />
      <DetailRow label="Data state" value={`${dataStateLabel(position.dataState)} · ${formatUpdatedAt(position.updatedAt)}`} />
    </>
  );
}

function OrderFacts({ order }: { order: PortfolioOrder }) {
  return (
    <>
      <DetailIdentity logoUrl={order.logoUrl} name={order.companyName} subtitle={`${order.marketSymbol} · ${order.venue}`} />
      <DetailRow label="Side" value={capitalize(order.side)} />
      <DetailRow label="Order type" value={order.orderType} />
      <DetailRow label="Quantity" value={order.quantity} />
      <DetailRow label="Price" value={formatNullableUsd(order.priceUsd)} />
      <DetailRow label="Status" value={order.status} />
      <DetailRow label="Reduce only" value={order.reduceOnly ? 'Yes' : 'No'} />
      <DetailRow label="Subaccount" value={`${order.traderPdaIndex} / ${order.subaccountIndex}`} />
      <DetailRow label="Updated" value={formatUpdatedAt(order.updatedAt)} />
    </>
  );
}

function DetailIdentity({ logoUrl, name, subtitle }: { logoUrl: string | null; name: string; subtitle: string }) {
  const theme = useTheme();
  return <View style={styles.detailIdentity}><Logo logoUrl={logoUrl} name={name} /><View style={styles.rowCopy}><Text style={[styles.detailName, { color: theme.ink }]}>{name}</Text><Text style={[styles.detailSubtitle, { color: theme.muted }]}>{subtitle}</Text></View></View>;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return <View style={[styles.detailRow, { borderBottomColor: `${theme.muted}33` }]}><Text style={[styles.detailLabel, { color: theme.muted }]}>{label}</Text><Text selectable style={[styles.detailValue, { color: theme.ink }]}>{value}</Text></View>;
}

function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.primaryButton, { backgroundColor: theme.proof }, pressed && styles.pressed]}><Text style={[styles.primaryButtonText, { color: theme.onProof }]}>{label}</Text></Pressable>;
}

function warningScope(warning: PortfolioWarning) {
  if (warning.section === 'wallet') return 'Wallet';
  if (warning.section === 'valuation') return 'Holdings';
  if (warning.section === 'perpetuals') return 'Perpetuals';
  if (warning.section === 'executions') return 'Orders';
  return 'Activity';
}

function countLabel(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function signedPercent(value: number) {
  return `${value < 0 ? '−' : value > 0 ? '+' : ''}${Math.abs(value).toFixed(2)}%`;
}

function capitalize(value: string) {
  return value[0]!.toUpperCase() + value.slice(1);
}

function initials(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}` : name.slice(0, 2)).toUpperCase();
}

const styles = StyleSheet.create({
  statePanel: { alignItems: 'center', justifyContent: 'center', minHeight: 310, paddingHorizontal: 28 },
  stateMark: { alignItems: 'center', borderRadius: 16, height: 48, justifyContent: 'center', width: 48 },
  stateMarkText: { fontFamily: Fonts.sans, fontSize: 24, fontWeight: '800' },
  stateTitle: { fontFamily: Fonts.sans, fontSize: 18, fontWeight: '700', letterSpacing: -0.4, marginTop: 16, textAlign: 'center' },
  stateBody: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 20, marginBottom: 18, marginTop: 7, maxWidth: 310, textAlign: 'center' },
  cleanEmpty: { paddingHorizontal: 2, paddingTop: 38 },
  emptyKicker: { fontFamily: Fonts.mono, fontSize: 10, fontWeight: '700', letterSpacing: 0.75 },
  cleanEmptyTitle: { fontFamily: Fonts.sans, fontSize: 27, fontWeight: '800', letterSpacing: -1.3, marginTop: 10 },
  cleanEmptyBody: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 20, marginTop: 9, maxWidth: 345 },
  positionFilters: { flexDirection: 'row', gap: 5, paddingTop: 16 },
  positionFilter: { alignItems: 'center', borderRadius: 10, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 40, minWidth: 0, paddingHorizontal: 8 },
  positionFilterText: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '500' },
  exposureBlock: { marginTop: 18 },
  exposureHeading: { alignItems: 'flex-start', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  exposureCopy: { flex: 1, minWidth: 0 },
  exposureTitle: { fontFamily: Fonts.sans, fontSize: 17, fontWeight: '500', letterSpacing: -0.4 },
  exposureBody: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 17, marginTop: 5 },
  textButton: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '800' },
  summaryGrid: { borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 20, marginTop: 10, padding: 14 },
  summaryMetric: { flex: 1 },
  metricLabel: { fontFamily: Fonts.sans, fontSize: 10 },
  metricValue: { fontFamily: Fonts.mono, fontSize: 18, fontWeight: '500', marginTop: 5 },
  metricState: { fontFamily: Fonts.sans, fontSize: 9, fontWeight: '700', marginTop: 5, textTransform: 'uppercase' },
  updatedText: { fontFamily: Fonts.sans, fontSize: 9, lineHeight: 14, marginTop: 18 },
  noticeRow: { alignItems: 'center', borderRadius: 14, flexDirection: 'row', gap: 12, marginTop: 18, padding: 13 },
  notices: { marginTop: 24 },
  noticeTitle: { fontFamily: Fonts.sans, fontSize: 14, fontWeight: '700' },
  warningRow: { borderRadius: 13, marginBottom: 7, padding: 12 },
  warningScope: { fontFamily: Fonts.sans, fontSize: 9, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  warningMessage: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 16, marginTop: 4 },
  emptyState: { borderRadius: 16, marginTop: 24, padding: 16 },
  emptyTitle: { fontFamily: Fonts.sans, fontSize: 15, fontWeight: '700' },
  emptyBody: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 17, marginTop: 5 },
  onboardingAction: { alignSelf: 'flex-start', marginTop: 14 },
  section: { marginTop: 20 },
  sectionHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, minHeight: 28 },
  sectionTitle: { fontFamily: Fonts.sans, fontSize: 17, fontWeight: '500', letterSpacing: -0.4 },
  sectionCount: { fontFamily: Fonts.sans, fontSize: 10 },
  orderRow: { alignItems: 'center', borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 10, minHeight: 66, padding: 11 },
  logo: { alignItems: 'center', borderRadius: 10, height: 34, justifyContent: 'center', overflow: 'hidden', width: 34 },
  logoImage: { height: 34, width: 34 },
  logoText: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '500' },
  cashLogo: { alignItems: 'center', borderRadius: 10, height: 34, justifyContent: 'center', width: 34 },
  cashLogoText: { fontFamily: Fonts.mono, fontSize: 9, fontWeight: '800' },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '500' },
  rowSubtitle: { fontFamily: Fonts.sans, fontSize: 10, lineHeight: 15, marginTop: 4 },
  statusBadge: { borderRadius: 999, maxWidth: 92, paddingHorizontal: 9, paddingVertical: 5 },
  statusText: { fontFamily: Fonts.sans, fontSize: 9, fontWeight: '800' },
  positionCard: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, marginBottom: 9, padding: 14 },
  positionHeader: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  positionNumbers: { alignItems: 'flex-start', flexDirection: 'row', gap: 10, justifyContent: 'space-between', marginTop: 15 },
  positionPnlGroup: { alignItems: 'baseline', flex: 1, flexDirection: 'row', gap: 6, minWidth: 0 },
  positionPnl: { flexShrink: 1, fontFamily: Fonts.mono, fontSize: 22, fontWeight: '500' },
  positionPnlPercent: { flexShrink: 1, fontFamily: Fonts.mono, fontSize: 12, fontWeight: '500' },
  positionExposure: { alignItems: 'flex-end', flexShrink: 1, maxWidth: 102, minWidth: 64 },
  positionExposureValue: { fontFamily: Fonts.mono, fontSize: 10, textAlign: 'right' },
  positionExposureLabel: { fontFamily: Fonts.sans, fontSize: 9, marginTop: 3 },
  riskLine: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 18, marginTop: 13 },
  viewDetail: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '500', marginTop: 12 },
  register: { borderTopWidth: StyleSheet.hairlineWidth },
  registerRow: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 10, minHeight: 66, paddingVertical: 10 },
  registerValue: { alignItems: 'flex-end', maxWidth: 122 },
  registerAmount: { fontFamily: Fonts.mono, fontSize: 13, fontWeight: '500' },
  registerMeta: { fontFamily: Fonts.sans, fontSize: 9, marginTop: 4, textAlign: 'right' },
  emptyRow: { alignItems: 'center', borderRadius: 14, borderStyle: 'dashed', borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center', minHeight: 58, padding: 12 },
  emptyRowText: { fontFamily: Fonts.sans, fontSize: 11 },
  disclosure: { fontFamily: Fonts.sans, fontSize: 10, lineHeight: 15, marginTop: 24 },
  primaryButton: { alignItems: 'center', borderRadius: 13, justifyContent: 'center', minHeight: 48, minWidth: 132, paddingHorizontal: 16 },
  primaryButtonText: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '800' },
  modalLayer: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(3,7,6,0.76)' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, maxHeight: '88%', paddingBottom: 8, paddingHorizontal: 20, paddingTop: 10 },
  sheetHandle: { alignSelf: 'center', borderRadius: 2, height: 4, marginBottom: 14, width: 40 },
  sheetHeader: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  sheetTitleRow: { alignItems: 'center', flex: 1, flexDirection: 'row', flexShrink: 1, gap: 9, minWidth: 0 },
  sheetTitle: { flexShrink: 1, fontFamily: Fonts.sans, fontSize: 21, fontWeight: '500', letterSpacing: -0.6 },
  readOnlyBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  readOnlyText: { fontFamily: Fonts.sans, fontSize: 8, fontWeight: '800', textTransform: 'uppercase' },
  closeButton: { alignItems: 'center', borderRadius: 14, height: 44, justifyContent: 'center', width: 44 },
  closeText: { fontFamily: Fonts.sans, fontSize: 25, lineHeight: 27 },
  sheetContent: { paddingBottom: 12 },
  detailIdentity: { alignItems: 'center', flexDirection: 'row', gap: 11, marginBottom: 13, marginTop: 10 },
  detailName: { fontFamily: Fonts.sans, fontSize: 15, fontWeight: '700' },
  detailSubtitle: { fontFamily: Fonts.sans, fontSize: 10, marginTop: 4 },
  detailRow: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12, justifyContent: 'space-between', minHeight: 46 },
  detailLabel: { flex: 1, fontFamily: Fonts.sans, fontSize: 11 },
  detailValue: { flex: 1, fontFamily: Fonts.mono, fontSize: 11, fontWeight: '600', textAlign: 'right' },
  readOnlyNotice: { borderRadius: 13, marginTop: 15, padding: 13 },
  readOnlyNoticeText: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 17 },
  pressed: { opacity: 0.72 },
  rowPressed: { opacity: 0.78, transform: [{ scale: 0.995 }] },
});
