export type MarketInstrument = {
  symbol: string;
  issuer: string;
  network: 'Solana';
  type: 'Tokenized stock';
};

export type MarketStock = {
  ticker: string;
  company: string;
  sector: string;
  description: string;
  price: number;
  changePercent: number;
  chart: readonly number[];
  accent: string;
  instrument: MarketInstrument;
};

/**
 * Controlled catalog data for the guest-discovery slice.
 *
 * Nothing in this fixture is an executable quote. The registry integration will
 * replace these records and is responsible for validating issuer and mint identity.
 */
export const marketStocks: readonly MarketStock[] = [
  {
    ticker: 'NVDA',
    company: 'NVIDIA',
    sector: 'Semiconductors',
    description: 'Computing platforms for accelerated workloads and artificial intelligence.',
    price: 185,
    changePercent: 2.34,
    chart: [42, 45, 43, 48, 51, 50, 56, 55, 61, 64, 63, 69],
    accent: '#7A8D76',
    instrument: {
      symbol: 'NVDAx',
      issuer: 'xStocks',
      network: 'Solana',
      type: 'Tokenized stock',
    },
  },
  {
    ticker: 'MSFT',
    company: 'Microsoft',
    sector: 'Software',
    description: 'Cloud, productivity, and computing products for people and businesses.',
    price: 450,
    changePercent: 0.82,
    chart: [44, 46, 47, 45, 48, 51, 49, 53, 55, 54, 57, 59],
    accent: '#65849A',
    instrument: {
      symbol: 'MSFTx',
      issuer: 'xStocks',
      network: 'Solana',
      type: 'Tokenized stock',
    },
  },
  {
    ticker: 'AAPL',
    company: 'Apple',
    sector: 'Consumer technology',
    description: 'Devices, software, and services built around a connected product ecosystem.',
    price: 225,
    changePercent: -0.64,
    chart: [63, 61, 64, 60, 58, 59, 55, 57, 53, 54, 51, 50],
    accent: '#897E74',
    instrument: {
      symbol: 'AAPLx',
      issuer: 'xStocks',
      network: 'Solana',
      type: 'Tokenized stock',
    },
  },
  {
    ticker: 'TSLA',
    company: 'Tesla',
    sector: 'Automotive',
    description: 'Electric vehicles, energy generation, and energy-storage products.',
    price: 250,
    changePercent: 1.43,
    chart: [38, 43, 41, 46, 44, 49, 53, 50, 57, 55, 61, 63],
    accent: '#9B6C61',
    instrument: {
      symbol: 'TSLAx',
      issuer: 'xStocks',
      network: 'Solana',
      type: 'Tokenized stock',
    },
  },
] as const;

export function findMarketStock(symbol?: string | string[]) {
  const candidate = Array.isArray(symbol) ? symbol[0] : symbol;
  if (!candidate) return undefined;

  const normalized = candidate.trim().toUpperCase();
  return marketStocks.find(
    (stock) =>
      stock.ticker === normalized || stock.instrument.symbol.toUpperCase() === normalized,
  );
}

export function formatUsd(value: number) {
  return `$${value.toFixed(2)}`;
}

export function formatPercent(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}
