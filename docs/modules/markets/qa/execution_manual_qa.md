# Manual QA: Spot and Perpetual Execution

This is the physical-device handoff for the user/manual QA owner. Use a wallet and funds
you are prepared to move on Solana mainnet. Start with the smallest provider-supported
amount.

## Before testing

- Run Warren API with valid Privy server credentials, Tokens.xyz credentials, a Jupiter
  API key, and a Solana mainnet RPC URL.
- Set mobile `EXPO_PUBLIC_API_URL` to an address the phone can reach; `localhost` on a
  physical phone points to the phone, not the development computer.
- Confirm the signed-in Privy user has an embedded Solana wallet.
- Perpetual execution additionally needs an activated, funded Phoenix trader account.
  Account activation and collateral deposit are intentionally outside this screen.

## Entry and guest continuity

1. Open any company with an available Spot or Perpetual instrument.
2. Tap `Trade {company}` and confirm the correct product/instrument is preselected.
3. As a guest, configure amount, direction, asset or Perpetual controls.
4. Tap the primary action. Sign-in must say it does not approve the trade.
5. Finish sign-in. Confirm Warren returns to the same saved ticket and still requires an
   explicit `Review` tap. No wallet approval should have appeared yet.

## Spot

1. Test Buy and Sell.
2. Open the flexible asset picker, search by symbol and mint, and choose another asset.
3. Confirm the stock side never becomes editable.
4. Request review and compare input, output, minimum output, route, fees, wallet, and
   expiry with the ticket.
5. Tap Edit; confirm the old executable review is discarded.
6. Request a new review, approve exactly one Privy transaction, and inspect the result
   plus Solscan link.
7. Repeat once but reject the wallet prompt. Warren must say nothing was submitted.

## Perpetual

1. Test Long/Short, Market/Limit, leverage, collateral, and limit price validation.
2. With an unprepared Phoenix account, confirm an explicit account/collateral/restriction
   state appears without a transaction.
3. With a funded account, request review and verify mark price, notional, quantity,
   funding, isolated margin, and liquidation estimate.
4. Approve once. Warren should show `submitted`, not claim final confirmation.
5. Reject once and confirm Warren returns to review with no submission claim.

## UI feedback targets

Check safe-area spacing, keyboard behavior, long company/asset names, loading states,
small-screen scrolling, light/dark contrast, readable amounts, and whether the review
ledger feels trustworthy. Record the company, product, direction, device, and exact
screen state with each UI note.

## Boundary-value analysis

The primary action must describe the next valid action. It must not say `Sign in to
review` until every required ticket field is locally valid. Invalid configuration must
never open authentication or request a provider review.

### BVA-01: Spot exact-input amount

**Priority:** P0
**Preconditions:** Guest session, verified Spot instrument, USDC selected (6 decimals).

| Input | Boundary represented | Expected result |
| --- | --- | --- |
| Empty | Missing required value | CTA disabled: `Enter an amount`; no error card and no sign-in |
| `0` / `0.000000` | Zero | CTA disabled: `Enter an amount`; inline greater-than-zero message |
| `0.000001` | Smallest positive USDC base unit | CTA enabled: `Sign in to review` |
| `0.0000001` | One decimal beyond asset precision | CTA disabled: `Check amount`; precision message |
| `1.` / `.1` / `1..2` | Incomplete or malformed decimal | CTA disabled: `Check amount`; value is not silently rewritten |
| `-1` / `abc` | Negative or non-numeric paste | CTA disabled: `Check amount`; value is not converted into a positive trade |
| `000000.000001` | Leading zeroes around minimum | Accepted as one base unit |
| 74-digit integer | Maximum 80-digit USDC base-unit value | Locally valid; provider may still apply its own size/liquidity limits |
| 75-digit integer | 81-digit USDC base-unit value | CTA disabled: `Check amount`; `This amount is too large.` |

Repeat after selecting a settlement asset with a different decimals value. The minimum
positive value and over-precision boundary must move with that asset. For Sell, use the
stock token's decimals. While stock metadata is loading, the CTA must say `Preparing
stock asset…` and remain disabled.

### BVA-02: Asset and direction transitions

**Priority:** P0
**Preconditions:** Guest Spot ticket.

1. Enter a valid Buy amount, then choose a different payment asset.
   **Expected:** Buy amount clears because its unit changed; CTA returns to `Enter an amount`.
2. Enter separate Buy and Sell values, then switch direction repeatedly.
   **Expected:** Each direction restores only its own value; no USDC amount becomes a stock-token amount.
3. Select a non-USDC Jupiter asset, start sign-in, then return.
   **Expected:** CTA stays disabled as `Restoring asset…` until metadata resolves. Failure says `Choose another asset`; Warren never silently substitutes USDC.

### BVA-03: Perpetual collateral and limit price

**Priority:** P0
**Preconditions:** Verified Phoenix Perpetual instrument.

| Field/input | Expected result |
| --- | --- |
| Collateral empty, `0`, or `0.000000` | CTA disabled: `Enter an amount` |
| Collateral `0.000001` | Smallest locally valid USDC collateral; CTA can advance |
| Collateral `0.0000001` | CTA disabled: `Check amount` |
| Market order with an old Limit value | Limit value is ignored; only collateral is required |
| Limit order with empty or zero price | CTA disabled: `Enter limit price` |
| Limit price `0.01` | Locally valid; provider remains authoritative |
| Malformed, negative, or 81-character Limit value | CTA disabled: `Check limit price`; no sign-in |

### BVA-04: Leverage and action-state boundaries

**Priority:** P1

- A restored leverage below `1×` falls back to the safe default.
- A restored leverage above the market maximum is clamped to that maximum for display,
  authentication return, and order creation.
- No visible preset exceeds the market maximum; `1×`, `2×`, and `3×` appear when supported.
- Empty/invalid tickets never advertise sign-in. A valid guest ticket says `Sign in to
  review`; a valid authenticated ticket says `Review buy/sell/long/short`.
- While the embedded wallet is initializing, CTA says `Preparing wallet…` and is disabled.
- On an unsupported runtime, CTA says `Trading unavailable` and is disabled.
