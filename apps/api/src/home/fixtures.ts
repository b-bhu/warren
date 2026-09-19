import type { CompanySummary, IndexSummary, MarketStatus, NewsSummary } from '@warren/home-contract';

const stocks: Array<[string, string, string, number, number, string]> = [
  ['nvidia', 'NVIDIA', 'NVDA', 220.56, 2.38, 'NVDAx'],
  ['microsoft', 'Microsoft', 'MSFT', 497.53, 0.93, 'MSFTx'],
  ['apple', 'Apple', 'AAPL', 238.15, -0.64, 'AAPLx'],
  ['tesla', 'Tesla', 'TSLA', 426.07, 1.43, 'TSLAx'],
  ['amazon', 'Amazon', 'AMZN', 231.41, 0.51, 'AMZNx'],
  ['meta', 'Meta', 'META', 612.2, -0.37, 'METAx'],
  ['alphabet', 'Alphabet', 'GOOGL', 197.12, 1.06, 'GOOGLx'],
  ['netflix', 'Netflix', 'NFLX', 1193, 0.28, 'NFLXx'],
  ['amd', 'AMD', 'AMD', 165.2, 1.18, 'AMDx'],
  ['oracle', 'Oracle', 'ORCL', 310.1, -0.21, 'ORCLx'],
  ['palantir', 'Palantir', 'PLTR', 170.42, 2.09, 'PLTRx'],
  ['coinbase', 'Coinbase', 'COIN', 337.35, -1.15, 'COINx'],
  ['strategy', 'Strategy', 'MSTR', 345.16, 0.66, 'MSTRx'],
  ['jpmorgan', 'JPMorgan', 'JPM', 310.31, 0.31, 'JPMx'],
  ['visa', 'Visa', 'V', 350.02, -0.18, 'Vx'],
  ['walmart', 'Walmart', 'WMT', 104.03, 0.44, 'WMTx'],
  ['disney', 'Disney', 'DIS', 118.44, -0.52, 'DISx'],
  ['coca-cola', 'Coca-Cola', 'KO', 70.05, 0.15, 'KOx'],
  ['boeing', 'Boeing', 'BA', 220.77, 0.77, 'BAx'],
  ['nike', 'Nike', 'NKE', 72.33, -0.33, 'NKEx'],
  ['starbucks', 'Starbucks', 'SBUX', 86.24, 0.24, 'SBUXx'],
  ['uber', 'Uber', 'UBER', 97.93, 0.93, 'UBERx'],
  ['salesforce', 'Salesforce', 'CRM', 255.48, -0.48, 'CRMx'],
  ['intel', 'Intel', 'INTC', 32.12, 0.12, 'INTCx'],
];

export function fixtureCompanies(now: Date): CompanySummary[] {
  const priceAsOf = now.toISOString();
  return stocks.map(([assetId, companyName, ticker, referencePrice, changePercent, token], index) => ({
    assetId,
    companyName,
    ticker,
    logoUrl: null,
    referencePrice,
    currency: 'USD',
    changePercent,
    changePeriod: '1d',
    priceAsOf,
    priceDataState: 'sample',
    changeAsOf: priceAsOf,
    changeDataState: 'sample',
    earningsAt: index < 6 ? new Date(now.getTime() + (index + 2) * 86_400_000).toISOString() : null,
    instrumentHints: [token],
  }));
}

export function fixtureMarket(now: Date): MarketStatus {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  const weekday = part('weekday');
  const minutes = Number(part('hour')) * 60 + Number(part('minute'));
  const tradingDay = !['Sat', 'Sun'].includes(weekday);
  const session = !tradingDay || minutes < 240 || minutes >= 1_200 ? 'closed' as const
    : minutes < 570 ? 'pre_market' as const
      : minutes < 960 ? 'open' as const
        : 'after_hours' as const;
  const label = session === 'open' ? 'US market open'
    : session === 'pre_market' ? 'US pre-market'
      : session === 'after_hours' ? 'US after hours'
        : 'US market closed';
  return {
    region: 'US',
    session,
    label,
    asOf: now.toISOString(),
    nextOpenAt: null,
    nextCloseAt: null,
    dataState: 'sample',
  };
}

export function fixtureIndices(now: Date): IndexSummary[] {
  const asOf = now.toISOString();
  return [
    ['spx', 'S&P 500', 6644.31, 0.23],
    ['nasdaq', 'Nasdaq', 22473.18, 0.41],
    ['dow', 'Dow', 45812.44, -0.12],
    ['russell', 'Russell', 2407.63, 0.18],
    ['vix', 'VIX', 15.82, -1.24],
  ].map(([id, name, value, changePercent]) => ({
    id: String(id),
    name: String(name),
    value: Number(value),
    changePercent: Number(changePercent),
    period: '1d',
    asOf,
    dataState: 'sample',
  }));
}

export function fixtureNews(now: Date): NewsSummary[] {
  return [
    {
      id: 'sample-chipmakers',
      headline: 'Chipmakers lead a broad technology-sector advance',
      category: 'Technology',
      source: 'Warren market brief',
      publishedAt: new Date(now.getTime() - 18 * 60_000).toISOString(),
      summary: 'A concise look at the companies and market signals behind today\'s move.',
      url: null,
      relatedAssetIds: ['nvidia', 'microsoft'],
      dataState: 'sample',
    },
    {
      id: 'sample-inflation',
      headline: 'What today\'s inflation update means for large-cap stocks',
      category: 'Economy',
      source: 'Warren market brief',
      publishedAt: new Date(now.getTime() - 42 * 60_000).toISOString(),
      summary: 'The numbers, the market response, and what changed since the last reading.',
      url: null,
      relatedAssetIds: [],
      dataState: 'sample',
    },
    {
      id: 'sample-market-hours',
      headline: 'How stock access works outside the opening bell',
      category: 'Market guide',
      source: 'Learn with Warren',
      publishedAt: new Date(now.getTime() - 2 * 3_600_000).toISOString(),
      summary: 'Understand availability, price freshness, and the difference between a quote and a trade.',
      url: null,
      relatedAssetIds: [],
      dataState: 'sample',
    },
  ];
}
