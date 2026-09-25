# Portfolio and Account PRD

## 1. Outcome

Replace the Profile placeholder with Warren's guest-aware Portfolio workspace. A signed-in
user must be able to answer:

1. What do I own or have open now?
2. What needs my attention?
3. What happened across my Warren activity?

The approved interaction and visual reference is `profile_mock.html`. The implementation may
adapt sample values to live responses, but it must preserve the mock's hierarchy, vocabulary,
four signed-in account states, and separation between owned assets, open orders, and perpetual
positions.

## 2. Delivery slices

Each slice is implemented, covered by automated tests, and reviewed against this PRD and the
mock before work moves to the next slice.

1. Portfolio account-state contract and authenticated data sources.
2. In-app Phoenix registration and transaction review.
3. Guest/account shell and sign-in handoff.
4. Signed-in Overview and wallet deposit sheet.
5. Positions and read-only order/position details.
6. Paginated Activity and activity details.
7. Full regression and manual-QA handoff.

## 3. Data authority

| Concern | Authority |
| --- | --- |
| Signed-in identity and owned Solana wallets | Privy |
| SOL and SPL/Token-2022 balances | Helius |
| Supported stock-token identity and market values | Tokens.xyz-backed Warren Markets registry |
| PreStock mint identity and provider values | PreStocks/Tessera-backed Warren Markets registry |
| Perpetual positions, orders, collateral, funding, and risk | Phoenix |
| Warren review/submission/result lifecycle | Warren database |

Unknown tokens, NFTs, arbitrary DeFi activity, and spam are excluded. A wallet token appears as
a Warren holding only when its exact mint matches a verified Spot or PreStock registry record.

## 4. Portfolio accounting rules

- `Net account equity` is priced wallet holdings + supported cash + Phoenix account equity.
- Perpetual notional is never counted as owned value. It is shown separately as `Gross exposure`.
- Unpriced holdings stay visible and are excluded from priced totals.
- SOL is labelled `Network fee balance`; USDC is labelled `Available to trade`.
- Values always include a source timestamp and data state.
- The Today change is returned only when a defensible prior snapshot exists. Otherwise it is
  `null`; the client must not synthesize it.
- Portfolio reads may be partial. Healthy sections remain visible with scoped warnings.

## 5. API surface

All endpoints require a valid Privy bearer token and operate only on Solana wallets linked to
that Privy user.

### `GET /v1/portfolio/overview`

Returns:

- wallet identity and refresh timestamp;
- net equity reconciliation;
- latest actionable/unresolved items;
- a preview of open orders, open positions, and holdings;
- warnings scoped to wallet, pricing, Phoenix, or reconciliation.

### `GET /v1/portfolio/positions`

Returns complete current-state collections:

- Phoenix open orders;
- Phoenix open positions with stable IDs, subaccount identity, side, quantity, entry, mark,
  collateral, notional, unrealized PnL, liquidation and funding when authoritative;
- verified Spot and PreStock holdings, including unpriced holdings.

### `GET /v1/portfolio/activity`

Query parameters:

- `cursor` — opaque continuation token;
- `limit` — 1–50, default 20;
- `kind` — `all|trades|perpetuals|transfers|funding`;
- `status` — `all|pending|confirmed|failed|unknown`;
- `query` — company, ticker, symbol, or transaction reference.

Returns reverse-chronological Warren-recognized events. One Warren user intent appears once even
when its transaction contains multiple token transfers. Cursor pagination must work with hundreds
of events without loading the entire history into the mobile client.

## 6. Durable execution ledger

Execution reviews and their terminal outcomes must survive API restarts. Every record preserves:

- `executionId`, user ID, wallet, product, company/instrument identity, and direction;
- unsigned transaction and provider request data needed for safe idempotent submission;
- review expiry and idempotency key;
- submission state, signature, result copy, and timestamps;
- a safe failure message when submission was attempted but failed.

The client never receives provider credentials or another user's execution record.

## 7. Guest and account states

- The visible tab is `Portfolio`; the route may remain `/profile`. The screen does not repeat a
  `Profile` or `Portfolio` title beneath the Warren header.
- The header uses Warren branding on the left and a `Sign in` or connected-wallet control on the
  right. The word `Guest` is not used as the user label.
- Guest Overview explains what signing in restores and retains device-local saved companies.
- Tapping Positions or Activity while signed out opens sign-in and preserves the requested view.
- Sign-in uses Privy email or Solana wallet only. Warren does not present EVM as a product option.
- Loading, wallet setup, recovery-required, expired-session, and recoverable-service states are
  explicit and never expose raw configuration or provider errors to users.

### 7.1 Signed-in capability states

Wallet funding and Phoenix registration are independent capabilities. The API and client derive
one of these presentation states from authoritative wallet balances and Phoenix account state:

| State | Supported wallet balance | Phoenix account | Primary presentation |
| --- | --- | --- | --- |
| New wallet | Empty | Not initialized | Deposit and Create Phoenix account |
| Spot only | Present | Not initialized | Net equity, holdings, Deposit, and Phoenix onboarding |
| Phoenix only | Empty | Ready | Deposit plus a truthful empty Phoenix positions state |
| Full account | Present | Ready | Reconciled equity, holdings, orders, positions, and activity |

An empty balance, an uninitialized Phoenix account, and a provider failure are never aliases:

- `empty` means the relevant source loaded successfully and returned no supported assets/events;
- `not_initialized` means Phoenix authoritatively reports that the default trader account does not
  exist;
- `unavailable` means the source could not be read and may be retried;
- the client must not render `Unavailable`, retry actions, or warning colors for a confirmed empty
  state.

### 7.2 Deposit and Phoenix onboarding

- `Deposit` opens the Warren wallet bottom sheet. It exposes the active Solana address, Copy
  address, and Show QR without initiating a transaction.
- `Create Phoenix account` stays inside Warren. Warren builds the current Phoenix registration
  transaction, presents an explicit transaction review, requests the existing Privy Solana wallet
  signature, submits it, waits for confirmation, and refreshes Portfolio state.
- For the hackathon, the user's Warren/Privy wallet is the fee payer and pays registration rent and
  network fees. Warren does not hold or use a sponsored payer key.
- A referral code is optional configuration. Without one Warren uses Phoenix's supported
  non-referral registration flow. Adding a code later must not require UI or state-model changes.
- Registration does not deposit collateral, place an order, or open a position. After confirmation,
  Warren explains that collateral is still required before trading.
- `Open Phoenix` is a fallback only when Warren cannot complete the supported in-app integration;
  it is not the normal onboarding path.

## 8. Signed-in Overview acceptance criteria

- Shows net account equity and reconciliation without counting gross perp exposure as equity.
- Shows `Needs attention` only when an actionable or unresolved item exists.
- Clearly separates Open orders, Open positions, and Holdings.
- Shows unpriced holdings truthfully.
- Account/wallet details, Copy address, Show QR, and Deposit are available without dominating the
  investment view.
- Empty, partial, stale, recoverable, and session-expired states have a useful next action.
- Matches the approved capital-routes hierarchy for New wallet and Phoenix-only states.

## 9. Positions acceptance criteria

- Open orders are not counted as positions.
- Spot/PreStock ownership remains separate from Phoenix exposure, even for the same company.
- Position rows show venue-backed values only; unavailable risk values are labelled unavailable.
- Read-only position details are available. Add collateral, reduce, close, and TP/SL remain hidden
  until their complete execution contracts exist.
- A confirmed empty Positions response shows a concise empty state, never unavailable metrics.

## 10. Activity acceptance criteria

- Search, product filters, status filters, and wallet scope operate on server-backed results.
- Results are grouped by Today, Yesterday, calendar date, then older month.
- Pagination does not duplicate or skip Warren ledger events.
- Supported transfers are derived from Helius; Phoenix funding/trades come from Phoenix; Warren
  submissions come from the durable ledger.
- Events include plain-language status plus the available signature/reference. Explorer opening is
  an explicit user action, never an automatic redirect.
- A successful empty response says `No activity yet`. Retry messaging appears only for an actual
  failed or partial provider request.

## 11. Automated verification and reviewer gate

Backend tests must cover authentication, wallet ownership, exact-mint allowlisting, decimal
conversion, unpriced assets, partial provider failures, Phoenix account absence, execution
persistence, idempotency after restart, filtering, cursor boundaries, and user isolation.

Mobile verification is code-level and automated only. It must cover API state mapping, guest and
signed-in navigation, tab selection, empty/error states, activity filtering/pagination, and
important accessibility labels. The user performs final device visual and interaction QA.

After each delivery slice, an independent reviewer agent compares the implementation against this
PRD, `profile_mock.html`, and the relevant tests. Findings are fixed before the slice is accepted.
