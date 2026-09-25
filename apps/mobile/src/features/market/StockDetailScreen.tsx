import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { openBrowserAsync } from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Line, Path, Stop } from 'react-native-svg';
import type {
  MarketCompanyNewsItem,
  MarketCompanyResponse,
  MarketHistoryRange,
  MarketHistoryResponse,
  MarketInstrument,
  MarketProduct,
} from '@warren/markets-contract';

import { NewsArticleSheet } from '@/components/NewsArticleSheet';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { loadMarketCompany, loadMarketCompanyNews, loadMarketHistory } from './markets-api';
import { useSavedCompanies } from './saved-companies';

type DetailsTab = 'overview' | 'market-data' | 'news';
type DetailIconName = 'back' | 'bookmark' | 'copy' | 'share';

const tabLabels: Record<DetailsTab, string> = {
  overview: 'Overview',
  'market-data': 'Market data',
  news: 'News',
};

const productLabels: Record<MarketProduct, string> = {
  spot: 'Spot stock',
  prestock: 'PreStock',
  perpetual: 'Equity perpetual',
};

const productNames: Record<MarketProduct, string> = { spot: 'Spot', prestock: 'PreStocks', perpetual: 'Perpetuals' };

function useDetailTheme() {
  const theme = useTheme();
  return { ...theme, line: `${theme.muted}33`, gain: theme.canvas === '#131918' ? '#8BC4A1' : '#286440' };
}

export function StockDetailScreen() {
  const params = useLocalSearchParams<{
    assetId?: string | string[];
    instrumentId?: string | string[];
    product?: string | string[];
    source?: string | string[];
  }>();
  const router = useRouter();
  const theme = useDetailTheme();
  const { width } = useWindowDimensions();
  const assetId = firstParam(params.assetId);
  const entryInstrumentId = firstParam(params.instrumentId);
  const entryProduct = parseProduct(firstParam(params.product));
  const routeContext = `${assetId}:${entryProduct}:${entryInstrumentId}`;
  const previousRouteContext = useRef(routeContext);

  const [company, setCompany] = useState<MarketCompanyResponse>();
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [requestVersion, setRequestVersion] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailsTab>('overview');
  const [selectedInstrumentId, setSelectedInstrumentId] = useState<string>();
  const [marketPickerOpen, setMarketPickerOpen] = useState(false);

  const [range, setRange] = useState<MarketHistoryRange>();
  const [history, setHistory] = useState<MarketHistoryResponse>();
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  const [historyCanRetry, setHistoryCanRetry] = useState(false);
  const [historyRequestVersion, setHistoryRequestVersion] = useState(0);

  const [news, setNews] = useState<MarketCompanyNewsItem[]>([]);
  const [isNewsLoading, setIsNewsLoading] = useState(true);
  const [newsError, setNewsError] = useState<string>();
  const [newsCanRetry, setNewsCanRetry] = useState(false);
  const [newsRequestVersion, setNewsRequestVersion] = useState(0);
  const [selectedArticle, setSelectedArticle] = useState<MarketCompanyNewsItem>();

  const { error: savedRepositoryError, hydrated: savesHydrated, isSaved, setSaved } = useSavedCompanies();
  const saved = assetId ? isSaved(assetId) : false;
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();

  const selectedInstrument = company?.instruments.find((instrument) => instrument.instrumentId === selectedInstrumentId)
    ?? company?.instruments.find((instrument) => instrument.instrumentId === company.primaryInstrumentId)
    ?? company?.instruments[0];
  // Only use an advertised history capability for its exact instrument/value.
  const historyCapability = useMemo(() => company?.history?.instrumentId === selectedInstrument?.instrumentId
    ? company?.history ?? null : null, [company?.history, selectedInstrument?.instrumentId]);

  useEffect(() => {
    if (!assetId) return;
    const contextChanged = previousRouteContext.current !== routeContext;
    const controller = new AbortController();
    void loadMarketCompany(assetId, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        previousRouteContext.current = routeContext;
        setLoadError(undefined);
        setCompany(response);
        setRange(response.history?.defaultRange);
        setIsHistoryLoading(Boolean(response.history));
        setIsNewsLoading(true);
        setNewsError(undefined);
        setNewsCanRetry(false);
        const contextual = response.instruments.find((instrument) => instrument.instrumentId === entryInstrumentId)
          ?? response.instruments.find((instrument) => instrument.productType === entryProduct)
          ?? response.instruments.find((instrument) => instrument.instrumentId === response.primaryInstrumentId);
        setSelectedInstrumentId((current) => !contextChanged && response.instruments.some((instrument) => instrument.instrumentId === current)
          ? current : contextual?.instrumentId);
      })
      .catch((error: unknown) => {
        if (isAbort(error)) return;
        setLoadError(error instanceof Error ? error.message : 'Warren could not load company details.');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      });
    return () => controller.abort();
  }, [assetId, entryInstrumentId, entryProduct, requestVersion, routeContext]);

  useEffect(() => {
    if (!assetId || !company) return;
    const controller = new AbortController();
    void loadMarketCompanyNews(assetId, controller.signal)
      .then((response) => {
        const warning = response.warnings.find((candidate) => candidate.section === 'news');
        setNews(response.items);
        setNewsError(warning?.message);
        setNewsCanRetry(Boolean(warning?.retryable));
      })
      .catch((error: unknown) => {
        if (!isAbort(error)) {
          setNewsError(error instanceof Error ? error.message : 'Warren could not refresh company news.');
          setNewsCanRetry(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsNewsLoading(false);
      });
    return () => controller.abort();
  }, [assetId, company, newsRequestVersion]);

  useEffect(() => {
    const capability = historyCapability;
    if (!assetId || !capability || !range) return;
    const controller = new AbortController();
    void loadMarketHistory({ assetId, instrumentId: capability.instrumentId, range }, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setHistory(response);
        const warning = response.warnings.find((candidate) => candidate.section === 'history');
        setHistoryError(warning?.message);
        setHistoryCanRetry(Boolean(warning?.retryable));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && !isAbort(error)) {
          setHistoryError(error instanceof Error ? error.message : 'Warren could not refresh price history.');
          setHistoryCanRetry(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsHistoryLoading(false);
      });
    return () => controller.abort();
  }, [assetId, historyCapability, historyRequestVersion, range]);

  const selectInstrument = (instrumentId: string) => {
    if (instrumentId !== selectedInstrumentId) {
      setHistory(undefined);
      setHistoryError(undefined);
      setHistoryCanRetry(false);
      setIsHistoryLoading(company?.history?.instrumentId === instrumentId);
      setSelectedInstrumentId(instrumentId);
    }
    setMarketPickerOpen(false);
  };

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/markets' as Href);
  }, [router]);

  const retryCompany = () => {
    setIsLoading(true);
    setLoadError(undefined);
    setCompany(undefined);
    setHistory(undefined);
    setNews([]);
    setIsNewsLoading(true);
    setNewsCanRetry(false);
    setRequestVersion((value) => value + 1);
  };

  const refreshCompany = () => {
    setIsRefreshing(true);
    setLoadError(undefined);
    setRequestVersion((value) => value + 1);
  };

  const selectRange = (nextRange: MarketHistoryRange) => {
    if (nextRange === range) return;
    setIsHistoryLoading(true);
    setHistoryError(undefined);
    setHistoryCanRetry(false);
    setRange(nextRange);
  };

  const retryHistory = () => {
    setIsHistoryLoading(true);
    setHistoryError(undefined);
    setHistoryCanRetry(false);
    setHistoryRequestVersion((value) => value + 1);
  };

  const retryNews = () => {
    setIsNewsLoading(true);
    setNewsError(undefined);
    setNewsCanRetry(false);
    setNewsRequestVersion((value) => value + 1);
  };

  const toggleSave = useCallback(async () => {
    if (!assetId || isSaving) return;
    setIsSaving(true);
    setSaveError(undefined);
    try {
      await setSaved(assetId, !saved);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'The saved-company change was not stored.');
    } finally {
      setIsSaving(false);
    }
  }, [assetId, isSaving, saved, setSaved]);

  const shareCompany = useCallback(async () => {
    if (!company) return;
    await Share.share({
      message: `${company.company.companyName} on Warren\nwarren://stocks/${company.company.assetId}`,
      title: company.company.companyName,
    });
  }, [company]);

  if (!assetId) return <DetailFailure message="This company link is incomplete." onBack={goBack} onRetry={goBack} />;
  if (isLoading) return <DetailLoading onBack={goBack} />;
  if (!company) return <DetailFailure message={loadError ?? 'Company not found.'} onBack={goBack} onRetry={retryCompany} />;

  const action = primaryAction(selectedInstrument);
  const contextLabel = company.company.ticker ?? 'Private company';
  const coreWarning = company.warnings.find((warning) => warning.section === 'registry' || warning.section === 'company');

  return (
    <View style={[styles.screen, { backgroundColor: theme.canvas }]}>
      <SafeAreaView aria-hidden={marketPickerOpen || Boolean(selectedArticle)} edges={['top', 'left', 'right']} style={styles.safeArea}>
        <View style={[styles.header, width < 360 && styles.headerCompact, { borderBottomColor: theme.line }]}>
          <IconButton icon="back" label="Go back" onPress={goBack} />
          <CompanyLogo companyName={company.company.companyName} logoUrl={company.company.logoUrl} size={32} />
          <View style={styles.headerContext}>
            <Text accessibilityRole="header" numberOfLines={1} style={[styles.headerTitle, width < 360 && styles.headerTitleCompact, { color: theme.ink }]}>{company.company.companyName}</Text>
            <Text numberOfLines={1} style={[styles.headerMeta, { color: theme.muted }]}>{contextLabel}</Text>
          </View>
          <View style={styles.headerActions}>
            <IconButton icon="share" label={`Share ${company.company.companyName}`} onPress={() => void shareCompany()} />
            <IconButton
              active={saved}
              disabled={!savesHydrated || isSaving}
              icon="bookmark"
              label={saved ? `Remove ${company.company.companyName} from saved companies` : `Save ${company.company.companyName}`}
              onPress={() => void toggleSave()}
            />
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl colors={[theme.proof]} onRefresh={refreshCompany} refreshing={isRefreshing} tintColor={theme.proof} />}
          showsVerticalScrollIndicator={false}
          stickyHeaderIndices={[1]}>
          <View>
            <View style={[styles.identityBlock, width < 360 && styles.horizontalCompact]}>
              <View style={styles.quoteHeading}>
                <Text
                  accessibilityLabel={`${selectedInstrument?.marketValue.label ?? 'Value'}, ${formatMoney(selectedInstrument?.marketValue.amount ?? null)}`}
                  adjustsFontSizeToFit minimumFontScale={0.7} numberOfLines={1}
                  style={[styles.heroValue, width < 360 && styles.heroValueCompact, { color: theme.ink }]}>
                  {formatMoney(selectedInstrument?.marketValue.amount ?? null)}
                </Text>
                <Pressable
                  accessibilityLabel="Choose a market"
                  accessibilityRole="button"
                  accessibilityState={{ expanded: marketPickerOpen }}
                  onPress={() => setMarketPickerOpen(true)}
                  style={({ pressed }) => [styles.instrumentSwitch, { backgroundColor: theme.surface, borderColor: theme.line }, pressed && styles.pressed]}>
                  <Text style={[styles.instrumentSwitchLabel, { color: theme.proof }]}>{selectedInstrument ? productNames[selectedInstrument.productType] : 'Markets'}</Text>
                  <Text style={[styles.instrumentSwitchChevron, { color: theme.proof }]}>⌄</Text>
                </Pressable>
              </View>
              {selectedInstrument?.productType === 'spot' && selectedInstrument.changePercent.value !== null ? (
                <Text style={[styles.heroMovement, { color: selectedInstrument.changePercent.value >= 0 ? theme.gain : theme.caution }]}>
                  {formatPercent(selectedInstrument.changePercent.value)} · 1D
                </Text>
              ) : null}
              {selectedInstrument?.productType === 'prestock' ? (
                <Text style={[styles.quoteMeta, { color: theme.muted }]}>{selectedInstrument.marketValue.label} · Indicative value</Text>
              ) : null}
              {selectedInstrument && selectedInstrument.marketValue.dataState !== 'live' ? (
                <Text style={[styles.quoteMeta, { color: theme.muted }]}>
                  {selectedInstrument.marketValue.amount === null ? 'Value unavailable' : dataStateLabel(selectedInstrument.marketValue.dataState)}{selectedInstrument.marketValue.asOf ? ` · ${formatAge(selectedInstrument.marketValue.asOf)}` : ''}
                </Text>
              ) : null}
              {selectedInstrument && selectedInstrument.availability !== 'available' ? (
                <Text style={[styles.marketStatus, { color: theme.caution }]}>Market {availabilityLabel(selectedInstrument.availability).toLowerCase()}</Text>
              ) : null}
            </View>
            {coreWarning ? <InlineNotice message={coreWarning.message} tone="caution" /> : null}
            {saveError || savedRepositoryError ? <InlineNotice message={saveError ?? savedRepositoryError!} tone="caution" /> : null}
            {selectedInstrument?.productType !== 'prestock' ? (
              <HistorySection
                capability={historyCapability}
                canRetry={historyCanRetry}
                error={historyError}
                history={history?.instrumentId === selectedInstrument?.instrumentId ? history : undefined}
                isLoading={isHistoryLoading}
                onRetry={retryHistory}
                onSelectRange={selectRange}
                range={range}
              />
            ) : null}
          </View>
          <View accessibilityRole="tablist" style={[styles.tabs, { backgroundColor: theme.canvas, borderBottomColor: theme.line, borderTopColor: theme.line }]}>
            {(Object.keys(tabLabels) as DetailsTab[]).map((tab) => (
              <Pressable
                key={tab}
                accessibilityRole="tab"
                accessibilityState={{ selected: activeTab === tab }}
                onPress={() => setActiveTab(tab)}
                style={styles.tab}>
                <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive, { color: activeTab === tab ? theme.ink : theme.muted }]}>{tabLabels[tab]}</Text>
                {activeTab === tab ? <View style={[styles.tabRule, { backgroundColor: theme.proof }]} /> : null}
              </Pressable>
            ))}
          </View>
          {activeTab === 'overview' ? (
            <OverviewTab company={company} selectedInstrument={selectedInstrument} onSelectInstrument={selectInstrument} />
          ) : null}
          {activeTab === 'market-data' && selectedInstrument ? <MarketDataTab instrument={selectedInstrument} /> : null}
          {activeTab === 'news' ? (
            <NewsTab
              error={newsError}
              isLoading={isNewsLoading}
              news={news}
              onRetry={newsCanRetry ? retryNews : undefined}
              onSelect={setSelectedArticle}
            />
          ) : null}
        </ScrollView>
        <ActionDock action={action} company={company} instrument={selectedInstrument} />
      </SafeAreaView>

      <MarketPicker
        instruments={company.instruments}
        onClose={() => setMarketPickerOpen(false)}
        onSelect={selectInstrument}
        selected={selectedInstrument}
        visible={marketPickerOpen}
      />
      <NewsArticleSheet
        article={selectedArticle}
        eyebrow={`${company.company.companyName} news`}
        onClose={() => setSelectedArticle(undefined)}
      />
    </View>
  );
}

function DetailLoading({ onBack }: { onBack: () => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.screen, { backgroundColor: theme.canvas }]}>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
        <View style={[styles.header, { borderBottomColor: theme.outline }]}>
          <IconButton icon="back" label="Go back" onPress={onBack} />
          <View style={styles.headerContext}><View style={[styles.skeletonLine, { backgroundColor: theme.disabledSurface }]} /></View>
          <View style={styles.headerActions} />
        </View>
        <View accessibilityLabel="Loading company details" style={styles.loadingBody}>
          <ActivityIndicator color={theme.proof} />
          <Text style={[styles.loadingText, { color: theme.muted }]}>Loading verified market details</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

function DetailFailure({ message, onBack, onRetry }: { message: string; onBack: () => void; onRetry: () => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.screen, { backgroundColor: theme.canvas }]}>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
        <View style={[styles.header, { borderBottomColor: theme.outline }]}>
          <IconButton icon="back" label="Go back" onPress={onBack} />
          <View style={styles.headerContext} />
          <View style={styles.headerActions} />
        </View>
        <View style={styles.failureBody}>
          <Text accessibilityRole="header" style={[styles.failureTitle, { color: theme.ink }]}>Company not available</Text>
          <Text style={[styles.failureMessage, { color: theme.muted }]}>{message}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={({ pressed }) => [styles.retryButton, { borderColor: theme.outline }, pressed && styles.pressed]}>
            <Text style={[styles.retryText, { color: theme.proof }]}>Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

function HistorySection({
  capability,
  canRetry,
  error,
  history,
  isLoading,
  onRetry,
  onSelectRange,
  range,
}: {
  capability: MarketCompanyResponse['history'];
  canRetry: boolean;
  error?: string;
  history?: MarketHistoryResponse;
  isLoading: boolean;
  onRetry: () => void;
  onSelectRange: (range: MarketHistoryRange) => void;
  range?: MarketHistoryRange;
}) {
  const theme = useDetailTheme();
  if (!capability) {
    return (
      <View style={[styles.historyUnavailable, { borderBottomColor: theme.outline, borderTopColor: theme.outline }]}>
        <Text style={[styles.historyUnavailableTitle, { color: theme.ink }]}>No matching price history</Text>
        <Text style={[styles.historyUnavailableBody, { color: theme.muted }]}>History is unavailable for this instrument.</Text>
      </View>
    );
  }

  const hasPoints = Boolean(history?.points.length);
  return (
    <View accessibilityLabel={`${capability.valueLabel} history from ${capability.source}`} style={styles.historySection}>
      <View style={styles.chartFrame}>
        {hasPoints ? <PriceChart history={history!} /> : null}
        {!hasPoints && isLoading ? (
          <View style={styles.chartMessage}>
            <ActivityIndicator color={theme.proof} />
            <Text style={[styles.chartMessageText, { color: theme.muted }]}>Loading matching history</Text>
          </View>
        ) : null}
        {!hasPoints && !isLoading ? (
          <View style={styles.chartMessage}>
            <Text style={[styles.chartMessageTitle, { color: theme.ink }]}>No history for this range</Text>
            <Text style={[styles.chartMessageText, { color: theme.muted }]}>{error ?? 'No candles are available for this range.'}</Text>
          </View>
        ) : null}
        {hasPoints && isLoading ? <ActivityIndicator color={theme.proof} size="small" style={styles.chartRefreshing} /> : null}
      </View>
      {error && hasPoints ? (
        <RetryableSectionNotice
          message={`${error} Showing the last matching ${history!.range.toUpperCase()} series.`}
          onRetry={canRetry ? onRetry : undefined}
        />
      ) : null}
      {error && !hasPoints && canRetry ? <RetryableSectionNotice message={error} onRetry={onRetry} /> : null}
      <ScrollView contentContainerStyle={styles.rangeContent} horizontal showsHorizontalScrollIndicator={false}>
        {capability.supportedRanges.map((item) => (
          <Pressable
            key={item}
            accessibilityRole="button"
            accessibilityState={{ selected: range === item }}
            onPress={() => onSelectRange(item)}
            style={({ pressed }) => [
              styles.rangeButton,
              { backgroundColor: range === item ? theme.surface : 'transparent', borderColor: range === item ? theme.outline : 'transparent' },
              pressed && styles.pressed,
            ]}>
            <Text style={[styles.rangeText, { color: range === item ? theme.ink : theme.muted }]}>{item.toUpperCase()}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function PriceChart({ history }: { history: MarketHistoryResponse }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const closes = history.points.map((point) => point.close);
  const first = closes[0] ?? 0;
  const last = closes.at(-1) ?? first;
  const movement = first > 0 ? ((last - first) / first) * 100 : 0;
  const color = movement < 0 ? theme.caution : theme.proof;
  const height = 148;
  const insetX = 3;
  const insetY = 12;
  const low = Math.min(...closes);
  const high = Math.max(...closes);
  const spread = Math.max(high - low, Math.abs(high) * 0.005, 0.01);
  const path = width > 0 ? closes.map((value, index) => {
    const x = insetX + (index / Math.max(closes.length - 1, 1)) * (width - insetX * 2);
    const y = height - insetY - ((value - low) / spread) * (height - insetY * 2);
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ') : '';

  const onLayout = (event: LayoutChangeEvent) => setWidth(Math.round(event.nativeEvent.layout.width));
  return (
    <View
      accessibilityLabel={`${history.range} ${history.valueLabel} history, ${movement >= 0 ? 'up' : 'down'} ${Math.abs(movement).toFixed(2)} percent`}
      accessibilityRole="image"
      onLayout={onLayout}
      style={styles.chart}>
      {width ? (
        <Svg height={height} width={width}>
          <Defs>
            <LinearGradient id="detail-chart-fill" x1="0" x2="0" y1="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity={0.12} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {[0.27, 0.74].map((ratio) => (
            <Line key={ratio} stroke={theme.muted} strokeDasharray="3 4" strokeOpacity={0.12} strokeWidth={1} x1="0" x2={width} y1={height * ratio} y2={height * ratio} />
          ))}
          <Path d={`${path} L ${width - insetX} ${height} L ${insetX} ${height} Z`} fill="url(#detail-chart-fill)" />
          <Path d={path} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} />
        </Svg>
      ) : null}
    </View>
  );
}

function OverviewTab({ company, selectedInstrument, onSelectInstrument }: {
  company: MarketCompanyResponse;
  selectedInstrument?: MarketInstrument;
  onSelectInstrument: (instrumentId: string) => void;
}) {
  const theme = useDetailTheme();
  const facts = selectedInstrument ? overviewFacts(selectedInstrument) : [];
  return (
    <View style={styles.tabPanel}>
      {selectedInstrument?.productType === 'prestock' ? (
        <View style={[styles.privateHistory, { borderBottomColor: theme.line }]}>
          <Text style={[styles.historyUnavailableTitle, { color: theme.ink }]}>No matching price history</Text>
          <Text style={[styles.historyUnavailableBody, { color: theme.muted }]}>Each offering has its own valuation and terms.</Text>
        </View>
      ) : null}
      {facts.length ? (
        <Section meta={selectedInstrument?.symbol} title="Snapshot">
          <View style={[styles.factGrid, { backgroundColor: theme.line, borderColor: theme.line }]}>
            {facts.map((fact) => <FactCell key={fact.label} label={fact.label} value={fact.value} />)}
          </View>
        </Section>
      ) : null}
      <Section meta={`${company.instruments.length} instruments`} title={selectedInstrument?.productType === 'prestock' ? 'Available offerings' : 'Available markets'}>
        {company.instruments.map((instrument) => (
          <MarketOption key={instrument.instrumentId} instrument={instrument} selected={instrument.instrumentId === selectedInstrument?.instrumentId} onPress={() => onSelectInstrument(instrument.instrumentId)} />
        ))}
      </Section>
      {company.company.description ? (
        <Disclosure title={`About ${company.company.companyName}`}>
          <Text style={[styles.description, { color: theme.muted }]}>{company.company.description.text}</Text>
          <Text style={[styles.descriptionSource, { color: theme.muted }]}>{company.company.description.source}</Text>
        </Disclosure>
      ) : null}
    </View>
  );
}

function MarketOption({ instrument, selected, onPress }: { instrument: MarketInstrument; selected: boolean; onPress: () => void }) {
  const theme = useDetailTheme();
  return (
    <Pressable
      accessibilityLabel={`${instrument.symbol}, ${productLabels[instrument.productType]}, ${instrument.marketValue.label} ${formatMoney(instrument.marketValue.amount)}, ${availabilityLabel(instrument.availability)}, provided by ${instrument.provider}`}
      accessibilityHint="Selects this instrument for the price, facts and action"
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.instrumentRow, { borderColor: selected ? theme.proof : theme.line, backgroundColor: selected ? theme.proofWash : theme.surface }, pressed && styles.pressed]}>
      <View style={styles.instrumentCopy}>
        <Text style={[styles.instrumentSymbol, { color: theme.ink }]}>{instrument.symbol}</Text>
        <Text style={[styles.instrumentProvider, { color: theme.muted }]}>{instrumentContext(instrument)}</Text>
        {instrument.productType === 'prestock' ? <Text style={[styles.instrumentStructure, { color: theme.muted }]}>{instrument.exposureType === 'spv_exposure' ? 'SPV exposure' : 'Loan participation'}</Text> : null}
      </View>
      <View style={styles.instrumentValue}>
        <Text style={[styles.instrumentPrice, { color: theme.ink }]}>{formatMoney(instrument.marketValue.amount)}</Text>
        <Text style={[styles.instrumentAvailability, { color: instrument.availability === 'paused' ? theme.caution : theme.muted }]}>{availabilityLabel(instrument.availability)}</Text>
      </View>
    </Pressable>
  );
}

function MarketPicker({ instruments, selected, visible, onClose, onSelect }: {
  instruments: MarketInstrument[];
  selected?: MarketInstrument;
  visible: boolean;
  onClose: () => void;
  onSelect: (instrumentId: string) => void;
}) {
  const theme = useDetailTheme();
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.sheetBackdrop}>
        <Pressable accessibilityLabel="Dismiss market selection" accessibilityRole="button" onPress={onClose} style={StyleSheet.absoluteFill} />
        <SafeAreaView edges={['bottom', 'left', 'right']} accessibilityViewIsModal style={[styles.sheet, { backgroundColor: theme.canvas, borderColor: theme.outline }]}>
          <View style={[styles.sheetHandle, { backgroundColor: theme.outline }]} />
          <View style={styles.sheetHeader}>
            <Text accessibilityRole="header" style={[styles.sheetTitle, { color: theme.ink }]}>{selected?.productType === 'prestock' ? 'Choose an offering' : 'Choose a market'}</Text>
            <Pressable accessibilityLabel="Close market selection" accessibilityRole="button" onPress={onClose} style={styles.iconButton}>
              <Text style={[styles.sheetClose, { color: theme.muted }]}>×</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {instruments.map((instrument) => <MarketOption key={instrument.instrumentId} instrument={instrument} selected={selected?.instrumentId === instrument.instrumentId} onPress={() => onSelect(instrument.instrumentId)} />)}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function Disclosure({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useDetailTheme();
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={[styles.disclosure, { borderTopColor: theme.line }]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded((current) => !current)} style={styles.disclosureToggle}>
        <Text style={[styles.disclosureTitle, { color: theme.ink }]}>{title}</Text>
        <Text style={[styles.disclosureChevron, { color: theme.muted }]}>{expanded ? '−' : '+'}</Text>
      </Pressable>
      {expanded ? children : null}
    </View>
  );
}

function MarketDataTab({ instrument }: { instrument: MarketInstrument }) {
  return <View style={styles.tabPanel}><InstrumentDataCard key={instrument.instrumentId} instrument={instrument} /></View>;
}

function InstrumentDataCard({ instrument }: { instrument: MarketInstrument }) {
  const theme = useDetailTheme();
  const [copyMessage, setCopyMessage] = useState<string>();
  const copyIdentifier = async () => {
    try {
      await Clipboard.setStringAsync(instrument.exactIdentifier);
      setCopyMessage('Identifier copied');
    } catch {
      setCopyMessage('Could not copy. Select the identifier to copy it.');
    }
  };
  const facts = [{ label: 'Instrument', value: instrument.symbol }, ...instrumentFacts(instrument)];
  return (
    <Section meta={instrument.symbol} title="Instrument details">
      <View style={[styles.dataCard, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        {facts.map((fact, index) => (
          <View key={fact.label} style={[styles.dataRow, index > 0 && { borderTopColor: theme.line, borderTopWidth: 1 }]}>
            <Text style={[styles.dataLabel, { color: theme.muted }]}>{fact.label}</Text>
            <Text selectable style={[styles.dataValue, { color: theme.ink }]}>{fact.value}</Text>
          </View>
        ))}
      </View>
      <Disclosure title="Exact identifier">
        <Text selectable style={[styles.identifierValue, { color: theme.ink }]}>{instrument.exactIdentifier}</Text>
        <Pressable accessibilityLabel={`Copy ${instrument.symbol} identifier`} accessibilityRole="button" onPress={() => void copyIdentifier()} style={styles.copyButton}>
          <Text style={[styles.copyButtonText, { color: theme.proof }]}>Copy identifier</Text>
        </Pressable>
        {copyMessage ? <Text accessibilityLiveRegion="polite" style={[styles.copiedText, { color: theme.proof }]}>{copyMessage}</Text> : null}
      </Disclosure>
    </Section>
  );
}

function NewsTab({
  error,
  isLoading,
  news,
  onRetry,
  onSelect,
}: {
  error?: string;
  isLoading: boolean;
  news: MarketCompanyNewsItem[];
  onRetry?: () => void;
  onSelect: (article: MarketCompanyNewsItem) => void;
}) {
  const theme = useTheme();
  if (isLoading && news.length === 0) return <SectionMessage loading message="Loading company news" />;
  if (news.length === 0) {
    return onRetry
      ? <RetryableSectionNotice message={error ?? 'Warren could not refresh company news.'} onRetry={onRetry} />
      : <SectionMessage message={error ?? 'No company-associated stories are available right now.'} />;
  }
  return (
    <View style={styles.tabPanel}>
      {error ? <RetryableSectionNotice message={error} onRetry={onRetry} /> : null}
      <View style={[styles.newsList, { borderColor: theme.outline }]}>
        {news.map((article, index) => (
          <CompanyNewsRow article={article} isLast={index === news.length - 1} key={article.id} onPress={() => onSelect(article)} />
        ))}
      </View>
    </View>
  );
}

function CompanyNewsRow({ article, isLast, onPress }: { article: MarketCompanyNewsItem; isLast: boolean; onPress: () => void }) {
  const theme = useTheme();
  const [failedImageUrl, setFailedImageUrl] = useState<string>();
  const imageFailed = Boolean(article.imageUrl && failedImageUrl === article.imageUrl);
  return (
    <Pressable
      accessibilityHint="Opens the story in an in-app preview"
      accessibilityLabel={`${article.headline}, ${article.source}, ${formatAge(article.publishedAt)}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.newsRow,
        { borderBottomColor: theme.outline, borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth },
        pressed && { backgroundColor: theme.proofWash },
      ]}>
      <View style={[styles.newsImage, { backgroundColor: theme.proofWash }]}>
        {article.imageUrl && !imageFailed ? (
          <Image contentFit="cover" onError={() => setFailedImageUrl(article.imageUrl ?? undefined)} source={{ uri: article.imageUrl }} style={StyleSheet.absoluteFill} />
        ) : (
          <Text style={[styles.newsImageFallback, { color: theme.proof }]}>{article.source.slice(0, 2).toUpperCase()}</Text>
        )}
      </View>
      <View style={styles.newsCopy}>
        <Text style={[styles.newsMeta, { color: theme.proof }]}>{article.source} · {formatAge(article.publishedAt)}</Text>
        <Text numberOfLines={3} style={[styles.newsHeadline, { color: theme.ink }]}>{article.headline}</Text>
      </View>
    </Pressable>
  );
}

function Section({ children, meta, title }: { children: React.ReactNode; meta?: string; title: string }) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.ink }]}>{title}</Text>
        {meta ? <Text style={[styles.sectionMeta, { color: theme.muted }]}>{meta}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function FactCell({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.factCell, { backgroundColor: theme.surface }]}>
      <Text style={[styles.factLabel, { color: theme.muted }]}>{label}</Text>
      <Text style={[styles.factValue, { color: theme.ink }]}>{value}</Text>
    </View>
  );
}

function InlineNotice({ message, tone }: { message: string; tone: 'caution' }) {
  const theme = useTheme();
  return (
    <View accessibilityLiveRegion="polite" style={[styles.notice, { backgroundColor: theme.cautionWash, borderColor: theme.caution }]}>
      <Text style={[styles.noticeText, { color: theme.ink }]}>{message}</Text>
    </View>
  );
}

function SectionMessage({ loading = false, message }: { loading?: boolean; message: string }) {
  const theme = useTheme();
  return (
    <View accessibilityLiveRegion="polite" style={styles.sectionMessage}>
      {loading ? <ActivityIndicator color={theme.proof} /> : null}
      <Text style={[styles.sectionMessageText, { color: theme.muted }]}>{message}</Text>
    </View>
  );
}

function RetryableSectionNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const theme = useTheme();
  return (
    <View accessibilityLiveRegion="polite" style={[styles.retryNotice, { borderColor: theme.outline }]}>
      <Text style={[styles.retryNoticeText, { color: theme.muted }]}>{message}</Text>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [styles.sectionRetryButton, { borderColor: theme.outline }, pressed && styles.pressed]}>
          <Text style={[styles.sectionRetryText, { color: theme.proof }]}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

type PrimaryAction =
  | { kind: 'offering'; url: string }
  | { kind: 'trade'; product: 'spot' | 'perpetual'; instrumentId: string };

function ActionDock({ action, company, instrument }: { action?: PrimaryAction; company: MarketCompanyResponse; instrument?: MarketInstrument }) {
  const theme = useDetailTheme();
  const router = useRouter();
  const label = !action ? 'Market unavailable' : action.kind === 'offering' ? 'View offering ↗' : `Trade ${company.company.companyName}`;
  const onPress = () => {
    if (!action) return;
    if (action.kind === 'offering') { void openBrowserAsync(action.url); return; }
    router.push({ pathname: '/trade/[assetId]', params: { assetId: company.company.assetId, product: action.product, instrumentId: action.instrumentId } } as Href);
  };
  return (
    <SafeAreaView edges={['bottom']} style={[styles.actionDock, { backgroundColor: theme.canvas, borderTopColor: theme.line }]}>
      {instrument ? <Text style={[styles.dockContext, { color: theme.muted }]}>{instrumentContext(instrument)}</Text> : null}
      <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ disabled: !action }} disabled={!action} onPress={onPress} style={({ pressed }) => [styles.primaryAction, { backgroundColor: action ? theme.proof : theme.disabledSurface }, pressed && styles.pressed]}>
        <Text style={[styles.primaryActionText, { color: action ? theme.onProof : theme.disabledInk }]}>{label}</Text>
      </Pressable>
    </SafeAreaView>
  );
}

function IconButton({
  active = false,
  disabled = false,
  icon,
  label,
  onPress,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: DetailIconName;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        active && { backgroundColor: theme.proofWash },
        pressed && { backgroundColor: theme.proofWash },
        disabled && styles.disabled,
      ]}>
      <DetailIcon color={active ? theme.proof : theme.muted} name={icon} />
    </Pressable>
  );
}

function DetailIcon({ color, name }: { color: string; name: DetailIconName }) {
  return (
    <Svg fill="none" height={21} viewBox="0 0 24 24" width={21}>
      {name === 'back' ? <Path d="m15 5-7 7 7 7M8 12h11" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} /> : null}
      {name === 'share' ? <Path d="M12 15V4m0 0L8 8m4-4 4 4M6 11v8h12v-8" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} /> : null}
      {name === 'bookmark' ? <Path d="M7 4.5h10v15l-5-3-5 3v-15Z" stroke={color} strokeLinejoin="round" strokeWidth={1.8} /> : null}
      {name === 'copy' ? <><Path d="M9 8h10v11H9z" stroke={color} strokeLinejoin="round" strokeWidth={1.8} /><Path d="M15 8V5H5v11h4" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} /></> : null}
    </Svg>
  );
}

function CompanyLogo({ companyName, logoUrl, size }: { companyName: string; logoUrl: string | null; size: number }) {
  const theme = useTheme();
  const [failedLogoUrl, setFailedLogoUrl] = useState<string>();
  const failed = Boolean(logoUrl && failedLogoUrl === logoUrl);
  const canRender = Boolean(logoUrl && !logoUrl.toLowerCase().endsWith('.svg') && !failed);
  return (
    <View style={[styles.logo, { backgroundColor: theme.proofWash, borderColor: theme.outline, height: size, width: size }]}>
      {canRender ? (
        <Image contentFit="contain" onError={() => setFailedLogoUrl(logoUrl ?? undefined)} source={{ uri: logoUrl! }} style={{ height: size, width: size }} />
      ) : (
        <Text style={[styles.logoText, { color: theme.proof }]}>{initials(companyName)}</Text>
      )}
    </View>
  );
}

function primaryAction(instrument?: MarketInstrument): PrimaryAction | undefined {
  if (!instrument || instrument.availability !== 'available') return undefined;
  if (instrument.productType === 'prestock') {
    const url = instrument.detailsUrl ?? instrument.providerUrl;
    return url ? { kind: 'offering', url } : undefined;
  }
  if (instrument.verificationState !== 'verified') return undefined;
  return { kind: 'trade', product: instrument.productType, instrumentId: instrument.instrumentId };
}

function instrumentContext(instrument: MarketInstrument) {
  const product = productNames[instrument.productType];
  return product === instrument.provider ? product : `${product} · ${instrument.provider}`;
}

function overviewFacts(instrument: MarketInstrument) {
  if (instrument.productType === 'spot') return compact([
    { label: '24h token volume', value: formatCompactMoney(instrument.volume24hUsd.value) },
    { label: 'Token liquidity', value: formatCompactMoney(instrument.liquidityUsd) },
    { label: 'Network', value: titleCase(instrument.network) },
    { label: 'Provider', value: instrument.provider },
  ]);
  if (instrument.productType === 'prestock') return compact([
    { label: 'Structure', value: instrument.exposureType === 'spv_exposure' ? 'SPV exposure' : 'Loan participation' },
    { label: 'Provider mark', value: formatMoney(instrument.markPrice) },
    { label: 'Transfer fee', value: instrument.transferFeeBps === null ? 'Unavailable' : `${instrument.transferFeeBps / 100}%` },
    { label: 'Provider', value: instrument.provider },
  ]);
  return compact([
    { label: 'Funding', value: instrument.fundingRatePercent.value === null ? undefined : formatPercent(instrument.fundingRatePercent.value) },
    { label: 'Open interest', value: formatCompactNumber(instrument.openInterestBase) },
    { label: 'Maximum leverage', value: `${instrument.maxLeverage}×` },
    { label: 'Margin', value: titleCase(instrument.marginMode) },
  ]);
}

function instrumentFacts(instrument: MarketInstrument): { label: string; value: string }[] {
  const common = compact([
    { label: 'Product', value: productLabels[instrument.productType] },
    { label: 'Provider', value: instrument.provider },
    { label: instrument.marketValue.label, value: formatMoney(instrument.marketValue.amount) },
    { label: 'Value state', value: dataStateLabel(instrument.marketValue.dataState) },
    { label: 'Availability', value: availabilityLabel(instrument.availability) },
    { label: 'Verification', value: titleCase(instrument.verificationState) },
  ]);
  if (instrument.productType === 'spot') return [...common, ...compact([
    { label: 'Network', value: instrument.network },
    { label: 'Issuer', value: instrument.issuer },
    { label: 'Redeemability', value: redeemabilityLabel(instrument.stockVariantTier) },
    { label: '1-day change', value: instrument.changePercent.value === null ? undefined : formatPercent(instrument.changePercent.value) },
    { label: '24h token volume', value: formatCompactMoney(instrument.volume24hUsd.value) },
    { label: 'Liquidity', value: formatCompactMoney(instrument.liquidityUsd) },
  ])];
  if (instrument.productType === 'prestock') return [...common, ...compact([
    { label: 'Structure', value: instrument.structureLabel },
    { label: 'Provider mark', value: formatMoney(instrument.markPrice) },
    { label: 'Provider token value', value: formatMoney(instrument.tokenPrice) },
    { label: 'Implied valuation', value: formatCompactMoney(instrument.impliedValuation) },
    { label: 'Mark valuation', value: formatCompactMoney(instrument.markValuation) },
    { label: 'Supply', value: formatCompactNumber(instrument.supply) },
    { label: 'Transfer fee', value: instrument.transferFeeBps === null ? undefined : `${instrument.transferFeeBps / 100}%` },
  ])];
  return [...common, ...compact([
    { label: 'Venue', value: instrument.venue },
    { label: 'Margin', value: titleCase(instrument.marginMode) },
    { label: 'Maximum leverage', value: `${instrument.maxLeverage}×` },
    { label: 'Funding rate', value: instrument.fundingRatePercent.value === null ? undefined : formatPercent(instrument.fundingRatePercent.value) },
    { label: 'Next funding', value: instrument.nextFundingAt ? formatDateTime(instrument.nextFundingAt) : undefined },
    { label: 'Open interest', value: formatCompactNumber(instrument.openInterestBase) },
    { label: 'Oracle', value: instrument.oracleLabel },
  ])];
}

function compact(items: { label: string; value?: string }[]) {
  return items.filter((item): item is { label: string; value: string } => Boolean(item.value));
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseProduct(value?: string): MarketProduct | undefined {
  return value === 'spot' || value === 'prestock' || value === 'perpetual' ? value : undefined;
}

function isAbort(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

function formatMoney(value: number | null) {
  if (value === null) return '—';
  const decimals = value >= 1_000 ? 0 : value >= 1 ? 2 : 4;
  const parts = value.toFixed(decimals).split('.');
  parts[0] = withThousands(parts[0]);
  return `$${parts.join('.')}`;
}

function formatCompactMoney(value: number | null) {
  if (value === null) return undefined;
  if (value >= 1_000_000_000_000) return `$${(value / 1_000_000_000_000).toFixed(2)}T`;
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return formatMoney(value);
}

function formatCompactNumber(value: number | null) {
  if (value === null) return undefined;
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return withThousands(value.toFixed(value % 1 ? 2 : 0));
}

function withThousands(value: string) {
  const [whole, decimal] = value.split('.');
  const formatted = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decimal ? `${formatted}.${decimal}` : formatted;
}

function formatPercent(value: number) {
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}%`;
}

function formatAge(value: string) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date not provided';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hour = date.getHours();
  return `${months[date.getMonth()]} ${date.getDate()} · ${hour % 12 || 12}:${String(date.getMinutes()).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function availabilityLabel(value: MarketInstrument['availability']) {
  if (value === 'available') return 'Available';
  if (value === 'preview') return 'Preview';
  if (value === 'paused') return 'Paused';
  return 'Not currently offered';
}

function dataStateLabel(value: MarketInstrument['marketValue']['dataState']) {
  if (value === 'live') return 'Live';
  if (value === 'delayed') return 'Delayed';
  if (value === 'stale') return 'Last known';
  if (value === 'sample') return 'Sample';
  return 'Source time not provided';
}

function redeemabilityLabel(value: Extract<MarketInstrument, { productType: 'spot' }>['stockVariantTier']) {
  if (value === 'share_redeemable') return 'Share redeemable';
  if (value === 'cash_redeemable') return 'Cash redeemable';
  if (value === 'not_redeemable') return 'Not redeemable';
  return 'Unknown';
}

function titleCase(value: string) {
  return value.replace(/_/g, ' ').replace(/^./, (character) => character.toUpperCase());
}

function initials(companyName: string) {
  const parts = companyName.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : companyName.slice(0, 2)).toUpperCase();
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safeArea: { alignSelf: 'center', flex: 1, maxWidth: 680, width: '100%' },
  header: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', gap: 9, minHeight: 60, paddingHorizontal: 14, paddingVertical: 7 },
  headerContext: { flex: 1, minWidth: 0 },
  headerTitle: { fontFamily: Fonts.sans, fontSize: 18, fontWeight: '500', letterSpacing: -0.45, lineHeight: 24 },
  headerMeta: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 15, marginTop: 3 },
  headerActions: { flexDirection: 'row' },
  iconButton: { alignItems: 'center', borderRadius: 12, height: 44, justifyContent: 'center', width: 44 },
  disabled: { opacity: 0.42 },
  scrollContent: { paddingBottom: 24 },
  identityBlock: { paddingBottom: 4, paddingHorizontal: 18, paddingTop: 18 },
  logo: { alignItems: 'center', borderRadius: 10, justifyContent: 'center', overflow: 'hidden' },
  logoText: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '600' },
  heroValue: { flexShrink: 1, fontFamily: Fonts.mono, fontSize: 35, fontWeight: '500', letterSpacing: -2.2, lineHeight: 46 },
  heroMovement: { fontFamily: Fonts.mono, fontSize: 12, lineHeight: 18, marginTop: 4 },
  notice: { borderLeftWidth: 2, marginHorizontal: 18, marginTop: 12, paddingHorizontal: 11, paddingVertical: 9 },
  noticeText: { fontFamily: Fonts.sans, fontSize: 10, lineHeight: 15 },
  historySection: { paddingBottom: 8, paddingHorizontal: 18, paddingTop: 10 },
  chartFrame: { height: 148, position: 'relative' },
  chart: { flex: 1 },
  chartMessage: { alignItems: 'center', flex: 1, gap: 9, justifyContent: 'center', paddingHorizontal: 30 },
  chartMessageTitle: { fontFamily: Fonts.sans, fontSize: 12, fontWeight: '700' },
  chartMessageText: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  chartRefreshing: { position: 'absolute', right: 18, top: 12 },
  rangeContent: { flexGrow: 1, gap: 4, paddingTop: 9 },
  rangeButton: { alignItems: 'center', borderRadius: 10, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 44, minWidth: 38, paddingHorizontal: 7 },
  rangeText: { fontFamily: Fonts.mono, fontSize: 11 },
  historyUnavailable: { borderBottomWidth: 1, borderTopWidth: 1, marginHorizontal: 18, marginTop: 18, paddingVertical: 18 },
  historyUnavailableTitle: { fontFamily: Fonts.sans, fontSize: 12, fontWeight: '500' },
  historyUnavailableBody: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 19, marginTop: 4 },
  tabs: { borderBottomWidth: 1, borderTopWidth: 1, flexDirection: 'row', gap: 8, marginTop: 0, paddingHorizontal: 18 },
  tab: { alignItems: 'center', flex: 1, justifyContent: 'center', minHeight: 47, position: 'relative' },
  tabText: { fontFamily: Fonts.sans, fontSize: 12 },
  tabRule: { bottom: -1, height: 2, left: 0, position: 'absolute', right: 0 },
  tabPanel: { paddingHorizontal: 18, paddingTop: 0 },
  section: { marginTop: 23 },
  sectionHeading: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { flexShrink: 1, fontFamily: Fonts.sans, fontSize: 17, fontWeight: '500', letterSpacing: -0.4 },
  sectionMeta: { fontFamily: Fonts.sans, fontSize: 10 },
  factGrid: { borderRadius: 13, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 1, overflow: 'hidden' },
  factCell: { flexBasis: '49%', flexGrow: 1, paddingHorizontal: 12, paddingVertical: 14 },
  factLabel: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 16 },
  factValue: { fontFamily: Fonts.sans, fontSize: 14, fontWeight: '500', lineHeight: 21, marginTop: 6 },
  instrumentRow: { alignItems: 'center', borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 12, marginTop: 8, minHeight: 77, padding: 13 },
  instrumentCopy: { flex: 1, minWidth: 0 },
  instrumentSymbol: { fontFamily: Fonts.sans, fontSize: 14, fontWeight: '500', lineHeight: 20 },
  instrumentProvider: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 17, marginTop: 5 },
  instrumentValue: { alignItems: 'flex-end', maxWidth: 100 },
  instrumentPrice: { fontFamily: Fonts.mono, fontSize: 13, lineHeight: 19 },
  instrumentAvailability: { fontFamily: Fonts.sans, fontSize: 10, lineHeight: 15, marginTop: 5 },
  description: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 21 },
  dataCard: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  dataRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 15, justifyContent: 'space-between', padding: 14 },
  dataLabel: { flex: 1, fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18 },
  dataValue: { flex: 1, fontFamily: Fonts.sans, fontSize: 12, fontWeight: '500', lineHeight: 18, textAlign: 'right' },
  identifierValue: { fontFamily: Fonts.mono, fontSize: 11, lineHeight: 19, marginTop: 6 },
  copiedText: { fontFamily: Fonts.sans, fontSize: 11, paddingBottom: 6 },
  newsList: { borderRadius: 14, borderWidth: 1, marginTop: 20, overflow: 'hidden' },
  newsRow: { flexDirection: 'row', gap: 11, minHeight: 108, padding: 10 },
  newsImage: { alignItems: 'center', aspectRatio: 1, borderRadius: 9, justifyContent: 'center', overflow: 'hidden', width: 86 },
  newsImageFallback: { fontFamily: Fonts.serif, fontSize: 18, fontWeight: '700' },
  newsCopy: { flex: 1, justifyContent: 'center', minWidth: 0 },
  newsMeta: { fontFamily: Fonts.sans, fontSize: 10 },
  newsHeadline: { fontFamily: Fonts.sans, fontSize: 14, fontWeight: '500', lineHeight: 21, marginTop: 7 },
  sectionMessage: { alignItems: 'center', gap: 10, justifyContent: 'center', minHeight: 170, paddingHorizontal: 34 },
  sectionMessageText: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 21, textAlign: 'center' },
  retryNotice: { alignItems: 'center', borderRadius: Radii.control, borderWidth: 1, gap: 10, margin: Spacing.three, padding: 13 },
  retryNoticeText: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 17, textAlign: 'center' },
  sectionRetryButton: { alignItems: 'center', borderRadius: Radii.control, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 16 },
  sectionRetryText: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '700' },
  actionDock: { borderTopWidth: 1, paddingBottom: 15, paddingHorizontal: 18, paddingTop: 11 },
  primaryAction: { alignItems: 'center', borderRadius: 12, justifyContent: 'center', minHeight: 49, paddingHorizontal: 16, paddingVertical: 10 },
  primaryActionText: { fontFamily: Fonts.sans, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  loadingBody: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center' },
  loadingText: { fontFamily: Fonts.sans, fontSize: 11 },
  skeletonLine: { borderRadius: 4, height: 11, width: 116 },
  failureBody: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingHorizontal: 34 },
  failureTitle: { fontFamily: Fonts.serif, fontSize: 26, fontWeight: '700' },
  failureMessage: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 19, marginTop: 10, textAlign: 'center' },
  retryButton: { alignItems: 'center', borderRadius: Radii.control, borderWidth: 1, justifyContent: 'center', marginTop: 18, minHeight: 44, paddingHorizontal: 18 },
  retryText: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '700' },
  pressed: { opacity: 0.74 },
  headerCompact: { gap: 5, paddingHorizontal: 9 },
  headerTitleCompact: { fontSize: 16 },
  horizontalCompact: { paddingHorizontal: 14 },
  quoteHeading: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  heroValueCompact: { fontSize: 32 },
  quoteMeta: { fontFamily: Fonts.sans, fontSize: 10, lineHeight: 15, marginTop: 4 },
  marketStatus: { fontFamily: Fonts.sans, fontSize: 11, marginTop: 8 },
  instrumentSwitch: { alignItems: 'center', borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 10, justifyContent: 'center', minHeight: 44, paddingHorizontal: 12 },
  instrumentSwitchLabel: { fontFamily: Fonts.sans, fontSize: 12 },
  instrumentSwitchChevron: { fontFamily: Fonts.sans, fontSize: 14 },
  privateHistory: { borderBottomWidth: 1, marginTop: 18, paddingBottom: 18 },
  tabTextActive: { fontWeight: '500' },
  instrumentStructure: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 17 },
  disclosure: { borderTopWidth: 1, marginTop: 18, paddingTop: 9 },
  disclosureToggle: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between', minHeight: 44 },
  disclosureTitle: { flexShrink: 1, fontFamily: Fonts.sans, fontSize: 13, lineHeight: 20 },
  disclosureChevron: { fontFamily: Fonts.sans, fontSize: 16 },
  descriptionSource: { fontFamily: Fonts.sans, fontSize: 10, marginTop: 8 },
  copyButton: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: 44 },
  copyButtonText: { fontFamily: Fonts.sans, fontSize: 12 },
  dockContext: { fontFamily: Fonts.sans, fontSize: 10, lineHeight: 15, marginBottom: 9 },
  sheetBackdrop: { backgroundColor: '#00000080', flex: 1, justifyContent: 'flex-end' },
  sheet: { alignSelf: 'center', borderTopLeftRadius: 23, borderTopRightRadius: 23, borderWidth: 1, maxHeight: '88%', maxWidth: 680, paddingHorizontal: 18, paddingTop: 9, width: '100%' },
  sheetHandle: { alignSelf: 'center', borderRadius: 99, height: 4, marginBottom: 5, marginTop: 2, width: 36 },
  sheetHeader: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { flexShrink: 1, fontFamily: Fonts.sans, fontSize: 20, fontWeight: '500', letterSpacing: -0.6 },
  sheetClose: { fontFamily: Fonts.sans, fontSize: 25 },
  sheetContent: { paddingBottom: 23 },
});
