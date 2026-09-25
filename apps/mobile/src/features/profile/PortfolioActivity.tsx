import type {
  PortfolioActivityItem,
  PortfolioActivityResponse,
  PortfolioWarning,
} from '@warren/portfolio-contract';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import {
  activityActionLabel,
  activityKindLabel,
  activityPageCanCommit,
  activityRefreshFlags,
  activitySheetKeys,
  activityStatusLabel,
  buildActivityRows,
  formatActivityDateTime,
  formatActivityTime,
  formatActivityValue,
  mergeActivityItems,
  mergePortfolioWarnings,
  type ActivityFilters,
  type ActivityListRow,
} from './portfolio-activity-view-model';
import { loadPortfolioActivity, PortfolioRequestError } from './portfolio-api';

type ActivityState =
  | { generation: number; key: string; phase: 'loading' }
  | { error: PortfolioRequestError; generation: number; key: string; phase: 'error' }
  | {
      data: PortfolioActivityResponse;
      generation: number;
      key: string;
      loadMoreError?: string;
      loadingMore: boolean;
      phase: 'ready';
      refreshError?: string;
      refreshing: boolean;
    };

const KIND_FILTERS: { label: string; value: ActivityFilters['kind'] }[] = [
  { label: 'All', value: 'all' },
  { label: 'Trades', value: 'trades' },
  { label: 'Perpetuals', value: 'perpetuals' },
  { label: 'Transfers', value: 'transfers' },
  { label: 'Funding', value: 'funding' },
];

const STATUS_FILTERS: { label: string; value: ActivityFilters['status'] }[] = [
  { label: 'All statuses', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Confirmed', value: 'confirmed' },
  { label: 'Failed', value: 'failed' },
  { label: 'Unknown', value: 'unknown' },
];

export function PortfolioActivity({
  getAccessToken,
  onSignInAgain,
  walletAddress,
}: {
  getAccessToken: () => Promise<string>;
  onSignInAgain: () => void;
  walletAddress: string;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [kind, setKind] = useState<ActivityFilters['kind']>('all');
  const [status, setStatus] = useState<ActivityFilters['status']>('all');
  const [statusSheetOpen, setStatusSheetOpen] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<PortfolioActivityItem | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const paginationController = useRef<AbortController | null>(null);
  const paginationRunning = useRef(false);
  const requestGeneration = useRef(0);
  const filters = useMemo<ActivityFilters>(() => ({ kind, query: debouncedQuery, status }), [debouncedQuery, kind, status]);
  const filterKey = `${kind}:${status}:${debouncedQuery}`;
  const [state, setState] = useState<ActivityState>({ generation: 0, key: filterKey, phase: 'loading' });

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    const generation = ++requestGeneration.current;
    const controller = new AbortController();
    paginationController.current?.abort();
    paginationRunning.current = false;
    const timeout = setTimeout(() => {
      setState((current) => current.phase === 'ready' && current.key === filterKey
        ? { ...current, ...activityRefreshFlags(), generation }
        : { generation, key: filterKey, phase: 'loading' });
      void loadPortfolioActivity({ filters, getAccessToken, signal: controller.signal, walletAddress })
        .then((data) => {
          if (!controller.signal.aborted && requestGeneration.current === generation) {
            setState({ data, generation, key: filterKey, loadingMore: false, phase: 'ready', refreshing: false });
          }
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === 'AbortError') return;
          const safeError = error instanceof PortfolioRequestError
            ? error
            : new PortfolioRequestError('Warren could not refresh your activity. Pull down to try again.', 'service', true);
          if (!controller.signal.aborted && requestGeneration.current === generation) {
            setState((current) => current.phase === 'ready'
              && current.key === filterKey
              && current.generation === generation
              && safeError.failure !== 'session'
              && safeError.failure !== 'wallet'
              ? { ...current, loadMoreError: undefined, loadingMore: false, refreshError: safeError.message, refreshing: false }
              : { error: safeError, generation, key: filterKey, phase: 'error' });
          }
        });
    }, 0);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [filterKey, filters, getAccessToken, requestVersion, walletAddress]);

  useEffect(() => () => paginationController.current?.abort(), []);

  const refresh = useCallback(() => {
    const generation = ++requestGeneration.current;
    paginationController.current?.abort();
    paginationController.current = null;
    paginationRunning.current = false;
    setState((current) => current.phase === 'ready'
      ? { ...current, ...activityRefreshFlags(), generation }
      : { generation, key: filterKey, phase: 'loading' });
    setRequestVersion((current) => current + 1);
  }, [filterKey]);

  const loadMore = useCallback(() => {
    if (
      state.phase !== 'ready'
      || state.key !== filterKey
      || state.generation !== requestGeneration.current
      || state.loadingMore
      || state.refreshing
      || paginationRunning.current
    ) return;
    const cursor = state.data.pageInfo.nextCursor;
    if (!state.data.pageInfo.hasNextPage || !cursor) return;
    paginationRunning.current = true;
    const generation = state.generation;
    const controller = new AbortController();
    paginationController.current = controller;
    setState((current) => current.phase === 'ready' && current.key === filterKey
      ? { ...current, loadMoreError: undefined, loadingMore: true }
      : current);
    void loadPortfolioActivity({ cursor, filters, getAccessToken, signal: controller.signal, walletAddress })
      .then((page) => {
        if (controller.signal.aborted) return;
        setState((current) => current.phase === 'ready'
          && current.key === filterKey
          && activityPageCanCommit({
            currentCursor: current.data.pageInfo.nextCursor,
            currentGeneration: current.generation,
            refreshing: current.refreshing,
            requestCursor: cursor,
            requestGeneration: generation,
          })
          ? {
              ...current,
              data: {
                ...current.data,
                generatedAt: page.generatedAt,
                items: mergeActivityItems(current.data.items, page.items),
                pageInfo: page.pageInfo,
                warnings: mergePortfolioWarnings(current.data.warnings, page.warnings),
              },
              loadingMore: false,
            }
          : current);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') return;
        const safeError = error instanceof PortfolioRequestError
          ? error
          : new PortfolioRequestError('Earlier activity could not be loaded.', 'service', true);
        setState((current) => {
          if (requestGeneration.current !== generation) return current;
          if (safeError.failure === 'session' || safeError.failure === 'wallet') {
            return { error: safeError, generation, key: filterKey, phase: 'error' };
          }
          return current.phase === 'ready' && current.key === filterKey && current.generation === generation
            ? { ...current, loadMoreError: safeError.message, loadingMore: false }
            : current;
        });
      })
      .finally(() => {
        if (paginationController.current === controller) paginationController.current = null;
        paginationRunning.current = false;
      });
  }, [filterKey, filters, getAccessToken, state, walletAddress]);

  const rows = useMemo(
    () => buildActivityRows(state.phase === 'ready' && state.key === filterKey ? state.data.items : []),
    [filterKey, state],
  );
  const searchPending = query.trim() !== debouncedQuery;
  const readyState = state.phase === 'ready' && state.key === filterKey ? state : undefined;
  const refreshing = readyState?.refreshing ?? false;
  const hasDefaultFilters = query.trim() === '' && kind === 'all' && status === 'all';
  const isCleanAccountEmpty = Boolean(
    readyState
    && rows.length === 0
    && hasDefaultFilters
    && !readyState.refreshError
    && readyState.data.warnings.length === 0,
  );
  const sheetKeys = activitySheetKeys({
    activityId: selectedActivity?.activityId ?? null,
    status,
    statusSheetOpen,
  });

  const renderRow = useCallback(({ item: row }: { item: ActivityListRow }) => (
    row.kind === 'header'
      ? <ActivityDateHeader label={row.label} />
      : <ActivityRow item={row.item} onPress={() => setSelectedActivity(row.item)} />
  ), []);

  return (
    <View style={styles.screen}>
      <FlatList
        contentContainerStyle={[styles.listContent, { paddingHorizontal: width < 360 ? 14 : 18 }, rows.length === 0 && styles.emptyListContent]}
        data={rows}
        initialNumToRender={14}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(row) => row.key}
        ListEmptyComponent={(
          <ActivityEmpty
            error={state.phase === 'error' ? state.error : undefined}
            filtered={!hasDefaultFilters}
            loading={state.phase === 'loading' || state.key !== filterKey}
            onRetry={state.phase === 'error' && (state.error.failure === 'session' || state.error.failure === 'wallet') ? onSignInAgain : refresh}
          />
        )}
        ListFooterComponent={readyState && rows.length > 0 ? (
          <ActivityFooter
            error={readyState.loadMoreError}
            hasNextPage={readyState.data.pageInfo.hasNextPage}
            loading={readyState.loadingMore}
            onLoadMore={loadMore}
          />
        ) : null}
        ListHeaderComponent={isCleanAccountEmpty ? null : (
          <ActivityHeader
            filters={filters}
            onKindChange={setKind}
            onOpenStatus={() => setStatusSheetOpen(true)}
            onQueryChange={setQuery}
            onRefresh={refresh}
            query={query}
            refreshError={readyState?.refreshError}
            refreshing={refreshing}
            searchPending={searchPending}
            walletAddress={walletAddress}
            warnings={readyState?.data.warnings ?? []}
          />
        )}
        onEndReached={loadMore}
        onEndReachedThreshold={0.35}
        refreshControl={<RefreshControl onRefresh={refresh} refreshing={refreshing} tintColor={theme.proof} />}
        renderItem={renderRow}
        showsVerticalScrollIndicator={false}
      />
      <StatusFilterSheet
        key={sheetKeys.statusFilter}
        onClose={() => setStatusSheetOpen(false)}
        onSelect={(nextStatus) => {
          setStatus(nextStatus);
          setStatusSheetOpen(false);
        }}
        selected={status}
        visible={statusSheetOpen}
      />
      <ActivityDetailSheet
        key={sheetKeys.activityDetail}
        item={selectedActivity}
        onClose={() => setSelectedActivity(null)}
        walletAddress={walletAddress}
      />
    </View>
  );
}

function ActivityHeader({
  filters,
  onKindChange,
  onOpenStatus,
  onQueryChange,
  onRefresh,
  query,
  refreshError,
  refreshing,
  searchPending,
  walletAddress,
  warnings,
}: {
  filters: ActivityFilters;
  onKindChange: (kind: ActivityFilters['kind']) => void;
  onOpenStatus: () => void;
  onQueryChange: (query: string) => void;
  onRefresh: () => void;
  query: string;
  refreshError?: string;
  refreshing: boolean;
  searchPending: boolean;
  walletAddress: string;
  warnings: PortfolioWarning[];
}) {
  const theme = useTheme();
  return (
    <View>
      <View style={[styles.searchField, { backgroundColor: theme.surface, borderColor: `${theme.muted}33` }]}>
        <SearchIcon color={theme.muted} />
        <TextInput
          accessibilityLabel="Search Portfolio activity"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={80}
          onChangeText={onQueryChange}
          placeholder="Company, ticker, or transaction"
          placeholderTextColor={theme.muted}
          returnKeyType="search"
          style={[styles.searchInput, { color: theme.ink }]}
          value={query}
        />
        {searchPending || refreshing ? <ActivityIndicator color={theme.proof} size="small" /> : query ? (
          <Pressable accessibilityLabel="Clear activity search" accessibilityRole="button" onPress={() => onQueryChange('')} style={styles.clearButton}><Text style={[styles.clearText, { color: theme.muted }]}>×</Text></Pressable>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.filterStrip} horizontal showsHorizontalScrollIndicator={false}>
        {KIND_FILTERS.map((option) => (
          <FilterChip active={filters.kind === option.value} key={option.value} label={option.label} onPress={() => onKindChange(option.value)} />
        ))}
      </ScrollView>

      <View style={[styles.toolRow, { borderBottomColor: `${theme.muted}33` }]}>
        <View style={styles.walletScope}>
          <View style={[styles.walletDot, { backgroundColor: theme.proof }]} />
          <Text numberOfLines={1} style={[styles.walletScopeText, { color: theme.muted }]}>Active wallet {shortAddress(walletAddress)}</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={onOpenStatus} style={({ pressed }) => [styles.statusFilter, pressed && styles.pressed]}>
          <Text style={[styles.statusFilterText, { color: theme.ink }]}>{statusFilterLabel(filters.status)} ▾</Text>
        </Pressable>
      </View>

      {refreshError ? <InlineNotice message={`${refreshError} Showing the last successful result.`} onRetry={onRefresh} retrying={refreshing} /> : null}
      {warnings.map((warning) => <InlineNotice key={`${warning.section}:${warning.code}`} message={`${warningSectionLabel(warning)}: ${warning.message}`} onRetry={warning.retryable ? onRefresh : undefined} retrying={refreshing} />)}
    </View>
  );
}

function FilterChip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.filterChip, { backgroundColor: active ? theme.proofWash : 'transparent', borderColor: active ? theme.proof : `${theme.muted}33` }, pressed && styles.pressed]}>
      <Text style={[styles.filterChipText, { color: active ? theme.proof : theme.muted }]}>{label}</Text>
    </Pressable>
  );
}

function InlineNotice({ message, onRetry, retrying }: { message: string; onRetry?: () => void; retrying: boolean }) {
  const theme = useTheme();
  return (
    <View accessibilityLiveRegion="polite" style={[styles.notice, { backgroundColor: theme.cautionWash }]}>
      <Text style={[styles.noticeText, { color: theme.ink }]}>{message}</Text>
      {onRetry ? <Pressable accessibilityRole="button" disabled={retrying} onPress={onRetry}><Text style={[styles.noticeAction, { color: theme.proof }]}>{retrying ? 'Retrying…' : 'Retry'}</Text></Pressable> : null}
    </View>
  );
}

function ActivityDateHeader({ label }: { label: string }) {
  const theme = useTheme();
  return <View style={styles.dateHeader}><Text accessibilityRole="header" style={[styles.dateLabel, { color: theme.muted }]}>{label}</Text></View>;
}

function ActivityRow({ item, onPress }: { item: PortfolioActivityItem; onPress: () => void }) {
  const theme = useTheme();
  const value = formatActivityValue(item);
  const statusTone = item.status === 'confirmed' ? theme.proof : item.status === 'failed' || item.status === 'unknown' ? theme.caution : theme.muted;
  return (
    <Pressable
      accessibilityLabel={`View ${item.title}, ${activityStatusLabel(item.status)}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.activityRow, { borderBottomColor: `${theme.muted}33` }, pressed && styles.rowPressed]}>
      <View style={[styles.activityIcon, { backgroundColor: item.kind === 'perpetual' || item.kind === 'funding' ? theme.proofWash : theme.surface }]}>
        <Text style={[styles.activityIconText, { color: item.kind === 'transfer' ? theme.muted : theme.proof }]}>{activityIcon(item)}</Text>
      </View>
      <View style={styles.activityCopy}>
        <Text numberOfLines={1} style={[styles.activityTitle, { color: theme.ink }]}>{item.title}</Text>
        <Text numberOfLines={1} style={[styles.activitySubtitle, { color: theme.muted }]}>{item.subtitle} · {formatActivityTime(item.occurredAt)}</Text>
      </View>
      <View style={styles.activityValue}>
        {value ? <Text style={[styles.activityAmount, { color: theme.ink }]}>{value}</Text> : null}
        <Text style={[styles.activityStatus, { color: statusTone }]}>{activityStatusLabel(item.status)}</Text>
      </View>
    </Pressable>
  );
}

function ActivityEmpty({
  error,
  filtered,
  loading,
  onRetry,
}: {
  error?: PortfolioRequestError;
  filtered: boolean;
  loading: boolean;
  onRetry: () => void;
}) {
  const theme = useTheme();
  if (loading) {
    return <View accessibilityLiveRegion="polite" style={styles.emptyState}><ActivityIndicator color={theme.proof} size="small" /><Text style={[styles.emptyTitle, { color: theme.ink }]}>Loading activity</Text><Text style={[styles.emptyBody, { color: theme.muted }]}>Searching your wallet and Phoenix events.</Text></View>;
  }
  return (
    <View accessibilityLiveRegion="polite" style={styles.emptyState}>
      <Text style={[styles.emptyEyebrow, { color: theme.proof }]}>{error ? 'ACTIVITY NEEDS ATTENTION' : 'ACTIVITY'}</Text>
      <Text style={[styles.emptyTitle, { color: theme.ink }]}>{error ? 'Activity could not load' : filtered ? 'No matching activity' : 'No activity yet'}</Text>
      <Text style={[styles.emptyBody, { color: theme.muted }]}>{error?.message ?? (filtered
        ? 'Try another company, product, or status filter.'
        : 'Trades, transfers, Phoenix orders, and funding events will appear here after your first action.')}</Text>
      {error ? <PrimaryButton label={error.failure === 'session' || error.failure === 'wallet' ? 'Sign in again' : 'Try again'} onPress={onRetry} /> : null}
    </View>
  );
}

function ActivityFooter({ error, hasNextPage, loading, onLoadMore }: { error?: string; hasNextPage: boolean; loading: boolean; onLoadMore: () => void }) {
  const theme = useTheme();
  if (loading) return <View style={styles.footer}><ActivityIndicator color={theme.proof} size="small" /><Text style={[styles.footerText, { color: theme.muted }]}>Loading earlier activity…</Text></View>;
  if (error) return <View style={styles.footer}><Text style={[styles.footerText, { color: theme.caution }]}>{error}</Text><Pressable accessibilityRole="button" onPress={onLoadMore}><Text style={[styles.noticeAction, { color: theme.proof }]}>Try again</Text></Pressable></View>;
  if (!hasNextPage) return <Text style={[styles.endLabel, { color: theme.muted }]}>You’re caught up with your activity.</Text>;
  return <Pressable accessibilityRole="button" onPress={onLoadMore} style={({ pressed }) => [styles.loadMore, { borderColor: `${theme.muted}33` }, pressed && styles.pressed]}><Text style={[styles.loadMoreText, { color: theme.ink }]}>Load earlier activity</Text></Pressable>;
}

function StatusFilterSheet({
  onClose,
  onSelect,
  selected,
  visible,
}: {
  onClose: () => void;
  onSelect: (status: ActivityFilters['status']) => void;
  selected: ActivityFilters['status'];
  visible: boolean;
}) {
  const theme = useTheme();
  return (
    <Modal animationType="slide" onRequestClose={onClose} statusBarTranslucent transparent visible={visible}>
      <View style={styles.modalLayer}>
        <Pressable accessibilityLabel="Close status filters" accessibilityRole="button" onPress={onClose} style={styles.backdrop} />
        <SafeAreaView edges={['bottom', 'left', 'right']} style={[styles.sheet, { backgroundColor: theme.canvas, borderTopColor: theme.outline }]}>
          <View style={[styles.sheetHandle, { backgroundColor: theme.outline }]} />
          <View style={styles.sheetHeader}>
            <Text accessibilityRole="header" style={[styles.sheetTitle, { color: theme.ink }]}>Activity status</Text>
            <CloseButton onPress={onClose} />
          </View>
          <Text style={[styles.sheetCopy, { color: theme.muted }]}>Filter activity by its latest known status.</Text>
          <View style={[styles.statusOptions, { borderTopColor: `${theme.muted}33` }]}>
            {STATUS_FILTERS.map((option) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: selected === option.value }}
                key={option.value}
                onPress={() => onSelect(option.value)}
                style={({ pressed }) => [styles.statusOption, { borderBottomColor: `${theme.muted}33` }, pressed && styles.pressed]}>
                <Text style={[styles.statusOptionText, { color: selected === option.value ? theme.proof : theme.ink }]}>{option.label}</Text>
                <Text style={[styles.statusOptionMark, { color: selected === option.value ? theme.proof : theme.muted }]}>{selected === option.value ? '✓' : ''}</Text>
              </Pressable>
            ))}
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function ActivityDetailSheet({ item, onClose, walletAddress }: { item: PortfolioActivityItem | null; onClose: () => void; walletAddress: string }) {
  const theme = useTheme();
  const [notice, setNotice] = useState<string>();
  const copyReference = async () => {
    const reference = item?.signature ?? item?.executionId;
    if (!reference) return;
    await Clipboard.setStringAsync(reference);
    setNotice('Transaction reference copied.');
  };
  const openExplorer = async () => {
    if (!item?.explorerUrl) return;
    try {
      await Linking.openURL(item.explorerUrl);
    } catch {
      setNotice('The transaction link could not be opened.');
    }
  };
  return (
    <Modal animationType="slide" onRequestClose={onClose} statusBarTranslucent transparent visible={item !== null}>
      <View style={styles.modalLayer}>
        <Pressable accessibilityLabel="Close activity details" accessibilityRole="button" onPress={onClose} style={styles.backdrop} />
        <SafeAreaView edges={['bottom', 'left', 'right']} style={[styles.sheet, styles.detailSheet, { backgroundColor: theme.canvas, borderTopColor: theme.outline }]}>
          <View style={[styles.sheetHandle, { backgroundColor: theme.outline }]} />
          <View style={styles.sheetHeader}>
            <Text accessibilityRole="header" numberOfLines={2} style={[styles.sheetTitle, styles.detailSheetTitle, { color: theme.ink }]}>{item?.title ?? 'Activity details'}</Text>
            <CloseButton onPress={onClose} />
          </View>
          {item ? (
            <ScrollView contentContainerStyle={styles.detailContent} showsVerticalScrollIndicator={false}>
              <View style={[styles.detailStatus, { backgroundColor: item.status === 'confirmed' ? theme.proofWash : theme.cautionWash }]}>
                <Text style={[styles.detailStatusText, { color: item.status === 'confirmed' ? theme.proof : theme.caution }]}>{activityStatusLabel(item.status)}</Text>
                <Text style={[styles.detailStatusCopy, { color: theme.ink }]}>{item.subtitle}</Text>
              </View>
              <DetailRow label="Event" value={activityActionLabel(item.action)} />
              <DetailRow label="Product" value={productLabel(item)} />
              <DetailRow label="Kind" value={activityKindLabel(item.kind)} />
              {item.quantity ? <DetailRow label="Quantity" value={`${item.quantity}${item.symbol ? ` ${item.symbol}` : ''}`} /> : null}
              {item.valueUsd !== null ? <DetailRow label="Value" value={formatActivityValue(item) ?? '—'} /> : null}
              <DetailRow label="Occurred" value={formatActivityDateTime(item.occurredAt)} />
              <DetailRow label="Wallet" value={shortAddress(walletAddress)} />
              {item.signature ? <DetailRow label="Transaction" value={shortReference(item.signature)} /> : null}
              {item.executionId ? <DetailRow label="Warren execution" value={shortReference(item.executionId)} /> : null}
              {item.signature || item.executionId ? <PrimaryButton label={notice === 'Transaction reference copied.' ? 'Reference copied' : 'Copy reference'} onPress={() => void copyReference()} /> : null}
              {item.explorerUrl ? <SecondaryButton label="Open transaction in browser" onPress={() => void openExplorer()} /> : null}
              {notice ? <Text accessibilityLiveRegion="polite" style={[styles.detailNotice, { color: notice.includes('could not') ? theme.caution : theme.proof }]}>{notice}</Text> : null}
              <Text style={[styles.detailDisclosure, { color: theme.muted }]}>Opening the transaction is an explicit browser action. Warren never redirects automatically.</Text>
            </ScrollView>
          ) : null}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return <View style={[styles.detailRow, { borderBottomColor: `${theme.muted}33` }]}><Text style={[styles.detailLabel, { color: theme.muted }]}>{label}</Text><Text selectable style={[styles.detailValue, { color: theme.ink }]}>{value}</Text></View>;
}

function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.primaryButton, { backgroundColor: theme.proof }, pressed && styles.pressed]}><Text style={[styles.primaryButtonText, { color: theme.onProof }]}>{label}</Text></Pressable>;
}

function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.secondaryButton, { borderColor: `${theme.muted}33` }, pressed && styles.pressed]}><Text style={[styles.secondaryButtonText, { color: theme.ink }]}>{label}</Text></Pressable>;
}

function CloseButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return <Pressable accessibilityLabel="Close" accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.closeButton, { backgroundColor: theme.canvas }, pressed && styles.pressed]}><Text style={[styles.closeText, { color: theme.muted }]}>×</Text></Pressable>;
}

function SearchIcon({ color }: { color: string }) {
  return <Svg fill="none" height={19} viewBox="0 0 24 24" width={19}><Circle cx={10.5} cy={10.5} r={5.5} stroke={color} strokeWidth={1.8} /><Path d="m15 15 4.5 4.5" stroke={color} strokeLinecap="round" strokeWidth={1.8} /></Svg>;
}

function activityIcon(item: PortfolioActivityItem) {
  if (item.kind === 'funding') return 'ƒ';
  if (item.kind === 'perpetual') return item.action === 'order_submitted' ? '≡' : '↗';
  if (item.kind === 'transfer') return item.action === 'received' ? '↓' : '↑';
  return item.companyName ? initials(item.companyName) : '↔';
}

function statusFilterLabel(status: ActivityFilters['status']) {
  return STATUS_FILTERS.find((option) => option.value === status)?.label ?? 'All statuses';
}

function warningSectionLabel(warning: PortfolioWarning) {
  if (warning.code.startsWith('PERPETUAL_') || warning.code.startsWith('PHOENIX_')) return 'Phoenix';
  if (warning.code.startsWith('WALLET_')) return 'Wallet';
  if (warning.section === 'wallet') return 'Wallet';
  if (warning.section === 'perpetuals') return 'Perpetuals';
  if (warning.section === 'executions') return 'Warren orders';
  if (warning.section === 'valuation') return 'Valuation';
  return 'Activity';
}

function productLabel(item: PortfolioActivityItem) {
  if (item.productType === 'prestock') return 'PreStock';
  if (item.productType === 'perpetual') return 'Equity perpetual';
  if (item.productType === 'cash') return 'Cash / network balance';
  return 'Spot stock token';
}

function shortAddress(value: string) {
  return value.length > 12 ? `${value.slice(0, 5)}…${value.slice(-4)}` : value;
}

function shortReference(value: string) {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function initials(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}` : name.slice(0, 2)).toUpperCase();
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  listContent: { paddingBottom: Spacing.five, paddingHorizontal: 18 },
  emptyListContent: { flexGrow: 1 },
  searchField: { alignItems: 'center', borderRadius: 13, borderWidth: 1, flexDirection: 'row', gap: 9, height: 50, marginTop: 16, paddingHorizontal: 13 },
  searchInput: { flex: 1, fontFamily: Fonts.sans, fontSize: 14, minWidth: 0, padding: 0 },
  clearButton: { alignItems: 'center', height: 38, justifyContent: 'center', width: 38 },
  clearText: { fontFamily: Fonts.sans, fontSize: 22, lineHeight: 24 },
  filterStrip: { gap: 7, paddingBottom: 12, paddingTop: 12 },
  filterChip: { alignItems: 'center', borderRadius: 10, borderWidth: 1, justifyContent: 'center', minHeight: 40, paddingHorizontal: 13 },
  filterChipText: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '500' },
  toolRow: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 8, minHeight: 50 },
  walletScope: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 7, minHeight: 40 },
  walletDot: { borderRadius: 4, height: 7, width: 7 },
  walletScopeText: { flex: 1, fontFamily: Fonts.mono, fontSize: 9 },
  statusFilter: { alignItems: 'center', justifyContent: 'center', minHeight: 40, paddingHorizontal: 0 },
  statusFilterText: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '500' },
  notice: { alignItems: 'center', borderRadius: 13, flexDirection: 'row', gap: 10, marginTop: 8, padding: 11 },
  noticeText: { flex: 1, fontFamily: Fonts.sans, fontSize: 10, lineHeight: 15 },
  noticeAction: { fontFamily: Fonts.sans, fontSize: 10, fontWeight: '800' },
  dateHeader: { justifyContent: 'flex-end', minHeight: 47, paddingBottom: 8 },
  dateLabel: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  activityRow: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 10, minHeight: 66, paddingVertical: 9 },
  activityIcon: { alignItems: 'center', borderRadius: 10, height: 34, justifyContent: 'center', width: 34 },
  activityIconText: { fontFamily: Fonts.mono, fontSize: 11, fontWeight: '800' },
  activityCopy: { flex: 1, minWidth: 0 },
  activityTitle: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '500' },
  activitySubtitle: { fontFamily: Fonts.sans, fontSize: 11, marginTop: 5 },
  activityValue: { alignItems: 'flex-end', maxWidth: 110, minWidth: 76 },
  activityAmount: { fontFamily: Fonts.mono, fontSize: 12, fontWeight: '500' },
  activityStatus: { fontFamily: Fonts.sans, fontSize: 10, fontWeight: '500', marginTop: 5 },
  emptyState: { alignItems: 'center', flex: 1, justifyContent: 'center', minHeight: 260, paddingHorizontal: 24 },
  emptyEyebrow: { fontFamily: Fonts.mono, fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  emptyTitle: { fontFamily: Fonts.sans, fontSize: 17, fontWeight: '700', marginTop: 14, textAlign: 'center' },
  emptyBody: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18, marginBottom: 16, marginTop: 6, textAlign: 'center' },
  footer: { alignItems: 'center', gap: 8, justifyContent: 'center', minHeight: 76, paddingVertical: 14 },
  footerText: { fontFamily: Fonts.sans, fontSize: 10, lineHeight: 15, textAlign: 'center' },
  endLabel: { fontFamily: Fonts.sans, fontSize: 10, lineHeight: 15, paddingVertical: 24, textAlign: 'center' },
  loadMore: { alignItems: 'center', borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center', marginVertical: 16, minHeight: 46 },
  loadMoreText: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '700' },
  primaryButton: { alignItems: 'center', borderRadius: 13, justifyContent: 'center', marginTop: 12, minHeight: 48, paddingHorizontal: 18 },
  primaryButtonText: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '800' },
  secondaryButton: { alignItems: 'center', borderRadius: 13, borderWidth: 1, justifyContent: 'center', marginTop: 9, minHeight: 48, paddingHorizontal: 18 },
  secondaryButtonText: { fontFamily: Fonts.sans, fontSize: 12, fontWeight: '700' },
  modalLayer: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(3,7,6,0.76)' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, maxHeight: '88%', paddingBottom: 10, paddingHorizontal: 20, paddingTop: 10 },
  detailSheet: { flexShrink: 1 },
  sheetHandle: { alignSelf: 'center', borderRadius: 2, height: 4, marginBottom: 14, width: 40 },
  sheetHeader: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  sheetTitle: { flexShrink: 1, fontFamily: Fonts.sans, fontSize: 21, fontWeight: '500', letterSpacing: -0.6 },
  detailSheetTitle: { maxWidth: '82%' },
  closeButton: { alignItems: 'center', borderRadius: 14, height: 44, justifyContent: 'center', width: 44 },
  closeText: { fontFamily: Fonts.sans, fontSize: 25, lineHeight: 27 },
  sheetCopy: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18, marginTop: 7 },
  statusOptions: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 14 },
  statusOption: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', minHeight: 50 },
  statusOptionText: { fontFamily: Fonts.sans, fontSize: 14, fontWeight: '400' },
  statusOptionMark: { fontFamily: Fonts.sans, fontSize: 18, fontWeight: '500', minWidth: 24, textAlign: 'right' },
  detailContent: { paddingBottom: 12 },
  detailStatus: { borderRadius: 14, marginTop: 10, padding: 13 },
  detailStatusText: { fontFamily: Fonts.sans, fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  detailStatusCopy: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18, marginTop: 5 },
  detailRow: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12, justifyContent: 'space-between', minHeight: 48 },
  detailLabel: { flex: 1, fontFamily: Fonts.sans, fontSize: 11 },
  detailValue: { flex: 1, fontFamily: Fonts.mono, fontSize: 10, fontWeight: '600', lineHeight: 15, textAlign: 'right' },
  detailNotice: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '700', marginTop: 12, textAlign: 'center' },
  detailDisclosure: { fontFamily: Fonts.sans, fontSize: 9, lineHeight: 14, marginTop: 14, textAlign: 'center' },
  pressed: { opacity: 0.72 },
  rowPressed: { opacity: 0.78, transform: [{ scale: 0.995 }] },
});
