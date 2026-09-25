# Warren Portfolio — Design Brief

## Purpose

Turn the current Profile placeholder into Warren's signed-in portfolio workspace while preserving a useful guest state.

The screen must answer three questions quickly:

1. What do I own or have open now?
2. What needs my attention?
3. What happened across my Warren activity?

## Users and primary jobs

- Guests want to keep locally saved companies and understand what signing in restores.
- Spot and PreStock holders want a truthful view of current holdings and valuation coverage.
- Perpetual traders want to monitor current risk and open a position detail without confusing orders with positions.
- Active users need to find one relevant event among hundreds of wallet and venue events.

## Design direction

Use a dense, company-first register rather than a generic finance dashboard. Spot/PreStock ownership and perpetual exposure remain separate factual bands even when they belong to the same company.

- Keep Warren's spruce canvas, paper-white ink, proof cyan, gain sage, risk coral, and private-market amber.
- Use serif only for the screen and section headings, sans for navigation and actions, and mono for financial values.
- Prefer edge-to-edge register rows and hairlines. Use filled surfaces only for selected controls, current risk, or primary actions.
- Keep all production text at 12px or larger and all touch targets at least 44px.

## Product truths

- Visible bottom tab: **Portfolio**. The implementation route may remain `/profile` during migration.
- Secondary views: **Overview · Positions · Activity**.
- `Positions` means all current exposure; inside it, derivatives are **Open positions** and owned Spot/PreStock assets are **Holdings**.
- A placed or submitted limit order is an **Open order**, not an open position.
- Net account equity includes priced wallet assets plus venue equity and subtracts liabilities. It excludes perpetual notional.
- Gross exposure is shown separately from equity.
- Unpriced private-market exposure is disclosed but excluded from the priced total.
- Ordinary funding is context, not automatically an alert.
- Only unresolved or actionable states enter **Needs attention**.

## Current-scope boundary

The existing perpetual execution contract supports opening a position. Add collateral, reduce, close, and TP/SL require a future position-management contract.

The prototype may show these controls only inside a labeled future-concept position detail. The shipping interface must hide them until the complete read, quote, risk, authentication, execution, recovery, and reconciliation paths exist.

## Prototype states

- Guest Overview
- Signed-in Overview
- Signed-in Positions
- Signed-in Activity with search and product filters
- Position detail concept
- Account/wallet, equity reconciliation, activity detail, order detail, receive, and sign-in sheets

## Success criteria

- A user can locate an open NVDA long without reading Activity.
- A user can distinguish holdings, open positions, and open orders.
- Portfolio value never implies that perpetual notional is owned value.
- Activity demonstrates how hundreds of Warren-recognized events will be searched, filtered, grouped, and paginated.
- Wallet/security controls remain available without dominating investment state.
- Guest navigation stays structurally consistent with signed-in Portfolio.
