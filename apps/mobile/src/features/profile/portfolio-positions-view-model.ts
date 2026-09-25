import type { PortfolioPosition, PortfolioPositionsResponse } from '@warren/portfolio-contract';

export function positionsIsEmpty(response: PortfolioPositionsResponse) {
  return response.openOrders.length === 0
    && response.openPositions.length === 0
    && response.holdings.length === 0;
}

export function fundingSummary(position: PortfolioPosition) {
  if (position.fundingRatePercent === null) return 'Funding rate not provided';
  if (position.fundingRatePercent === 0) return 'No funding · 0.0000%';
  if (position.fundingEffect === null) {
    return `Funding direction not provided · ${signedPercent(position.fundingRatePercent, 4)}`;
  }
  const effect = position.fundingEffect === 'pay' ? 'You pay' : 'You receive';
  return `${effect} ${Math.abs(position.fundingRatePercent).toFixed(4)}%`;
}

export function liquidationSummary(position: PortfolioPosition) {
  const price = position.liquidationPriceUsd === null ? 'Price not provided' : `$${position.liquidationPriceUsd.toLocaleString('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
  const distance = position.liquidationDistancePercent === null
    ? 'distance not provided'
    : `${preservedPercent(position.liquidationDistancePercent, 0)} away`;
  return `${price} · ${distance}`;
}

export function holdingsCountLabel(response: PortfolioPositionsResponse) {
  const unpriced = response.holdings.filter((holding) => (
    !holding.valuationIncluded || holding.marketValueUsd.amount === null
  )).length;
  const noun = response.holdings.length === 1 ? 'holding' : 'holdings';
  if (!unpriced) return `${response.holdings.length} ${noun}`;
  return `${response.holdings.length} ${noun} · ${unpriced} unpriced`;
}

function signedPercent(value: number, digits: number) {
  const sign = value < 0 ? '−' : value > 0 ? '+' : '';
  return `${sign}${Math.abs(value).toFixed(digits)}%`;
}

function preservedPercent(value: number, digits: number) {
  return `${value < 0 ? '−' : ''}${Math.abs(value).toFixed(digits)}%`;
}
