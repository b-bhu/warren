import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
  Modal,
  Pressable,
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
  type MarketAvailability,
  type MarketCompanyResponse,
  type MarketCompanySummary,
  type MarketCounts,
  type MarketInstrument,
  type MarketProduct,
  type MarketSort,
} from '@warren/markets-contract';

import { BrandLogo } from '@/components/brand-logo';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { loadMarketCompany, loadMarkets, searchMarkets } from './markets-api';

const productOrder: readonly MarketProduct[] = ['spot', 'prestock', 'perpetual'];
const emptyCounts: MarketCounts = { spot: 0, prestock: 0, perpetual: 0 };

const productLabels: Record<MarketProduct, string> = {
  spot: 'Spot',
  prestock: 'PreStocks',
  perpetual: 'Perpetuals',
};

export function MarketHomeScreen() {
  const theme = useTheme();
  const listRef = useRef<FlatList<MarketInstrument>>(null);
  const searchBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [product, setProduct] = useState<MarketProduct>('spot');
  const [items, setItems] = useState<MarketInstrument[]>([]);
  const [counts, setCounts] = useState<MarketCounts>(emptyCounts);
  const [nextCursor, setNextCursor] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [warning, setWarning] = useState<string>();
  const [requestVersion, setRequestVersion] = useState(0);

  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchResults, setSearchResults] = useState<MarketCompanySummary[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string>();

  const [selectedAssetId, setSelectedAssetId] = useState<string>();
  const [selectedInstrumentId, setSelectedInstrumentId] = useState<string>();
  const [selectedCompany, setSelectedCompany] = useState<MarketCompanyResponse>();
  const [isSheetLoading, setIsSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState<string>();
  const [sheetRequestVersion, setSheetRequestVersion] = useState(0);

  const sort = defaultSort(product);
  const registryKey = `${product}:${sort}`;
  const registryKeyRef = useRef(registryKey);
  registryKeyRef.current = registryKey;

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setIsLoadingMore(false);
    setError(undefined);
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
        setError(reason instanceof Error ? reason.message : 'Markets are temporarily unavailable.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [product, requestVersion, sort]);

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) {
      setSearchResults([]);
      setSearchError(undefined);
      setIsSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setIsSearching(true);
      setSearchError(undefined);
      searchMarkets(normalized, controller.signal)
        .then((response) => setSearchResults(response.items))
        .catch((reason: unknown) => {
          if (reason instanceof Error && reason.name === 'AbortError') return;
          setSearchResults([]);
          setSearchError(reason instanceof Error ? reason.message : 'Search is temporarily unavailable.');
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

  useEffect(() => {
    if (!selectedAssetId) return;
    const controller = new AbortController();
    setIsSheetLoading(true);
    setSheetError(undefined);
    setSelectedCompany(undefined);
    loadMarketCompany(selectedAssetId, controller.signal)
      .then(setSelectedCompany)
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.name === 'AbortError') return;
        setSheetError(reason instanceof Error ? reason.message : 'Company markets are temporarily unavailable.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsSheetLoading(false);
      });
    return () => controller.abort();
  }, [selectedAssetId, sheetRequestVersion]);

  useEffect(() => () => {
    if (searchBlurTimer.current) clearTimeout(searchBlurTimer.current);
  }, []);

  const totalProducts = counts.spot + counts.prestock + counts.perpetual;
  const searchOpen = searchFocused && query.trim().length > 0;

  const chooseProduct = useCallback((next: MarketProduct) => {
    setProduct(next);
    setIsLoadingMore(false);
    setItems([]);
    setNextCursor(undefined);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  const openCompany = useCallback((assetId: string, instrumentId?: string) => {
    Keyboard.dismiss();
    setSearchFocused(false);
    setSelectedInstrumentId(instrumentId);
    setSelectedAssetId(assetId);
  }, []);

  const closeCompany = useCallback(() => {
    setSelectedAssetId(undefined);
    setSelectedInstrumentId(undefined);
    setSelectedCompany(undefined);
    setSheetError(undefined);
  }, []);

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
                onChangeText={setQuery}
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
                    setQuery('');
                    setSearchResults([]);
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
                      <SearchResult key={company.assetId} company={company} onPress={() => openCompany(company.assetId)} />
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
                active={product === item}
                count={counts[item]}
                key={item}
                label={productLabels[item]}
                onPress={() => chooseProduct(item)}
              />
            ))}
          </ScrollView>

          {warning ? (
            <View style={[styles.warningBar, { backgroundColor: theme.cautionWash }]}>
              <Text style={[styles.warningText, { color: theme.caution }]}>{warning}</Text>
            </View>
          ) : null}

          <FlatList
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
                  onAction={() => setRequestVersion((current) => current + 1)}
                  title="Markets unavailable"
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
            renderItem={renderItem}
            showsVerticalScrollIndicator={false}
            style={[styles.instrumentList, { borderTopColor: theme.outline }]}
          />
        </View>
      </View>

      <CompanyMarketsSheet
        company={selectedCompany}
        error={sheetError}
        focusedInstrumentId={selectedInstrumentId}
        isLoading={isSheetLoading}
        onClose={closeCompany}
        onRetry={() => setSheetRequestVersion((current) => current + 1)}
        visible={Boolean(selectedAssetId)}
      />
    </SafeAreaView>
  );
}

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
      <View accessibilityLabel="Browsing as guest" style={[styles.guestPill, { backgroundColor: theme.surface, borderColor: theme.outline }]}>
        <View style={[styles.guestDot, { backgroundColor: theme.proof }]} />
        <Text style={[styles.guestText, { color: theme.muted }]}>Guest</Text>
      </View>
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

function CompanyMarketsSheet({
  company,
  error,
  focusedInstrumentId,
  isLoading,
  onClose,
  onRetry,
  visible,
}: {
  company?: MarketCompanyResponse;
  error?: string;
  focusedInstrumentId?: string;
  isLoading: boolean;
  onClose: () => void;
  onRetry: () => void;
  visible: boolean;
}) {
  const theme = useTheme();
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalLayer}>
        <Pressable accessibilityLabel="Close company markets" accessibilityRole="button" onPress={onClose} style={styles.modalBackdrop} />
        <SafeAreaView edges={['bottom', 'left', 'right']} style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.outline }]}>
          <View style={[styles.sheetHandle, { backgroundColor: theme.outline }]} />
          {isLoading ? (
            <View style={styles.sheetLoading}>
              <ActivityIndicator color={theme.proof} />
              <Text style={[styles.sheetLoadingText, { color: theme.muted }]}>Checking company markets</Text>
            </View>
          ) : error ? (
            <RegistryMessage action="Try again" message={error} onAction={onRetry} title="Company markets unavailable" />
          ) : company ? (
            <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
              <View style={styles.sheetHeader}>
                <CompanyLogo companyName={company.company.companyName} logoUrl={company.company.logoUrl} size={48} />
                <View style={styles.sheetTitleBlock}>
                  <Text style={[styles.sheetEyebrow, { color: theme.proof }]}>Markets for</Text>
                  <Text numberOfLines={1} style={[styles.sheetTitle, { color: theme.ink }]}>{company.company.companyName}</Text>
                </View>
                <Pressable
                  accessibilityLabel="Close company markets"
                  accessibilityRole="button"
                  onPress={onClose}
                  style={({ pressed }) => [styles.sheetClose, { borderColor: theme.outline }, pressed && styles.pressed]}>
                  <Text style={[styles.sheetCloseText, { color: theme.ink }]}>×</Text>
                </Pressable>
              </View>

              <View style={[styles.sheetEvidence, { backgroundColor: theme.canvas, borderColor: theme.outline }]}>
                <Text style={[styles.sheetEvidenceSummary, { color: theme.muted }]}>
                  {company.instruments.length} {company.instruments.length === 1 ? 'market' : 'markets'} · {company.availableNow} available now
                </Text>
                <Text style={[styles.sheetEvidenceState, { color: theme.proof }]}>Registry checked</Text>
              </View>

              <View style={styles.capabilityGroup}>
                <View style={styles.capabilityGroupHeading}>
                  <Text style={[styles.capabilityGroupTitle, { color: theme.ink }]}>Invest</Text>
                  <Text style={[styles.capabilityGroupMeta, { color: theme.muted }]}>Read-only</Text>
                </View>
                <View style={[styles.capabilityList, { borderColor: theme.outline }]}>
                  {company.instruments.map((instrument, index) => (
                    <CapabilityRow
                      focused={instrument.instrumentId === focusedInstrumentId}
                      instrument={instrument}
                      isLast={index === company.instruments.length - 1}
                      key={instrument.instrumentId}
                    />
                  ))}
                </View>
              </View>

              <View style={styles.capabilityGroup}>
                <View style={styles.capabilityGroupHeading}>
                  <Text style={[styles.capabilityGroupTitle, { color: theme.ink }]}>Use holdings</Text>
                  <Text style={[styles.capabilityGroupMeta, { color: theme.muted }]}>Future</Text>
                </View>
                <View style={[styles.capabilityList, { borderColor: theme.outline }]}>
                  <LaterCapability icon="lend" label="Lend" subtitle="Earn against a supported stock position" />
                  <LaterCapability icon="borrow" isLast label="Borrow" subtitle="Use a supported position as collateral" />
                </View>
              </View>

              <Text style={[styles.sheetDisclosure, { color: theme.muted }]}>
                Product availability and market-data freshness are separate. Inspecting a product here does not request a quote, connect a wallet, or place a trade.
              </Text>
            </ScrollView>
          ) : null}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function CapabilityRow({ focused, instrument, isLast }: { focused: boolean; instrument: MarketInstrument; isLast: boolean }) {
  const theme = useTheme();
  return (
    <View style={[
      styles.capabilityRow,
      { backgroundColor: focused ? theme.proofWash : 'transparent', borderBottomColor: theme.outline, borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth },
    ]}>
      <View style={[styles.capabilityIcon, { backgroundColor: theme.proofWash }]}>
        <MarketIcon color={theme.proof} name={instrument.productType} size={17} />
      </View>
      <View style={styles.capabilityCopy}>
        <Text style={[styles.capabilityName, { color: theme.ink }]}>{fullProductLabel(instrument.productType)}</Text>
        <Text numberOfLines={2} style={[styles.capabilityDescription, { color: theme.muted }]}>
          {capabilityDescription(instrument)}
        </Text>
        <Text numberOfLines={1} selectable style={[styles.capabilityIdentifier, { color: theme.muted }]}>
          ID {instrument.exactIdentifier}
        </Text>
      </View>
      <View style={styles.capabilityState}>
        <Text style={[styles.capabilityStateText, { color: instrument.availability === 'available' ? theme.proof : theme.muted }]}>
          {availabilityLabel(instrument.availability)}
        </Text>
        <Text style={[styles.capabilityValueLabel, { color: theme.muted }]}>{instrument.marketValue.label}</Text>
        <Text style={[styles.capabilityPrice, { color: theme.ink }]}>{formatMoney(instrument.marketValue.amount)}</Text>
      </View>
    </View>
  );
}

function LaterCapability({ icon, isLast = false, label, subtitle }: { icon: 'lend' | 'borrow'; isLast?: boolean; label: string; subtitle: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.capabilityRow, { borderBottomColor: theme.outline, borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth }]}>
      <View style={[styles.capabilityIcon, { backgroundColor: theme.disabledSurface }]}>
        <MarketIcon color={theme.muted} name={icon} size={17} />
      </View>
      <View style={styles.capabilityCopy}>
        <Text style={[styles.capabilityName, { color: theme.ink }]}>{label}</Text>
        <Text style={[styles.capabilityDescription, { color: theme.muted }]}>{subtitle}</Text>
      </View>
      <Text style={[styles.laterText, { color: theme.muted }]}>Later</Text>
    </View>
  );
}

function CompanyLogo({ companyName, logoUrl, size }: { companyName: string; logoUrl: string | null; size: number }) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [logoUrl]);
  const canRender = Boolean(logoUrl && !logoUrl.toLowerCase().endsWith('.svg') && !failed);
  return (
    <View style={[styles.companyLogo, { backgroundColor: theme.proofWash, borderRadius: Math.round(size * 0.25), height: size, width: size }]}>
      {canRender ? (
        <Image onError={() => setFailed(true)} resizeMode="contain" source={{ uri: logoUrl! }} style={{ height: size, width: size }} />
      ) : (
        <Text style={[styles.companyInitials, { color: theme.proof, fontSize: Math.max(9, size * 0.24) }]}>{initials(companyName)}</Text>
      )}
    </View>
  );
}

function MarketIcon({ color, name, size }: { color: string; name: MarketProduct | 'search' | 'lend' | 'borrow'; size: number }) {
  const strokeWidth = 1.8;
  return (
    <Svg fill="none" height={size} viewBox="0 0 24 24" width={size}>
      {name === 'search' ? (
        <>
          <Circle cx="10.5" cy="10.5" r="6.5" stroke={color} strokeWidth={strokeWidth} />
          <Path d="m15.4 15.4 4.2 4.2" stroke={color} strokeLinecap="round" strokeWidth={strokeWidth} />
        </>
      ) : null}
      {name === 'spot' ? <Path d="M5 18V9m7 9V5m7 13v-6" stroke={color} strokeLinecap="round" strokeWidth={strokeWidth} /> : null}
      {name === 'prestock' ? (
        <>
          <Path d="M4.5 19.5h15M6.5 19.5v-9h11v9M9 10.5V7l3-2 3 2v3.5" stroke={color} strokeLinejoin="round" strokeWidth={strokeWidth} />
          <Path d="M10 14h4" stroke={color} strokeLinecap="round" strokeWidth={strokeWidth} />
        </>
      ) : null}
      {name === 'perpetual' ? (
        <>
          <Path d="M4 7h11a4 4 0 0 1 4 4v1" stroke={color} strokeLinecap="round" strokeWidth={strokeWidth} />
          <Path d="m16 9 3 3 3-3M20 17H9a4 4 0 0 1-4-4v-1M8 15l-3-3-3 3" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} />
        </>
      ) : null}
      {name === 'lend' ? <Path d="M4 7h16M6 7l2-3m10 3-2-3M7 11h10v9H7z" stroke={color} strokeLinejoin="round" strokeWidth={strokeWidth} /> : null}
      {name === 'borrow' ? <Path d="M4 17h16M6 17l2 3m10-3-2 3M7 4h10v9H7z" stroke={color} strokeLinejoin="round" strokeWidth={strokeWidth} /> : null}
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

function capabilityDescription(instrument: MarketInstrument) {
  if (instrument.productType === 'spot') {
    const tier = instrument.stockVariantTier === 'share_redeemable'
      ? 'share redeemable'
      : instrument.stockVariantTier === 'cash_redeemable'
        ? 'cash redeemable'
        : instrument.stockVariantTier === 'not_redeemable'
          ? 'not redeemable'
          : 'redemption unknown';
    return `${instrument.symbol} · ${instrument.issuer} · ${tier}`;
  }
  if (instrument.productType === 'prestock') {
    const fee = instrument.transferFeeBps === null ? '' : ` · ${instrument.transferFeeBps / 100}% transfer fee`;
    return `${instrument.symbol} · ${instrument.provider} · ${instrument.structureLabel}${fee}`;
  }
  return `${instrument.symbol} · Phoenix · ${instrument.marginMode} margin · up to ${instrument.maxLeverage}×`;
}

function availabilityLabel(availability: MarketAvailability) {
  if (availability === 'available') return 'Available';
  if (availability === 'preview') return 'Preview';
  if (availability === 'paused') return 'Paused';
  return 'Unavailable';
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
  const price = instrument.marketValue.amount === null ? 'value unavailable' : formatMoney(instrument.marketValue.amount);
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
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.62)' },
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
