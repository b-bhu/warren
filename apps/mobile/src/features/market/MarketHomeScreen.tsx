import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useRouter, type Href } from 'expo-router';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type ListRenderItem,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import {
  type MarketCompanySummary,
  type MarketCounts,
  type MarketInstrument,
  type MarketProduct,
  type MarketSort,
} from '@warren/markets-contract';
import type { LendingCatalogResponse, LendingAsset } from '@warren/lending-contract';

import { AppAccountButton } from '@/components/AppAccountButton';
import { BrandLogo } from '@/components/brand-logo';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { loadMarkets, searchMarkets } from './markets-api';
import { loadLendingCatalog } from './lending-api';

const productOrder: readonly MarketProduct[] = ['spot', 'prestock', 'perpetual'];
type MarketSection = MarketProduct | 'lending';
const emptyCounts: MarketCounts = { spot: 0, prestock: 0, perpetual: 0 };
type DirectorySection = { title: string; data: MarketInstrument[] };

function useMarketsTheme() {
  const theme = useTheme();
  const dark = theme.canvas === '#131918';
  return {
    ...theme,
    outlineSoft: `${theme.muted}33`,
    raised: dark ? '#222D2A' : '#FFFFFF',
    gain: dark ? '#8BC4A1' : '#286440',
    privateInk: dark ? '#D8B87C' : '#775418',
    privateWash: dark ? '#3C321F' : '#F2E7D3',
  };
}

const productLabels: Record<MarketProduct, string> = {
  spot: 'Spot',
  prestock: 'PreStocks',
  perpetual: 'Perpetuals',
};

export function MarketHomeScreen() {
  const router = useRouter();
  const theme = useMarketsTheme();
  const { width } = useWindowDimensions();
  const listRef = useRef<SectionList<MarketInstrument, DirectorySection>>(null);
  const lendingListRef = useRef<ScrollView>(null);
  const searchBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingJump = useRef<{ sectionIndex: number; attempts: number } | null>(null);
  const [indexOpen, setIndexOpen] = useState(false);
  const [showTop, setShowTop] = useState(false);
  const [product, setProduct] = useState<MarketProduct>('spot');
  const [section, setSection] = useState<MarketSection>('spot');
  const [lendingCatalog, setLendingCatalog] = useState<LendingCatalogResponse>();
  const [lendingError, setLendingError] = useState<string>();
  const [lendingRequestVersion, setLendingRequestVersion] = useState(0);
  const [items, setItems] = useState<MarketInstrument[]>([]);
  const [counts, setCounts] = useState<MarketCounts>(emptyCounts);
  const [nextCursor, setNextCursor] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [warning, setWarning] = useState<string>();
  const [requestVersion, setRequestVersion] = useState(0);
  const [refreshingSection, setRefreshingSection] = useState<MarketSection>();

  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchResults, setSearchResults] = useState<MarketCompanySummary[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string>();

  const sort = defaultSort(product);
  const registryKey = `${product}:${sort}`;
  const registryKeyRef = useRef(registryKey);

  useEffect(() => {
    registryKeyRef.current = registryKey;
  }, [registryKey]);

  useEffect(() => {
    const controller = new AbortController();
    loadMarkets({ product, availableOnly: false, sort, limit: 24 }, controller.signal)
      .then((response) => {
        setItems(response.items);
        setCounts(response.counts);
        setNextCursor(response.pageInfo.nextCursor ?? undefined);
        setWarning(response.warnings[0]?.message);
      })
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.name === 'AbortError') return;
        setItems([]);
        setNextCursor(undefined);
        setError(reason instanceof Error ? reason.message : 'Warren could not refresh Markets.');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
          setRefreshingSection((current) => current === product ? undefined : current);
        }
      });
    return () => controller.abort();
  }, [product, requestVersion, sort]);

  useEffect(() => {
    const controller = new AbortController();
    loadLendingCatalog(controller.signal)
      .then((response) => { setLendingCatalog(response); setLendingError(undefined); })
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.name === 'AbortError') return;
        setLendingError(reason instanceof Error ? reason.message : 'Warren could not refresh lending markets.');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setRefreshingSection((current) => current === 'lending' ? undefined : current);
        }
      });
    return () => controller.abort();
  }, [lendingRequestVersion]);

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setIsSearching(true);
      setSearchError(undefined);
      searchMarkets(normalized, controller.signal)
        .then((response) => setSearchResults(response.items))
        .catch((reason: unknown) => {
          if (reason instanceof Error && reason.name === 'AbortError') return;
          setSearchResults([]);
          setSearchError(reason instanceof Error ? reason.message : 'Warren could not refresh search results.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsSearching(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => () => {
    if (searchBlurTimer.current) clearTimeout(searchBlurTimer.current);
    if (jumpTimer.current) clearTimeout(jumpTimer.current);
  }, []);

  const totalProducts = counts.spot + counts.prestock + counts.perpetual;
  const searchOpen = searchFocused && query.trim().length > 0;
  // Arrange only the presentation; retain every instrument, API sort and cursor.
  const directory = useMemo(() => {
    const groups = new Map<string, MarketInstrument[]>();
    const sorted = [...items].sort((left, right) => left.companyName.localeCompare(right.companyName)
      || left.symbol.localeCompare(right.symbol));
    for (const instrument of sorted) {
      const first = instrument.companyName.trim().charAt(0).toUpperCase();
      const letter = /^[A-Z]$/.test(first) ? first : '#';
      const group = groups.get(letter) ?? [];
      group.push(instrument);
      groups.set(letter, group);
    }
    return [...groups].map(([title, data]) => ({ title, data }));
  }, [items]);

  const scrollToTop = useCallback(() => {
    if (jumpTimer.current) clearTimeout(jumpTimer.current);
    pendingJump.current = null;
    setIndexOpen(false);
    listRef.current?.getScrollResponder()?.scrollTo({ y: 0, animated: false });
    lendingListRef.current?.scrollTo({ y: 0, animated: false });
  }, []);

  const trackScroll = useCallback((offset: number) => {
    const away = offset > 32;
    setShowTop((current) => current === away ? current : away);
  }, []);

  const jumpToLetter = useCallback((letter: string) => {
    const sectionIndex = directory.findIndex((group) => group.title === letter);
    if (sectionIndex < 0) return;
    if (jumpTimer.current) clearTimeout(jumpTimer.current);
    setIndexOpen(false);
    pendingJump.current = { sectionIndex, attempts: 0 };
    // Target the first row after the section header so sticky-header offsets apply.
    listRef.current?.scrollToLocation({ sectionIndex, itemIndex: 1, animated: false });
  }, [directory]);

  const retryLetterJump = useCallback(({ averageItemLength, index }: { averageItemLength: number; index: number }) => {
    const pending = pendingJump.current;
    if (!pending || pending.attempts >= 3) return;
    pending.attempts += 1;
    listRef.current?.getScrollResponder()?.scrollTo({ y: averageItemLength * index, animated: false });
    jumpTimer.current = setTimeout(() => {
      if (pendingJump.current !== pending) return;
      listRef.current?.scrollToLocation({ sectionIndex: pending.sectionIndex, itemIndex: 1, animated: false });
    }, 150);
  }, []);

  const chooseProduct = useCallback((next: MarketProduct) => {
    if (jumpTimer.current) clearTimeout(jumpTimer.current);
    pendingJump.current = null;
    setIndexOpen(false);
    setShowTop(false);
    setSection(next);
    setProduct(next);
    setIsLoading(true);
    setIsLoadingMore(false);
    setError(undefined);
    setItems([]);
    setNextCursor(undefined);
    listRef.current?.getScrollResponder()?.scrollTo({ y: 0, animated: false });
  }, []);

  const changeQuery = useCallback((nextQuery: string) => {
    setQuery(nextQuery);
    if (nextQuery.trim()) return;
    setSearchResults([]);
    setSearchError(undefined);
    setIsSearching(false);
  }, []);

  const retryRegistry = useCallback(() => {
    setIsLoading(true);
    setIsLoadingMore(false);
    setError(undefined);
    setRequestVersion((current) => current + 1);
  }, []);

  const pullToRefresh = useCallback(() => {
    setRefreshingSection(section);
    if (section === 'lending') {
      setLendingError(undefined);
      setLendingRequestVersion((current) => current + 1);
      return;
    }
    setError(undefined);
    setRequestVersion((current) => current + 1);
  }, [section]);

  const openCompany = useCallback((assetId: string, instrumentId?: string, entrySource: 'markets' | 'search' = 'markets') => {
    Keyboard.dismiss();
    setSearchFocused(false);
    router.push({
      pathname: '/stocks/[assetId]',
      params: {
        assetId,
        product,
        source: entrySource,
        ...(instrumentId ? { instrumentId } : {}),
      },
    } as Href);
  }, [product, router]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || isLoadingMore) return;
    const requestedRegistry = registryKey;
    setIsLoadingMore(true);
    try {
      const response = await loadMarkets({ product, availableOnly: false, sort, cursor: nextCursor, limit: 24 });
      if (registryKeyRef.current !== requestedRegistry) return;
      setItems((current) => {
        const known = new Set(current.map((item) => item.instrumentId));
        return [...current, ...response.items.filter((item) => !known.has(item.instrumentId))];
      });
      setNextCursor(response.pageInfo.nextCursor ?? undefined);
      setWarning(response.warnings[0]?.message);
    } catch (reason) {
      if (registryKeyRef.current !== requestedRegistry) return;
      setWarning(reason instanceof Error ? reason.message : 'More markets could not be loaded.');
    } finally {
      if (registryKeyRef.current === requestedRegistry) setIsLoadingMore(false);
    }
  }, [isLoadingMore, nextCursor, product, registryKey, sort]);

  const renderItem: ListRenderItem<MarketInstrument> = useCallback(({ item }) => (
    <InstrumentRow instrument={item} onPress={() => openCompany(item.assetId, item.instrumentId)} />
  ), [openCompany]);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.safeArea, { backgroundColor: theme.canvas }]}>
      <MarketHeader onBrandPress={scrollToTop} />

      <View style={[styles.screen, width < 360 && styles.screenCompact]}>
        <View accessibilityLabel="Verified market instruments" style={styles.registryPanel}>
          <View
            accessibilityRole="tablist"
            style={[styles.productTabs, { borderBottomColor: theme.outlineSoft }]}>
            {productOrder.map((item) => (
              <ProductTab
                active={section === item}
                count={counts[item]}
                key={item}
                label={productLabels[item]}
                onPress={() => chooseProduct(item)}
              />
            ))}
            <ProductTab
              active={section === 'lending'}
              count={lendingCatalog?.assets.length ?? 9}
              label="Lending"
              onPress={() => {
                if (jumpTimer.current) clearTimeout(jumpTimer.current);
                pendingJump.current = null;
                setIndexOpen(false);
                setShowTop(false);
                setSection('lending');
              }}
            />
          </View>
          <View style={styles.browseHeader}>
            <View style={styles.searchArea}>
              <View style={[styles.searchBox, { borderColor: searchFocused ? theme.proof : theme.outlineSoft }]}>
                <MarketIcon color={theme.muted} name="search" size={16} />
                <TextInput
                  accessibilityLabel="Search company, ticker, or instrument"
                  autoCapitalize="none"
                  autoCorrect={false}
                  onBlur={() => {
                    searchBlurTimer.current = setTimeout(() => setSearchFocused(false), 120);
                  }}
                  onChangeText={changeQuery}
                  onFocus={() => {
                    setIndexOpen(false);
                    if (searchBlurTimer.current) clearTimeout(searchBlurTimer.current);
                    setSearchFocused(true);
                  }}
                  placeholder="Search companies"
                  placeholderTextColor={theme.muted}
                  returnKeyType="search"
                  style={[styles.searchInput, width < 360 && styles.searchInputCompact, { color: theme.ink }]}
                  value={query}
                />
                {isSearching ? <ActivityIndicator color={theme.proof} size="small" /> : null}
                {query ? (
                  <Pressable
                    accessibilityLabel="Clear Markets search"
                    accessibilityRole="button"
                    hitSlop={7}
                    onPress={() => {
                      changeQuery('');
                    }}
                    style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}>
                    <Text style={[styles.clearText, { color: theme.muted }]}>×</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
            {section !== 'lending' ? (
              <Pressable
                accessibilityLabel="Jump to company letter"
                accessibilityRole="button"
                accessibilityState={{ expanded: indexOpen }}
                onPress={() => {
                  Keyboard.dismiss();
                  setSearchFocused(false);
                  setIndexOpen((current) => !current);
                }}
                style={[styles.indexToggle, { backgroundColor: theme.surface, borderColor: indexOpen ? theme.proof : theme.outlineSoft }]}>
                <Text style={[styles.indexToggleLabel, { color: indexOpen ? theme.proof : theme.ink }]}>A–Z</Text>
                <Text style={[styles.indexChevron, { color: theme.muted }]}>⌄</Text>
              </Pressable>
            ) : null}
            {searchOpen ? (
              <View
                accessibilityLiveRegion="polite"
                style={[styles.searchResults, { backgroundColor: theme.raised, borderColor: theme.outline }]}>
                {searchError ? (
                  <Text style={[styles.searchEmpty, { color: theme.caution }]}>{searchError}</Text>
                ) : !isSearching && searchResults.length === 0 ? (
                  <Text style={[styles.searchEmpty, { color: theme.muted }]}>No verified company or instrument matches this search.</Text>
                ) : (
                  <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled showsVerticalScrollIndicator={false}>
                    {searchResults.map((company) => (
                      <SearchResult key={company.assetId} company={company} onPress={() => openCompany(company.assetId, undefined, 'search')} />
                    ))}
                  </ScrollView>
                )}
              </View>
            ) : null}
            {indexOpen && section !== 'lending' ? (
              <LetterPicker
                hasMore={Boolean(nextCursor)}
                letters={directory.map((group) => group.title)}
                onClose={() => setIndexOpen(false)}
                onSelect={jumpToLetter}
                onTop={scrollToTop}
              />
            ) : null}
          </View>

          {warning ? (
            <View style={[styles.warningBar, { backgroundColor: theme.cautionWash }]}>
              <Text style={[styles.warningText, { color: theme.caution }]}>{warning}</Text>
            </View>
          ) : null}

          {section !== 'lending' ? (
            <View style={styles.columnLabels}>
              <Text style={[styles.columnLabel, { color: theme.muted }]}>Company / Instrument</Text>
              <Text style={[styles.columnLabel, { color: theme.muted }]}>
                {product === 'spot' ? 'Price / 1D' : product === 'prestock' ? 'Indicative value' : 'Price / Funding'}
              </Text>
            </View>
          ) : null}
          <View style={styles.listArea}>
            {section === 'lending' ? (
              <LendingList
                catalog={lendingCatalog}
                error={lendingError}
                onRefresh={pullToRefresh}
                onOpen={(assetId) => router.push({ pathname: '/lending/[assetId]', params: { assetId } } as Href)}
                onRetry={() => setLendingRequestVersion((version) => version + 1)}
                onScroll={trackScroll}
                refreshing={refreshingSection === 'lending'}
                scrollRef={lendingListRef}
              />
            ) : <SectionList<MarketInstrument, DirectorySection>
              contentContainerStyle={[styles.listContent, !items.length && styles.emptyListContent]}
              sections={directory}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              keyExtractor={(item) => item.instrumentId}
              ListEmptyComponent={
                isLoading ? (
                  <LoadingRows />
                ) : error ? (
                  <RegistryMessage
                    action="Try again"
                    message={error}
                    onAction={retryRegistry}
                    title="Markets need a refresh"
                  />
                ) : (
                  <RegistryMessage
                    message="No verified instruments are listed for this market yet."
                    title="No instruments found"
                  />
                )
              }
              ListFooterComponent={
                items.length ? (
                  <View>
                    {nextCursor ? (
                      <Pressable
                        accessibilityRole="button"
                        disabled={isLoadingMore}
                        onPress={loadMore}
                        style={({ pressed }) => [
                          styles.loadMore,
                          { borderColor: theme.outline },
                          pressed && styles.pressed,
                        ]}>
                        {isLoadingMore ? <ActivityIndicator color={theme.proof} size="small" /> : null}
                        <Text style={[styles.loadMoreText, { color: theme.proof }]}>
                          {isLoadingMore ? 'Loading more' : 'Load more instruments'}
                        </Text>
                      </Pressable>
                    ) : null}
                    <Coverage count={totalProducts} />
                  </View>
                ) : null
              }
              ref={listRef}
              refreshControl={(
                <RefreshControl
                  colors={[theme.proof]}
                  onRefresh={pullToRefresh}
                  refreshing={refreshingSection === section}
                  tintColor={theme.proof}
                />
              )}
              renderItem={renderItem}
              renderSectionHeader={({ section: group }) => (
                <Text accessibilityRole="header" style={[styles.letterHeading, { backgroundColor: theme.canvas, borderBottomColor: theme.outlineSoft, color: theme.proof }]}>{group.title}</Text>
              )}
              stickySectionHeadersEnabled
              onScroll={(event) => trackScroll(event.nativeEvent.contentOffset.y)}
              scrollEventThrottle={16}
              onScrollToIndexFailed={retryLetterJump}
              showsVerticalScrollIndicator={false}
              style={styles.instrumentList}
            />}
            {showTop ? (
              <Pressable accessibilityLabel="Back to top" accessibilityRole="button" onPress={scrollToTop} style={[styles.backToTop, { backgroundColor: theme.raised, borderColor: theme.outline }]}>
                <Text style={[styles.backToTopText, { color: theme.proof }]}>↑ Top</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

function LetterPicker({ hasMore, letters, onClose, onSelect, onTop }: {
  hasMore: boolean;
  letters: string[];
  onClose: () => void;
  onSelect: (letter: string) => void;
  onTop: () => void;
}) {
  const theme = useMarketsTheme();
  const alphabet = [...(letters.includes('#') ? '#' : ''), ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
  return (
    <View accessibilityLabel="Company letter index" style={[styles.letterPicker, { backgroundColor: theme.raised, borderColor: theme.outline }]}>
      <View style={styles.pickerHeading}>
        <Pressable accessibilityRole="button" onPress={onTop} style={styles.indexReset}>
          <Text style={[styles.indexResetLabel, { color: theme.proof }]}>↑ Start from top</Text>
        </Pressable>
        <Pressable accessibilityLabel="Close letter index" accessibilityRole="button" onPress={onClose} style={styles.pickerClose}>
          <Text style={[styles.pickerCloseLabel, { color: theme.muted }]}>×</Text>
        </Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled showsVerticalScrollIndicator={false}>
        <View style={styles.letterGrid}>
          {alphabet.map((letter) => {
            const available = letters.includes(letter);
            return (
              <View key={letter} style={styles.letterCell}>
                <Pressable
                  accessibilityLabel={`Jump to ${letter}`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !available }}
                  disabled={!available}
                  onPress={() => onSelect(letter)}
                  style={({ pressed }) => [styles.letterButton, { backgroundColor: pressed ? theme.proofWash : theme.surface, borderColor: theme.outlineSoft }, !available && styles.letterDisabled]}>
                  <Text style={[styles.letterButtonLabel, { color: theme.ink }]}>{letter}</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
        {hasMore ? <Text style={[styles.pickerNote, { color: theme.muted }]}>Letters shown cover loaded instruments. Use Load more to browse additional companies.</Text> : null}
      </ScrollView>
    </View>
  );
}

function LendingList({ catalog, error, onRefresh, onRetry, onOpen, onScroll, refreshing, scrollRef }: { catalog?: LendingCatalogResponse; error?: string; onRefresh: () => void; onRetry: () => void; onOpen: (assetId: string) => void; onScroll: (offset: number) => void; refreshing: boolean; scrollRef: RefObject<ScrollView | null> }) {
  const theme = useMarketsTheme();
  if (error) return <RegistryMessage action="Try again" message={error} onAction={onRetry} title="Lending markets need a refresh" />;
  if (!catalog) return <LoadingRows />;
  return (
    <ScrollView
      contentContainerStyle={styles.lendingList}
      onScroll={(event) => onScroll(event.nativeEvent.contentOffset.y)}
      ref={scrollRef}
      refreshControl={<RefreshControl colors={[theme.proof]} onRefresh={onRefresh} refreshing={refreshing} tintColor={theme.proof} />}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}>
      <View accessibilityLabel="Supply xStocks as collateral to borrow USDC" style={styles.lendingFlow}>
        <View style={[styles.lendingFlowCard, { backgroundColor: theme.surface, borderColor: theme.outlineSoft }]}>
          <Text style={[styles.lendingFlowTitle, { color: theme.ink }]}>Supply xStocks</Text>
          <Text style={[styles.lendingFlowCopy, { color: theme.muted }]}>Collateral you provide</Text>
        </View>
        <Text style={[styles.lendingFlowArrow, { color: theme.proof }]}>→</Text>
        <View style={[styles.lendingFlowCard, { backgroundColor: theme.surface, borderColor: theme.outlineSoft }]}>
          <Text style={[styles.lendingFlowTitle, { color: theme.ink }]}>Borrow USDC</Text>
          <Text style={[styles.lendingFlowCopy, { color: theme.muted }]}>Debt against collateral</Text>
        </View>
      </View>
      <Text style={[styles.lendingCopy, { color: theme.muted }]}>Kamino · Solana mainnet · Terms refresh from the market. Borrowing the stock token is not supported.</Text>
      <View style={[styles.lendingCards, { backgroundColor: theme.surface, borderColor: theme.outlineSoft }]}>
        {catalog.assets.map((asset, index) => <LendingRow key={asset.assetId} asset={asset} isLast={index === catalog.assets.length - 1} onPress={() => onOpen(asset.assetId)} />)}
      </View>
      <Text style={[styles.lendingNotice, { color: theme.muted }]}>Market terms can change. Each action is refreshed, simulated and shown for wallet review before signing. New borrowing remains subject to Warren’s risk controls.</Text>
    </ScrollView>
  );
}

function LendingRow({ asset, isLast, onPress }: { asset: LendingAsset; isLast: boolean; onPress: () => void }) {
  const theme = useMarketsTheme();
  const status = asset.routeAvailable ? 'USDC route active' : asset.marketStatus ?? 'No active route';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${asset.symbol}, lending details`} onPress={onPress} style={({ pressed }) => [styles.lendingRow, { borderBottomColor: theme.outlineSoft, borderBottomWidth: isLast ? 0 : 1 }, pressed && { backgroundColor: theme.proofWash }]}>
      <View style={styles.lendingIdentity}>
        <Text style={[styles.lendingSymbol, { color: theme.ink }]}>{asset.symbol}</Text>
        <Text style={[styles.lendingName, { color: theme.muted }]}>{asset.name} · xStock collateral</Text>
      </View>
      <View style={styles.lendingTerms}>
        <View style={styles.lendingRate}>
          <Text style={[styles.lendingRateLabel, { color: theme.muted }]}>Supply APY</Text>
          <Text style={[styles.lendingRateValue, { color: theme.ink }]}>{percent(asset.supplyApy)}</Text>
        </View>
        <View style={[styles.lendingRate, styles.lendingBorrowRate, { borderLeftColor: theme.outlineSoft }]}>
          <Text style={[styles.lendingRateLabel, { color: theme.muted }]}>USDC borrow APY</Text>
          <Text style={[styles.lendingRateValue, { color: theme.ink }]}>{percent(asset.borrowApy)}</Text>
        </View>
      </View>
      <View style={styles.lendingStatusRow}>
        <View style={[styles.lendingStatusDot, { backgroundColor: asset.actionsPaused || !asset.routeAvailable ? theme.caution : theme.proof }]} />
        <Text style={[styles.lendingStatus, { color: asset.actionsPaused || !asset.routeAvailable ? theme.caution : theme.muted }]}>{asset.actionsPaused ? 'Actions paused' : status}</Text>
      </View>
      <Text selectable numberOfLines={1} style={[styles.lendingMint, { color: theme.muted }]}>Mint {asset.mintAddress}</Text>
    </Pressable>
  );
}

function percent(value: string | null): string { return value === null ? '—' : `${(Number(value) * 100).toFixed(2)}%`; }

function MarketHeader({ onBrandPress }: { onBrandPress: () => void }) {
  const theme = useMarketsTheme();
  return (
    <View style={[styles.header, { backgroundColor: theme.canvas }]}>
      <Pressable
        accessibilityLabel="Warren markets"
        accessibilityHint="Scrolls Markets to the top"
        accessibilityRole="button"
        onPress={onBrandPress}
        style={({ pressed }) => [styles.brand, pressed && styles.pressed]}>
        <BrandLogo decorative width={112} />
      </Pressable>
      <AppAccountButton appearance="outlined" />
    </View>
  );
}

function ProductTab({ active, count, label, onPress }: { active: boolean; count: number; label: string; onPress: () => void }) {
  const theme = useMarketsTheme();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={`${label}, ${count} instruments`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.productTab,
        { borderBottomColor: active ? theme.proof : 'transparent' },
        pressed && styles.pressed,
      ]}>
      <Text style={[styles.productTabLabel, { color: active ? theme.proof : theme.muted }, active && styles.productTabActive]}>{label}</Text>
    </Pressable>
  );
}

function SearchResult({ company, onPress }: { company: MarketCompanySummary; onPress: () => void }) {
  const theme = useMarketsTheme();
  return (
    <Pressable
      accessibilityLabel={`Open markets for ${company.companyName}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.searchResult, pressed && { backgroundColor: theme.proofWash }]}>
      <CompanyLogo companyName={company.companyName} logoUrl={company.logoUrl} size={32} />
      <View style={styles.searchResultCopy}>
        <Text numberOfLines={1} style={[styles.searchResultName, { color: theme.ink }]}>{company.companyName}</Text>
        <Text style={[styles.searchResultTicker, { color: theme.muted }]}>{company.ticker ?? 'Private company exposure'}</Text>
      </View>
      <View style={styles.capabilityChips}>
        {company.capabilities.map((capability) => (
          <View key={capability.productType}>
            <Text style={[styles.capabilityChipText, { color: capability.availability === 'available' ? theme.ink : theme.muted }]}>
              {shortProductLabel(capability.productType)}
            </Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

function InstrumentRow({ instrument, onPress }: { instrument: MarketInstrument; onPress: () => void }) {
  const theme = useMarketsTheme();
  const { width, fontScale } = useWindowDimensions();
  const compact = width < 360;
  const movement = instrument.productType === 'spot' ? instrument.changePercent.value : null;
  return (
    <Pressable
      accessibilityHint="Opens every Warren market known for this company"
      accessibilityLabel={instrumentAccessibilityLabel(instrument)}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.instrumentRow,
        compact && styles.instrumentRowCompact,
        fontScale > 1.3 && styles.instrumentRowLargeText,
        { borderBottomColor: theme.outlineSoft, backgroundColor: pressed ? theme.surface : 'transparent' },
      ]}>
      <CompanyLogo companyName={instrument.companyName} logoUrl={instrument.logoUrl} privateStock={instrument.productType === 'prestock'} size={compact ? 26 : 30} />
      <View style={styles.instrumentIdentity}>
        <Text numberOfLines={fontScale > 1.3 ? undefined : 1} style={[styles.companyName, compact && styles.companyNameCompact, { color: theme.ink }]}>{instrument.companyName}</Text>
        <Text numberOfLines={fontScale > 1.3 ? undefined : 1} style={[styles.instrumentSymbol, compact && styles.instrumentSymbolCompact, { color: instrument.availability === 'paused' ? theme.caution : theme.muted }]}>
          {instrument.availability === 'paused' ? 'Paused · ' : ''}{instrument.symbol} · {instrument.provider}
        </Text>
      </View>
      <View style={[styles.instrumentMarket, compact && styles.instrumentMarketCompact, fontScale > 1.3 && styles.instrumentMarketLargeText]}>
        <Text style={[styles.marketValue, compact && styles.marketValueCompact, { color: theme.ink }]}>{formatMoney(instrument.marketValue.amount)}</Text>
        {instrument.productType === 'spot' && movement !== null ? (
          <Text style={[styles.marketSecondaryStrong, { color: movement >= 0 ? theme.gain : theme.caution }]}>
            {formatPercent(movement)}
          </Text>
        ) : null}
        {instrument.productType === 'perpetual' && instrument.fundingRatePercent.value !== null ? (
          <Text style={[styles.marketSecondaryStrong, { color: theme.muted }]}>Funding {formatPercent(instrument.fundingRatePercent.value)}</Text>
        ) : null}
        {instrument.productType === 'prestock' ? (
          <>
            <Text style={[styles.marketSecondary, { color: theme.muted }]}>{instrument.marketValue.label}</Text>
            <Text numberOfLines={1} style={[styles.marketSecondary, { color: theme.muted }]}>
              {instrument.exposureType === 'spv_exposure' ? 'SPV exposure' : 'Loan participation'}
            </Text>
          </>
        ) : null}
      </View>
      <Text style={[styles.rowChevron, { color: theme.outline }]}>›</Text>
    </Pressable>
  );
}

function LoadingRows() {
  const theme = useMarketsTheme();
  return (
    <View accessibilityLabel="Loading market instruments">
      {[0, 1, 2, 3].map((item) => (
        <View key={item} style={[styles.instrumentRow, { borderBottomColor: theme.outline }]}>
          <View style={[styles.skeletonLogo, { backgroundColor: theme.disabledSurface }]} />
          <View style={styles.skeletonCopy}>
            <View style={[styles.skeletonLineWide, { backgroundColor: theme.disabledSurface }]} />
            <View style={[styles.skeletonLineShort, { backgroundColor: theme.disabledSurface }]} />
          </View>
          <View style={styles.skeletonMarket}>
            <View style={[styles.skeletonValue, { backgroundColor: theme.disabledSurface }]} />
            <View style={[styles.skeletonBadge, { backgroundColor: theme.disabledSurface }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

function RegistryMessage({ action, message, onAction, title }: { action?: string; message: string; onAction?: () => void; title: string }) {
  const theme = useMarketsTheme();
  return (
    <View style={styles.registryMessage}>
      <Text style={[styles.registryMessageTitle, { color: theme.ink }]}>{title}</Text>
      <Text style={[styles.registryMessageBody, { color: theme.muted }]}>{message}</Text>
      {action && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => [styles.retryButton, { borderColor: theme.outline }, pressed && styles.pressed]}>
          <Text style={[styles.retryText, { color: theme.proof }]}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Coverage({ count }: { count: number }) {
  const theme = useMarketsTheme();
  return (
    <View style={[styles.coverage, { borderTopColor: theme.outline }]}>
      <View style={styles.coverageTop}>
        <Text style={[styles.coverageTitle, { color: theme.ink }]}>Registry coverage</Text>
        <Text style={[styles.coverageCount, { color: theme.muted }]}>{count} products · Solana</Text>
      </View>
      <Text style={[styles.coverageBody, { color: theme.muted }]}>
        Warren checks the instrument identity shown here. That does not make an investment safe or endorsed. Displayed values are informational and never reused as executable quotes.
      </Text>
    </View>
  );
}

function CompanyLogo({ companyName, logoUrl, privateStock = false, size }: { companyName: string; logoUrl: string | null; privateStock?: boolean; size: number }) {
  const theme = useMarketsTheme();
  const [failedLogoUrl, setFailedLogoUrl] = useState<string>();
  const failed = Boolean(logoUrl && failedLogoUrl === logoUrl);
  const canRender = Boolean(logoUrl && !logoUrl.toLowerCase().endsWith('.svg') && !failed);
  return (
    <View style={[styles.companyLogo, { backgroundColor: privateStock ? theme.privateWash : theme.proofWash, borderRadius: Math.round(size * 0.3), height: size, width: size }]}>
      {canRender ? (
        <Image onError={() => setFailedLogoUrl(logoUrl ?? undefined)} resizeMode="contain" source={{ uri: logoUrl! }} style={{ height: size, width: size }} />
      ) : (
        <Text style={[styles.companyInitials, { color: privateStock ? theme.privateInk : theme.proof, fontSize: Math.max(9, size * 0.33) }]}>{initials(companyName)}</Text>
      )}
    </View>
  );
}

function MarketIcon({ color, name, size }: { color: string; name: 'search'; size: number }) {
  const strokeWidth = 1.8;
  return (
    <Svg fill="none" height={size} viewBox="0 0 24 24" width={size}>
      {name === 'search' ? (
        <>
          <Circle cx="10.5" cy="10.5" r="6.5" stroke={color} strokeWidth={strokeWidth} />
          <Path d="m15.4 15.4 4.2 4.2" stroke={color} strokeLinecap="round" strokeWidth={strokeWidth} />
        </>
      ) : null}
    </Svg>
  );
}

function defaultSort(product: MarketProduct): MarketSort {
  return product === 'prestock' ? 'alphabetical' : 'activity';
}

function shortProductLabel(product: MarketProduct) {
  if (product === 'prestock') return 'PreStock';
  if (product === 'perpetual') return 'Perp';
  return 'Spot';
}

function fullProductLabel(product: MarketProduct) {
  if (product === 'prestock') return 'PreStock';
  if (product === 'perpetual') return 'Equity perpetual';
  return 'Spot stock';
}

function formatMoney(value: number | null) {
  if (value === null) return '—';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${withThousandsSeparators(Math.round(value).toString())}`;
  return `$${value.toFixed(2)}`;
}

function withThousandsSeparators(value: string) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatPercent(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function initials(companyName: string) {
  const parts = companyName.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : companyName.slice(0, 2)).toUpperCase();
}

function instrumentAccessibilityLabel(instrument: MarketInstrument) {
  const price = instrument.marketValue.amount === null ? 'value not provided' : formatMoney(instrument.marketValue.amount);
  return `${instrument.companyName}, ${fullProductLabel(instrument.productType)}, ${instrument.symbol}, ${price}`;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', minHeight: 52, paddingHorizontal: 18, paddingVertical: 3 },
  brand: { alignItems: 'center', minHeight: 44 },
  screen: { alignSelf: 'center', flex: 1, maxWidth: 680, minHeight: 0, paddingHorizontal: 18, width: '100%' },
  screenCompact: { paddingHorizontal: 14 },
  registryPanel: { flex: 1, minHeight: 0 },
  browseHeader: { alignItems: 'center', flexDirection: 'row', gap: 8, paddingBottom: 8, paddingTop: 12, position: 'relative', zIndex: 25 },
  searchArea: { flex: 1, minWidth: 0 },
  searchBox: { alignItems: 'center', borderRadius: 13, borderWidth: 1, flexDirection: 'row', gap: 9, minHeight: 44, paddingHorizontal: 11 },
  searchInput: { flex: 1, fontFamily: Fonts.sans, fontSize: 14, minHeight: 42, minWidth: 0, paddingVertical: 10, textAlignVertical: 'center' },
  searchInputCompact: { fontSize: 13 },
  clearButton: { alignItems: 'center', height: 44, justifyContent: 'center', marginRight: -11, width: 44 },
  clearText: { fontFamily: Fonts.sans, fontSize: 24, lineHeight: 28 },
  searchResults: { borderRadius: 14, borderWidth: 1, elevation: 10, left: 0, marginTop: -2, maxHeight: 300, padding: 6, position: 'absolute', right: 0, shadowColor: '#000000', shadowOffset: { height: 12, width: 0 }, shadowOpacity: 0.28, shadowRadius: 24, top: '100%', zIndex: 40 },
  searchEmpty: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 20, paddingHorizontal: 12, paddingVertical: 20, textAlign: 'center' },
  searchResult: { alignItems: 'center', borderRadius: 8, flexDirection: 'row', gap: 9, minHeight: 64, paddingHorizontal: 6, paddingVertical: 10 },
  searchResultCopy: { flex: 1, minWidth: 0 },
  searchResultName: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '600' },
  searchResultTicker: { fontFamily: Fonts.sans, fontSize: 10, marginTop: 4 },
  capabilityChips: { alignItems: 'flex-end', gap: 3, maxWidth: 82 },
  capabilityChipText: { fontFamily: Fonts.sans, fontSize: 10, lineHeight: 16 },
  productTabs: { borderBottomWidth: 1, flexDirection: 'row', gap: 4 },
  productTab: { alignItems: 'center', borderBottomWidth: 2, flex: 1, justifyContent: 'center', minHeight: 46, paddingHorizontal: 1, paddingVertical: 10 },
  productTabLabel: { fontFamily: Fonts.sans, fontSize: 12 },
  productTabActive: { fontWeight: '600' },
  indexToggle: { alignItems: 'center', borderRadius: 10, borderWidth: 1, flexDirection: 'row', gap: 10, justifyContent: 'center', minHeight: 44, paddingHorizontal: 10, paddingVertical: 8, minWidth: 68 },
  indexToggleLabel: { fontFamily: Fonts.sans, fontSize: 12 },
  indexChevron: { fontFamily: Fonts.sans, fontSize: 16 },
  letterPicker: { borderRadius: 14, borderWidth: 1, elevation: 10, left: 0, marginTop: -2, maxHeight: 340, paddingBottom: 14, paddingHorizontal: 12, paddingTop: 8, position: 'absolute', right: 0, shadowColor: '#000000', shadowOffset: { height: 12, width: 0 }, shadowOpacity: 0.28, shadowRadius: 24, top: '100%', zIndex: 40 },
  pickerHeading: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'space-between', marginBottom: 8 },
  indexReset: { flexShrink: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 6 },
  indexResetLabel: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '500' },
  pickerClose: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  pickerCloseLabel: { fontFamily: Fonts.sans, fontSize: 22 },
  letterGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  letterCell: { padding: 2, width: '16.666666%' },
  letterButton: { alignItems: 'center', borderRadius: 8, borderWidth: 1, justifyContent: 'center', minHeight: 44 },
  letterButtonLabel: { fontFamily: Fonts.mono, fontSize: 14, fontWeight: '500' },
  letterDisabled: { opacity: 0.25 },
  pickerNote: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 16, marginTop: 10 },
  columnLabels: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', minHeight: 27, paddingBottom: 8, paddingHorizontal: 10, paddingTop: 6 },
  columnLabel: { fontFamily: Fonts.sans, fontSize: 9, letterSpacing: 0.2 },
  listArea: { flex: 1, minHeight: 0, position: 'relative' },
  listContent: { paddingBottom: 68 },
  letterHeading: { borderBottomWidth: 1, fontFamily: Fonts.mono, fontSize: 10, fontWeight: '500', lineHeight: 13, paddingBottom: 6, paddingHorizontal: 10, paddingTop: 7 },
  backToTop: { alignItems: 'center', borderRadius: 999, borderWidth: 1, bottom: 12, elevation: 5, justifyContent: 'center', minHeight: 44, minWidth: 68, paddingHorizontal: 13, position: 'absolute', right: 0, shadowColor: '#000000', shadowOffset: { height: 4, width: 0 }, shadowOpacity: 0.25, shadowRadius: 16 },
  backToTopText: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '500' },
  warningBar: { borderRadius: 10, marginBottom: 8, paddingHorizontal: 10, paddingVertical: 8 },
  warningText: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 16 },
  instrumentList: { flex: 1 },
  lendingList: { paddingBottom: 26, paddingTop: 8 },
  lendingFlow: { alignItems: 'stretch', flexDirection: 'row', marginBottom: 12 },
  lendingFlowCard: { borderRadius: 14, borderWidth: 1, flex: 1, gap: 4, justifyContent: 'center', minHeight: 84, paddingHorizontal: 11, paddingVertical: 13 },
  lendingFlowTitle: { fontFamily: Fonts.sans, fontSize: 14, fontWeight: '500', lineHeight: 18 },
  lendingFlowCopy: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 16 },
  lendingFlowArrow: { alignSelf: 'center', fontFamily: Fonts.sans, fontSize: 18, textAlign: 'center', width: 24 },
  lendingCopy: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 17, marginBottom: 20 },
  lendingCards: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  lendingRow: { paddingHorizontal: 16, paddingVertical: 19 },
  lendingIdentity: { minWidth: 0 },
  lendingSymbol: { fontFamily: Fonts.sans, fontSize: 18, fontWeight: '500', letterSpacing: -0.36, lineHeight: 24 },
  lendingName: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18, marginTop: 3 },
  lendingMint: { fontFamily: Fonts.mono, fontSize: 9, marginTop: 8 },
  lendingTerms: { flexDirection: 'row', gap: 8, marginTop: 18 },
  lendingRate: { flex: 1, minWidth: 0 },
  lendingBorrowRate: { borderLeftWidth: 1, paddingLeft: 10 },
  lendingRateLabel: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 17 },
  lendingRateValue: { fontFamily: Fonts.mono, fontSize: 22, fontWeight: '500', letterSpacing: -0.9, marginTop: 5 },
  lendingStatusRow: { alignItems: 'center', flexDirection: 'row', gap: 5, marginTop: 14 },
  lendingStatusDot: { borderRadius: 3, height: 6, width: 6 },
  lendingStatus: { flexShrink: 1, fontFamily: Fonts.sans, fontSize: 11, lineHeight: 17 },
  lendingNotice: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 18, paddingTop: 14 },
  instrumentRow: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', gap: 9, minHeight: 64, paddingBottom: 10, paddingLeft: 8, paddingRight: 5, paddingTop: 10 },
  instrumentRowCompact: { gap: 7, paddingLeft: 5 },
  instrumentRowLargeText: { flexWrap: 'wrap' },
  companyLogo: { alignItems: 'center', flexShrink: 0, justifyContent: 'center', overflow: 'hidden' },
  companyInitials: { fontFamily: Fonts.sans, fontWeight: '600', letterSpacing: -0.3 },
  instrumentIdentity: { flex: 1, minWidth: 0 },
  companyName: { fontFamily: Fonts.sans, fontSize: 14, fontWeight: '500', lineHeight: 19 },
  companyNameCompact: { fontSize: 13, lineHeight: 18 },
  instrumentSymbol: { fontFamily: Fonts.sans, fontSize: 10, lineHeight: 14, marginTop: 4 },
  instrumentSymbolCompact: { fontSize: 9 },
  instrumentMarket: { alignItems: 'flex-end', width: 99 },
  instrumentMarketCompact: { width: 81 },
  instrumentMarketLargeText: { width: '100%' },
  marketValue: { fontFamily: Fonts.mono, fontSize: 14, fontWeight: '500', letterSpacing: -0.55, lineHeight: 19 },
  marketValueCompact: { fontSize: 13, lineHeight: 18 },
  marketSecondaryStrong: { fontFamily: Fonts.mono, fontSize: 10, lineHeight: 14, marginTop: 4, textAlign: 'right' },
  marketSecondary: { fontFamily: Fonts.sans, fontSize: 10, lineHeight: 14, marginTop: 4, textAlign: 'right' },
  rowChevron: { fontFamily: Fonts.sans, fontSize: 18, width: 8 },
  emptyListContent: { flexGrow: 1 },
  registryMessage: { alignItems: 'center', justifyContent: 'center', minHeight: 220, paddingHorizontal: 24, paddingVertical: 34 },
  registryMessageTitle: { fontFamily: Fonts.sans, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  registryMessageBody: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 20, marginTop: 7, textAlign: 'center' },
  retryButton: { alignItems: 'center', borderRadius: 10, borderWidth: 1, justifyContent: 'center', marginTop: 14, minHeight: 44, paddingHorizontal: 16 },
  retryText: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '600' },
  skeletonLogo: { borderRadius: 9, height: 30, width: 30 },
  skeletonCopy: { flex: 1, gap: 8 },
  skeletonLineWide: { borderRadius: 4, height: 14, width: '58%' },
  skeletonLineShort: { borderRadius: 4, height: 10, width: '40%' },
  skeletonMarket: { alignItems: 'flex-end', gap: 7, width: 90 },
  skeletonValue: { borderRadius: 4, height: 14, width: 58 },
  skeletonBadge: { borderRadius: 4, height: 10, width: 48 },
  loadMore: { alignItems: 'center', borderRadius: 10, borderWidth: 1, flexDirection: 'row', gap: 8, justifyContent: 'center', marginHorizontal: 4, marginTop: 16, minHeight: 44 },
  loadMoreText: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '500' },
  coverage: { marginTop: 20, paddingBottom: 24, paddingHorizontal: 4 },
  coverageTop: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  coverageTitle: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '500' },
  coverageCount: { fontFamily: Fonts.mono, fontSize: 10 },
  coverageBody: { fontFamily: Fonts.sans, fontSize: 10, lineHeight: 16, marginTop: 8 },
  pressed: { opacity: 0.72 },
});
