import type {
  CompanySummary,
  DataState,
  HomeResponse,
  IndexSummary,
  NewsSummary,
} from '@warren/home-contract';
import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { BrandLogo } from '@/components/brand-logo';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import {
  getCachedHome,
  HomeRequestError,
  loadEarnings,
  loadHome,
  loadMovers,
  loadWatchlist,
  searchAssets,
} from './home-api';

type MarketMode = 'all' | 'watchlist' | 'earnings';
type MovementView = 'gainers' | 'losers';
type HomeIconName = 'calendar' | 'clock' | 'deposit' | 'grid' | 'long' | 'search' | 'send' | 'star' | 'swap' | 'plus';

const SAVED_ASSET_IDS: readonly string[] = [];
const BOARD_ROWS = 4;
const SEARCH_DEBOUNCE_MS = 225;
const SEARCH_CACHE_TTL_MS = 30_000;

type SearchCacheEntry = { items: CompanySummary[]; cachedAt: number };

export function HomeScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { fontScale, width: windowWidth } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const boardRef = useRef<ScrollView>(null);
  const searchCacheRef = useRef(new Map<string, SearchCacheEntry>());
  const searchRequestRef = useRef(0);
  const cached = getCachedHome();

  const [home, setHome] = useState<HomeResponse | undefined>(cached);
  const [isLoading, setIsLoading] = useState(!cached);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [mode, setMode] = useState<MarketMode>('all');
  const [movementView, setMovementView] = useState<MovementView>('gainers');
  const [modeCompanies, setModeCompanies] = useState<CompanySummary[]>([]);
  const [isModeLoading, setIsModeLoading] = useState(false);
  const [modeError, setModeError] = useState<string>();
  const [loserCompanies, setLoserCompanies] = useState<CompanySummary[]>([]);
  const [isMoverLoading, setIsMoverLoading] = useState(false);
  const [moverError, setMoverError] = useState<string>();
  const [query, setQuery] = useState('');
  const [remoteSearchResults, setRemoteSearchResults] = useState<CompanySummary[]>([]);
  const [completedSearchQuery, setCompletedSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string>();
  const [boardWidth, setBoardWidth] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);

  const loadInitialHome = useCallback(async (signal?: AbortSignal) => {
    setLoadError(undefined);
    try {
      const next = await loadHome(signal);
      setHome(next);
    } catch (error) {
      if (isAbort(error)) return;
      setLoadError(messageFor(error));
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadInitialHome(controller.signal);
    return () => controller.abort();
  }, [loadInitialHome]);

  const refreshHome = useCallback(async () => {
    setIsRefreshing(true);
    setLoadError(undefined);
    try {
      const next = await loadHome();
      setHome(next);
    } catch (error) {
      setLoadError(messageFor(error));
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const normalized = normalizeSearchText(query);
    const requestId = ++searchRequestRef.current;
    if (!normalized) {
      setCompletedSearchQuery('');
      setSearchError(undefined);
      setIsSearching(false);
      return;
    }

    setSearchError(undefined);
    const cachedSearch = searchCacheRef.current.get(normalized);
    if (cachedSearch && Date.now() - cachedSearch.cachedAt < SEARCH_CACHE_TTL_MS) {
      setRemoteSearchResults(cachedSearch.items);
      setCompletedSearchQuery(normalized);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      void searchAssets(normalized, controller.signal)
        .then((result) => {
          if (requestId !== searchRequestRef.current) return;
          searchCacheRef.current.set(normalized, { items: result.items, cachedAt: Date.now() });
          setRemoteSearchResults(result.items);
          setCompletedSearchQuery(normalized);
        })
        .catch((error) => {
          if (requestId === searchRequestRef.current && !isAbort(error)) {
            setSearchError(messageFor(error));
            setCompletedSearchQuery(normalized);
          }
        })
        .finally(() => {
          if (requestId === searchRequestRef.current && !controller.signal.aborted) setIsSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    setCurrentPage(0);
    boardRef.current?.scrollTo({ x: 0, animated: false });
    setModeError(undefined);

    if (mode === 'all') {
      setModeCompanies([]);
      setIsModeLoading(false);
      return;
    }
    if (mode === 'watchlist' && SAVED_ASSET_IDS.length === 0) {
      setModeCompanies([]);
      setIsModeLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsModeLoading(true);
    const request = mode === 'earnings'
      ? loadEarnings(controller.signal)
      : loadWatchlist(SAVED_ASSET_IDS, controller.signal);
    void request
      .then((result) => setModeCompanies(result.items))
      .catch((error) => {
        if (!isAbort(error)) setModeError(messageFor(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsModeLoading(false);
      });
    return () => controller.abort();
  }, [mode]);

  useEffect(() => {
    if (mode !== 'all' || movementView !== 'losers') {
      setIsMoverLoading(false);
      setMoverError(undefined);
      return;
    }
    const controller = new AbortController();
    setIsMoverLoading(true);
    setMoverError(undefined);
    void loadMovers('losers', controller.signal)
      .then((result) => setLoserCompanies(result.items))
      .catch((error) => {
        if (!isAbort(error)) setMoverError(messageFor(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsMoverLoading(false);
      });
    return () => controller.abort();
  }, [home?.generatedAt, mode, movementView]);

  const companies = mode === 'all'
    ? movementView === 'gainers' ? home?.companies ?? [] : loserCompanies
    : modeCompanies;
  const normalizedQuery = normalizeSearchText(query);
  const searchResults = useMemo(
    () => rankSearchResults(normalizedQuery, [...(home?.companies ?? []), ...remoteSearchResults]),
    [home?.companies, normalizedQuery, remoteSearchResults],
  );
  const searchPending = Boolean(normalizedQuery) && (isSearching || completedSearchQuery !== normalizedQuery);
  const columnCount = windowWidth < 340 || fontScale > 1.25 ? 2 : 3;
  const pageSize = columnCount * BOARD_ROWS;
  const pages = useMemo(() => chunk(companies, pageSize), [companies, pageSize]);
  const isCompanyBoardLoading = isModeLoading || (mode === 'all' && isMoverLoading);
  const companyBoardError = mode === 'all' ? moverError : modeError;

  useEffect(() => {
    setCurrentPage(0);
    boardRef.current?.scrollTo({ x: 0, animated: false });
  }, [movementView]);

  const openCompany = useCallback((company: CompanySummary) => {
    router.push({
      pathname: '/stocks/[symbol]',
      params: { symbol: company.ticker, assetId: company.assetId },
    } as Href);
  }, [router]);

  const updateBoardPage = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!boardWidth) return;
    setCurrentPage(Math.round(event.nativeEvent.contentOffset.x / boardWidth));
  }, [boardWidth]);

  const scrollToPage = useCallback((page: number) => {
    boardRef.current?.scrollTo({ x: page * boardWidth, animated: true });
    setCurrentPage(page);
  }, [boardWidth]);

  const onBoardLayout = useCallback((event: LayoutChangeEvent) => {
    setBoardWidth(Math.round(event.nativeEvent.layout.width));
  }, []);

  return (
    <View style={[styles.screen, { backgroundColor: theme.canvas }]}>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
        <HomeHeader onBrandPress={() => scrollRef.current?.scrollTo({ y: 0, animated: true })} />
        <ScrollView
          ref={scrollRef}
          alwaysBounceVertical={false}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={isRefreshing} tintColor={theme.proof} onRefresh={refreshHome} />}
          showsVerticalScrollIndicator={false}>
          <MarketStatus home={home} isLoading={isLoading} />

          <View style={[styles.marketDeck, { backgroundColor: theme.surface, borderColor: theme.outline }]}>
            <DiscoveryToolbar
              isSearching={searchPending}
              mode={mode}
              onModeChange={setMode}
              onQueryChange={setQuery}
              query={query}
            />
            {query.trim() ? (
              <SearchPanel
                error={searchError}
                isLoading={searchPending}
                onSelect={openCompany}
                results={searchResults}
              />
            ) : null}

            {home?.indices.length ? <IndexStrip indices={home.indices} /> : (
              <SectionMessage compact message={isLoading ? 'Loading market indices…' : 'Market indices are unavailable.'} />
            )}

            <View style={[styles.boardHeading, { borderTopColor: theme.outline }]}>
              <Text style={[styles.boardTitle, { color: theme.ink }]}>Popular companies</Text>
              {mode === 'all' ? (
                <View accessibilityLabel="Rank companies by daily movement" style={styles.movementSwitcher}>
                  <MovementButton active={movementView === 'gainers'} label="Top gainers" onPress={() => setMovementView('gainers')} />
                  <MovementButton active={movementView === 'losers'} label="Top losers" onPress={() => setMovementView('losers')} />
                </View>
              ) : (
                <Text style={[styles.boardMeta, { color: theme.muted }]}>{modeLabel(mode)}</Text>
              )}
            </View>

            <View onLayout={onBoardLayout}>
              {isLoading && !home ? (
                <CompanyBoardSkeleton columns={columnCount} />
              ) : isCompanyBoardLoading ? (
                <SectionMessage loading message={mode === 'all' ? 'Loading top losers…' : `Loading ${modeLabel(mode).toLowerCase()}…`} />
              ) : companyBoardError ? (
                <SectionMessage message={companyBoardError} />
              ) : pages.length ? (
                <ScrollView
                  ref={boardRef}
                  accessibilityLabel="Company pages"
                  decelerationRate="fast"
                  horizontal
                  onMomentumScrollEnd={updateBoardPage}
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}>
                  {pages.map((page, pageIndex) => (
                    <CompanyPage
                      key={`${mode}-${movementView}-${pageIndex}`}
                      companies={page}
                      columns={columnCount}
                      mode={mode}
                      onSelect={openCompany}
                      width={boardWidth}
                    />
                  ))}
                </ScrollView>
              ) : (
                <SectionMessage message={emptyModeMessage(mode)} />
              )}
            </View>

            <View style={[styles.deckFooter, { borderTopColor: theme.outline }]}>
              <Text style={[styles.deckNote, { color: theme.muted }]}>
                {companies.length ? `${companies.length} companies · informational prices` : 'Read-only market discovery'}
              </Text>
              {pages.length > 1 ? (
                <View accessibilityLabel="Company page selector" style={styles.pageDots}>
                  {pages.map((_, index) => (
                    <Pressable
                      key={index}
                      accessibilityLabel={`Show company page ${index + 1}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: currentPage === index }}
                      hitSlop={10}
                      onPress={() => scrollToPage(index)}
                      style={[
                        styles.pageDot,
                        { backgroundColor: currentPage === index ? theme.proof : theme.outline },
                        currentPage === index && styles.pageDotActive,
                      ]}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          </View>

          {loadError ? (
            <RetryNotice message={loadError} onRetry={() => void loadInitialHome()} />
          ) : null}

          <StaticActions />

          <NewsSection news={home?.news ?? []} unavailable={!isLoading && !home?.news.length} />

          <QuickActions />

          <Text style={[styles.disclosure, { borderTopColor: theme.outline, color: theme.muted }]}>
            Prices, market status, and headlines are informational and may be delayed. They are not executable quotes or investment recommendations.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function HomeHeader({ onBrandPress }: { onBrandPress: () => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.header, { backgroundColor: theme.canvas, borderBottomColor: theme.outline }]}>
      <Pressable
        accessibilityHint="Scrolls Home to the top"
        accessibilityLabel="Warren home"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onBrandPress}
        style={({ pressed }) => [styles.brand, pressed && styles.pressed]}>
        <BrandLogo decorative />
      </Pressable>
      <View accessibilityLabel="Browsing as guest" style={[styles.guestPill, { backgroundColor: theme.surface, borderColor: theme.outline }]}>
        <View style={[styles.guestDot, { backgroundColor: theme.proof }]} />
        <Text style={[styles.guestText, { color: theme.muted }]}>Guest</Text>
      </View>
    </View>
  );
}

function MarketStatus({ home, isLoading }: { home?: HomeResponse; isLoading: boolean }) {
  const theme = useTheme();
  const status = home?.market;
  return (
    <View accessibilityLiveRegion="polite" style={styles.marketStatus}>
      <View style={styles.marketStatusLeft}>
        <View style={[styles.statusDot, { backgroundColor: status?.session === 'open' ? theme.proof : theme.muted }]} />
        <Text style={[styles.marketStatusLabel, { color: theme.ink }]}>
          {status?.label ?? (isLoading ? 'Loading US market status' : 'US market status unavailable')}
        </Text>
      </View>
      <Text style={[styles.marketStatusMeta, { color: theme.muted }]}>
        {status ? marketFreshness(status.dataState, status.asOf) : 'Waiting for data'}
      </Text>
    </View>
  );
}

function DiscoveryToolbar({
  isSearching,
  mode,
  onModeChange,
  onQueryChange,
  query,
}: {
  isSearching: boolean;
  mode: MarketMode;
  onModeChange: (mode: MarketMode) => void;
  onQueryChange: (query: string) => void;
  query: string;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.toolbar, { borderBottomColor: theme.outline }]}>
      <View style={[styles.searchBox, { backgroundColor: theme.canvas, borderColor: theme.outline }]}>
        <HomeIcon color={theme.muted} name="search" size={16} />
        <TextInput
          accessibilityLabel="Search companies"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={onQueryChange}
          placeholder="Search companies"
          placeholderTextColor={theme.muted}
          returnKeyType="search"
          style={[styles.searchInput, { color: theme.ink }]}
          value={query}
        />
        {isSearching ? <ActivityIndicator color={theme.proof} size="small" /> : null}
        {query ? (
          <Pressable
            accessibilityLabel="Clear company search"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => onQueryChange('')}
            style={({ pressed }) => [styles.clearSearch, pressed && styles.pressed]}>
            <Text style={[styles.clearSearchText, { color: theme.muted }]}>×</Text>
          </Pressable>
        ) : null}
      </View>
      <View accessibilityLabel="Market view" style={[styles.marketModes, { borderColor: theme.outline }]}>
        <ModeButton active={mode === 'all'} icon="grid" label="All" onPress={() => onModeChange('all')} />
        <ModeButton active={mode === 'watchlist'} icon="star" label="Saved" onPress={() => onModeChange('watchlist')} />
        <ModeButton active={mode === 'earnings'} icon="calendar" label="Earnings" onPress={() => onModeChange('earnings')} />
      </View>
    </View>
  );
}

function MovementButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.movementButton,
        { backgroundColor: active ? theme.proofWash : 'transparent', borderColor: active ? theme.proof : theme.outline },
        pressed && styles.pressed,
      ]}>
      <Text style={[styles.movementButtonText, { color: active ? theme.proof : theme.muted }]}>{label}</Text>
    </Pressable>
  );
}

function ModeButton({ active, icon, label, onPress }: { active: boolean; icon: HomeIconName; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityLabel={`Show ${label.toLowerCase()} companies`}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.modeButton,
        { backgroundColor: active ? theme.proofWash : 'transparent', borderRightColor: theme.outline },
        pressed && styles.pressed,
      ]}>
      <HomeIcon color={active ? theme.proof : theme.muted} name={icon} size={15} />
      <Text style={[styles.modeLabel, { color: active ? theme.proof : theme.muted }]}>{label}</Text>
    </Pressable>
  );
}

function SearchPanel({
  error,
  isLoading,
  onSelect,
  results,
}: {
  error?: string;
  isLoading: boolean;
  onSelect: (company: CompanySummary) => void;
  results: CompanySummary[];
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.searchPanel, { backgroundColor: theme.surface, borderColor: theme.outline }]}>
      {isLoading && results.length === 0 ? (
        <View style={styles.searchStatus}>
          <ActivityIndicator color={theme.proof} size="small" />
          <Text style={[styles.panelMessage, { color: theme.muted }]}>Searching supported companies…</Text>
        </View>
      ) : null}
      {!isLoading && error && results.length === 0 ? <Text style={[styles.panelMessage, { color: theme.caution }]}>{error}</Text> : null}
      {!isLoading && !error && results.length === 0 ? (
        <Text style={[styles.panelMessage, { color: theme.muted }]}>No supported company matches this search.</Text>
      ) : null}
      {results.length ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
          style={styles.searchResultsScroll}>
          {results.map((company) => (
            <Pressable
              key={company.assetId}
              accessibilityLabel={`Open ${company.companyName}, ${company.ticker}`}
              accessibilityRole="button"
              onPress={() => onSelect(company)}
              style={({ pressed }) => [styles.searchResult, pressed && { backgroundColor: theme.proofWash }]}>
              <CompanyLogo company={company} size={34} />
              <View style={styles.searchResultCopy}>
                <Text numberOfLines={1} style={[styles.searchResultName, { color: theme.ink }]}>{company.companyName}</Text>
              </View>
              <View style={styles.searchResultPrice}>
                <Text style={[styles.searchResultPriceText, { color: theme.ink }]}>{formatUsd(company.referencePrice)}</Text>
                <Text style={[styles.searchResultChange, { color: movementColor(company.changePercent, theme) }]}>
                  {formatPercent(company.changePercent)}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function IndexStrip({ indices }: { indices: IndexSummary[] }) {
  return (
    <ScrollView
      accessibilityLabel="Market indices"
      contentContainerStyle={styles.indexStripContent}
      horizontal
      showsHorizontalScrollIndicator={false}>
      {indices.map((index) => <IndexQuote index={index} key={index.id} />)}
    </ScrollView>
  );
}

function IndexQuote({ index }: { index: IndexSummary }) {
  const theme = useTheme();
  return (
    <View
      accessibilityLabel={`${index.name}, ${formatIndexValue(index.value)}, ${formatPercent(index.changePercent)}, ${stateLabel(index.dataState)}`}
      style={[styles.indexQuote, { backgroundColor: theme.surface, borderColor: theme.outline }]}>
      <View style={styles.indexNameColumn}>
        <Text numberOfLines={1} style={[styles.indexName, { color: theme.muted }]}>{index.name}</Text>
        <Text style={[styles.indexState, { color: theme.muted }]}>{shortStateLabel(index.dataState)}</Text>
      </View>
      <View style={styles.indexValueColumn}>
        <Text style={[styles.indexValue, { color: theme.ink }]}>{formatIndexValue(index.value)}</Text>
        <Text style={[styles.indexChange, { color: movementColor(index.changePercent, theme) }]}>{formatPercent(index.changePercent)}</Text>
      </View>
    </View>
  );
}

function CompanyPage({
  companies,
  columns,
  mode,
  onSelect,
  width,
}: {
  companies: CompanySummary[];
  columns: number;
  mode: MarketMode;
  onSelect: (company: CompanySummary) => void;
  width: number;
}) {
  const rows = chunk(companies, columns);
  return (
    <View style={[styles.companyPage, { width: Math.max(width, 1) }]}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.companyRow}>
          {row.map((company) => (
            <CompanyCard company={company} key={company.assetId} mode={mode} onPress={() => onSelect(company)} />
          ))}
          {row.length < columns
            ? Array.from({ length: columns - row.length }, (_, index) => <View key={`empty-${index}`} style={styles.companyPlaceholder} />)
            : null}
        </View>
      ))}
    </View>
  );
}

function CompanyCard({ company, mode, onPress }: { company: CompanySummary; mode: MarketMode; onPress: () => void }) {
  const theme = useTheme();
  const secondary = mode === 'earnings' && company.earningsAt
    ? formatEarningsDate(company.earningsAt)
    : formatPercent(company.changePercent);
  const state = mode === 'earnings' ? 'upcoming earnings' : stateLabel(company.changeDataState);
  return (
    <Pressable
      accessibilityHint="Opens read-only company details"
      accessibilityLabel={`${company.companyName}, ${company.ticker}, ${secondary}, ${state}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.companyCard,
        { backgroundColor: theme.surface, borderColor: theme.outline },
        pressed && { backgroundColor: theme.proofWash, borderColor: theme.proof },
      ]}>
      <View style={styles.companyCardLeft}>
        <CompanyLogo company={company} size={25} />
        <Text numberOfLines={1} style={[styles.companyName, { color: theme.ink }]}>{company.companyName}</Text>
      </View>
      <View style={styles.companyCardRight}>
        <Text numberOfLines={1} style={[styles.companyTicker, { color: theme.muted }]}>{company.ticker}</Text>
        <Text
          numberOfLines={1}
          style={[
            styles.companyChange,
            { color: mode === 'earnings' ? theme.proof : movementColor(company.changePercent, theme) },
          ]}>
          {secondary}
        </Text>
      </View>
    </Pressable>
  );
}

function CompanyLogo({ company, size }: { company: CompanySummary; size: number }) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  const showImage = company.logoUrl && !failed;
  return (
    <View style={[styles.companyLogo, { backgroundColor: theme.proofWash, borderRadius: Math.round(size * 0.28), height: size, width: size }]}>
      {showImage ? (
        <Image
          accessibilityLabel={`${company.companyName} logo`}
          contentFit="contain"
          onError={() => setFailed(true)}
          source={{ uri: company.logoUrl ?? undefined }}
          style={{ height: size, width: size }}
        />
      ) : (
        <Text style={[styles.companyInitials, { color: theme.proof, fontSize: Math.max(8, size * 0.32) }]}>
          {company.ticker.slice(0, 2)}
        </Text>
      )}
    </View>
  );
}

function CompanyBoardSkeleton({ columns }: { columns: number }) {
  const theme = useTheme();
  return (
    <View accessibilityLabel="Loading companies" style={styles.companyPage}>
      {Array.from({ length: BOARD_ROWS }, (_, row) => (
        <View key={row} style={styles.companyRow}>
          {Array.from({ length: columns }, (_, column) => (
            <View key={column} style={[styles.companyCard, { backgroundColor: theme.disabledSurface, borderColor: theme.outline }]} />
          ))}
        </View>
      ))}
    </View>
  );
}

function StaticActions() {
  const theme = useTheme();
  const actions: { icon: HomeIconName; label: string }[] = [
    { icon: 'deposit', label: 'Deposit' },
    { icon: 'send', label: 'Send' },
    { icon: 'plus', label: 'Buy stock' },
  ];
  return (
    <View accessibilityLabel="Account actions coming later" style={[styles.staticActions, { backgroundColor: theme.surface, borderColor: theme.outline }]}>
      {actions.map((action, index) => (
        <View key={action.label} style={[styles.staticAction, index < actions.length - 1 && { borderRightColor: theme.outline, borderRightWidth: 1 }]}>
          <HomeIcon color={theme.proof} name={action.icon} size={18} />
          <Text style={[styles.staticActionLabel, { color: theme.ink }]}>{action.label}</Text>
          <Text style={[styles.laterLabel, { color: theme.muted }]}>Later</Text>
        </View>
      ))}
    </View>
  );
}

function NewsSection({ news, unavailable }: { news: NewsSummary[]; unavailable: boolean }) {
  const theme = useTheme();
  const newsRef = useRef<ScrollView>(null);
  const [newsWidth, setNewsWidth] = useState(0);
  const [newsPage, setNewsPage] = useState(0);
  const [selectedArticle, setSelectedArticle] = useState<NewsSummary>();
  const pages = useMemo(() => chunk(news, 3), [news]);

  useEffect(() => {
    setNewsPage(0);
    newsRef.current?.scrollTo({ x: 0, animated: false });
  }, [news]);

  const updatePage = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!newsWidth) return;
    const nextPage = Math.max(0, Math.min(pages.length - 1, Math.round(event.nativeEvent.contentOffset.x / newsWidth)));
    setNewsPage((current) => current === nextPage ? current : nextPage);
  };

  const showPage = (page: number) => {
    setNewsPage(page);
    if (newsWidth > 0) newsRef.current?.scrollTo({ x: page * newsWidth, animated: true });
  };

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.ink }]}>Top news</Text>
        <Text style={[styles.sectionMeta, { color: theme.muted }]}>
          {pages.length > 1 ? `${newsPage + 1} / ${pages.length}` : news.length ? `${news.length} latest` : 'Latest'}
        </Text>
      </View>
      <View
        onLayout={(event) => setNewsWidth(Math.round(event.nativeEvent.layout.width))}
        style={[styles.newsList, { borderBottomColor: theme.outline, borderTopColor: theme.outline }]}>
        {pages.length ? (
          <ScrollView
            ref={newsRef}
            accessibilityLabel="Top news pages"
            decelerationRate="fast"
            disableIntervalMomentum
            horizontal
            onScroll={updatePage}
            onMomentumScrollEnd={updatePage}
            pagingEnabled
            scrollEventThrottle={16}
            snapToAlignment="start"
            snapToInterval={newsWidth || undefined}
            showsHorizontalScrollIndicator={false}>
            {pages.map((page, pageIndex) => (
              <View key={pageIndex} style={[styles.newsPage, { width: Math.max(newsWidth, 1) }]}>
                {page.map((article, articleIndex) => (
                  <NewsCard
                    article={article}
                    isLast={articleIndex === page.length - 1}
                    key={article.id}
                    onPress={() => setSelectedArticle(article)}
                  />
                ))}
              </View>
            ))}
          </ScrollView>
        ) : null}
        {unavailable ? <SectionMessage compact message="News is unavailable right now. Company discovery is still available." /> : null}
      </View>
      {pages.length > 1 ? (
        <View accessibilityLabel="News page selector" style={styles.newsPageDots}>
          {pages.map((_, index) => (
            <Pressable
              key={index}
              accessibilityLabel={`Show news page ${index + 1}`}
              accessibilityRole="button"
              accessibilityState={{ selected: newsPage === index }}
              hitSlop={10}
              onPress={() => showPage(index)}
              style={[
                styles.pageDot,
                { backgroundColor: newsPage === index ? theme.proof : theme.outline },
                newsPage === index && styles.pageDotActive,
              ]}
            />
          ))}
        </View>
      ) : null}
      <NewsBottomSheet article={selectedArticle} onClose={() => setSelectedArticle(undefined)} />
    </View>
  );
}

function NewsCard({ article, isLast, onPress }: { article: NewsSummary; isLast: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityHint="Opens the story in an in-app preview"
      accessibilityLabel={`${article.headline}, ${article.source}, ${formatAge(article.publishedAt)} ago`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => pressed && { backgroundColor: theme.proofWash }}>
      <View style={[styles.newsCard, !isLast && { borderBottomColor: theme.outline, borderBottomWidth: StyleSheet.hairlineWidth }]}>
        <NewsArtwork article={article} variant="thumbnail" />
        <View style={styles.newsCopy}>
          <View>
            <View style={styles.newsKicker}>
              <Text style={[styles.newsCategory, { color: theme.proof }]}>{article.category}</Text>
              <Text style={[styles.newsAge, { color: theme.muted }]}>{formatAge(article.publishedAt)}</Text>
            </View>
            <Text numberOfLines={3} style={[styles.newsHeadline, { color: theme.ink }]}>{article.headline}</Text>
          </View>
          <View style={styles.newsFooter}>
            <Text numberOfLines={1} style={[styles.newsSource, { color: theme.muted }]}>{article.source}</Text>
            <Text style={[styles.newsArrow, { color: theme.proof }]}>›</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function NewsArtwork({ article, variant }: { article: NewsSummary; variant: 'hero' | 'thumbnail' }) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [article.imageUrl]);

  return (
    <View
      style={[
        variant === 'hero' ? styles.newsHero : styles.newsThumbnail,
        { backgroundColor: theme.proofWash },
      ]}>
      {article.imageUrl && !failed ? (
        <Image
          accessibilityLabel={`Image for ${article.headline}`}
          contentFit="cover"
          onError={() => setFailed(true)}
          source={{ uri: article.imageUrl }}
          style={StyleSheet.absoluteFill}
          transition={150}
        />
      ) : (
        <Text style={[styles.newsArtworkFallback, { color: theme.proof }]}>
          {article.source.slice(0, 2).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

function NewsBottomSheet({ article, onClose }: { article?: NewsSummary; onClose: () => void }) {
  const theme = useTheme();
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={Boolean(article)}>
      <View accessibilityViewIsModal style={styles.sheetRoot}>
        <Pressable accessibilityLabel="Close article preview" accessibilityRole="button" onPress={onClose} style={styles.sheetBackdrop} />
        <SafeAreaView edges={['bottom']} style={[styles.newsSheet, { backgroundColor: theme.surface, borderColor: theme.outline }]}>
          <View style={[styles.sheetHandle, { backgroundColor: theme.outline }]} />
          {article ? (
            <ScrollView contentContainerStyle={styles.newsSheetContent} showsVerticalScrollIndicator={false}>
              <NewsArtwork article={article} variant="hero" />
              <View style={styles.newsSheetHeader}>
                <View style={styles.newsSheetKicker}>
                  <Text style={[styles.newsCategory, { color: theme.proof }]}>{article.category}</Text>
                  <Text style={[styles.newsAge, { color: theme.muted }]}>{formatPublishedAt(article.publishedAt)}</Text>
                </View>
                <Pressable
                  accessibilityLabel="Close article preview"
                  accessibilityRole="button"
                  onPress={onClose}
                  style={({ pressed }) => [
                    styles.sheetClose,
                    { borderColor: theme.outline },
                    pressed && { backgroundColor: theme.proofWash },
                  ]}>
                  <Text style={[styles.sheetCloseText, { color: theme.ink }]}>×</Text>
                </Pressable>
              </View>
              <Text accessibilityRole="header" style={[styles.newsSheetHeadline, { color: theme.ink }]}>{article.headline}</Text>
              <View style={[styles.newsSheetSource, { borderBottomColor: theme.outline, borderTopColor: theme.outline }]}>
                <Text style={[styles.newsSheetSourceLabel, { color: theme.muted }]}>Published by</Text>
                <Text style={[styles.newsSheetSourceName, { color: theme.ink }]}>{article.source}</Text>
              </View>
              <Text style={[styles.newsSheetSummary, { color: theme.muted }]}>
                {article.summary ?? `This preview contains the headline and publishing details supplied by ${article.source}.`}
              </Text>
              {article.relatedAssetIds.length ? (
                <Text style={[styles.newsSheetRelated, { color: theme.proof }]}>
                  Related: {article.relatedAssetIds.join(' · ')}
                </Text>
              ) : null}
            </ScrollView>
          ) : null}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function QuickActions() {
  const theme = useTheme();
  const actions: { icon: HomeIconName; label: string }[] = [
    { icon: 'clock', label: 'Pre-market' },
    { icon: 'long', label: 'Open long' },
    { icon: 'swap', label: 'Swap' },
  ];
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.ink }]}>Quick actions</Text>
      </View>
      <View accessibilityLabel="Trading capabilities coming later" style={[styles.quickGrid, { backgroundColor: theme.surface, borderColor: theme.outline }]}>
        {actions.map((action, index) => (
          <View key={action.label} style={[styles.quickCard, index < actions.length - 1 && { borderRightColor: theme.outline, borderRightWidth: 1 }]}>
            <HomeIcon color={theme.proof} name={action.icon} size={21} />
            <Text style={[styles.quickLabel, { color: theme.ink }]}>{action.label}</Text>
            <Text style={[styles.laterLabel, { color: theme.muted }]}>Later</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function RetryNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  const theme = useTheme();
  return (
    <View accessibilityLiveRegion="polite" style={[styles.retryNotice, { backgroundColor: theme.cautionWash, borderColor: theme.caution }]}>
      <Text style={[styles.retryMessage, { color: theme.ink }]}>{message}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={({ pressed }) => [styles.retryButton, { borderColor: theme.caution }, pressed && styles.pressed]}>
        <Text style={[styles.retryButtonText, { color: theme.caution }]}>Try again</Text>
      </Pressable>
    </View>
  );
}

function SectionMessage({ compact = false, loading = false, message }: { compact?: boolean; loading?: boolean; message: string }) {
  const theme = useTheme();
  return (
    <View accessibilityLiveRegion="polite" style={[styles.sectionMessage, compact && styles.sectionMessageCompact]}>
      {loading ? <ActivityIndicator color={theme.proof} size="small" /> : null}
      <Text style={[styles.sectionMessageText, { color: theme.muted }]}>{message}</Text>
    </View>
  );
}

function HomeIcon({ color, name, size }: { color: string; name: HomeIconName; size: number }) {
  const strokeWidth = 1.8;
  return (
    <Svg fill="none" height={size} viewBox="0 0 24 24" width={size}>
      {name === 'search' ? <><Circle cx="10.5" cy="10.5" r="6.5" stroke={color} strokeWidth={strokeWidth} /><Path d="m15.4 15.4 4.2 4.2" stroke={color} strokeLinecap="round" strokeWidth={strokeWidth} /></> : null}
      {name === 'grid' ? <><Rect height="6" rx="1" stroke={color} strokeWidth={strokeWidth} width="6" x="4" y="4" /><Rect height="6" rx="1" stroke={color} strokeWidth={strokeWidth} width="6" x="14" y="4" /><Rect height="6" rx="1" stroke={color} strokeWidth={strokeWidth} width="6" x="4" y="14" /><Rect height="6" rx="1" stroke={color} strokeWidth={strokeWidth} width="6" x="14" y="14" /></> : null}
      {name === 'star' ? <Path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8L12 4Z" stroke={color} strokeLinejoin="round" strokeWidth={strokeWidth} /> : null}
      {name === 'calendar' ? <><Rect height="14" rx="2" stroke={color} strokeWidth={strokeWidth} width="16" x="4" y="6" /><Path d="M8 3.5V8m8-4.5V8M4 10h16" stroke={color} strokeLinecap="round" strokeWidth={strokeWidth} /></> : null}
      {name === 'deposit' ? <Path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19.5h14" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} /> : null}
      {name === 'send' ? <><Path d="m4 11 15-7-6.5 16-2.2-6.3L4 11Z" stroke={color} strokeLinejoin="round" strokeWidth={strokeWidth} /><Path d="m10.3 13.7 4-4" stroke={color} strokeLinecap="round" strokeWidth={strokeWidth} /></> : null}
      {name === 'plus' ? <Path d="M12 5v14M5 12h14" stroke={color} strokeLinecap="round" strokeWidth={strokeWidth} /> : null}
      {name === 'clock' ? <><Circle cx="12" cy="12" r="8.5" stroke={color} strokeWidth={strokeWidth} /><Path d="M12 7v5l3.2 2" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} /></> : null}
      {name === 'long' ? <><Path d="m5 17 5-5 3.2 3.2L19 8" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} /><Path d="M14.5 8H19v4.5" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} /></> : null}
      {name === 'swap' ? <Path d="M5 8h13m0 0-3-3m3 3-3 3M19 16H6m0 0 3 3m-3-3 3-3" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} /> : null}
    </Svg>
  );
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function rankSearchResults(query: string, candidates: readonly CompanySummary[]): CompanySummary[] {
  if (!query) return [];
  const unique = new Map<string, CompanySummary>();
  for (const company of candidates) unique.set(company.assetId, company);

  return [...unique.values()]
    .map((company) => ({ company, score: searchScore(company, query) }))
    .filter((result): result is { company: CompanySummary; score: number } => result.score !== null)
    .sort((left, right) => left.score - right.score
      || left.company.companyName.localeCompare(right.company.companyName))
    .slice(0, 12)
    .map((result) => result.company);
}

function searchScore(company: CompanySummary, query: string): number | null {
  const ticker = normalizeSearchText(company.ticker);
  const name = normalizeSearchText(company.companyName);
  const hints = company.instrumentHints.map(normalizeSearchText);
  const words = name.split(/\s+/);

  if (ticker === query) return 0;
  if (hints.some((hint) => hint === query)) return 1;
  if (name === query) return 2;
  if (ticker.startsWith(query)) return 3;
  if (hints.some((hint) => hint.startsWith(query))) return 4;
  if (name.startsWith(query)) return 5;
  if (words.some((word) => word.startsWith(query))) return 6;
  if (ticker.includes(query)) return 7;
  if (hints.some((hint) => hint.includes(query))) return 8;
  if (name.includes(query)) return 9;
  return null;
}

function messageFor(error: unknown): string {
  return error instanceof HomeRequestError ? error.message : 'Market data is temporarily unavailable.';
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function modeLabel(mode: MarketMode): string {
  if (mode === 'watchlist') return 'Watchlist';
  if (mode === 'earnings') return 'Earnings';
  return 'Today';
}

function emptyModeMessage(mode: MarketMode): string {
  if (mode === 'watchlist') return 'No companies are saved yet. You can still browse every supported company as a guest.';
  if (mode === 'earnings') return 'No upcoming earnings data is available for supported companies.';
  return 'Company data is temporarily unavailable. Pull down or use Try again to refresh.';
}

function marketFreshness(state: DataState, asOf: string | null): string {
  if (state === 'sample') return 'Sample data';
  if (!asOf) return stateLabel(state);
  return `Updated ${formatTime(asOf)} · ${stateLabel(state)}`;
}

function stateLabel(state: DataState): string {
  if (state === 'live') return 'Live';
  if (state === 'delayed') return 'Delayed';
  if (state === 'stale') return 'Stale';
  if (state === 'sample') return 'Sample';
  return 'Unavailable';
}

function shortStateLabel(state: DataState): string {
  return state === 'unavailable' ? 'N/A' : state.toUpperCase();
}

function formatUsd(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}

function formatIndexValue(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

function formatPercent(value: number | null): string {
  if (value === null) return '—';
  const prefix = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${prefix}${Math.abs(value).toFixed(2)}%`;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function formatEarningsDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value));
}

function formatAge(value: string): string {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr`;
  return `${Math.floor(hours / 24)} d`;
}

function formatPublishedAt(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function movementColor(value: number | null, theme: ReturnType<typeof useTheme>): string {
  if (value === null) return theme.muted;
  return value < 0 ? theme.caution : theme.proof;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 62,
    paddingHorizontal: 18,
    paddingVertical: 7,
  },
  brand: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 44 },
  guestPill: { alignItems: 'center', borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 8, minHeight: 36, paddingHorizontal: 12 },
  guestDot: { borderRadius: 999, height: 7, width: 7 },
  guestText: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '700' },
  content: { alignSelf: 'center', maxWidth: 680, paddingBottom: 32, paddingHorizontal: 16, paddingTop: 14, width: '100%' },
  marketStatus: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between', marginBottom: 12, minHeight: 20, paddingHorizontal: 2 },
  marketStatusLeft: { alignItems: 'center', flexDirection: 'row', flexShrink: 1, gap: 6 },
  statusDot: { borderRadius: 999, height: 6, width: 6 },
  marketStatusLabel: { flexShrink: 1, fontFamily: Fonts.mono, fontSize: 10, fontWeight: '600' },
  marketStatusMeta: { fontFamily: Fonts.mono, fontSize: 9, textAlign: 'right' },
  marketDeck: { borderRadius: 12, borderWidth: 1, overflow: 'hidden', position: 'relative' },
  toolbar: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 8, padding: 8, position: 'relative', zIndex: 30 },
  searchBox: { alignItems: 'center', borderRadius: 10, borderWidth: 1, flex: 1, flexDirection: 'row', gap: 5, height: 52, minWidth: 0, paddingHorizontal: 9 },
  searchInput: { alignSelf: 'stretch', flex: 1, fontFamily: Fonts.sans, fontSize: 14, fontWeight: '600', height: '100%', lineHeight: 19, minWidth: 0, paddingVertical: 0, textAlignVertical: 'center' },
  clearSearch: { alignItems: 'center', borderRadius: 9, height: 32, justifyContent: 'center', width: 32 },
  clearSearchText: { fontFamily: Fonts.sans, fontSize: 20, lineHeight: 22 },
  marketModes: { borderRadius: 10, borderWidth: 1, flexDirection: 'row', height: 44, overflow: 'hidden', width: 132 },
  modeButton: { alignItems: 'center', borderRightWidth: StyleSheet.hairlineWidth, flex: 1, gap: 2, justifyContent: 'center', minHeight: 44 },
  modeLabel: { fontFamily: Fonts.sans, fontSize: 7, fontWeight: '700' },
  searchPanel: { borderRadius: 10, borderWidth: 1, elevation: 12, left: 8, maxHeight: 238, overflow: 'hidden', padding: 5, position: 'absolute', right: 148, top: 65, zIndex: 40 },
  searchStatus: { alignItems: 'center', flexDirection: 'row', justifyContent: 'center', minHeight: 56, paddingHorizontal: 10 },
  searchResultsScroll: { maxHeight: 226 },
  panelMessage: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 17, paddingHorizontal: 10, paddingVertical: 14, textAlign: 'center' },
  searchResult: { alignItems: 'center', borderRadius: 9, flexDirection: 'row', gap: 10, minHeight: 52, padding: 8 },
  searchResultCopy: { flex: 1, minWidth: 0 },
  searchResultName: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '700' },
  searchResultPrice: { alignItems: 'flex-end' },
  searchResultPriceText: { fontFamily: Fonts.mono, fontSize: 9, fontWeight: '600' },
  searchResultChange: { fontFamily: Fonts.mono, fontSize: 9, marginTop: 2 },
  indexStripContent: { gap: 6, paddingHorizontal: 8, paddingVertical: 6 },
  indexQuote: { alignItems: 'center', borderRadius: 10, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 50, paddingHorizontal: 9, paddingVertical: 7, width: 118 },
  indexNameColumn: { flex: 1, minWidth: 0 },
  indexName: { fontFamily: Fonts.mono, fontSize: 9, letterSpacing: 0.3, textTransform: 'uppercase' },
  indexState: { fontFamily: Fonts.mono, fontSize: 6, marginTop: 4 },
  indexValueColumn: { alignItems: 'flex-end', marginLeft: 6 },
  indexValue: { fontFamily: Fonts.mono, fontSize: 10, fontWeight: '700' },
  indexChange: { fontFamily: Fonts.mono, fontSize: 9, fontWeight: '600', marginTop: 3 },
  boardHeading: { alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 10, paddingBottom: 3, paddingTop: 8 },
  boardTitle: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '700' },
  boardMeta: { fontFamily: Fonts.mono, fontSize: 8, fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase' },
  movementSwitcher: { flexDirection: 'row', gap: 4 },
  movementButton: { alignItems: 'center', borderRadius: 8, borderWidth: 1, justifyContent: 'center', minHeight: 32, paddingHorizontal: 8 },
  movementButtonText: { fontFamily: Fonts.sans, fontSize: 8, fontWeight: '700' },
  companyPage: { gap: 6, minHeight: 274, paddingHorizontal: 8, paddingVertical: 6 },
  companyRow: { alignItems: 'stretch', flexDirection: 'row', gap: 6 },
  companyCard: { borderRadius: 10, borderWidth: 1, flex: 1, minHeight: 62, paddingHorizontal: 7, paddingVertical: 7, position: 'relative' },
  companyPlaceholder: { flex: 1 },
  companyCardLeft: { alignItems: 'flex-start', flex: 1, gap: 4, minWidth: 0, width: '100%' },
  companyCardRight: { alignItems: 'flex-end', gap: 4, position: 'absolute', right: 7, top: 7 },
  companyLogo: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  companyInitials: { fontFamily: Fonts.sans, fontWeight: '800', letterSpacing: -0.3 },
  companyName: { alignSelf: 'stretch', fontFamily: Fonts.sans, fontSize: 10, lineHeight: 12 },
  companyTicker: { fontFamily: Fonts.mono, fontSize: 9, fontWeight: '500' },
  companyChange: { fontFamily: Fonts.mono, fontSize: 10, fontWeight: '700', letterSpacing: -0.2 },
  deckFooter: { alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 8, justifyContent: 'space-between', minHeight: 38, paddingHorizontal: 12, paddingVertical: 9 },
  deckNote: { flex: 1, fontFamily: Fonts.sans, fontSize: 8 },
  pageDots: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  pageDot: { borderRadius: 999, height: 6, width: 6 },
  pageDotActive: { width: 18 },
  sectionMessage: { alignItems: 'center', gap: 9, justifyContent: 'center', minHeight: 274, paddingHorizontal: 28, paddingVertical: 24 },
  sectionMessageCompact: { minHeight: 68 },
  sectionMessageText: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 17, textAlign: 'center' },
  retryNotice: { alignItems: 'center', borderRadius: 10, borderWidth: 1, flexDirection: 'row', gap: 10, marginTop: 10, padding: 10 },
  retryMessage: { flex: 1, fontFamily: Fonts.sans, fontSize: 11, lineHeight: 16 },
  retryButton: { alignItems: 'center', borderRadius: 8, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 12 },
  retryButtonText: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '800' },
  staticActions: { borderRadius: 12, borderWidth: 1, flexDirection: 'row', marginBottom: 26, marginTop: 12, overflow: 'hidden' },
  staticAction: { alignItems: 'center', flex: 1, gap: 5, justifyContent: 'center', minHeight: 64, paddingHorizontal: 5, paddingVertical: 8 },
  staticActionLabel: { fontFamily: Fonts.sans, fontSize: 10, fontWeight: '800', textAlign: 'center' },
  laterLabel: { fontFamily: Fonts.mono, fontSize: 7, fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase' },
  section: { marginTop: 24 },
  sectionHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, paddingHorizontal: 2 },
  sectionTitle: { fontFamily: Fonts.sans, fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  sectionMeta: { fontFamily: Fonts.mono, fontSize: 8, textTransform: 'uppercase' },
  newsList: { borderBottomWidth: StyleSheet.hairlineWidth, borderTopWidth: StyleSheet.hairlineWidth },
  newsPage: { minHeight: 306 },
  newsPageDots: { alignItems: 'center', flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 32, paddingTop: 10 },
  newsCard: { alignItems: 'stretch', flexDirection: 'row', gap: 12, minHeight: 102, paddingHorizontal: 2, paddingVertical: 10 },
  newsThumbnail: { alignItems: 'center', borderRadius: 10, height: 82, justifyContent: 'center', overflow: 'hidden', width: 82 },
  newsHero: { alignItems: 'center', aspectRatio: 1.65, borderRadius: 14, justifyContent: 'center', marginBottom: 18, overflow: 'hidden', width: '100%' },
  newsArtworkFallback: { fontFamily: Fonts.serif, fontSize: 18, fontWeight: '700' },
  newsCopy: { flex: 1, justifyContent: 'space-between', minWidth: 0 },
  newsKicker: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  newsCategory: { fontFamily: Fonts.mono, fontSize: 8, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
  newsAge: { fontFamily: Fonts.sans, fontSize: 8 },
  newsHeadline: { fontFamily: Fonts.sans, fontSize: 12, fontWeight: '700', lineHeight: 18, marginTop: 7 },
  newsFooter: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between', marginTop: 7 },
  newsSource: { flex: 1, fontFamily: Fonts.sans, fontSize: 8, lineHeight: 11 },
  newsArrow: { fontFamily: Fonts.sans, fontSize: 13 },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.56)' },
  newsSheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, maxHeight: '82%', minHeight: 340, overflow: 'hidden' },
  sheetHandle: { alignSelf: 'center', borderRadius: 999, height: 4, marginBottom: 4, marginTop: 10, width: 38 },
  newsSheetContent: { paddingBottom: 24, paddingHorizontal: 20, paddingTop: 10 },
  newsSheetHeader: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  newsSheetKicker: { flex: 1, gap: 5 },
  sheetClose: { alignItems: 'center', borderRadius: 11, borderWidth: 1, height: 44, justifyContent: 'center', width: 44 },
  sheetCloseText: { fontFamily: Fonts.sans, fontSize: 25, lineHeight: 27 },
  newsSheetHeadline: { fontFamily: Fonts.serif, fontSize: 25, fontWeight: '700', letterSpacing: -0.5, lineHeight: 31, marginTop: 22 },
  newsSheetSource: { borderBottomWidth: StyleSheet.hairlineWidth, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 22, paddingVertical: 14 },
  newsSheetSourceLabel: { fontFamily: Fonts.mono, fontSize: 8, letterSpacing: 0.5, textTransform: 'uppercase' },
  newsSheetSourceName: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '700', marginTop: 5 },
  newsSheetSummary: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 22, marginTop: 20 },
  newsSheetRelated: { fontFamily: Fonts.mono, fontSize: 10, lineHeight: 16, marginTop: 18, textTransform: 'uppercase' },
  quickGrid: { borderRadius: 12, borderWidth: 1, flexDirection: 'row', overflow: 'hidden' },
  quickCard: { alignItems: 'flex-start', flex: 1, gap: 9, minHeight: 108, padding: 12 },
  quickLabel: { fontFamily: Fonts.sans, fontSize: 10, fontWeight: '800', lineHeight: 14 },
  disclosure: { borderTopWidth: StyleSheet.hairlineWidth, fontFamily: Fonts.sans, fontSize: 9, lineHeight: 15, marginTop: 20, paddingHorizontal: 2, paddingTop: 14 },
  pressed: { opacity: 0.7 },
});
