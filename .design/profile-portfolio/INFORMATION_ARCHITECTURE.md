# Warren Portfolio — Information Architecture

## Navigation model

```text
Home
Markets
Portfolio                           visible tab label
├── Overview
│   ├── Equity reconciliation
│   ├── Order detail
│   ├── Position detail
│   └── Holding / company detail
├── Positions                       all current exposure
│   ├── Open orders                 not counted as positions
│   ├── Open positions              perpetuals and later derivatives
│   ├── Holdings                    Spot and PreStocks
│   └── Earn & borrow               future
└── Activity
    ├── Search and filters
    └── Activity detail → explorer

Header account chip
└── Account & wallet
    ├── Wallet / receive
    ├── Security & recovery
    ├── Privacy & terms
    └── Sign out
```

The existing code route can remain `(tabs)/profile` during migration. Visible navigation and user-facing copy should say **Portfolio**.

## Overview hierarchy

1. Net account equity, daily change, and privacy control
2. Cash, perpetual equity, and gross exposure reconciliation
3. Conditional Needs attention
4. Open orders, only when non-empty
5. Open positions
6. Holdings
7. Latest three to five meaningful Activity records

Needs attention is not a news rail. It is limited to actionable or unresolved states such as elevated/critical risk, stale venue data, a failed risk-reducing action, or a submitted transaction whose final state is unknown.

## Positions hierarchy

The page owns current state, not history.

- **Open orders:** orders placed but not filled. Submitted state never changes equity or position count.
- **Open positions:** each perpetual position keeps a stable `positionId`. Isolated subaccounts are never merged for risk calculations.
- **Holdings:** owned Spot and PreStock assets. Private exposure without a defensible price is labeled unpriced.
- **Earn & borrow:** later product group, added only after it exists.

Multiple exposures may share company identity while retaining product-specific facts and actions.

## Position detail

Current read model should eventually show:

- instrument, venue, direction, leverage, and margin mode
- authoritative state and freshness
- quantity and gross exposure
- entry, mark, unrealized PnL, collateral
- venue-provided liquidation price and distance
- direction-aware funding effect and next funding time
- open orders
- position-scoped Activity sourced from the canonical ledger

Future position-management actions belong here and always require review. Overview never performs a one-tap close.

## Activity ledger

Activity is an append-only, Warren-recognized economic ledger. Chronology remains canonical; unresolved records may also be summarized in Needs attention without moving the source record.

Include:

- Spot buys and sells
- PreStock commitments, settlements, and exits
- perpetual order and position lifecycle events
- collateral and risk-order events when supported
- funding paid or received
- supported-asset transfers
- later earn/borrow lifecycle events
- pending, unknown, failed, and reconciled outcomes

Exclude by default:

- spam or dust tokens
- NFTs
- arbitrary DeFi activity
- raw program-instruction noise
- internal protocol legs that implement one user intent

Scale behavior:

- virtualized rows
- cursor pagination
- Today / Yesterday / calendar-date grouping, then month grouping for old history
- filters for product, action, status, date, and wallet
- search by company, ticker, instrument, and transaction reference
- repetitive funding may collapse into a daily expandable group without losing exact records

One multi-instruction transaction appears as one expandable Warren-intent lifecycle. Position detail queries this same ledger by `positionId`; it does not maintain a second history.

## Required identifiers

- `assetId`
- `instrumentId`
- `positionId`
- `orderId`
- `executionId`
- isolated `subaccountIndex`, when applicable
- Solana signature
- causal/group identifier for one user intent

Only a confirmed fill creates or mutates a position.

## Guest behavior

- Keep the same Portfolio shell and Overview tab.
- Show device-local saved companies without implying ownership or sync.
- Selecting Positions or Activity opens contextual sign-in.
- After sign-in, return to the originally requested Portfolio view.
- Never show fake zero balances or dash-filled portfolio metrics.

## Empty and failure states

- account loading
- signed in with no holdings
- no open orders
- no open perpetuals
- no Activity yet
- no Activity matches current filters
- partial or stale valuation
- venue risk data unavailable
- Activity reconciliation delayed
- submitted/unknown transaction with do-not-resubmit guidance
- session expired with requested destination preserved
- wallet or portfolio service unavailable

## Naming contract

| Concept | User-facing term |
| --- | --- |
| Primary personal finance surface | Portfolio |
| Owned Spot/PreStock exposure | Holdings |
| Leveraged derivative exposure | Open positions |
| Unfilled order | Open order |
| Spendable USDC | Available to trade |
| SOL used for fees | Network fee balance |
| Identity/security surface | Account & wallet |
| Current priced total | Net account equity |
| Absolute derivative notional | Gross exposure |

## Backend gap before implementation

The current perpetual result contract lacks authoritative `positionId`, `orderId`, fill state, filled quantity, isolated subaccount, and lifecycle linkage. A portfolio read model and canonical Activity model are required before the mobile screen can claim current positions or full reconciliation.
