import type {
  PortfolioHolding,
  PortfolioOrder,
  PortfolioOverviewResponse,
  PortfolioPosition,
  PortfolioWarning,
} from '@warren/portfolio-contract';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import Svg, { Path } from 'react-native-svg';
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

import { loadPortfolioOverview, PortfolioRequestError } from './portfolio-api';
import { PhoenixRecoveryPanel } from './PhoenixRecoveryPanel';
import { isPhoenixRecoveryWarning } from './phoenix-recovery';
import {
  portfolioFailureState,
  type PortfolioLoadState,
} from './portfolio-load-state';
import {
  dataStateLabel,
  formatNullableUsd,
  formatPortfolioMoney,
  formatPortfolioPercent,
  formatUpdatedAt,
  overviewIsEmpty,
  portfolioAccountPresentationState,
  todayChangeAvailable,
} from './portfolio-view-model';

export function PortfolioOverview({
  getAccessToken,
  onOpenCompany,
  onOpenPositions,
  onSignInAgain,
  onRefreshSettled,
  refreshVersion = 0,
  signTransaction,
  walletAddress,
}: {
  getAccessToken: () => Promise<string>;
  onOpenCompany: (assetId: string) => void;
  onOpenPositions: () => void;
  onSignInAgain: () => void;
  onRefreshSettled?: () => void;
  refreshVersion?: number;
  signTransaction: (unsignedTransaction: string) => Promise<string>;
  walletAddress: string;
}) {
  const theme = useTheme();
  const [requestVersion, setRequestVersion] = useState(0);
  const [state, setState] = useState<PortfolioLoadState<PortfolioOverviewResponse>>({ phase: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    void loadPortfolioOverview({ getAccessToken, signal: controller.signal, walletAddress })
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
          : new PortfolioRequestError('Warren could not refresh your portfolio. Pull down to try again.', 'service', true);
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
    return <OverviewLoading />;
  }
  if (state.phase === 'error') {
    const sessionFailure = state.error.failure === 'session' || state.error.failure === 'wallet';
    return (
      <View accessibilityLiveRegion="polite" style={styles.statePanel}>
        <View style={[styles.stateMark, { backgroundColor: theme.cautionWash }]}>
          <Text style={[styles.stateMarkText, { color: theme.caution }]}>!</Text>
        </View>
        <Text style={[styles.stateTitle, { color: theme.ink }]}>
          {sessionFailure ? 'Reconnect Portfolio' : 'Portfolio needs a refresh'}
        </Text>
        <Text style={[styles.stateBody, { color: theme.muted }]}>{state.error.message}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={sessionFailure ? onSignInAgain : refresh}
          style={({ pressed }) => [styles.primaryButton, { backgroundColor: theme.proof }, pressed && styles.pressed]}>
          <Text style={[styles.primaryButtonText, { color: theme.onProof }]}>
            {sessionFailure ? 'Sign in again' : 'Try again'}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <OverviewContent
      data={state.data}
      getAccessToken={getAccessToken}
      onOpenCompany={onOpenCompany}
      onOpenPositions={onOpenPositions}
      onRefresh={refresh}
      refreshError={state.refreshError}
      refreshing={state.refreshing}
      signTransaction={signTransaction}
      walletAddress={walletAddress}
    />
  );
}

function OverviewLoading() {
  const theme = useTheme();
  return (
    <View accessibilityLiveRegion="polite" style={styles.statePanel}>
      <ActivityIndicator color={theme.proof} size="small" />
      <Text style={[styles.stateTitle, { color: theme.ink }]}>Loading your portfolio</Text>
      <Text style={[styles.stateBody, { color: theme.muted }]}>Checking wallet balances, supported holdings, and Phoenix exposure.</Text>
    </View>
  );
}

function OverviewContent({
  data,
  getAccessToken,
  onOpenCompany,
  onOpenPositions,
  onRefresh,
  refreshError,
  refreshing,
  signTransaction,
  walletAddress,
}: {
  data: PortfolioOverviewResponse;
  getAccessToken: () => Promise<string>;
  onOpenCompany: (assetId: string) => void;
  onOpenPositions: () => void;
  onRefresh: () => void;
  refreshError?: string;
  refreshing: boolean;
  signTransaction: (unsignedTransaction: string) => Promise<string>;
  walletAddress: string;
}) {
  const theme = useTheme();
  const [masked, setMasked] = useState(false);
  const [sheet, setSheet] = useState<'equity' | 'receive' | null>(null);
  const changeAvailable = todayChangeAvailable(data);
  const todayPositive = (data.equity.todayChangeUsd.amount ?? 0) >= 0;
  const hasPhoenixRecovery = data.perpetuals.accountState !== 'ready';
  const visibleWarnings = data.warnings.filter((warning) => !isPhoenixRecoveryWarning(warning));
  const presentationState = portfolioAccountPresentationState(data);

  if (presentationState === 'new_wallet' || presentationState === 'phoenix_only') {
    return (
      <>
        <CapitalAccountState
          data={data}
          getAccessToken={getAccessToken}
          kind={presentationState}
          masked={masked}
          onDeposit={() => setSheet('receive')}
          onRefresh={onRefresh}
          refreshing={refreshing}
          signTransaction={signTransaction}
        />
        {refreshError ? <RefreshSummary error={refreshError} onRefresh={onRefresh} refreshing={refreshing} /> : null}
        {visibleWarnings.length ? <PortfolioWarnings onRefresh={onRefresh} refreshing={refreshing} warnings={visibleWarnings} /> : null}
        <OverviewSheet
          key={sheet ?? 'closed'}
          data={data}
          masked={masked}
          mode={sheet}
          onClose={() => setSheet(null)}
          walletAddress={walletAddress}
        />
      </>
    );
  }

  if (presentationState === 'partial') {
    return (
      <PartialOverview
        data={data}
        getAccessToken={getAccessToken}
        masked={masked}
        onOpenCompany={onOpenCompany}
        onOpenPositions={onOpenPositions}
        onRefresh={onRefresh}
        refreshError={refreshError}
        refreshing={refreshing}
        signTransaction={signTransaction}
      />
    );
  }

  return (
    <>
      <View style={styles.equityBlock}>
        <View style={styles.equityHeading}>
          <Text style={[styles.eyebrow, { color: theme.muted }]}>Net account equity</Text>
          <Pressable
            accessibilityLabel={masked ? 'Show account values' : 'Hide account values'}
            accessibilityRole="button"
            accessibilityState={{ selected: masked }}
            onPress={() => setMasked((current) => !current)}
            style={({ pressed }) => [styles.privacyButton, pressed && styles.pressed]}>
            <EyeIcon color={theme.muted} hidden={masked} />
          </Pressable>
        </View>
        <Text
          accessibilityLabel={masked ? 'Account equity hidden' : undefined}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.72}
          style={[styles.equityValue, { color: masked ? theme.muted : theme.ink }]}>
          {masked ? '••••' : formatPortfolioMoney(data.equity.netAccountEquity)}
        </Text>

        <View style={[styles.changeRow, !changeAvailable && styles.changeRowWithoutChange]}>
          {changeAvailable ? (
            <View style={styles.todayChange}>
              <Text
                accessibilityLabel={masked ? 'Today change hidden' : undefined}
                style={[
                  styles.changeValue,
                  { color: masked ? theme.muted : todayPositive ? gainColor(theme) : theme.caution },
                ]}>
                {masked ? '••••' : `${formatPortfolioMoney(data.equity.todayChangeUsd, { signed: true })} · ${formatPortfolioPercent(data.equity.todayChangePercent, { signed: true })}`}
              </Text>
              <Text style={[styles.changeLabel, { color: theme.muted }]}>Today</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.updatedRow}>
          <Text style={[styles.updatedText, { color: theme.muted }]}>{formatUpdatedAt(data.generatedAt)} · {dataStateLabel(data.equity.netAccountEquity.dataState)}</Text>
          <Pressable accessibilityRole="button" disabled={refreshing} onPress={onRefresh}>
            <Text style={[styles.textButton, { color: theme.proof }]}>{refreshing ? 'Refreshing…' : 'Refresh'}</Text>
          </Pressable>
        </View>

        <View style={styles.equityActions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setSheet('receive')}
            style={({ pressed }) => [styles.primaryButton, styles.flexButton, { backgroundColor: theme.proof }, pressed && styles.pressed]}>
            <Text style={[styles.primaryButtonText, { color: theme.onProof }]}>Deposit</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="See how account equity is calculated"
            accessibilityRole="button"
            onPress={() => setSheet('equity')}
            style={({ pressed }) => [styles.secondaryButton, styles.flexButton, { borderColor: theme.outline }, pressed && styles.pressed]}>
            <Text style={[styles.secondaryButtonText, { color: theme.ink }]}>Breakdown ↗</Text>
          </Pressable>
        </View>
      </View>

      {refreshError ? (
        <View accessibilityLiveRegion="polite" style={[styles.refreshNotice, { backgroundColor: theme.cautionWash }]}>
          <View style={styles.rowCopy}>
            <Text style={[styles.rowTitle, { color: theme.ink }]}>Latest refresh did not finish</Text>
            <Text style={[styles.rowSubtitle, { color: theme.muted }]}>{refreshError} The values below are from the last successful update.</Text>
          </View>
          <Pressable accessibilityRole="button" disabled={refreshing} onPress={onRefresh}>
            <Text style={[styles.textButton, { color: theme.proof }]}>{refreshing ? 'Refreshing…' : 'Retry'}</Text>
          </Pressable>
        </View>
      ) : null}

      {visibleWarnings.length ? <PortfolioWarnings onRefresh={onRefresh} refreshing={refreshing} warnings={visibleWarnings} /> : null}

      {presentationState !== 'spot_only' ? <PhoenixRecoveryPanel
        data={data}
        getAccessToken={getAccessToken}
        onRefresh={onRefresh}
        refreshing={refreshing}
        signTransaction={signTransaction}
      /> : null}

      {data.attention.length ? (
        <OverviewSection count={`${data.attention.length} unresolved`} title="Needs attention">
          {data.attention.map((item) => (
            <View key={item.attentionId} style={[styles.attentionRow, { backgroundColor: theme.cautionWash }]}>
              <View style={[styles.attentionDot, { backgroundColor: theme.caution }]} />
              <View style={styles.rowCopy}>
                <Text style={[styles.rowTitle, { color: theme.ink }]}>{item.title}</Text>
                <Text style={[styles.rowSubtitle, { color: theme.muted }]}>{item.message}</Text>
              </View>
            </View>
          ))}
        </OverviewSection>
      ) : null}

      {overviewIsEmpty(data) && !hasPhoenixRecovery ? (
        <View style={[styles.emptyState, { backgroundColor: theme.surface }]}>
          <Text style={[styles.emptyTitle, { color: theme.ink }]}>Your portfolio is ready</Text>
          <Text style={[styles.emptyBody, { color: theme.muted }]}>Supported holdings, open orders, and Phoenix positions will appear here after your first activity.</Text>
        </View>
      ) : null}

      <OverviewSection action="View all" count={holdingCountLabel(data)} onAction={onOpenPositions} title="Holdings">
        {data.holdings.length
          ? <View style={[styles.register, { borderTopColor: `${theme.muted}33` }]}>{data.holdings.map((holding) => <HoldingRow holding={holding} key={holding.holdingId} masked={masked} onPress={() => onOpenCompany(holding.assetId)} />)}</View>
          : <EmptyRow message="No supported stock-token holdings" />}
      </OverviewSection>

      {presentationState === 'full' ? <OverviewSection action="View all" count={countLabel(data.counts.openPositions, 'position')} onAction={onOpenPositions} title="Perpetuals">
        {data.openPositions.length
          ? data.openPositions.map((position) => <CompactPositionRow key={position.positionId} masked={masked} onPress={onOpenPositions} position={position} />)
          : <EmptyRow message="No open perpetual positions" />}
      </OverviewSection> : null}

      {presentationState === 'full' ? <OverviewSection action="View all" count={countLabel(data.counts.openOrders, 'order')} onAction={onOpenPositions} title="Open orders">
        {data.openOrders.length
          ? data.openOrders.map((order) => <OrderRow key={order.orderId} masked={masked} onPress={onOpenPositions} order={order} />)
          : <EmptyRow message="No orders waiting to fill" />}
      </OverviewSection> : null}

      {presentationState === 'spot_only' ? <PhoenixRecoveryPanel
        data={data}
        getAccessToken={getAccessToken}
        onRefresh={onRefresh}
        refreshing={refreshing}
        signTransaction={signTransaction}
      /> : null}

      <Text style={[styles.disclosure, { color: theme.muted }]}>Only exact-mint supported stock tokens and Warren-recognized Phoenix stock markets are included.</Text>

      <OverviewSheet
        key={sheet ?? 'closed'}
        data={data}
        masked={masked}
        mode={sheet}
        onClose={() => setSheet(null)}
        walletAddress={walletAddress}
      />
    </>
  );
}

function CapitalAccountState({
  data,
  getAccessToken,
  kind,
  masked,
  onDeposit,
  onRefresh,
  refreshing,
  signTransaction,
}: {
  data: PortfolioOverviewResponse;
  getAccessToken: () => Promise<string>;
  kind: 'new_wallet' | 'phoenix_only';
  masked: boolean;
  onDeposit: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  signTransaction: (unsignedTransaction: string) => Promise<string>;
}) {
  const theme = useTheme();
  const phoenixReady = kind === 'phoenix_only';
  return (
    <View style={styles.emptyAccount}>
      <Text style={[styles.equityLabel, { color: theme.muted }]}>Net account equity</Text>
      <Text accessibilityLabel={masked ? 'Account equity hidden' : undefined} style={[styles.emptyBalance, { color: theme.muted }]}>{formatPortfolioMoney(data.equity.netAccountEquity, { mask: masked })}</Text>
      <Text style={[styles.updatedText, styles.emptyUpdated, { color: theme.muted }]}>{formatUpdatedAt(data.generatedAt)} · {dataStateLabel(data.equity.netAccountEquity.dataState)}</Text>
      <Text accessibilityRole="header" style={[styles.emptyAccountTitle, { color: theme.ink }]}>{phoenixReady ? 'Your perpetual account is ready' : 'Make your first investment'}</Text>
      <Text style={[styles.emptyAccountBody, { color: theme.muted }]}>
        {phoenixReady ? 'Deposit funds to start trading. Your positions will appear here.' : 'Deposit funds to buy tokenized stocks.'}
      </Text>
      <Pressable accessibilityRole="button" onPress={onDeposit} style={({ pressed }) => [styles.primaryButton, styles.emptyDeposit, { backgroundColor: theme.proof }, pressed && styles.pressed]}>
        <Text style={[styles.primaryButtonText, { color: theme.onProof }]}>Deposit</Text>
      </Pressable>
      {phoenixReady ? (
        <View style={[styles.phoenixReadyLine, { borderTopColor: theme.outline }]}>
          <Text style={[styles.phoenixReadyLabel, { color: theme.muted }]}>Phoenix account</Text>
          <Text style={[styles.phoenixReadyValue, { color: theme.proof }]}>Ready</Text>
        </View>
      ) : (
        <PhoenixRecoveryPanel
          compact
          data={data}
          getAccessToken={getAccessToken}
          onRefresh={onRefresh}
          refreshing={refreshing}
          signTransaction={signTransaction}
        />
      )}
    </View>
  );
}

function PartialOverview({
  data,
  getAccessToken,
  masked,
  onOpenCompany,
  onOpenPositions,
  onRefresh,
  refreshError,
  refreshing,
  signTransaction,
}: {
  data: PortfolioOverviewResponse;
  getAccessToken: () => Promise<string>;
  masked: boolean;
  onOpenCompany: (assetId: string) => void;
  onOpenPositions: () => void;
  onRefresh: () => void;
  refreshError?: string;
  refreshing: boolean;
  signTransaction: (unsignedTransaction: string) => Promise<string>;
}) {
  const theme = useTheme();
  const visibleWarnings = data.warnings.filter((warning) => !isPhoenixRecoveryWarning(warning));
  return (
    <>
      <View style={[styles.partialState, { backgroundColor: theme.surface }]}>
        <View style={styles.rowCopy}>
          <Text accessibilityRole="header" style={[styles.partialTitle, { color: theme.ink }]}>Some portfolio data needs a refresh</Text>
          <Text style={[styles.partialBody, { color: theme.muted }]}>Warren is showing the account data it could verify. Missing totals are withheld instead of estimated.</Text>
        </View>
        <Pressable accessibilityRole="button" disabled={refreshing} onPress={onRefresh}>
          <Text style={[styles.textButton, { color: theme.proof }]}>{refreshing ? 'Refreshing…' : 'Retry'}</Text>
        </Pressable>
      </View>
      {refreshError ? <RefreshSummary error={refreshError} onRefresh={onRefresh} refreshing={refreshing} /> : null}
      {visibleWarnings.length ? <PortfolioWarnings onRefresh={onRefresh} refreshing={refreshing} warnings={visibleWarnings} /> : null}
      <PhoenixRecoveryPanel
        data={data}
        getAccessToken={getAccessToken}
        onRefresh={onRefresh}
        refreshing={refreshing}
        signTransaction={signTransaction}
      />
      {data.openPositions.length ? (
        <OverviewSection action="View all" count={countLabel(data.counts.openPositions, 'position')} onAction={onOpenPositions} title="Open positions">
          {data.openPositions.map((position) => <PositionCard key={position.positionId} masked={masked} onPress={onOpenPositions} position={position} />)}
        </OverviewSection>
      ) : null}
      {data.openOrders.length ? (
        <OverviewSection action="View all" count={countLabel(data.counts.openOrders, 'order')} onAction={onOpenPositions} title="Open orders">
          {data.openOrders.map((order) => <OrderRow key={order.orderId} masked={masked} onPress={onOpenPositions} order={order} />)}
        </OverviewSection>
      ) : null}
      {data.holdings.length ? (
        <OverviewSection action="View all" count={holdingCountLabel(data)} onAction={onOpenPositions} title="Holdings">
          <View style={[styles.register, { borderTopColor: `${theme.muted}33` }]}>{data.holdings.map((holding) => <HoldingRow holding={holding} key={holding.holdingId} masked={masked} onPress={() => onOpenCompany(holding.assetId)} />)}</View>
        </OverviewSection>
      ) : null}
    </>
  );
}

function RefreshSummary({ error, onRefresh, refreshing }: { error: string; onRefresh: () => void; refreshing: boolean }) {
  const theme = useTheme();
  return (
    <View accessibilityLiveRegion="polite" style={[styles.refreshNotice, { backgroundColor: theme.cautionWash }]}>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: theme.ink }]}>Latest refresh did not finish</Text>
        <Text style={[styles.rowSubtitle, { color: theme.muted }]}>{error}</Text>
      </View>
      <Pressable accessibilityRole="button" disabled={refreshing} onPress={onRefresh}>
        <Text style={[styles.textButton, { color: theme.proof }]}>{refreshing ? 'Refreshing…' : 'Retry'}</Text>
      </Pressable>
    </View>
  );
}

function PortfolioWarnings({ onRefresh, refreshing, warnings }: { onRefresh: () => void; refreshing: boolean; warnings: PortfolioWarning[] }) {
  const theme = useTheme();
  return (
    <View style={styles.warningSection}>
      <View style={styles.warningHeading}>
        <Text style={[styles.warningTitle, { color: theme.ink }]}>Data notices</Text>
        {warnings.some((warning) => warning.retryable) ? (
          <Pressable accessibilityRole="button" disabled={refreshing} onPress={onRefresh}>
            <Text style={[styles.textButton, { color: theme.proof }]}>{refreshing ? 'Refreshing…' : 'Retry'}</Text>
          </Pressable>
        ) : null}
      </View>
      {warnings.map((warning) => (
        <View key={`${warning.section}:${warning.code}`} style={[styles.warningRow, { backgroundColor: theme.cautionWash }]}>
          <Text style={[styles.warningScope, { color: theme.caution }]}>{warningSectionLabel(warning.section)}</Text>
          <Text style={[styles.warningMessage, { color: theme.ink }]}>{warning.message}</Text>
        </View>
      ))}
    </View>
  );
}

function OverviewSection({
  action,
  children,
  count,
  onAction,
  title,
}: {
  action?: string;
  children: React.ReactNode;
  count?: string;
  onAction?: () => void;
  title: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <View style={styles.sectionTitleRow}>
          <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.ink }]}>{title}</Text>
          {count ? <Text style={[styles.sectionCount, { color: theme.muted }]}>{count}</Text> : null}
        </View>
        {action && onAction ? (
          <Pressable accessibilityRole="button" onPress={onAction}>
            <Text style={[styles.textButton, { color: theme.proof }]}>{action}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function PositionCard({ masked, onPress, position }: { masked: boolean; onPress: () => void; position: PortfolioPosition }) {
  const theme = useTheme();
  const positive = (position.unrealizedPnlUsd ?? 0) >= 0;
  return (
    <Pressable
      accessibilityLabel={`View ${position.companyName} ${position.direction} position`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.positionCard, { backgroundColor: theme.surface }, pressed && styles.rowPressed]}>
      <View style={styles.positionHeader}>
        <PortfolioLogo logoUrl={position.logoUrl} name={position.companyName} />
        <View style={styles.rowCopy}>
          <Text style={[styles.rowTitle, { color: theme.ink }]}>{position.companyName}</Text>
          <Text style={[styles.rowSubtitle, { color: theme.muted }]}>{position.marketSymbol} · {position.direction.toUpperCase()} · {position.leverage ? `${position.leverage}× ` : ''}{position.marginMode.toUpperCase()}</Text>
        </View>
        <View style={[styles.openBadge, { backgroundColor: theme.proofWash }]}><Text style={[styles.openBadgeText, { color: theme.proof }]}>Open</Text></View>
      </View>
      <View style={styles.positionNumbers}>
        <Text accessibilityLabel={masked ? 'Position profit and loss hidden' : undefined} style={[styles.positionPnl, { color: positive ? gainColor(theme) : theme.caution }]}>{masked ? '••••' : `${formatNullableUsd(position.unrealizedPnlUsd, { signed: true })}${position.unrealizedPnlPercent === null ? '' : ` · ${position.unrealizedPnlPercent >= 0 ? '+' : '−'}${Math.abs(position.unrealizedPnlPercent).toFixed(2)}%`}`}</Text>
        <Text accessibilityLabel={masked ? 'Position exposure hidden' : undefined} style={[styles.positionExposure, { color: theme.ink }]}>{masked ? '••••' : formatNullableUsd(position.notionalUsd)} exposure</Text>
      </View>
      <View style={styles.factGrid}>
        <PositionFact label="Entry" value={masked ? '••••' : formatNullableUsd(position.entryPriceUsd)} />
        <PositionFact label="Mark" value={masked ? '••••' : formatNullableUsd(position.markPriceUsd)} />
        <PositionFact label="Collateral" value={masked ? '••••' : formatNullableUsd(position.collateralUsd)} />
      </View>
      <Text style={[styles.riskLine, { color: theme.muted }]}>Liquidation {masked ? '••••' : `${formatNullableUsd(position.liquidationPriceUsd)}${position.liquidationDistancePercent === null ? '' : ` · ${position.liquidationDistancePercent.toFixed(0)}% away`}`}</Text>
    </Pressable>
  );
}

function CompactPositionRow({ masked = false, onPress, position }: { masked?: boolean; onPress: () => void; position: PortfolioPosition }) {
  const theme = useTheme();
  const positive = (position.unrealizedPnlUsd ?? 0) >= 0;
  return (
    <Pressable
      accessibilityLabel={`View ${position.companyName} ${position.direction} position`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.positionPreview, { backgroundColor: theme.surface, borderColor: `${theme.muted}33` }, pressed && styles.rowPressed]}>
      <PortfolioLogo logoUrl={position.logoUrl} name={position.companyName} />
      <View style={styles.rowCopy}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.ink }]}>{position.companyName}</Text>
        <Text numberOfLines={1} style={[styles.rowSubtitle, { color: theme.muted }]}>{capitalize(position.direction)} · {position.leverage ? `${position.leverage}× ` : ''}{capitalize(position.marginMode)}</Text>
      </View>
      <View style={styles.positionPreviewValue}>
        <Text accessibilityLabel={masked ? 'Position profit and loss hidden' : undefined} style={[styles.positionPreviewPnl, { color: masked || position.unrealizedPnlUsd === null ? theme.muted : positive ? gainColor(theme) : theme.caution }]}>{masked ? '••••' : formatNullableUsd(position.unrealizedPnlUsd, { signed: true })}</Text>
        <Text accessibilityLabel={masked ? 'Position exposure hidden' : undefined} style={[styles.positionPreviewExposure, { color: theme.muted }]}>{masked ? '•••• exposure' : `${formatNullableUsd(position.notionalUsd)} exposure`}</Text>
      </View>
    </Pressable>
  );
}

function PositionFact({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.factItem}>
      <Text style={[styles.factLabel, { color: theme.muted }]}>{label}</Text>
      <Text style={[styles.factValue, { color: theme.ink }]}>{value}</Text>
    </View>
  );
}

function OrderRow({ masked = false, onPress, order }: { masked?: boolean; onPress: () => void; order: PortfolioOrder }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.orderRow, { borderColor: `${theme.muted}33` }, pressed && styles.rowPressed]}>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: theme.ink }]}>{capitalize(order.side)} {order.companyName} perpetual</Text>
        <Text style={[styles.rowSubtitle, { color: theme.muted }]}>{order.orderType} · {masked ? '••••' : order.quantity} · {order.priceUsd === null ? 'Market price' : masked ? '••••' : formatNullableUsd(order.priceUsd)}</Text>
      </View>
      <View style={[styles.statusBadge, { backgroundColor: theme.proofWash }]}><Text style={[styles.statusBadgeText, { color: theme.proof }]}>{order.status}</Text></View>
    </Pressable>
  );
}

function HoldingRow({ holding, masked = false, onPress }: { holding: PortfolioHolding; masked?: boolean; onPress: () => void }) {
  const theme = useTheme();
  const positive = (holding.changePercent.value ?? 0) >= 0;
  const unpriced = !holding.valuationIncluded || holding.marketValueUsd.amount === null;
  return (
    <Pressable accessibilityLabel={`Open ${holding.companyName} holding`} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.holdingRow, { borderBottomColor: `${theme.muted}33` }, pressed && styles.rowPressed]}>
      <PortfolioLogo logoUrl={holding.logoUrl} name={holding.companyName} />
      <View style={styles.rowCopy}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.ink }]}>{holding.companyName}</Text>
        <Text numberOfLines={1} style={[styles.rowSubtitle, { color: theme.muted }]}>{holding.productType === 'prestock' ? 'PRESTOCK' : 'OWN'} · {masked ? '••••' : holding.quantity} {holding.symbol}</Text>
      </View>
      <View style={styles.holdingValue}>
        <Text accessibilityLabel={masked && !unpriced ? 'Holding value hidden' : undefined} style={[styles.holdingAmount, { color: masked ? theme.muted : theme.ink }]}>{unpriced ? 'Unpriced' : masked ? '••••' : formatPortfolioMoney(holding.marketValueUsd)}</Text>
        <Text accessibilityLabel={masked && !unpriced ? 'Holding change hidden' : undefined} style={[styles.holdingChange, { color: masked || unpriced || holding.changePercent.value === null ? theme.muted : positive ? gainColor(theme) : theme.caution }]}>{unpriced ? 'Excluded from equity' : formatPortfolioPercent(holding.changePercent, { mask: masked, signed: true })}</Text>
      </View>
    </Pressable>
  );
}

function PortfolioLogo({ logoUrl, name }: { logoUrl: string | null; name: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.logo, { backgroundColor: theme.proofWash }]}>
      {logoUrl && !logoUrl.toLowerCase().endsWith('.svg')
        ? <Image contentFit="contain" source={{ uri: logoUrl }} style={styles.logoImage} />
        : <Text style={[styles.logoText, { color: theme.proof }]}>{initials(name)}</Text>}
    </View>
  );
}

function EyeIcon({ color, hidden }: { color: string; hidden: boolean }) {
  return (
    <Svg fill="none" height={20} viewBox="0 0 24 24" width={20}>
      <Path d="M2.8 12s3.3-5.5 9.2-5.5 9.2 5.5 9.2 5.5-3.3 5.5-9.2 5.5S2.8 12 2.8 12Z" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} />
      <Path d="M12 14.7a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4Z" stroke={color} strokeWidth={1.8} />
      {hidden ? <Path d="m4 4 16 16" stroke={color} strokeLinecap="round" strokeWidth={1.8} /> : null}
    </Svg>
  );
}

function EmptyRow({ message }: { message: string }) {
  const theme = useTheme();
  return <View style={[styles.emptyRow, { borderColor: theme.outline }]}><Text style={[styles.emptyRowText, { color: theme.muted }]}>{message}</Text></View>;
}

function OverviewSheet({
  data,
  masked,
  mode,
  onClose,
  walletAddress,
}: {
  data: PortfolioOverviewResponse;
  masked: boolean;
  mode: 'equity' | 'receive' | null;
  onClose: () => void;
  walletAddress: string;
}) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await Clipboard.setStringAsync(walletAddress);
    setCopied(true);
  };
  return (
    <Modal animationType="slide" onRequestClose={onClose} statusBarTranslucent transparent visible={mode !== null}>
      <View style={styles.modalLayer}>
        <Pressable accessibilityLabel="Close sheet" accessibilityRole="button" onPress={onClose} style={styles.backdrop} />
        <SafeAreaView edges={['bottom', 'left', 'right']} style={[styles.sheet, { backgroundColor: theme.canvas, borderColor: theme.outline }]}>
          <View style={[styles.sheetHandle, { backgroundColor: theme.outline }]} />
          <View style={styles.sheetHeader}>
            <Text accessibilityRole="header" style={[styles.sheetTitle, { color: theme.ink }]}>{mode === 'receive' ? 'Receive' : 'Account equity'}</Text>
            <Pressable accessibilityLabel="Close" accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.closeButton, { backgroundColor: theme.canvas }, pressed && styles.pressed]}><Text style={[styles.closeText, { color: theme.muted }]}>×</Text></Pressable>
          </View>
          <ScrollView
            alwaysBounceVertical={false}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
            style={styles.sheetScroll}
            showsVerticalScrollIndicator={false}>
            {mode === 'receive' ? (
              <>
                <Text style={[styles.sheetCopy, { color: theme.muted }]}>Send supported Solana assets to this wallet. Always verify the network before transferring.</Text>
                <Text selectable style={[styles.receiveAddress, { backgroundColor: theme.surface, color: theme.ink }]}>{walletAddress}</Text>
                <Pressable accessibilityRole="button" onPress={() => void copy()} style={({ pressed }) => [styles.primaryButton, { backgroundColor: theme.proof }, pressed && styles.pressed]}><Text style={[styles.primaryButtonText, { color: theme.onProof }]}>{copied ? 'Address copied' : 'Copy wallet address'}</Text></Pressable>
              </>
            ) : null}
            {mode === 'equity' ? (
              <>
                <Text style={[styles.sheetCopy, { color: theme.muted }]}>Owned assets, cash, and Phoenix account equity contribute to net equity. Perpetual notional is risk exposure, not owned value.</Text>
                <View style={[styles.reconcileList, { borderTopColor: theme.outline }]}>
                  <ReconcileRow label="Priced token holdings" masked={masked} value={formatPortfolioMoney(data.equity.pricedHoldings)} />
                  <ReconcileRow label="Available USDC + SOL" masked={masked} value={formatPortfolioMoney(data.equity.cash)} />
                  <ReconcileRow label="Phoenix account equity" masked={masked} value={formatPortfolioMoney(data.equity.perpetualEquity)} />
                  <ReconcileRow label="Liabilities" masked={masked} value={formatPortfolioMoney(data.equity.liabilities)} />
                  <ReconcileRow emphasis label="Net account equity" masked={masked} value={formatPortfolioMoney(data.equity.netAccountEquity)} />
                </View>
                <View style={[styles.sheetFact, { backgroundColor: theme.surface }]}>
                  <Text style={[styles.sheetFactText, { color: theme.muted }]}>Gross perp exposure: </Text>
                  <Text
                    accessibilityLabel={masked ? 'Gross perpetual exposure hidden' : undefined}
                    style={[
                      styles.sheetFactValue,
                      { color: theme.ink },
                    ]}>
                    {masked ? '••••' : formatPortfolioMoney(data.equity.grossPerpetualExposure)}
                  </Text>
                  <Text style={[styles.sheetFactText, { color: theme.muted }]}> · excluded from net account equity.</Text>
                </View>
              </>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function ReconcileRow({ emphasis = false, label, masked, value }: { emphasis?: boolean; label: string; masked: boolean; value: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.reconcileRow, { borderBottomColor: theme.outline }]}>
      <Text style={[emphasis ? styles.reconcileStrong : styles.reconcileLabel, { color: emphasis ? theme.ink : theme.muted }]}>{label}</Text>
      <Text
        accessibilityLabel={masked ? `${label} hidden` : undefined}
        style={[
          emphasis ? styles.reconcileStrong : styles.reconcileValue,
          { color: theme.ink },
        ]}>
        {masked ? '••••' : value}
      </Text>
    </View>
  );
}

function warningSectionLabel(section: PortfolioWarning['section']) {
  if (section === 'wallet') return 'Wallet';
  if (section === 'valuation') return 'Holdings';
  if (section === 'perpetuals') return 'Perpetuals';
  if (section === 'executions') return 'Orders';
  return 'Activity';
}

function countLabel(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function holdingCountLabel(data: PortfolioOverviewResponse) {
  if (!data.counts.unpricedHoldings) return countLabel(data.counts.holdings, 'holding');
  return `${data.counts.holdings} holdings · ${data.counts.unpricedHoldings} unpriced`;
}

function capitalize(value: string) {
  return value[0]!.toUpperCase() + value.slice(1);
}

function gainColor(theme: { canvas: string }) {
  return theme.canvas === '#131918' ? '#8BC4A1' : '#286440';
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
  partialState: { alignItems: 'center', borderRadius: 17, flexDirection: 'row', gap: 12, marginTop: 20, padding: 16 },
  partialTitle: { fontFamily: Fonts.sans, fontSize: 15, fontWeight: '800', letterSpacing: -0.3 },
  partialBody: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 17, marginTop: 5 },
  emptyAccount: { paddingBottom: 6, paddingTop: 30 },
  equityLabel: { fontFamily: Fonts.sans, fontSize: 12 },
  emptyBalance: { fontFamily: Fonts.mono, fontSize: 38, fontWeight: '500', letterSpacing: -2, marginTop: 9 },
  emptyUpdated: { marginTop: 7 },
  emptyAccountTitle: { fontFamily: Fonts.sans, fontSize: 23, fontWeight: '500', letterSpacing: -0.7, lineHeight: 28, marginTop: 36 },
  emptyAccountBody: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 20, marginTop: 10 },
  phoenixReadyLine: { alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', marginTop: 30, paddingTop: 16 },
  phoenixReadyLabel: { fontFamily: Fonts.sans, fontSize: 13 },
  phoenixReadyValue: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '600' },
  equityBlock: { paddingBottom: 20, paddingTop: 16 },
  equityHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 44 },
  eyebrow: { fontFamily: Fonts.sans, fontSize: 12, fontWeight: '400' },
  equityValue: { fontFamily: Fonts.mono, fontSize: 38, fontWeight: '500', letterSpacing: -2.5, lineHeight: 46, marginTop: 0 },
  privacyButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  changeRow: { marginTop: 10 },
  changeRowWithoutChange: { justifyContent: 'flex-end' },
  todayChange: { alignItems: 'baseline', flexDirection: 'row', gap: 9 },
  changeLabel: { fontFamily: Fonts.sans, fontSize: 11 },
  changeValue: { fontFamily: Fonts.mono, fontSize: 12, fontWeight: '400' },
  updatedRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 7 },
  updatedText: { fontFamily: Fonts.sans, fontSize: 10 },
  textButton: { fontFamily: Fonts.sans, fontSize: 12, fontWeight: '500' },
  equityActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  primaryButton: { alignItems: 'center', borderRadius: 12, justifyContent: 'center', minHeight: 46, minWidth: 132, paddingHorizontal: 12 },
  primaryButtonText: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '500' },
  secondaryButton: { alignItems: 'center', borderRadius: 12, borderWidth: 1, justifyContent: 'center', minHeight: 46, paddingHorizontal: 12 },
  secondaryButtonText: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '500' },
  flexButton: { flex: 1, minWidth: 0 },
  warningSection: { marginTop: 24 },
  refreshNotice: { alignItems: 'center', borderRadius: 14, flexDirection: 'row', gap: 12, marginTop: 18, padding: 13 },
  warningHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  warningTitle: { fontFamily: Fonts.sans, fontSize: 14, fontWeight: '700' },
  warningRow: { borderRadius: 13, marginBottom: 7, padding: 12 },
  warningScope: { fontFamily: Fonts.sans, fontSize: 9, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  warningMessage: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 16, marginTop: 4 },
  section: { marginTop: 20 },
  sectionHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, minHeight: 28 },
  sectionTitleRow: { alignItems: 'baseline', flexDirection: 'row', flexShrink: 1, gap: 8 },
  sectionTitle: { fontFamily: Fonts.sans, fontSize: 17, fontWeight: '500', letterSpacing: -0.4 },
  sectionCount: { fontFamily: Fonts.sans, fontSize: 10 },
  attentionRow: { alignItems: 'flex-start', borderRadius: 14, flexDirection: 'row', gap: 11, padding: 13 },
  attentionDot: { borderRadius: 4, height: 7, marginTop: 6, width: 7 },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '500' },
  rowSubtitle: { fontFamily: Fonts.sans, fontSize: 10, lineHeight: 15, marginTop: 4 },
  emptyState: { borderRadius: 16, marginTop: 24, padding: 16 },
  emptyTitle: { fontFamily: Fonts.sans, fontSize: 15, fontWeight: '700' },
  emptyBody: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 17, marginTop: 5 },
  positionCard: { borderRadius: 17, padding: 14 },
  positionPreview: { alignItems: 'center', borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 11, minHeight: 76, padding: 14 },
  positionPreviewValue: { alignItems: 'flex-end', flexShrink: 0 },
  positionPreviewPnl: { fontFamily: Fonts.mono, fontSize: 13, fontWeight: '500' },
  positionPreviewExposure: { fontFamily: Fonts.sans, fontSize: 10, marginTop: 4 },
  positionHeader: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  logo: { alignItems: 'center', borderRadius: 10, height: 34, justifyContent: 'center', overflow: 'hidden', width: 34 },
  logoImage: { height: 34, width: 34 },
  logoText: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '800' },
  openBadge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  openBadgeText: { fontFamily: Fonts.sans, fontSize: 9, fontWeight: '800' },
  positionNumbers: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between', marginTop: 15 },
  positionPnl: { flex: 1, fontFamily: Fonts.mono, fontSize: 13, fontWeight: '700' },
  positionExposure: { fontFamily: Fonts.mono, fontSize: 10 },
  factGrid: { flexDirection: 'row', gap: 8, marginTop: 14 },
  factItem: { flex: 1 },
  factLabel: { fontFamily: Fonts.sans, fontSize: 9 },
  factValue: { fontFamily: Fonts.mono, fontSize: 10, fontWeight: '600', marginTop: 4 },
  riskLine: { fontFamily: Fonts.sans, fontSize: 10, lineHeight: 15, marginTop: 13 },
  orderRow: { alignItems: 'center', borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 10, minHeight: 64, padding: 12 },
  statusBadge: { borderRadius: 999, maxWidth: 92, paddingHorizontal: 9, paddingVertical: 5 },
  statusBadgeText: { fontFamily: Fonts.sans, fontSize: 9, fontWeight: '800' },
  register: { borderTopWidth: StyleSheet.hairlineWidth },
  holdingRow: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 10, minHeight: 66, paddingVertical: 10 },
  holdingValue: { alignItems: 'flex-end', maxWidth: 122 },
  holdingAmount: { fontFamily: Fonts.mono, fontSize: 13, fontWeight: '500' },
  holdingChange: { fontFamily: Fonts.sans, fontSize: 9, marginTop: 4, textAlign: 'right' },
  emptyRow: { alignItems: 'center', borderRadius: 14, borderStyle: 'dashed', borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center', minHeight: 58, padding: 12 },
  emptyRowText: { fontFamily: Fonts.sans, fontSize: 11 },
  disclosure: { fontFamily: Fonts.sans, fontSize: 10, lineHeight: 15, marginTop: 24 },
  modalLayer: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(3,7,6,0.76)' },
  sheet: { borderBottomWidth: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, maxHeight: '86%', paddingBottom: 12, paddingHorizontal: 20, paddingTop: 10 },
  sheetScroll: { flexShrink: 1 },
  sheetContent: { paddingBottom: 12 },
  sheetHandle: { alignSelf: 'center', borderRadius: 2, height: 4, marginBottom: 14, width: 40 },
  sheetHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  sheetTitle: { fontFamily: Fonts.sans, fontSize: 21, fontWeight: '500', letterSpacing: -0.4 },
  closeButton: { alignItems: 'center', borderRadius: 14, height: 44, justifyContent: 'center', width: 44 },
  closeText: { fontFamily: Fonts.sans, fontSize: 25, lineHeight: 27 },
  sheetCopy: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 20, marginTop: 9 },
  receiveAddress: { borderRadius: 15, fontFamily: Fonts.mono, fontSize: 13, lineHeight: 20, marginBottom: 12, marginTop: 17, padding: 16 },
  reconcileList: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 17 },
  reconcileRow: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', minHeight: 48 },
  reconcileLabel: { flex: 1, fontFamily: Fonts.sans, fontSize: 12 },
  reconcileValue: { fontFamily: Fonts.mono, fontSize: 12, fontWeight: '600' },
  reconcileStrong: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '800' },
  sheetFact: { borderRadius: 13, flexDirection: 'row', flexWrap: 'wrap', marginTop: 15, padding: 13 },
  sheetFactText: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 17 },
  sheetFactValue: { fontFamily: Fonts.mono, fontSize: 11, fontWeight: '700', lineHeight: 17 },
  emptyDeposit: { marginTop: 20, minHeight: 49 },
  pressed: { opacity: 0.72 },
  rowPressed: { opacity: 0.78, transform: [{ scale: 0.995 }] },
});
