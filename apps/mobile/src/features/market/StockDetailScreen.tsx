import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { openBrowserAsync } from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Line, Path } from 'react-native-svg';
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

export function StockDetailScreen() {
  const params = useLocalSearchParams<{
    assetId?: string | string[];
    instrumentId?: string | string[];
    product?: string | string[];
    source?: string | string[];
  }>();
  const router = useRouter();
  const theme = useTheme();
  const assetId = firstParam(params.assetId);
  const entryInstrumentId = firstParam(params.instrumentId);
  const entryProduct = parseProduct(firstParam(params.product));
  const source = firstParam(params.source);

  const [company, setCompany] = useState<MarketCompanyResponse>();
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [requestVersion, setRequestVersion] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailsTab>('overview');
  const [expandedInstrumentId, setExpandedInstrumentId] = useState<string>();

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

  useEffect(() => {
    if (!assetId) return;
    const controller = new AbortController();
    void loadMarketCompany(assetId, controller.signal)
      .then((response) => {
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
        setExpandedInstrumentId(contextual?.instrumentId);
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
  }, [assetId, entryInstrumentId, entryProduct, requestVersion]);

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
    const capability = company?.history;
    if (!assetId || !capability || !range) return;
    const controller = new AbortController();
    void loadMarketHistory({ assetId, instrumentId: capability.instrumentId, range }, controller.signal)
      .then((response) => {
        setHistory(response);
        const warning = response.warnings.find((candidate) => candidate.section === 'history');
        setHistoryError(warning?.message);
        setHistoryCanRetry(Boolean(warning?.retryable));
      })
      .catch((error: unknown) => {
        if (!isAbort(error)) {
          setHistoryError(error instanceof Error ? error.message : 'Warren could not refresh price history.');
          setHistoryCanRetry(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsHistoryLoading(false);
      });
    return () => controller.abort();
  }, [assetId, company?.history, historyRequestVersion, range]);

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

  const heroInstrument = company.primaryInstrumentId
    ? company.instruments.find((instrument) => instrument.instrumentId === company.primaryInstrumentId)
    : undefined;
  const action = primaryAction(company, entryProduct, entryInstrumentId);
  const contextLabel = company.company.ticker ? `${company.company.ticker} · US equity` : 'Private company';
  const coreWarning = company.warnings.find((warning) => warning.section === 'registry' || warning.section === 'company');

  return (
    <View style={[styles.screen, { backgroundColor: theme.canvas }]}>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
        <View style={[styles.header, { borderBottomColor: theme.outline }]}>
          <IconButton icon="back" label="Go back" onPress={goBack} />
          <View style={styles.headerContext}>
            <Text numberOfLines={1} style={[styles.headerTitle, { color: theme.ink }]}>{company.company.companyName}</Text>
            <Text numberOfLines={1} style={[styles.headerMeta, { color: theme.muted }]}>
              {source ? `From ${source}` : 'Market details'}
            </Text>
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
          contentContainerStyle={[styles.scrollContent, { paddingBottom: action ? 118 : Spacing.five }]}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl colors={[theme.proof]} onRefresh={refreshCompany} refreshing={isRefreshing} tintColor={theme.proof} />}
          showsVerticalScrollIndicator={false}>
          <View style={styles.identityBlock}>
            <View style={styles.identityRow}>
              <CompanyLogo companyName={company.company.companyName} logoUrl={company.company.logoUrl} size={50} />
              <View style={styles.identityCopy}>
                <Text style={[styles.identityKicker, { color: theme.muted }]}>{contextLabel}</Text>
                <Text accessibilityRole="header" style={[styles.companyName, { color: theme.ink }]}>{company.company.companyName}</Text>
              </View>
              <View accessibilityLabel="Public read-only market details" style={[styles.readState, { borderColor: theme.outline }]}>
                <View style={[styles.readStateDot, { backgroundColor: theme.proof }]} />
                <Text style={[styles.readStateText, { color: theme.muted }]}>Read only</Text>
              </View>
            </View>

            <View
              accessible
              accessibilityLabel={company.hero
                ? `${company.company.companyName}, ${company.hero.value.label}, ${formatMoney(company.hero.value.amount)}, ${productLabels[company.hero.productType]}, provided by ${company.hero.provider}, ${dataStateLabel(company.hero.value.dataState)}`
                : `${company.company.companyName}, value not provided`}
              style={styles.heroBlock}>
              <Text style={[styles.heroLabel, { color: theme.muted }]}>{company.hero?.value.label ?? 'Value not provided'}</Text>
              <Text adjustsFontSizeToFit minimumFontScale={0.7} numberOfLines={1} style={[styles.heroValue, { color: theme.ink }]}>
                {formatMoney(company.hero?.value.amount ?? null)}
              </Text>
              {heroInstrument?.productType === 'spot' && heroInstrument.changePercent.value !== null ? (
                <Text style={[styles.heroMovement, { color: movementColor(heroInstrument.changePercent.value, theme) }]}>
                  {formatPercent(heroInstrument.changePercent.value)} over 1 day
                </Text>
              ) : null}
              {company.hero ? (
                <View style={[styles.provenanceRail, { borderColor: theme.outline }]}>
                  <Text style={[styles.provenanceStrong, { color: theme.ink }]}>{productLabels[company.hero.productType]}</Text>
                  <Text style={[styles.provenanceText, { color: theme.muted }]}>{company.hero.provider}</Text>
                  <Text style={[styles.provenanceText, { color: theme.muted }]}>{dataStateLabel(company.hero.value.dataState)}</Text>
                  {company.hero.value.asOf ? <Text style={[styles.provenanceText, { color: theme.muted }]}>{formatAge(company.hero.value.asOf)}</Text> : null}
                </View>
              ) : null}
              <View style={[styles.marketAvailability, { borderTopColor: theme.outline }]}>
                <Text style={[styles.marketAvailabilityStrong, { color: theme.ink }]}>
                  {company.availableNow} {company.availableNow === 1 ? 'Solana market' : 'Solana markets'} available
                </Text>
                <Text style={[styles.marketAvailabilityMeta, { color: theme.muted }]}>Product availability is independent of US market hours</Text>
              </View>
            </View>
          </View>

          {coreWarning ? <InlineNotice message={coreWarning.message} tone="caution" /> : null}
          {saveError || savedRepositoryError ? <InlineNotice message={saveError ?? savedRepositoryError!} tone="caution" /> : null}

          <HistorySection
            capability={company.history}
            canRetry={historyCanRetry}
            error={historyError}
            history={history}
            isLoading={isHistoryLoading}
            onRetry={retryHistory}
            onSelectRange={selectRange}
            range={range}
          />

          <View accessibilityRole="tablist" style={[styles.tabs, { borderBottomColor: theme.outline, borderTopColor: theme.outline }]}>
            {(Object.keys(tabLabels) as DetailsTab[]).map((tab) => (
              <Pressable
                key={tab}
                accessibilityRole="tab"
                accessibilityState={{ selected: activeTab === tab }}
                onPress={() => setActiveTab(tab)}
                style={styles.tab}>
                <Text style={[styles.tabText, { color: activeTab === tab ? theme.ink : theme.muted }]}>{tabLabels[tab]}</Text>
                {activeTab === tab ? <View style={[styles.tabRule, { backgroundColor: theme.proof }]} /> : null}
              </Pressable>
            ))}
          </View>

          {activeTab === 'overview' ? (
            <OverviewTab
              company={company}
              entryInstrumentId={entryInstrumentId}
              expandedInstrumentId={expandedInstrumentId}
              onToggleInstrument={(instrumentId) => setExpandedInstrumentId((current) => current === instrumentId ? undefined : instrumentId)}
            />
          ) : null}
          {activeTab === 'market-data' ? <MarketDataTab company={company} /> : null}
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

        {action ? <ActionDock action={action} company={company} /> : null}
      </SafeAreaView>

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
  const theme = useTheme();
  if (!capability) {
    return (
      <View style={[styles.historyUnavailable, { borderBottomColor: theme.outline, borderTopColor: theme.outline }]}>
        <Text style={[styles.historyUnavailableTitle, { color: theme.ink }]}>No matching history</Text>
        <Text style={[styles.historyUnavailableBody, { color: theme.muted }]}>No real chart matches the value shown above.</Text>
      </View>
    );
  }

  const hasPoints = Boolean(history?.points.length);
  return (
    <View style={[styles.historySection, { borderTopColor: theme.outline }]}>
      <View style={styles.historyHeading}>
        <Text style={[styles.sectionEyebrow, { color: theme.muted }]}>{capability.valueLabel} history</Text>
        <Text style={[styles.historySource, { color: theme.muted }]}>{capability.source}</Text>
      </View>
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
              { backgroundColor: range === item ? theme.proofWash : 'transparent', borderColor: range === item ? theme.proof : 'transparent' },
              pressed && styles.pressed,
            ]}>
            <Text style={[styles.rangeText, { color: range === item ? theme.proof : theme.muted }]}>{item.toUpperCase()}</Text>
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
  const height = 210;
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
          {[0.25, 0.5, 0.75].map((ratio) => (
            <Line key={ratio} stroke={theme.outline} strokeOpacity={0.35} strokeWidth={StyleSheet.hairlineWidth} x1="0" x2={width} y1={height * ratio} y2={height * ratio} />
          ))}
          <Path d={path} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} />
        </Svg>
      ) : null}
      <View style={styles.chartLegend}>
        <Text style={[styles.chartLegendValue, { color }]}>{formatPercent(movement)} in range</Text>
        <Text style={[styles.chartLegendMeta, { color: theme.muted }]}>{history.points.length} real candles · {history.interval}</Text>
      </View>
    </View>
  );
}

function OverviewTab({
  company,
  entryInstrumentId,
  expandedInstrumentId,
  onToggleInstrument,
}: {
  company: MarketCompanyResponse;
  entryInstrumentId?: string;
  expandedInstrumentId?: string;
  onToggleInstrument: (instrumentId: string) => void;
}) {
  const theme = useTheme();
  const heroInstrument = company.primaryInstrumentId
    ? company.instruments.find((instrument) => instrument.instrumentId === company.primaryInstrumentId)
    : undefined;
  const facts = heroInstrument ? overviewFacts(heroInstrument) : [];
  return (
    <View style={styles.tabPanel}>
      {facts.length ? (
        <Section title="Snapshot">
          <View style={[styles.factGrid, { borderColor: theme.outline }]}>
            {facts.map((fact) => <FactCell key={fact.label} label={fact.label} value={fact.value} />)}
          </View>
        </Section>
      ) : null}

      <Section meta={`${company.instruments.length} known`} title="Available markets">
        <View style={[styles.instrumentList, { borderColor: theme.outline }]}>
          {company.instruments.map((instrument, index) => (
            <InstrumentDisclosure
              entryFocused={instrument.instrumentId === entryInstrumentId}
              expanded={instrument.instrumentId === expandedInstrumentId}
              instrument={instrument}
              isLast={index === company.instruments.length - 1}
              key={instrument.instrumentId}
              onPress={() => onToggleInstrument(instrument.instrumentId)}
            />
          ))}
        </View>
      </Section>

      {company.company.description ? (
        <Section meta={company.company.description.source} title="About">
          <Text style={[styles.description, { color: theme.muted }]}>{company.company.description.text}</Text>
        </Section>
      ) : null}
    </View>
  );
}

function InstrumentDisclosure({
  entryFocused,
  expanded,
  instrument,
  isLast,
  onPress,
}: {
  entryFocused: boolean;
  expanded: boolean;
  instrument: MarketInstrument;
  isLast: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const facts = instrumentFacts(instrument).slice(0, 4);
  return (
    <View style={{ borderBottomColor: theme.outline, borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth }}>
      <Pressable
        accessibilityHint={expanded ? 'Collapses instrument facts' : 'Expands instrument facts'}
        accessibilityLabel={`${instrument.symbol}, ${productLabels[instrument.productType]}, ${instrument.marketValue.label} ${formatMoney(instrument.marketValue.amount)}, ${availabilityLabel(instrument.availability)}, provided by ${instrument.provider}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onPress}
        style={({ pressed }) => [styles.instrumentRow, (pressed || entryFocused) && { backgroundColor: theme.proofWash }]}>
        <View style={[styles.productMark, { backgroundColor: theme.proofWash }]}>
          <Text style={[styles.productMarkText, { color: theme.proof }]}>{productShort(instrument.productType)}</Text>
        </View>
        <View style={styles.instrumentCopy}>
          <View style={styles.instrumentTitleLine}>
            <Text style={[styles.instrumentSymbol, { color: theme.ink }]}>{instrument.symbol}</Text>
            {entryFocused ? <Text style={[styles.originLabel, { color: theme.proof }]}>Opened from here</Text> : null}
          </View>
          <Text numberOfLines={1} style={[styles.instrumentProvider, { color: theme.muted }]}>{productLabels[instrument.productType]} · {instrument.provider}</Text>
        </View>
        <View style={styles.instrumentValue}>
          <Text style={[styles.instrumentPrice, { color: theme.ink }]}>{formatMoney(instrument.marketValue.amount)}</Text>
          <Text style={[styles.instrumentAvailability, { color: instrument.availability === 'available' ? theme.proof : theme.muted }]}>{availabilityLabel(instrument.availability)}</Text>
        </View>
      </Pressable>
      {expanded ? (
        <View style={[styles.instrumentFacts, { backgroundColor: theme.canvas }]}>
          {facts.map((fact) => <CompactFact key={fact.label} label={fact.label} value={fact.value} />)}
        </View>
      ) : null}
    </View>
  );
}

function MarketDataTab({ company }: { company: MarketCompanyResponse }) {
  return (
    <View style={styles.tabPanel}>
      {company.instruments.map((instrument) => <InstrumentDataCard instrument={instrument} key={instrument.instrumentId} />)}
    </View>
  );
}

function InstrumentDataCard({ instrument }: { instrument: MarketInstrument }) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const copyIdentifier = async () => {
    await Clipboard.setStringAsync(instrument.exactIdentifier);
    setCopied(true);
    setTimeout(() => setCopied(false), 1_800);
  };
  return (
    <Section meta={availabilityLabel(instrument.availability)} title={`${instrument.symbol} · ${productLabels[instrument.productType]}`}>
      <View style={[styles.dataCard, { borderColor: theme.outline }]}>
        {instrumentFacts(instrument).map((fact, index) => (
          <View key={fact.label} style={[styles.dataRow, index > 0 && { borderTopColor: theme.outline, borderTopWidth: StyleSheet.hairlineWidth }]}>
            <Text style={[styles.dataLabel, { color: theme.muted }]}>{fact.label}</Text>
            <Text selectable style={[styles.dataValue, { color: theme.ink }]}>{fact.value}</Text>
          </View>
        ))}
        <View style={[styles.dataRow, { borderTopColor: theme.outline, borderTopWidth: StyleSheet.hairlineWidth }]}>
          <Text style={[styles.dataLabel, { color: theme.muted }]}>Exact identifier</Text>
          <View style={styles.identifierLine}>
            <Text numberOfLines={1} selectable style={[styles.identifierValue, { color: theme.ink }]}>{instrument.exactIdentifier}</Text>
            <IconButton icon="copy" label={`Copy ${instrument.symbol} identifier`} onPress={() => void copyIdentifier()} />
          </View>
        </View>
        {copied ? <Text accessibilityLiveRegion="polite" style={[styles.copiedText, { color: theme.proof }]}>Identifier copied</Text> : null}
      </View>
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
    <View style={styles.factCell}>
      <Text style={[styles.factLabel, { color: theme.muted }]}>{label}</Text>
      <Text style={[styles.factValue, { color: theme.ink }]}>{value}</Text>
    </View>
  );
}

function CompactFact({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.compactFact}>
      <Text style={[styles.compactFactLabel, { color: theme.muted }]}>{label}</Text>
      <Text style={[styles.compactFactValue, { color: theme.ink }]}>{value}</Text>
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

function ActionDock({ action, company }: { action: PrimaryAction; company: MarketCompanyResponse }) {
  const theme = useTheme();
  const router = useRouter();
  if (action.kind === 'offering') {
    return (
      <SafeAreaView edges={['bottom']} style={[styles.actionDock, { backgroundColor: theme.canvas, borderTopColor: theme.outline }]}>
        <Pressable
          accessibilityHint="Opens the provider offering in an in-app browser"
          accessibilityRole="button"
          onPress={() => void openBrowserAsync(action.url)}
          style={({ pressed }) => [styles.primaryAction, { backgroundColor: theme.proof }, pressed && styles.pressed]}>
          <Text style={[styles.primaryActionText, { color: theme.onProof }]}>View offering</Text>
          <Text style={[styles.primaryActionArrow, { color: theme.onProof }]}>↗</Text>
        </Pressable>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView edges={['bottom']} style={[styles.actionDock, { backgroundColor: theme.canvas, borderTopColor: theme.outline }]}>
      <Pressable
        accessibilityLabel={`Trade ${company.company.companyName}`}
        accessibilityRole="button"
        onPress={() => router.push({
          pathname: '/trade/[assetId]',
          params: {
            assetId: company.company.assetId,
            product: action.product,
            instrumentId: action.instrumentId,
          },
        } as unknown as Href)}
        style={({ pressed }) => [styles.primaryAction, { backgroundColor: theme.proof }, pressed && styles.pressed]}>
        <Text style={[styles.primaryActionText, { color: theme.onProof }]}>Trade {company.company.companyName}</Text>
        <Text style={[styles.primaryActionArrow, { color: theme.onProof }]}>→</Text>
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

function primaryAction(company: MarketCompanyResponse, entryProduct?: MarketProduct, entryInstrumentId?: string): PrimaryAction | undefined {
  const available = company.instruments.filter((instrument) => instrument.availability === 'available');
  const executableMarkets = available.filter((instrument) =>
    (instrument.productType === 'spot' || instrument.productType === 'perpetual')
    && instrument.verificationState === 'verified',
  );
  const executable = executableMarkets.find((instrument) => instrument.instrumentId === entryInstrumentId)
    ?? executableMarkets.find((instrument) => instrument.productType === entryProduct)
    ?? executableMarkets.find((instrument) => instrument.productType === 'spot')
    ?? executableMarkets.find((instrument) => instrument.productType === 'perpetual');
  if (executable?.productType === 'spot' || executable?.productType === 'perpetual') {
    return { kind: 'trade', product: executable.productType, instrumentId: executable.instrumentId };
  }
  const offering = available.find((instrument) => instrument.productType === 'prestock');
  if (offering?.productType === 'prestock') {
    const url = offering.detailsUrl ?? offering.providerUrl;
    if (url) return { kind: 'offering', url };
  }
  return undefined;
}

function overviewFacts(instrument: MarketInstrument) {
  if (instrument.productType === 'spot') return compact([
    { label: '1-day change', value: instrument.changePercent.value === null ? undefined : formatPercent(instrument.changePercent.value) },
    { label: '24h token volume', value: formatCompactMoney(instrument.volume24hUsd.value) },
    { label: 'Token liquidity', value: formatCompactMoney(instrument.liquidityUsd) },
    { label: 'Redeemability', value: redeemabilityLabel(instrument.stockVariantTier) },
  ]);
  if (instrument.productType === 'prestock') return compact([
    { label: 'Structure', value: instrument.exposureType === 'spv_exposure' ? 'SPV exposure' : 'Loan participation' },
    { label: 'Provider mark', value: formatMoney(instrument.markPrice) },
    { label: 'Implied valuation', value: formatCompactMoney(instrument.impliedValuation) },
    { label: 'Supply', value: formatCompactNumber(instrument.supply) },
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

function productShort(product: MarketProduct) {
  return product === 'spot' ? 'SPT' : product === 'prestock' ? 'PRE' : 'PERP';
}

function titleCase(value: string) {
  return value.replace(/_/g, ' ').replace(/^./, (character) => character.toUpperCase());
}

function initials(companyName: string) {
  const parts = companyName.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : companyName.slice(0, 2)).toUpperCase();
}

function movementColor(value: number, theme: ReturnType<typeof useTheme>) {
  return value < 0 ? theme.caution : theme.proof;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safeArea: { flex: 1 },
  header: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 58, paddingHorizontal: 8, paddingVertical: 5 },
  headerContext: { flex: 1, minWidth: 0, paddingHorizontal: 5 },
  headerTitle: { fontFamily: Fonts.serif, fontSize: 15, fontWeight: '700', lineHeight: 18 },
  headerMeta: { fontFamily: Fonts.mono, fontSize: 7, marginTop: 3, textTransform: 'uppercase' },
  headerActions: { flexDirection: 'row', minWidth: 88 },
  iconButton: { alignItems: 'center', borderRadius: Radii.control, height: 44, justifyContent: 'center', width: 44 },
  disabled: { opacity: 0.42 },
  scrollContent: { paddingBottom: Spacing.five },
  identityBlock: { paddingHorizontal: 18, paddingTop: 18 },
  identityRow: { alignItems: 'center', flexDirection: 'row', gap: 11 },
  logo: { alignItems: 'center', borderRadius: 13, borderWidth: 1, justifyContent: 'center', overflow: 'hidden' },
  logoText: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '800' },
  identityCopy: { flex: 1, minWidth: 0 },
  identityKicker: { fontFamily: Fonts.mono, fontSize: 8, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
  companyName: { fontFamily: Fonts.serif, fontSize: 26, fontWeight: '700', letterSpacing: -0.7, lineHeight: 30, marginTop: 4 },
  readState: { alignItems: 'center', borderRadius: Radii.pill, borderWidth: 1, flexDirection: 'row', gap: 6, minHeight: 34, paddingHorizontal: 10 },
  readStateDot: { borderRadius: 3, height: 6, width: 6 },
  readStateText: { fontFamily: Fonts.mono, fontSize: 8, fontWeight: '700', textTransform: 'uppercase' },
  heroBlock: { marginTop: 23 },
  heroLabel: { fontFamily: Fonts.mono, fontSize: 9, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase' },
  heroValue: { fontFamily: Fonts.mono, fontSize: 38, fontWeight: '700', letterSpacing: -1.4, lineHeight: 44, marginTop: 6 },
  heroMovement: { fontFamily: Fonts.mono, fontSize: 12, fontWeight: '700', marginTop: 5 },
  provenanceRail: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 17, minHeight: 38, paddingVertical: 9 },
  provenanceStrong: { fontFamily: Fonts.sans, fontSize: 10, fontWeight: '700' },
  provenanceText: { fontFamily: Fonts.mono, fontSize: 8 },
  marketAvailability: { alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12, justifyContent: 'space-between', paddingVertical: 12 },
  marketAvailabilityStrong: { flexShrink: 1, fontFamily: Fonts.sans, fontSize: 10, fontWeight: '700' },
  marketAvailabilityMeta: { flex: 1, fontFamily: Fonts.mono, fontSize: 7, lineHeight: 11, textAlign: 'right' },
  notice: { borderLeftWidth: 2, marginHorizontal: 18, marginTop: 12, paddingHorizontal: 11, paddingVertical: 9 },
  noticeText: { fontFamily: Fonts.sans, fontSize: 10, lineHeight: 15 },
  historySection: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 18, paddingTop: 13 },
  historyHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18 },
  sectionEyebrow: { fontFamily: Fonts.mono, fontSize: 8, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase' },
  historySource: { fontFamily: Fonts.mono, fontSize: 8 },
  chartFrame: { height: 248, marginTop: 4, position: 'relative' },
  chart: { flex: 1, paddingTop: 7 },
  chartLegend: { alignItems: 'center', bottom: 1, flexDirection: 'row', justifyContent: 'space-between', left: 18, position: 'absolute', right: 18 },
  chartLegendValue: { fontFamily: Fonts.mono, fontSize: 9, fontWeight: '700' },
  chartLegendMeta: { fontFamily: Fonts.mono, fontSize: 7 },
  chartMessage: { alignItems: 'center', flex: 1, gap: 9, justifyContent: 'center', paddingHorizontal: 30 },
  chartMessageTitle: { fontFamily: Fonts.sans, fontSize: 12, fontWeight: '700' },
  chartMessageText: { fontFamily: Fonts.sans, fontSize: 10, lineHeight: 15, textAlign: 'center' },
  chartRefreshing: { position: 'absolute', right: 18, top: 12 },
  rangeContent: { gap: 3, paddingHorizontal: 14 },
  rangeButton: { alignItems: 'center', borderRadius: 8, borderWidth: 1, justifyContent: 'center', minHeight: 44, minWidth: 45, paddingHorizontal: 10 },
  rangeText: { fontFamily: Fonts.mono, fontSize: 9, fontWeight: '700' },
  historyUnavailable: { borderBottomWidth: StyleSheet.hairlineWidth, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 18, paddingHorizontal: 18, paddingVertical: 19 },
  historyUnavailableTitle: { fontFamily: Fonts.sans, fontSize: 12, fontWeight: '700' },
  historyUnavailableBody: { fontFamily: Fonts.sans, fontSize: 10, lineHeight: 15, marginTop: 5 },
  tabs: { borderBottomWidth: StyleSheet.hairlineWidth, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', marginTop: 18, paddingHorizontal: 8 },
  tab: { alignItems: 'center', flex: 1, justifyContent: 'center', minHeight: 52, position: 'relative' },
  tabText: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '700' },
  tabRule: { bottom: -1, height: 2, left: 9, position: 'absolute', right: 9 },
  tabPanel: { paddingHorizontal: 18, paddingTop: 2 },
  section: { marginTop: 23 },
  sectionHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { fontFamily: Fonts.serif, fontSize: 20, fontWeight: '700', letterSpacing: -0.4 },
  sectionMeta: { fontFamily: Fonts.mono, fontSize: 8, textTransform: 'uppercase' },
  factGrid: { borderRadius: Radii.card, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', overflow: 'hidden', padding: 5 },
  factCell: { minHeight: 72, padding: 10, width: '50%' },
  factLabel: { fontFamily: Fonts.mono, fontSize: 8, textTransform: 'uppercase' },
  factValue: { fontFamily: Fonts.mono, fontSize: 13, fontWeight: '700', lineHeight: 17, marginTop: 8 },
  instrumentList: { borderRadius: Radii.card, borderWidth: 1, overflow: 'hidden' },
  instrumentRow: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 72, paddingHorizontal: 10, paddingVertical: 9 },
  productMark: { alignItems: 'center', borderRadius: 9, height: 38, justifyContent: 'center', width: 42 },
  productMarkText: { fontFamily: Fonts.mono, fontSize: 7, fontWeight: '800' },
  instrumentCopy: { flex: 1, minWidth: 0 },
  instrumentTitleLine: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  instrumentSymbol: { fontFamily: Fonts.mono, fontSize: 11, fontWeight: '800' },
  originLabel: { fontFamily: Fonts.mono, fontSize: 6.5, fontWeight: '700', textTransform: 'uppercase' },
  instrumentProvider: { fontFamily: Fonts.sans, fontSize: 9, marginTop: 5 },
  instrumentValue: { alignItems: 'flex-end', maxWidth: 100 },
  instrumentPrice: { fontFamily: Fonts.mono, fontSize: 10, fontWeight: '700' },
  instrumentAvailability: { fontFamily: Fonts.mono, fontSize: 7, fontWeight: '700', marginTop: 5, textTransform: 'uppercase' },
  instrumentFacts: { flexDirection: 'row', flexWrap: 'wrap', padding: 7 },
  compactFact: { padding: 7, width: '50%' },
  compactFactLabel: { fontFamily: Fonts.mono, fontSize: 7, textTransform: 'uppercase' },
  compactFactValue: { fontFamily: Fonts.sans, fontSize: 9, fontWeight: '600', lineHeight: 13, marginTop: 4 },
  description: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 21 },
  dataCard: { borderRadius: Radii.card, borderWidth: 1, overflow: 'hidden' },
  dataRow: { gap: 7, paddingHorizontal: 11, paddingVertical: 11 },
  dataLabel: { fontFamily: Fonts.mono, fontSize: 7.5, textTransform: 'uppercase' },
  dataValue: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '600', lineHeight: 16 },
  identifierLine: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  identifierValue: { flex: 1, fontFamily: Fonts.mono, fontSize: 8 },
  copiedText: { fontFamily: Fonts.mono, fontSize: 8, fontWeight: '700', paddingBottom: 10, paddingHorizontal: 11, textTransform: 'uppercase' },
  newsList: { borderRadius: Radii.card, borderWidth: 1, overflow: 'hidden' },
  newsRow: { flexDirection: 'row', gap: 11, minHeight: 108, padding: 10 },
  newsImage: { alignItems: 'center', aspectRatio: 1, borderRadius: 9, justifyContent: 'center', overflow: 'hidden', width: 86 },
  newsImageFallback: { fontFamily: Fonts.serif, fontSize: 18, fontWeight: '700' },
  newsCopy: { flex: 1, justifyContent: 'center', minWidth: 0 },
  newsMeta: { fontFamily: Fonts.mono, fontSize: 7.5, fontWeight: '700', textTransform: 'uppercase' },
  newsHeadline: { fontFamily: Fonts.serif, fontSize: 15, fontWeight: '700', lineHeight: 20, marginTop: 7 },
  sectionMessage: { alignItems: 'center', gap: 10, justifyContent: 'center', minHeight: 230, paddingHorizontal: 34 },
  sectionMessageText: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 17, textAlign: 'center' },
  retryNotice: { alignItems: 'center', borderRadius: Radii.control, borderWidth: 1, gap: 10, margin: Spacing.three, padding: 13 },
  retryNoticeText: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 17, textAlign: 'center' },
  sectionRetryButton: { alignItems: 'center', borderRadius: Radii.control, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 16 },
  sectionRetryText: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '700' },
  actionDock: { borderTopWidth: StyleSheet.hairlineWidth, bottom: 0, left: 0, paddingHorizontal: 14, paddingTop: 9, position: 'absolute', right: 0 },
  primaryAction: { alignItems: 'center', borderRadius: Radii.card, flexDirection: 'row', justifyContent: 'space-between', minHeight: 56, paddingHorizontal: 17 },
  primaryActionText: { fontFamily: Fonts.sans, fontSize: 15, fontWeight: '800' },
  primaryActionArrow: { fontFamily: Fonts.sans, fontSize: 18 },
  disabledAction: { alignItems: 'center', borderRadius: Radii.card, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 58, paddingHorizontal: 15 },
  disabledActionTitle: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '800' },
  disabledActionMeta: { fontFamily: Fonts.sans, fontSize: 8, marginTop: 4 },
  disabledActionState: { fontFamily: Fonts.mono, fontSize: 8, fontWeight: '700', textTransform: 'uppercase' },
  loadingBody: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center' },
  loadingText: { fontFamily: Fonts.sans, fontSize: 11 },
  skeletonLine: { borderRadius: 4, height: 11, width: 116 },
  failureBody: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingHorizontal: 34 },
  failureTitle: { fontFamily: Fonts.serif, fontSize: 26, fontWeight: '700' },
  failureMessage: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 19, marginTop: 10, textAlign: 'center' },
  retryButton: { alignItems: 'center', borderRadius: Radii.control, borderWidth: 1, justifyContent: 'center', marginTop: 18, minHeight: 44, paddingHorizontal: 18 },
  retryText: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '700' },
  pressed: { opacity: 0.74 },
});
