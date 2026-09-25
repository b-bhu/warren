import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, type Href } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { loadMarkets, searchMarkets } from './markets-api';
import { loadLendingCatalog } from './lending-api';

const productOrder: readonly MarketProduct[] = ['spot', 'prestock', 'perpetual'];
type MarketSection = MarketProduct | 'lending';
const emptyCounts: MarketCounts = { spot: 0, prestock: 0, perpetual: 0 };

const productLabels: Record<MarketProduct, string> = {
  spot: 'Spot',
  prestock: 'PreStocks',
  perpetual: 'Perpetuals',
};

export function MarketHomeScreen() {
  const router = useRouter();
  const theme = useTheme();
  const listRef = useRef<FlatList<MarketInstrument>>(null);
  const searchBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  }, []);

  const totalProducts = counts.spot + counts.prestock + counts.perpetual;
  const searchOpen = searchFocused && query.trim().length > 0;

  const chooseProduct = useCallback((next: MarketProduct) => {
    setSection(next);
    setProduct(next);
    setIsLoading(true);
    setIsLoadingMore(false);
    setError(undefined);
    setItems([]);
    setNextCursor(undefined);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
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
      <MarketHeader onBrandPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })} />

      <View style={styles.screen}>
        <View style={styles.intro}>
          <Text accessibilityRole="header" style={[styles.screenTitle, { color: theme.ink }]}>Markets</Text>
          <View style={styles.readOnlyState}>
            <View style={styles.readOnlyLine}>
              <View style={[styles.stateDot, { backgroundColor: theme.muted }]} />
              <Text style={[styles.stateTitle, { color: theme.ink }]}>Read-only</Text>
            </View>
            <Text style={[styles.stateMeta, { color: theme.muted }]}>
              {totalProducts ? `${totalProducts} registry products` : 'Loading registry'}
            </Text>
          </View>
        </View>

        <View
          accessibilityLabel="Verified market instruments"
          style={[styles.registryPanel, { backgroundColor: theme.surface, borderColor: theme.outline }]}>
          <View style={styles.searchArea}>
            <View style={[styles.searchBox, { backgroundColor: theme.canvas, borderColor: searchFocused ? theme.proof : theme.outline }]}>
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
                  if (searchBlurTimer.current) clearTimeout(searchBlurTimer.current);
                  setSearchFocused(true);
                }}
                placeholder="Search company, ticker, or instrument"
                placeholderTextColor={theme.muted}
                returnKeyType="search"
                style={[styles.searchInput, { color: theme.ink }]}
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

            {searchOpen ? (
              <View
                accessibilityLiveRegion="polite"
                style={[styles.searchResults, { backgroundColor: theme.surface, borderColor: theme.outline }]}>
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
          </View>

          <ScrollView
            accessibilityRole="tablist"
            contentContainerStyle={styles.productTabsContent}
            horizontal
            keyboardShouldPersistTaps="handled"
            showsHorizontalScrollIndicator={false}
            style={styles.productTabs}>
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
              onPress={() => setSection('lending')}
            />
          </ScrollView>

          {warning ? (
            <View style={[styles.warningBar, { backgroundColor: theme.cautionWash }]}>
              <Text style={[styles.warningText, { color: theme.caution }]}>{warning}</Text>
            </View>
          ) : null}

          {section === 'lending' ? (
            <LendingList
              catalog={lendingCatalog}
              error={lendingError}
              onRefresh={pullToRefresh}
              onOpen={(assetId) => router.push({ pathname: '/lending/[assetId]', params: { assetId } } as Href)}
              onRetry={() => setLendingRequestVersion((version) => version + 1)}
              refreshing={refreshingSection === 'lending'}
            />
          ) : <FlatList
            contentContainerStyle={!items.length ? styles.emptyListContent : undefined}
            data={items}
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
            showsVerticalScrollIndicator={false}
            style={[styles.instrumentList, { borderTopColor: theme.outline }]}
          />}
        </View>
      </View>

    </SafeAreaView>
  );
}

function LendingList({ catalog, error, onRefresh, onRetry, onOpen, refreshing }: { catalog?: LendingCatalogResponse; error?: string; onRefresh: () => void; onRetry: () => void; onOpen: (assetId: string) => void; refreshing: boolean }) {
  const theme = useTheme();
  if (error) return <RegistryMessage action="Try again" message={error} onAction={onRetry} title="Lending markets need a refresh" />;
  if (!catalog) return <LoadingRows />;
  return (
    <ScrollView
      contentContainerStyle={styles.lendingList}
      refreshControl={<RefreshControl colors={[theme.proof]} onRefresh={onRefresh} refreshing={refreshing} tintColor={theme.proof} />}
      showsVerticalScrollIndicator={false}>
      <View style={[styles.lendingIntro, { borderBottomColor: theme.outline }]}>
        <Text style={[styles.lendingHeading, { color: theme.ink }]}>Supply xStocks, borrow USDC</Text>
        <Text style={[styles.lendingCopy, { color: theme.muted }]}>Kamino · Solana mainnet · Terms refresh from the market. Borrowing the stock token is not supported.</Text>
      </View>
      {catalog.assets.map((asset) => <LendingRow key={asset.assetId} asset={asset} onPress={() => onOpen(asset.assetId)} />)}
      <Text style={[styles.lendingNotice, { color: theme.muted }]}>Market terms can change. Each action is refreshed, simulated and shown for wallet review before signing. New borrowing remains subject to Warren’s risk controls.</Text>
    </ScrollView>
  );
}

function LendingRow({ asset, onPress }: { asset: LendingAsset; onPress: () => void }) {
  const theme = useTheme();
  const status = asset.routeAvailable ? 'USDC route active' : asset.marketStatus ?? 'No active route';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${asset.symbol}, lending details`} onPress={onPress} style={[styles.lendingRow, { borderBottomColor: theme.outline }]}>
      <View style={styles.lendingIdentity}>
        <Text style={[styles.lendingSymbol, { color: theme.ink }]}>{asset.symbol}</Text>
        <Text numberOfLines={1} style={[styles.lendingName, { color: theme.muted }]}>{asset.name} · xStock collateral</Text>
        <Text selectable numberOfLines={1} style={[styles.lendingMint, { color: theme.muted }]}>Mint {asset.mintAddress}</Text>
      </View>
      <View style={styles.lendingTerms}>
        <Text style={[styles.lendingTerm, { color: theme.ink }]}>{percent(asset.borrowApy)} USDC borrow</Text>
        <Text style={[styles.lendingTermSmall, { color: theme.muted }]}>{percent(asset.supplyApy)} supply APY</Text>
        <Text style={[styles.lendingStatus, { color: asset.routeAvailable ? theme.proof : theme.caution }]}>{status}</Text>
        <Text style={[styles.lendingTermSmall, { color: theme.muted }]}>{asset.actionsPaused ? 'Actions paused' : 'See current terms'}</Text>
      </View>
    </Pressable>
  );
}

function percent(value: string | null): string { return value === null ? '—' : `${(Number(value) * 100).toFixed(2)}%`; }

function MarketHeader({ onBrandPress }: { onBrandPress: () => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.header, { borderBottomColor: theme.outline }]}>
      <Pressable
        accessibilityLabel="Warren markets"
        accessibilityHint="Scrolls Markets to the top"
        accessibilityRole="button"
        onPress={onBrandPress}
        style={({ pressed }) => [styles.brand, pressed && styles.pressed]}>
        <BrandLogo decorative />
      </Pressable>
      <AppAccountButton />
    </View>
  );
}

function ProductTab({ active, count, label, onPress }: { active: boolean; count: number; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.productTab,
        { backgroundColor: active ? theme.proofWash : 'transparent', borderColor: active ? theme.proof : theme.outline },
        pressed && styles.pressed,
      ]}>
      <Text style={[styles.productTabLabel, { color: active ? theme.proof : theme.muted }]}>{label}</Text>
      <Text style={[styles.productTabCount, { color: active ? theme.proof : theme.muted }]}>{count}</Text>
    </Pressable>
  );
}

function SearchResult({ company, onPress }: { company: MarketCompanySummary; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityLabel={`Open markets for ${company.companyName}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.searchResult, pressed && { backgroundColor: theme.proofWash }]}>
      <CompanyLogo companyName={company.companyName} logoUrl={company.logoUrl} size={36} />
      <View style={styles.searchResultCopy}>
        <Text numberOfLines={1} style={[styles.searchResultName, { color: theme.ink }]}>{company.companyName}</Text>
        <Text style={[styles.searchResultTicker, { color: theme.muted }]}>{company.ticker ?? 'Private company exposure'}</Text>
      </View>
      <View style={styles.capabilityChips}>
        {company.capabilities.map((capability) => (
          <View key={capability.productType} style={[styles.capabilityChip, { backgroundColor: theme.proofWash }]}>
            <Text style={[styles.capabilityChipText, { color: capability.availability === 'available' ? theme.proof : theme.muted }]}>
              {shortProductLabel(capability.productType)}
            </Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

function InstrumentRow({ instrument, onPress }: { instrument: MarketInstrument; onPress: () => void }) {
  const theme = useTheme();
  const movement = instrument.productType === 'spot' ? instrument.changePercent.value : null;
  return (
    <Pressable
      accessibilityHint="Opens every Warren market known for this company"
      accessibilityLabel={instrumentAccessibilityLabel(instrument)}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.instrumentRow,
        { borderBottomColor: theme.outline, backgroundColor: pressed ? theme.proofWash : 'transparent' },
      ]}>
      <CompanyLogo companyName={instrument.companyName} logoUrl={instrument.logoUrl} size={40} />
      <View style={styles.instrumentIdentity}>
        <View style={styles.companyLine}>
          <Text numberOfLines={1} style={[styles.companyName, { color: theme.ink }]}>{instrument.companyName}</Text>
          <Text style={[styles.companyTicker, { color: theme.muted }]}>{instrument.ticker ?? 'PRIVATE'}</Text>
        </View>
        <View style={styles.instrumentLine}>
          <Text style={[styles.instrumentSymbol, { color: theme.ink }]}>{instrument.symbol}</Text>
          <Text style={[styles.instrumentProvider, { color: theme.muted }]}>· {instrument.provider}</Text>
        </View>
      </View>
      <View style={styles.instrumentMarket}>
        <Text style={[styles.marketValue, { color: theme.ink }]}>{formatMoney(instrument.marketValue.amount)}</Text>
        {instrument.productType === 'spot' && movement !== null ? (
          <Text style={[styles.marketSecondaryStrong, { color: movement >= 0 ? theme.proof : theme.caution }]}>
            {formatPercent(movement)} · 1D
          </Text>
        ) : null}
        {instrument.productType === 'perpetual' && instrument.fundingRatePercent.value !== null ? (
          <Text style={[styles.marketSecondaryStrong, { color: theme.muted }]}>Funding {formatPercent(instrument.fundingRatePercent.value)}</Text>
        ) : null}
        {instrument.productType === 'prestock' ? (
          <Text numberOfLines={1} style={[styles.marketSecondary, { color: theme.muted }]}>
            {instrument.exposureType === 'spv_exposure' ? 'SPV exposure' : 'Loan participation'}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function LoadingRows() {
  const theme = useTheme();
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
  const theme = useTheme();
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
  const theme = useTheme();
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

function CompanyLogo({ companyName, logoUrl, size }: { companyName: string; logoUrl: string | null; size: number }) {
  const theme = useTheme();
  const [failedLogoUrl, setFailedLogoUrl] = useState<string>();
  const failed = Boolean(logoUrl && failedLogoUrl === logoUrl);
  const canRender = Boolean(logoUrl && !logoUrl.toLowerCase().endsWith('.svg') && !failed);
  return (
    <View style={[styles.companyLogo, { backgroundColor: theme.proofWash, borderRadius: Math.round(size * 0.25), height: size, width: size }]}>
      {canRender ? (
        <Image onError={() => setFailedLogoUrl(logoUrl ?? undefined)} resizeMode="contain" source={{ uri: logoUrl! }} style={{ height: size, width: size }} />
      ) : (
        <Text style={[styles.companyInitials, { color: theme.proof, fontSize: Math.max(9, size * 0.24) }]}>{initials(companyName)}</Text>
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
  guestPill: { alignItems: 'center', borderRadius: Radii.pill, borderWidth: 1, flexDirection: 'row', gap: 8, minHeight: 36, paddingHorizontal: 12 },
  guestDot: { borderRadius: 4, height: 7, width: 7 },
  guestText: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '700' },
  screen: { flex: 1, paddingBottom: Spacing.two, paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
  intro: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 13, paddingHorizontal: 2 },
  screenTitle: { fontFamily: Fonts.serif, fontSize: 28, fontWeight: '700', letterSpacing: -0.8, lineHeight: 31 },
  readOnlyState: { alignItems: 'flex-end' },
  readOnlyLine: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  stateDot: { borderRadius: 3, height: 6, width: 6 },
  stateTitle: { fontFamily: Fonts.mono, fontSize: 9, fontWeight: '600' },
  stateMeta: { fontFamily: Fonts.mono, fontSize: 8, marginTop: 3 },
  registryPanel: { borderRadius: Radii.card, borderWidth: 1, flex: 1, minHeight: 0 },
  searchArea: { padding: 8, position: 'relative', width: '100%', zIndex: 12 },
  searchBox: { alignItems: 'center', borderRadius: Radii.control, borderWidth: 1, flexDirection: 'row', gap: 5, height: 52, paddingHorizontal: 9, width: '100%' },
  searchInput: { alignSelf: 'stretch', flex: 1, fontFamily: Fonts.sans, fontSize: 14, fontWeight: '600', height: '100%', lineHeight: 19, minWidth: 0, paddingVertical: 0, textAlignVertical: 'center' },
  clearButton: { alignItems: 'center', borderRadius: 9, height: 32, justifyContent: 'center', width: 32 },
  clearText: { fontFamily: Fonts.sans, fontSize: 20, lineHeight: 22 },
  searchResults: { borderRadius: Radii.card, borderWidth: 1, elevation: 10, left: 8, maxHeight: 280, padding: 5, position: 'absolute', right: 8, shadowColor: '#000000', shadowOffset: { height: 12, width: 0 }, shadowOpacity: 0.28, shadowRadius: 24, top: 64, zIndex: 40 },
  searchEmpty: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 17, paddingHorizontal: 12, paddingVertical: 18, textAlign: 'center' },
  searchResult: { alignItems: 'center', borderRadius: 9, flexDirection: 'row', gap: 10, minHeight: 58, padding: 8 },
  searchResultCopy: { flex: 1, minWidth: 0 },
  searchResultName: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '700' },
  searchResultTicker: { fontFamily: Fonts.sans, fontSize: 8, marginTop: 3 },
  capabilityChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, justifyContent: 'flex-end', maxWidth: 122 },
  capabilityChip: { borderRadius: 5, paddingHorizontal: 5, paddingVertical: 4 },
  capabilityChipText: { fontFamily: Fonts.mono, fontSize: 7, fontWeight: '600' },
  productTabs: { flexGrow: 0 },
  productTabsContent: { gap: 4, paddingBottom: 8, paddingHorizontal: 8 },
  productTab: { alignItems: 'center', borderRadius: Radii.control, borderWidth: 1, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 44, minWidth: 104, paddingHorizontal: 11 },
  productTabLabel: { fontFamily: Fonts.sans, fontSize: 10, fontWeight: '800' },
  productTabCount: { fontFamily: Fonts.mono, fontSize: 8, fontWeight: '600' },
  warningBar: { paddingHorizontal: 10, paddingVertical: 7 },
  warningText: { fontFamily: Fonts.sans, fontSize: 9, lineHeight: 13 },
  instrumentList: { borderTopWidth: StyleSheet.hairlineWidth, flex: 1 },
  lendingList: { paddingHorizontal: 12, paddingBottom: 24 },
  lendingIntro: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 13 },
  lendingHeading: { fontFamily: Fonts.serif, fontSize: 18, fontWeight: '700' },
  lendingCopy: { fontFamily: Fonts.sans, fontSize: 9, lineHeight: 14, marginTop: 5 },
  lendingRow: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 8, minHeight: 88, paddingVertical: 10 },
  lendingIdentity: { flex: 1, minWidth: 0 },
  lendingSymbol: { fontFamily: Fonts.mono, fontSize: 12, fontWeight: '800' },
  lendingName: { fontFamily: Fonts.sans, fontSize: 8, marginTop: 3 },
  lendingMint: { fontFamily: Fonts.mono, fontSize: 6.5, marginTop: 5 },
  lendingTerms: { alignItems: 'flex-end', maxWidth: 148 },
  lendingTerm: { fontFamily: Fonts.mono, fontSize: 8, fontWeight: '700' },
  lendingTermSmall: { fontFamily: Fonts.mono, fontSize: 7, marginTop: 4 },
  lendingStatus: { fontFamily: Fonts.mono, fontSize: 7, fontWeight: '700', marginTop: 5 },
  lendingNotice: { fontFamily: Fonts.sans, fontSize: 8, lineHeight: 13, paddingTop: 13 },
  instrumentRow: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 10, minHeight: 82, padding: 10 },
  companyLogo: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  companyInitials: { fontFamily: Fonts.sans, fontWeight: '800', letterSpacing: -0.3 },
  instrumentIdentity: { flex: 1, minWidth: 0 },
  companyLine: { alignItems: 'center', flexDirection: 'row', gap: 6, minWidth: 0 },
  companyName: { flexShrink: 1, fontFamily: Fonts.sans, fontSize: 12, fontWeight: '700', lineHeight: 16 },
  companyTicker: { fontFamily: Fonts.mono, fontSize: 8 },
  instrumentLine: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 3, marginTop: 6 },
  instrumentSymbol: { fontFamily: Fonts.mono, fontSize: 8, fontWeight: '700' },
  instrumentProvider: { fontFamily: Fonts.sans, fontSize: 8 },
  instrumentMarket: { alignItems: 'flex-end', minWidth: 98 },
  marketValue: { fontFamily: Fonts.mono, fontSize: 11, fontWeight: '700', lineHeight: 14 },
  marketSecondaryStrong: { fontFamily: Fonts.mono, fontSize: 8, fontWeight: '600', marginTop: 3 },
  marketSecondary: { fontFamily: Fonts.mono, fontSize: 7, marginTop: 3 },
  emptyListContent: { flexGrow: 1 },
  registryMessage: { alignItems: 'center', justifyContent: 'center', minHeight: 220, paddingHorizontal: 24, paddingVertical: 34 },
  registryMessageTitle: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '700' },
  registryMessageBody: { fontFamily: Fonts.sans, fontSize: 10, lineHeight: 16, marginTop: 7, textAlign: 'center' },
  retryButton: { alignItems: 'center', borderRadius: Radii.control, borderWidth: 1, justifyContent: 'center', marginTop: 14, minHeight: 44, paddingHorizontal: 16 },
  retryText: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '700' },
  skeletonLogo: { borderRadius: 10, height: 40, width: 40 },
  skeletonCopy: { flex: 1, gap: 8 },
  skeletonLineWide: { borderRadius: 4, height: 10, width: '58%' },
  skeletonLineShort: { borderRadius: 4, height: 7, width: '40%' },
  skeletonMarket: { alignItems: 'flex-end', gap: 7, width: 90 },
  skeletonValue: { borderRadius: 4, height: 9, width: 58 },
  skeletonBadge: { borderRadius: 5, height: 16, width: 48 },
  loadMore: { alignItems: 'center', borderRadius: Radii.control, borderWidth: 1, flexDirection: 'row', gap: 8, justifyContent: 'center', marginHorizontal: 10, marginTop: 10, minHeight: 44 },
  loadMoreText: { fontFamily: Fonts.sans, fontSize: 10, fontWeight: '700' },
  coverage: { borderTopWidth: StyleSheet.hairlineWidth, marginHorizontal: 10, marginTop: 18, paddingBottom: 16, paddingTop: 13 },
  coverageTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  coverageTitle: { fontFamily: Fonts.sans, fontSize: 10, fontWeight: '700' },
  coverageCount: { fontFamily: Fonts.mono, fontSize: 8 },
  coverageBody: { fontFamily: Fonts.sans, fontSize: 8, lineHeight: 13, marginTop: 8 },
  modalLayer: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.62)' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, maxHeight: '82%', minHeight: 310, paddingHorizontal: Spacing.three, paddingTop: 10 },
  sheetHandle: { alignSelf: 'center', borderRadius: 2, height: 4, marginBottom: 12, width: 38 },
  sheetLoading: { alignItems: 'center', gap: 12, justifyContent: 'center', minHeight: 260 },
  sheetLoadingText: { fontFamily: Fonts.sans, fontSize: 12 },
  sheetContent: { paddingBottom: Spacing.four },
  sheetHeader: { alignItems: 'center', flexDirection: 'row', gap: 11 },
  sheetTitleBlock: { flex: 1, minWidth: 0 },
  sheetEyebrow: { fontFamily: Fonts.mono, fontSize: 8, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
  sheetTitle: { fontFamily: Fonts.serif, fontSize: 23, fontWeight: '700', letterSpacing: -0.5, lineHeight: 27, marginTop: 3 },
  sheetClose: { alignItems: 'center', borderRadius: 11, borderWidth: 1, height: 44, justifyContent: 'center', width: 44 },
  sheetCloseText: { fontFamily: Fonts.sans, fontSize: 24, lineHeight: 26 },
  sheetEvidence: { alignItems: 'center', borderRadius: Radii.control, borderWidth: 1, flexDirection: 'row', gap: 8, justifyContent: 'space-between', marginTop: 16, paddingHorizontal: 11, paddingVertical: 10 },
  sheetEvidenceSummary: { flex: 1, fontFamily: Fonts.sans, fontSize: 9 },
  sheetEvidenceState: { fontFamily: Fonts.mono, fontSize: 8, fontWeight: '700', textTransform: 'uppercase' },
  capabilityGroup: { marginTop: 19 },
  capabilityGroupHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, paddingHorizontal: 2 },
  capabilityGroupTitle: { fontFamily: Fonts.sans, fontSize: 12, fontWeight: '700' },
  capabilityGroupMeta: { fontFamily: Fonts.mono, fontSize: 7, fontWeight: '600', textTransform: 'uppercase' },
  capabilityList: { borderRadius: Radii.card, borderWidth: 1, overflow: 'hidden' },
  capabilityRow: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 76, paddingHorizontal: 10, paddingVertical: 9 },
  capabilityIcon: { alignItems: 'center', borderRadius: 9, height: 32, justifyContent: 'center', width: 32 },
  capabilityCopy: { flex: 1, minWidth: 0 },
  capabilityName: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '700' },
  capabilityDescription: { fontFamily: Fonts.sans, fontSize: 8, lineHeight: 12, marginTop: 3 },
  capabilityIdentifier: { fontFamily: Fonts.mono, fontSize: 6.5, lineHeight: 10, marginTop: 4 },
  capabilityState: { alignItems: 'flex-end', maxWidth: 90 },
  capabilityStateText: { fontFamily: Fonts.mono, fontSize: 7, fontWeight: '700', textTransform: 'uppercase' },
  capabilityValueLabel: { fontFamily: Fonts.mono, fontSize: 6.5, marginTop: 5, textTransform: 'uppercase' },
  capabilityPrice: { fontFamily: Fonts.mono, fontSize: 9, fontWeight: '600', marginTop: 4 },
  laterText: { fontFamily: Fonts.mono, fontSize: 8, fontWeight: '700', textTransform: 'uppercase' },
  sheetDisclosure: { fontFamily: Fonts.sans, fontSize: 8, lineHeight: 13, marginHorizontal: 2, marginTop: 17 },
  pressed: { opacity: 0.72 },
});
