import type {
  CompanySummary,
  DataState,
  HomeResponse,
  IndexSummary,
  NewsSummary,
} from '@warren/home-contract';
import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
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

import { Fonts } from '@/constants/theme';
import { AppAccountButton } from '@/components/AppAccountButton';
import { BrandLogo } from '@/components/brand-logo';
import { NewsArticleSheet } from '@/components/NewsArticleSheet';
import { useSavedCompanies } from '@/features/market/saved-companies';
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

const BOARD_PAGE_SIZE = 6;
const SEARCH_DEBOUNCE_MS = 225;
const SEARCH_CACHE_TTL_MS = 30_000;

type SearchCacheEntry = { items: CompanySummary[]; cachedAt: number };

// Home-only accents from the mock; keep the shared light/dark palette intact.
function useHomeTheme() {
  const theme = useTheme();
  return {
    ...theme,
    gain: theme.canvas === '#131918' ? '#8BC4A1' : '#286440',
    outlineSoft: `${theme.muted}33`,
  };
}

export function HomeScreen() {
  const router = useRouter();
  const theme = useHomeTheme();
  const { width: windowWidth } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const boardRef = useRef<ScrollView>(null);
  const searchCacheRef = useRef(new Map<string, SearchCacheEntry>());
  const searchRequestRef = useRef(0);
  const cached = getCachedHome();
  const { assetIds: savedAssetIds } = useSavedCompanies();

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
    const timeout = setTimeout(() => void loadInitialHome(controller.signal), 0);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
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
    if (!normalized) return;
    const requestId = ++searchRequestRef.current;
    const cachedSearch = searchCacheRef.current.get(normalized);
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setSearchError(undefined);
      if (cachedSearch && Date.now() - cachedSearch.cachedAt < SEARCH_CACHE_TTL_MS) {
        setRemoteSearchResults(cachedSearch.items);
        setCompletedSearchQuery(normalized);
        setIsSearching(false);
        return;
      }
      setIsSearching(true);
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
    }, cachedSearch ? 0 : SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    if (mode === 'all') return;
    const controller = new AbortController();
    if (mode === 'watchlist' && savedAssetIds.length === 0) {
      const timeout = setTimeout(() => {
        setModeCompanies([]);
        setIsModeLoading(false);
      }, 0);
      return () => {
        clearTimeout(timeout);
        controller.abort();
      };
    }

    const timeout = setTimeout(() => {
      setIsModeLoading(true);
      const request = mode === 'earnings'
        ? loadEarnings(controller.signal)
        : loadWatchlist(savedAssetIds, controller.signal);
      void request
        .then((result) => setModeCompanies(result.items))
        .catch((error) => {
          if (!isAbort(error)) setModeError(messageFor(error));
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsModeLoading(false);
        });
    }, 0);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [mode, savedAssetIds]);

  useEffect(() => {
    if (mode !== 'all' || movementView !== 'losers') return;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
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
    }, 0);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [home?.generatedAt, mode, movementView]);

  const companies = useMemo(() => (
    mode === 'all'
      ? movementView === 'gainers' ? home?.companies ?? [] : loserCompanies
      : modeCompanies
  ), [home?.companies, loserCompanies, mode, modeCompanies, movementView]);
  const normalizedQuery = normalizeSearchText(query);
  const searchResults = useMemo(
    () => rankSearchResults(normalizedQuery, [...(home?.companies ?? []), ...remoteSearchResults]),
    [home?.companies, normalizedQuery, remoteSearchResults],
  );
  const searchPending = Boolean(normalizedQuery) && (isSearching || completedSearchQuery !== normalizedQuery);
  const pages = useMemo(() => chunk(companies, BOARD_PAGE_SIZE), [companies]);
  const movementScale = useMemo(() => Math.max(1, ...companies.map((company) => Math.ceil(Math.abs(company.changePercent ?? 0)))), [companies]);
  const isCompanyBoardLoading = isModeLoading || (mode === 'all' && isMoverLoading);
  const companyBoardError = mode === 'all' ? moverError : modeError;

  const changeMode = useCallback((nextMode: MarketMode) => {
    setMode(nextMode);
    setCurrentPage(0);
    boardRef.current?.scrollTo({ x: 0, animated: false });
    setModeError(undefined);
    if (nextMode === 'all') {
      setModeCompanies([]);
      setIsModeLoading(false);
    }
  }, []);

  const changeMovementView = useCallback((nextView: MovementView) => {
    setMovementView(nextView);
    setCurrentPage(0);
    boardRef.current?.scrollTo({ x: 0, animated: false });
    if (nextView === 'gainers') {
      setIsMoverLoading(false);
      setMoverError(undefined);
    }
  }, []);

  const changeQuery = useCallback((nextQuery: string) => {
    setQuery(nextQuery);
    if (normalizeSearchText(nextQuery)) return;
    searchRequestRef.current += 1;
    setRemoteSearchResults([]);
    setCompletedSearchQuery('');
    setSearchError(undefined);
    setIsSearching(false);
  }, []);

  const retryInitialHome = useCallback(() => {
    setIsLoading(true);
    setLoadError(undefined);
    void loadInitialHome();
  }, [loadInitialHome]);

  const openCompany = useCallback((company: CompanySummary, entrySource: 'home' | 'search' = 'home') => {
    router.push({
      pathname: '/stocks/[assetId]',
      params: { assetId: company.assetId, product: 'spot', source: entrySource },
    } as Href);
  }, [router]);

  const openSearchCompany = useCallback((company: CompanySummary) => {
    openCompany(company, 'search');
  }, [openCompany]);

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
          contentContainerStyle={[styles.content, windowWidth < 360 && styles.contentCompact]}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={isRefreshing} tintColor={theme.proof} onRefresh={refreshHome} />}
          showsVerticalScrollIndicator={false}>
          <MarketStatus home={home} isLoading={isLoading} />

          <View style={styles.marketDeck}>
            <DiscoveryToolbar
              isSearching={searchPending}
              onQueryChange={changeQuery}
              query={query}>
              {query.trim() ? (
                <SearchPanel
                  error={searchError}
                  isLoading={searchPending}
                  onSelect={openSearchCompany}
                  results={searchResults}
                />
              ) : null}
            </DiscoveryToolbar>

            {home?.indices.length ? <IndexStrip indices={home.indices} /> : (
              <SectionMessage compact message={isLoading ? 'Loading market indices…' : 'Could not refresh market indices. Pull down to try again.'} />
            )}

            <View accessibilityLabel="Market view" style={[styles.marketModes, { borderColor: theme.outlineSoft }]}>
              <ModeButton active={mode === 'all'} label="All" onPress={() => changeMode('all')} />
              <ModeButton active={mode === 'watchlist'} label="Saved" onPress={() => changeMode('watchlist')} />
              <ModeButton active={mode === 'earnings'} label="Earnings" onPress={() => changeMode('earnings')} />
            </View>

            <View style={styles.boardHeading}>
              <Text accessibilityRole="header" style={[styles.boardTitle, windowWidth < 360 && styles.boardTitleCompact, { color: theme.ink }]}>
                {mode === 'watchlist' ? 'Your saved companies' : mode === 'earnings' ? 'Earnings ahead' : 'Market movers'}
              </Text>
              <Text style={[styles.boardMeta, { color: theme.muted }]}>{mode === 'earnings' ? 'Upcoming' : '1D change'}</Text>
            </View>
            {mode === 'all' ? (
              <View accessibilityLabel="Rank companies by daily movement" style={[styles.movementSwitcher, { borderBottomColor: theme.outlineSoft }]}>
                <MovementButton active={movementView === 'gainers'} label="Top gainers" onPress={() => changeMovementView('gainers')} />
                <MovementButton active={movementView === 'losers'} label="Top losers" onPress={() => changeMovementView('losers')} />
              </View>
            ) : null}
            <View style={styles.boardColumns}>
              <Text style={[styles.boardColumnLabel, { color: theme.muted }]}>{mode === 'earnings' ? 'Report date / Company' : 'Company'}</Text>
              {mode !== 'earnings' ? <Text style={[styles.boardColumnLabel, { color: theme.muted }]}>Daily move</Text> : null}
            </View>

            <View onLayout={onBoardLayout} style={[styles.companyBoard, { backgroundColor: theme.surface }]}>
              {isLoading && !home ? (
                <CompanyBoardSkeleton />
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
                      mode={mode}
                      movementScale={movementScale}
                      onSelect={openCompany}
                      rankOffset={pageIndex * BOARD_PAGE_SIZE}
                      width={boardWidth}
                    />
                  ))}
                </ScrollView>
              ) : (
                <SectionMessage message={emptyModeMessage(mode)} />
              )}
            </View>

            {mode !== 'earnings' && companies.length ? (
              <Text style={[styles.movementCaption, { color: theme.muted }]}>Daily change · shared ±{movementScale}% scale</Text>
            ) : null}
            <View style={styles.deckFooter}>
              <Text style={[styles.deckNote, { color: theme.muted }]}>
                {companies.length ? `${currentPage * BOARD_PAGE_SIZE + 1}–${Math.min((currentPage + 1) * BOARD_PAGE_SIZE, companies.length)} of ${companies.length} ${mode === 'earnings' ? 'reports' : 'companies'}` : `0 ${mode === 'earnings' ? 'reports' : 'companies'}`}
              </Text>
              {pages.length > 1 ? (
                <View accessibilityLabel="Company page selector" style={styles.pageDots}>
                  {pages.map((_, index) => (
                    <Pressable
                      key={index}
                      accessibilityLabel={`Show company page ${index + 1}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: currentPage === index }}
                      onPress={() => scrollToPage(index)}
                      style={styles.pageDot}>
                      <Text style={[styles.pageNumber, { color: currentPage === index ? theme.ink : theme.muted }]}>{index + 1}</Text>
                      {currentPage === index ? <View style={[styles.pageUnderline, { backgroundColor: theme.ink }]} /> : null}
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          </View>

          {loadError ? (
            <RetryNotice message={loadError} onRetry={retryInitialHome} />
          ) : null}

          <NewsSection
            key={home?.generatedAt ?? 'pending-news'}
            news={home?.news ?? []}
            unavailable={!isLoading && !home?.news.length}
          />

          <StaticActions />
          <QuickActions />

          <Text style={[styles.disclosure, { borderTopColor: theme.outlineSoft, color: theme.muted }]}>
            Prices, market status, and headlines are informational and may be delayed. They are not executable quotes or investment recommendations.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function HomeHeader({ onBrandPress }: { onBrandPress: () => void }) {
  const theme = useHomeTheme();
  return (
    <View style={[styles.header, { backgroundColor: theme.canvas }]}>
      <Pressable
        accessibilityHint="Scrolls Home to the top"
        accessibilityLabel="Warren home"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onBrandPress}
        style={({ pressed }) => [styles.brand, pressed && styles.pressed]}>
        <BrandLogo decorative />
      </Pressable>
      <AppAccountButton appearance="outlined" />
    </View>
  );
}

function MarketStatus({ home, isLoading }: { home?: HomeResponse; isLoading: boolean }) {
  const theme = useHomeTheme();
  const { width } = useWindowDimensions();
  const status = home?.market;
  return (
    <View accessibilityLiveRegion="polite">
      <View style={styles.homeIntro}>
        <Text accessibilityRole="header" style={[styles.homeTitle, width < 360 && styles.homeTitleCompact, { color: theme.ink }]}>Market today</Text>
        <View style={styles.marketStatusLeft}>
          <View style={[styles.statusDot, { backgroundColor: status?.session === 'open' ? theme.gain : theme.muted }]} />
          <Text style={[styles.marketStatusLabel, { color: theme.ink }]}>
            {status?.label ?? (isLoading ? 'Loading US market status' : 'US market status needs a refresh')}
          </Text>
        </View>
      </View>
      <Text style={[styles.marketStatusMeta, { color: theme.muted }]}>
        {status ? marketFreshness(status.dataState, status.asOf) : 'Waiting for data'}
      </Text>
    </View>
  );
}

function DiscoveryToolbar({
  children,
  isSearching,
  onQueryChange,
  query,
}: {
  children: ReactNode;
  isSearching: boolean;
  onQueryChange: (query: string) => void;
  query: string;
}) {
  const theme = useHomeTheme();
  return (
    <View style={styles.toolbar}>
      <View style={[styles.searchBox, { borderColor: theme.outlineSoft }]}>
        <HomeIcon color={theme.muted} name="search" size={17} />
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
      {children}
    </View>
  );
}

function MovementButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  const theme = useHomeTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.movementButton,
        { borderBottomColor: active ? theme.ink : 'transparent' },
        pressed && styles.pressed,
      ]}>
      <Text style={[styles.movementButtonText, { color: active ? theme.ink : theme.muted }]}>{label}</Text>
    </Pressable>
  );
}

function ModeButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  const theme = useHomeTheme();
  return (
    <Pressable
      accessibilityLabel={`Show ${label.toLowerCase()} companies`}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.modeButton,
        { backgroundColor: active ? theme.surface : 'transparent' },
        pressed && styles.pressed,
      ]}>
      <Text style={[styles.modeLabel, { color: active ? theme.ink : theme.muted }]}>{label}</Text>
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
  const theme = useHomeTheme();
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
                <Text style={[styles.searchResultTicker, { color: theme.muted }]}>{company.ticker}</Text>
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
  const theme = useHomeTheme();
  const { width, fontScale } = useWindowDimensions();
  const quoteWidth = Math.max(90 * fontScale, (Math.min(width, 680) - (width < 360 ? 28 : 36) - 32) / 3);
  return (
    <View style={[styles.indexStrip, { borderColor: theme.outlineSoft }]}>
      <ScrollView
        accessibilityLabel="Market indices"
        contentContainerStyle={styles.indexStripContent}
        horizontal
        showsHorizontalScrollIndicator={false}>
        {indices.map((index) => <IndexQuote index={index} key={index.id} width={quoteWidth} />)}
      </ScrollView>
    </View>
  );
}

function IndexQuote({ index, width }: { index: IndexSummary; width: number }) {
  const theme = useHomeTheme();
  const { width: windowWidth } = useWindowDimensions();
  return (
    <View
      accessibilityLabel={`${index.name}, ${formatIndexValue(index.value)}, ${formatPercent(index.changePercent)}, ${stateLabel(index.dataState)}`}
      style={[styles.indexQuote, { width }]}>
      <Text numberOfLines={1} style={[styles.indexName, { color: theme.muted }]}>{index.name}</Text>
      <Text style={[styles.indexValue, windowWidth < 360 && styles.indexValueCompact, { color: theme.ink }]}>{formatIndexValue(index.value)}</Text>
      <Text style={[styles.indexChange, { color: movementColor(index.changePercent, theme) }]}>{formatPercent(index.changePercent)}</Text>
      {index.dataState !== 'live' ? <Text style={[styles.indexState, { color: theme.muted }]}>{shortStateLabel(index.dataState)}</Text> : null}
    </View>
  );
}

function CompanyPage({
  companies,
  mode,
  movementScale,
  onSelect,
  rankOffset,
  width,
}: {
  companies: CompanySummary[];
  mode: MarketMode;
  movementScale: number;
  onSelect: (company: CompanySummary) => void;
  rankOffset: number;
  width: number;
}) {
  const { width: windowWidth } = useWindowDimensions();
  return (
    <View style={[styles.companyPage, windowWidth < 360 && styles.companyPageCompact, { width: Math.max(width, 1) }]}>
      {companies.map((company, index) => (
        <CompanyCard
          company={company}
          isLast={index === companies.length - 1}
          key={company.assetId}
          mode={mode}
          movementScale={movementScale}
          onPress={() => onSelect(company)}
          rank={rankOffset + index + 1}
        />
      ))}
    </View>
  );
}

function CompanyCard({ company, isLast, mode, movementScale, onPress, rank }: {
  company: CompanySummary;
  isLast: boolean;
  mode: MarketMode;
  movementScale: number;
  onPress: () => void;
  rank: number;
}) {
  const theme = useHomeTheme();
  const { fontScale, width } = useWindowDimensions();
  const compact = width < 360;
  const earnings = mode === 'earnings';
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
        compact && styles.companyCardCompact,
        { borderBottomColor: theme.outlineSoft, borderBottomWidth: isLast ? 0 : 1 },
        earnings && styles.earningsRow,
        earnings && compact && styles.earningsRowCompact,
        fontScale > 1.3 && styles.companyCardLargeText,
        pressed && { backgroundColor: theme.proofWash },
      ]}>
      {mode === 'all' ? <Text style={[styles.companyRank, compact && styles.companyRankCompact, { color: theme.muted }]}>{String(rank).padStart(2, '0')}</Text> : null}
      {earnings ? (
        <View style={[styles.earningsCalendar, { backgroundColor: theme.canvas }]}>
          <Text style={[styles.earningsMonth, { color: theme.muted }]}>{company.earningsAt ? new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(company.earningsAt)) : 'TBD'}</Text>
          <Text style={[styles.earningsDay, { color: theme.ink }]}>{company.earningsAt ? new Intl.DateTimeFormat('en-US', { day: 'numeric' }).format(new Date(company.earningsAt)) : '—'}</Text>
        </View>
      ) : null}
      <View style={[styles.companyCardLeft, compact && styles.companyCardLeftCompact]}>
        <CompanyLogo company={company} size={compact ? 26 : 30} />
        <View style={styles.companyCopy}>
          <Text style={[styles.companyName, compact && styles.companyNameCompact, { color: theme.ink }]}>{company.companyName}</Text>
          <Text style={[styles.companyTicker, { color: theme.muted }]}>{company.ticker}</Text>
        </View>
      </View>
      {earnings ? <Text style={[styles.rowChevron, { color: theme.muted }]}>↗</Text> : (
        <View style={[styles.companyCardRight, compact && styles.companyCardRightCompact, fontScale > 1.3 && styles.companyCardRightLargeText]}>
          <Text
            style={[
              styles.companyChange,
              compact && styles.companyChangeCompact,
              { color: movementColor(company.changePercent, theme) },
            ]}>
            {secondary}
          </Text>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.movementTrack, { backgroundColor: `${theme.muted}1A` }]}>
            {company.changePercent !== null ? <View style={[
              styles.movementFill,
              { backgroundColor: movementColor(company.changePercent, theme), width: `${Math.abs(company.changePercent) / movementScale * 50}%` },
              company.changePercent < 0 ? styles.movementFillNegative : styles.movementFillPositive,
            ]} /> : null}
            <View style={[styles.movementZero, { backgroundColor: theme.outline }]} />
          </View>
        </View>
      )}
    </Pressable>
  );
}

function CompanyLogo({ company, size }: { company: CompanySummary; size: number }) {
  const theme = useHomeTheme();
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

function CompanyBoardSkeleton() {
  const theme = useHomeTheme();
  return (
    <View accessibilityLabel="Loading companies" style={styles.companyPage}>
      {Array.from({ length: BOARD_PAGE_SIZE }, (_, row) => (
        <View key={row} style={[styles.companyCard, { borderBottomColor: theme.outlineSoft, borderBottomWidth: row === BOARD_PAGE_SIZE - 1 ? 0 : 1 }]}>
          <View style={[styles.skeletonLogo, { backgroundColor: theme.disabledSurface }]} />
          <View style={[styles.skeletonName, { backgroundColor: theme.disabledSurface }]} />
          <View style={[styles.skeletonValue, { backgroundColor: theme.disabledSurface }]} />
        </View>
      ))}
    </View>
  );
}

function StaticActions() {
  const theme = useHomeTheme();
  const actions: { icon: HomeIconName; label: string }[] = [
    { icon: 'deposit', label: 'Deposit' },
    { icon: 'send', label: 'Send' },
    { icon: 'plus', label: 'Buy stock' },
  ];
  return (
    <View style={[styles.section, styles.toolsSection, { borderTopColor: theme.outlineSoft }]}>
      <View style={styles.sectionHeading}>
        <Text accessibilityRole="header" style={[styles.toolsTitle, { color: theme.ink }]}>Account actions</Text>
        <Text style={[styles.sectionMeta, { color: theme.muted }]}>Coming later</Text>
      </View>
      <View accessibilityLabel="Account actions coming later" style={styles.staticActions}>
        {actions.map((action) => (
          <View key={action.label} style={styles.staticAction}>
            <HomeIcon color={theme.muted} name={action.icon} size={18} />
            <Text style={[styles.staticActionLabel, { color: theme.muted }]}>{action.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function NewsSection({ news, unavailable }: { news: NewsSummary[]; unavailable: boolean }) {
  const theme = useHomeTheme();
  const newsRef = useRef<ScrollView>(null);
  const [newsWidth, setNewsWidth] = useState(0);
  const [newsPage, setNewsPage] = useState(0);
  const [selectedArticle, setSelectedArticle] = useState<NewsSummary>();
  const pages = useMemo(() => chunk(news, 3), [news]);

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
        style={styles.newsList}>
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
                    isLead={articleIndex === 0}
                    isLast={articleIndex === page.length - 1}
                    key={article.id}
                    onPress={() => setSelectedArticle(article)}
                  />
                ))}
              </View>
            ))}
          </ScrollView>
        ) : null}
        {unavailable ? <SectionMessage compact message="Could not refresh market news. Pull down to try again; company discovery still works." /> : null}
      </View>
      {pages.length > 1 ? (
        <View accessibilityLabel="News page selector" style={styles.newsPageDots}>
          {pages.map((_, index) => (
            <Pressable
              key={index}
              accessibilityLabel={`Show news page ${index + 1}`}
              accessibilityRole="button"
              accessibilityState={{ selected: newsPage === index }}
              onPress={() => showPage(index)}
              style={styles.pageDot}>
              <Text style={[styles.pageNumber, { color: newsPage === index ? theme.ink : theme.muted }]}>{index + 1}</Text>
              {newsPage === index ? <View style={[styles.pageUnderline, { backgroundColor: theme.ink }]} /> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      <NewsArticleSheet
        article={selectedArticle}
        eyebrow={selectedArticle?.category ?? 'Market news'}
        onClose={() => setSelectedArticle(undefined)}
      />
    </View>
  );
}

function NewsCard({ article, isLast, isLead, onPress }: { article: NewsSummary; isLast: boolean; isLead: boolean; onPress: () => void }) {
  const theme = useHomeTheme();
  const { width } = useWindowDimensions();
  return (
    <Pressable
      accessibilityHint="Opens the story in an in-app preview"
      accessibilityLabel={`${article.headline}, ${article.source}, ${formatAge(article.publishedAt)} ago`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.newsCard,
        isLead ? [styles.newsLead, { backgroundColor: theme.surface, borderColor: theme.outlineSoft }] : !isLast && { borderBottomColor: theme.outlineSoft, borderBottomWidth: 1 },
        isLead && width < 360 && styles.newsLeadCompact,
        pressed && { backgroundColor: theme.proofWash },
      ]}>
      {article.imageUrl ? <NewsArtwork article={article} variant={isLead ? 'hero' : 'thumbnail'} /> : null}
      <View style={styles.newsCopy}>
        <View>
          <View style={styles.newsKicker}>
            <Text style={[styles.newsCategory, { color: theme.proof }]}>{article.category}</Text>
            <Text style={[styles.newsAge, { color: theme.muted }]}>{formatAge(article.publishedAt)}</Text>
          </View>
          <Text numberOfLines={isLead ? 4 : 3} style={[styles.newsHeadline, isLead && styles.newsLeadHeadline, isLead && width < 360 && styles.newsLeadHeadlineCompact, { color: theme.ink }]}>{article.headline}</Text>
        </View>
        <View style={styles.newsFooter}>
          <Text numberOfLines={1} style={[styles.newsSource, { color: theme.muted }]}>{article.source}</Text>
          <Text style={[styles.newsArrow, { color: theme.proof }]}>›</Text>
        </View>
      </View>
    </Pressable>
  );
}

function NewsArtwork({ article, variant }: { article: NewsSummary; variant: 'hero' | 'thumbnail' }) {
  const theme = useHomeTheme();
  const [failedImageUrl, setFailedImageUrl] = useState<string>();
  const failed = Boolean(article.imageUrl && failedImageUrl === article.imageUrl);

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
          onError={() => setFailedImageUrl(article.imageUrl ?? undefined)}
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

function QuickActions() {
  const theme = useHomeTheme();
  const actions: { icon: HomeIconName; label: string }[] = [
    { icon: 'clock', label: 'Pre-market' },
    { icon: 'long', label: 'Open long' },
    { icon: 'swap', label: 'Swap' },
  ];
  return (
    <View style={[styles.section, styles.toolsSection, { borderTopColor: theme.outlineSoft }]}>
      <View style={styles.sectionHeading}>
        <Text accessibilityRole="header" style={[styles.toolsTitle, { color: theme.ink }]}>Quick actions</Text>
      </View>
      <View accessibilityLabel="Trading capabilities coming later" style={styles.quickGrid}>
        {actions.map((action) => (
          <View key={action.label} style={styles.quickCard}>
            <HomeIcon color={theme.muted} name={action.icon} size={21} />
            <Text style={[styles.quickLabel, { color: theme.muted }]}>{action.label}</Text>
            <Text style={[styles.laterLabel, { color: theme.muted }]}>Later</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function RetryNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  const theme = useHomeTheme();
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
  const theme = useHomeTheme();
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
  return error instanceof HomeRequestError ? error.message : 'Warren could not refresh market data.';
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
  if (mode === 'watchlist') return 'No companies are saved yet. You can still browse every supported company without signing in.';
  if (mode === 'earnings') return 'No upcoming earnings data is available for supported companies.';
  return 'Warren could not refresh company data. Pull down or use Try again.';
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
  return 'Needs refresh';
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

function movementColor(value: number | null, theme: ReturnType<typeof useHomeTheme>): string {
  if (value === null) return theme.muted;
  return value < 0 ? theme.caution : theme.gain;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safeArea: { flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', minHeight: 60, paddingHorizontal: 18, paddingVertical: 8 },
  brand: { alignItems: 'center', flexDirection: 'row', minHeight: 44 },
  content: { alignSelf: 'center', maxWidth: 680, paddingBottom: 24, paddingHorizontal: 18, paddingTop: 12, width: '100%' },
  contentCompact: { paddingHorizontal: 14 },
  homeIntro: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' },
  homeTitleCompact: { fontSize: 25, lineHeight: 30 },
  homeTitle: { fontFamily: Fonts.sans, fontSize: 27, fontWeight: '600', letterSpacing: -1.4, lineHeight: 33 },
  marketStatusLeft: { alignItems: 'center', flexDirection: 'row', flexShrink: 1, gap: 6 },
  statusDot: { borderRadius: 999, flexShrink: 0, height: 6, width: 6 },
  marketStatusLabel: { flexShrink: 1, fontFamily: Fonts.sans, fontSize: 11, fontWeight: '500', lineHeight: 16 },
  marketStatusMeta: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 16, marginBottom: 14, marginTop: 9 },
  marketDeck: { position: 'relative', zIndex: 1 },
  toolbar: { marginBottom: 12, position: 'relative', zIndex: 30 },
  searchBox: { alignItems: 'center', borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 10, minHeight: 48, minWidth: 0, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontFamily: Fonts.sans, fontSize: 15, fontWeight: '500', minHeight: 46, minWidth: 0, paddingVertical: 10, textAlignVertical: 'center' },
  clearSearch: { alignItems: 'center', borderRadius: 8, height: 44, justifyContent: 'center', width: 44 },
  clearSearchText: { fontFamily: Fonts.sans, fontSize: 22, lineHeight: 26 },
  marketModes: { borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 4, padding: 4 },
  modeButton: { alignItems: 'center', borderRadius: 10, flex: 1, justifyContent: 'center', minHeight: 40, paddingHorizontal: 8, paddingVertical: 8 },
  modeLabel: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '500' },
  searchPanel: { borderRadius: 12, borderWidth: 1, elevation: 12, left: 0, maxHeight: 238, overflow: 'hidden', padding: 5, position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 40 },
  searchStatus: { alignItems: 'center', flexDirection: 'row', justifyContent: 'center', minHeight: 56, paddingHorizontal: 10 },
  searchResultsScroll: { maxHeight: 226 },
  panelMessage: { flexShrink: 1, fontFamily: Fonts.sans, fontSize: 14, lineHeight: 21, paddingHorizontal: 10, paddingVertical: 14, textAlign: 'center' },
  searchResult: { alignItems: 'center', borderRadius: 9, flexDirection: 'row', gap: 10, minHeight: 64, padding: 10 },
  searchResultCopy: { flex: 1, minWidth: 0 },
  searchResultName: { fontFamily: Fonts.sans, fontSize: 14, fontWeight: '600' },
  searchResultTicker: { fontFamily: Fonts.sans, fontSize: 12, marginTop: 4 },
  searchResultPrice: { alignItems: 'flex-end', flexShrink: 0 },
  searchResultPriceText: { fontFamily: Fonts.mono, fontSize: 12, fontWeight: '600' },
  searchResultChange: { fontFamily: Fonts.mono, fontSize: 12, marginTop: 3 },
  indexStrip: { borderBottomWidth: 1, borderTopWidth: 1, marginBottom: 14, paddingVertical: 10 },
  indexStripContent: { gap: 16 },
  indexQuote: { alignItems: 'flex-start', gap: 6, justifyContent: 'center', minHeight: 58 },
  indexName: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 15 },
  indexState: { fontFamily: Fonts.mono, fontSize: 8 },
  indexValueCompact: { fontSize: 14 },
  indexValue: { fontFamily: Fonts.sans, fontSize: 16, fontWeight: '500', fontVariant: ['tabular-nums'], letterSpacing: -0.6 },
  indexChange: { fontFamily: Fonts.mono, fontSize: 11, fontWeight: '500', lineHeight: 15 },
  boardHeading: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', paddingBottom: 10, paddingTop: 18 },
  boardTitleCompact: { fontSize: 21, lineHeight: 27 },
  boardTitle: { flexShrink: 1, fontFamily: Fonts.sans, fontSize: 23, fontWeight: '500', letterSpacing: -1, lineHeight: 30 },
  boardMeta: { fontFamily: Fonts.mono, fontSize: 10, fontWeight: '500' },
  movementSwitcher: { borderBottomWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 18, marginBottom: 8 },
  movementButton: { alignItems: 'center', borderBottomWidth: 2, justifyContent: 'center', minHeight: 44, paddingHorizontal: 2, paddingVertical: 8 },
  movementButtonText: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '500' },
  boardColumns: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between', paddingBottom: 7, paddingHorizontal: 10, paddingTop: 10 },
  boardColumnLabel: { fontFamily: Fonts.sans, fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase' },
  companyBoard: { borderRadius: 16, overflow: 'hidden' },
  companyPageCompact: { paddingHorizontal: 10 },
  companyPage: { paddingHorizontal: 12 },
  companyCardCompact: { gap: 7 },
  companyCard: { alignItems: 'center', flexDirection: 'row', gap: 9, minHeight: 65, paddingVertical: 11 },
  companyCardLargeText: { flexWrap: 'wrap' },
  companyRankCompact: { minWidth: 16 },
  companyRank: { fontFamily: Fonts.mono, fontSize: 10, minWidth: 19 },
  companyCardLeftCompact: { gap: 7 },
  companyCardLeft: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 10, minWidth: 0 },
  companyCopy: { flex: 1, gap: 4, minWidth: 0 },
  companyCardRight: { alignItems: 'flex-end', gap: 7, justifyContent: 'center', width: 90 },
  companyCardRightCompact: { width: 77 },
  companyCardRightLargeText: { width: '100%' },
  companyLogo: { alignItems: 'center', flexShrink: 0, justifyContent: 'center', overflow: 'hidden' },
  companyInitials: { fontFamily: Fonts.sans, fontWeight: '700', letterSpacing: -0.3 },
  companyName: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '500', lineHeight: 17 },
  companyNameCompact: { fontSize: 12, lineHeight: 16 },
  companyTicker: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 0.35, lineHeight: 13 },
  companyChange: { fontFamily: Fonts.mono, fontSize: 16, fontWeight: '500', letterSpacing: -0.9 },
  companyChangeCompact: { fontSize: 15 },
  movementTrack: { borderRadius: 4, height: 4, maxWidth: '100%', position: 'relative', width: 86 },
  movementFill: { height: '100%', position: 'absolute', top: 0 },
  movementFillPositive: { borderBottomRightRadius: 4, borderTopRightRadius: 4, left: '50%' },
  movementFillNegative: { borderBottomLeftRadius: 4, borderTopLeftRadius: 4, right: '50%' },
  movementZero: { height: 8, left: '50%', position: 'absolute', top: -2, width: 1 },
  movementCaption: { fontFamily: Fonts.sans, fontSize: 10, lineHeight: 15, paddingHorizontal: 2, paddingTop: 10 },
  earningsRowCompact: { gap: 10 },
  earningsRow: { gap: 14, minHeight: 76 },
  earningsCalendar: { alignItems: 'center', borderRadius: 9, flexShrink: 0, gap: 3, justifyContent: 'center', minHeight: 50, minWidth: 40, padding: 4 },
  earningsMonth: { fontFamily: Fonts.mono, fontSize: 9, fontWeight: '500', letterSpacing: 0.5, textTransform: 'uppercase' },
  earningsDay: { fontFamily: Fonts.sans, fontSize: 21, fontWeight: '500', letterSpacing: -1 },
  rowChevron: { fontFamily: Fonts.sans, fontSize: 18 },
  skeletonLogo: { borderRadius: 10, height: 30, width: 30 },
  skeletonName: { borderRadius: 4, flex: 1, height: 14, marginRight: 20 },
  skeletonValue: { borderRadius: 4, height: 16, width: 72 },
  deckFooter: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: 'space-between', paddingTop: 8 },
  deckNote: { fontFamily: Fonts.sans, fontSize: 10, lineHeight: 15 },
  pageDots: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap' },
  pageDot: { alignItems: 'center', height: 44, justifyContent: 'center', position: 'relative', width: 44 },
  pageNumber: { fontFamily: Fonts.mono, fontSize: 11, fontWeight: '500' },
  pageUnderline: { bottom: 5, height: 2, position: 'absolute', width: 14 },
  sectionMessage: { alignItems: 'center', gap: 9, justifyContent: 'center', minHeight: 220, paddingHorizontal: 28, paddingVertical: 28 },
  sectionMessageCompact: { minHeight: 68 },
  sectionMessageText: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 22, textAlign: 'center' },
  retryNotice: { alignItems: 'center', borderRadius: 10, borderWidth: 1, flexDirection: 'row', gap: 10, marginTop: 10, padding: 10 },
  retryMessage: { flex: 1, fontFamily: Fonts.sans, fontSize: 13, lineHeight: 19 },
  retryButton: { alignItems: 'center', borderRadius: 8, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 12 },
  retryButtonText: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '600' },
  staticActions: { flexDirection: 'row', gap: 10 },
  staticAction: { alignItems: 'flex-start', flex: 1, gap: 7, minHeight: 74, paddingVertical: 8 },
  staticActionLabel: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '600' },
  laterLabel: { fontFamily: Fonts.sans, fontSize: 12, fontWeight: '500', marginTop: 'auto' },
  section: { marginTop: 32 },
  sectionHeading: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', marginBottom: 14 },
  sectionTitle: { fontFamily: Fonts.sans, fontSize: 23, fontWeight: '500', letterSpacing: -1, lineHeight: 30 },
  sectionMeta: { fontFamily: Fonts.sans, fontSize: 10 },
  newsList: { overflow: 'hidden' },
  newsPage: { paddingHorizontal: 1 },
  newsPageDots: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end' },
  newsCard: { alignItems: 'flex-start', flexDirection: 'row', gap: 12, paddingHorizontal: 4, paddingVertical: 16 },
  newsLeadCompact: { paddingHorizontal: 18, paddingVertical: 18 },
  newsLead: { alignItems: 'stretch', borderRadius: 16, borderWidth: 1, flexDirection: 'column', marginBottom: 3, paddingHorizontal: 20, paddingVertical: 20 },
  newsThumbnail: { alignItems: 'center', borderRadius: 10, flexShrink: 0, height: 64, justifyContent: 'center', overflow: 'hidden', width: 58 },
  newsHero: { alignItems: 'center', borderRadius: 10, height: 140, justifyContent: 'center', overflow: 'hidden', width: '100%' },
  newsArtworkFallback: { fontFamily: Fonts.serif, fontSize: 22, fontWeight: '700' },
  newsCopy: { flex: 1, minWidth: 0, width: '100%' },
  newsKicker: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  newsCategory: { fontFamily: Fonts.sans, fontSize: 10 },
  newsAge: { fontFamily: Fonts.sans, fontSize: 10 },
  newsHeadline: { fontFamily: Fonts.sans, fontSize: 14, fontWeight: '500', letterSpacing: -0.14, lineHeight: 20, marginBottom: 10, marginTop: 8 },
  newsLeadHeadlineCompact: { fontSize: 21, lineHeight: 26 },
  newsLeadHeadline: { fontSize: 23, letterSpacing: -0.8, lineHeight: 28, marginBottom: 20, marginTop: 14 },
  newsFooter: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  newsSource: { flex: 1, fontFamily: Fonts.sans, fontSize: 10, lineHeight: 14 },
  newsArrow: { fontFamily: Fonts.sans, fontSize: 14 },
  toolsSection: { borderTopWidth: 1, paddingTop: 24 },
  toolsTitle: { fontFamily: Fonts.sans, fontSize: 16, fontWeight: '500', letterSpacing: -0.4 },
  quickGrid: { flexDirection: 'row', gap: 10 },
  quickCard: { alignItems: 'flex-start', flex: 1, gap: 10, minHeight: 72 },
  quickLabel: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  disclosure: { borderTopWidth: 1, fontFamily: Fonts.sans, fontSize: 11, lineHeight: 18, marginTop: 20, paddingHorizontal: 2, paddingTop: 14 },
  pressed: { opacity: 0.7 },
});
