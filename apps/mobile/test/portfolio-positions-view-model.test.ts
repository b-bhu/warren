import assert from 'node:assert/strict';
import test from 'node:test';

import type { PortfolioPosition, PortfolioPositionsResponse } from '@warren/portfolio-contract';

import {
  fundingSummary,
  holdingsCountLabel,
  liquidationSummary,
  positionsIsEmpty,
} from '../src/features/profile/portfolio-positions-view-model.js';

const at = '2026-09-23T10:00:00.000Z';
const unavailableMoney = { amount: null, asOf: null, currency: 'USD' as const, dataState: 'unavailable' as const };

function response(): PortfolioPositionsResponse {
  return {
    generatedAt: at,
    wallet: { address: '11111111111111111111111111111111', displayAddress: '1111…1111', network: 'Solana', supportedAssetState: 'funded' },
    perpetuals: { accountState: 'ready', registration: null },
    summary: { unrealizedPnlUsd: unavailableMoney, grossExposureUsd: unavailableMoney },
    openOrders: [],
    openPositions: [],
    holdings: [],
    cashBalances: [],
    warnings: [],
  };
}

function position(overrides: Partial<PortfolioPosition> = {}): PortfolioPosition {
  return {
    positionId: 'position:1',
    assetId: 'nvda',
    instrumentId: 'perp:nvda',
    companyName: 'NVIDIA',
    ticker: 'NVDA',
    logoUrl: null,
    venue: 'Phoenix',
    marketSymbol: 'NVDA-PERP',
    direction: 'long',
    marginMode: 'isolated',
    traderPdaIndex: 0,
    subaccountIndex: 0,
    quantity: '1.5',
    leverage: 3,
    entryPriceUsd: 180,
    markPriceUsd: 190,
    collateralUsd: 100,
    notionalUsd: 300,
    unrealizedPnlUsd: 10,
    unrealizedPnlPercent: 10,
    liquidationPriceUsd: 125.2,
    liquidationDistancePercent: 34,
    fundingRatePercent: 0.0062,
    fundingEffect: 'pay',
    nextFundingAt: null,
    updatedAt: at,
    dataState: 'live',
    ...overrides,
  };
}

test('orders, positions, and holdings independently make current state non-empty', () => {
  const empty = response();
  assert.equal(positionsIsEmpty(empty), true);
  assert.equal(positionsIsEmpty({ ...empty, openPositions: [position()] }), false);
  assert.equal(positionsIsEmpty({ ...empty, openOrders: [{} as PortfolioPositionsResponse['openOrders'][number]] }), false);
  assert.equal(positionsIsEmpty({ ...empty, holdings: [{} as PortfolioPositionsResponse['holdings'][number]] }), false);
});

test('funding and liquidation use venue direction and preserve missing-data boundaries', () => {
  assert.equal(fundingSummary(position()), 'You pay 0.0062%');
  assert.equal(fundingSummary(position({ fundingEffect: 'receive', fundingRatePercent: -0.004 })), 'You receive 0.0040%');
  assert.equal(fundingSummary(position({ fundingEffect: null, fundingRatePercent: 0 })), 'No funding · 0.0000%');
  assert.equal(fundingSummary(position({ fundingEffect: null, fundingRatePercent: 0.004 })), 'Funding direction not provided · +0.0040%');
  assert.equal(fundingSummary(position({ fundingEffect: null, fundingRatePercent: null })), 'Funding rate not provided');
  assert.equal(liquidationSummary(position()), '$125.20 · 34% away');
  assert.equal(liquidationSummary(position({ liquidationDistancePercent: null })), '$125.20 · distance not provided');
  assert.equal(liquidationSummary(position({ liquidationDistancePercent: -4 })), '$125.20 · −4% away');
  assert.equal(liquidationSummary(position({ liquidationPriceUsd: null })), 'Price not provided · 34% away');
});

test('unpriced holdings remain represented in the holdings count', () => {
  const base = response();
  const holding = { marketValueUsd: unavailableMoney, valuationIncluded: false } as PortfolioPositionsResponse['holdings'][number];
  assert.equal(holdingsCountLabel({ ...base, holdings: [holding] }), '1 holding · 1 unpriced');
  assert.equal(holdingsCountLabel({ ...base, holdings: [{ ...holding, valuationIncluded: true }] }), '1 holding · 1 unpriced');
});
