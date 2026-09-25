# Portfolio mobile manual QA

This checklist is for device testing after the automated Portfolio checks pass. The developer does
not need to run Expo for this phase; the manual tester owns visual and interaction acceptance.

## Before testing

- Run the Warren API with its Privy, Helius, Tokens.xyz, and Phoenix provider configuration.
- Set `EXPO_PUBLIC_API_URL` to an address the device can reach. Do not use `localhost` from a
  physical phone.
- Use the Privy mobile client ID and Warren app identifiers already configured for the build.
- Prepare accounts or deterministic fixtures for all four signed-in states: New wallet, Spot only,
  Phoenix only, and Full account. The Full account should include a supported stock-token holding,
  a Phoenix order or position, and several activity pages.
- Treat displayed provider values as read-only test data. Do not send funds only to populate this
  screen.

## 1. Signed-out Portfolio

1. Open the visible `Portfolio` tab while signed out.
2. Confirm the header says `Sign in`; no user-facing `Guest` or EVM option appears.
3. Confirm companies saved from Home or Markets appear under `Saved on this device`.
4. Confirm the copy says saved companies are local and are not holdings.
5. Tap a saved company and confirm its stock detail opens.
6. Tap `Positions`, back out of sign-in, then repeat for `Activity`.
7. Complete sign-in from each tab and confirm Warren returns to the originally requested tab.

## 2. Sign-in and account control

1. Confirm sign-in offers email and Solana wallet only.
2. Confirm signing in does not imply that a trade was approved.
3. During wallet restoration, confirm private Portfolio data stays hidden behind `Preparing your
   Solana wallet`.
4. When ready, tap the shortened wallet address in the header.
5. Confirm `Warren wallet` shows the active Solana address, Copy address, Show QR, Security &
   recovery, and Sign out.
6. Copy the address and confirm feedback appears once and resets on the next sheet opening.
7. Open Show QR and confirm the full address is selectable/copyable.
8. Sign out and confirm private Portfolio data disappears immediately.

## 3. Overview

1. Confirm there is no duplicate Profile/Portfolio heading below the Warren header.
2. In New wallet, confirm the capital-routes view shows the active Warren wallet, no holdings,
   Deposit, and Create Phoenix account without any unavailable warning.
3. In Spot only, confirm `Net account equity`, holdings, Deposit, and Phoenix onboarding are shown.
4. In Phoenix only, confirm Phoenix says Ready, Spot says no holdings, and Deposit remains the
   primary funding action.
5. In Full account, confirm `Net account equity` is visually primary.
6. Tap Hide/Show and confirm monetary values mask and restore without changing the data.
7. Confirm Today is omitted or explained only when the API lacks authoritative change values; a
   confirmed empty account must not show `Unavailable` values.
8. Confirm Owned stocks, Perps equity, and Cash form the equity composition.
9. Confirm `Gross perp exposure` is visibly separate and says it is not owned value.
10. Open `How it adds up` and reconcile priced holdings + cash + Phoenix equity − liabilities with
   net account equity. Gross exposure must not be added.
11. Confirm `Needs attention` is absent when empty and visible when unresolved items exist.
12. Confirm Open positions, Open orders, and Holdings are separate sections.
13. Confirm an unpriced holding says `Unpriced` and `Excluded from equity`.
14. Pull/tap Refresh with the API reachable, then briefly unreachable. Previously loaded data should
    remain visible with a retry notice after a recoverable refresh failure.
15. Confirm delayed, stale, unavailable, and provider-warning states use explicit text rather than
    fake zeroes or raw error details.

## 4. Phoenix registration

1. From New wallet or Spot only, tap `Create Phoenix account`.
2. Confirm Warren shows an in-app transaction review identifying a one-time Phoenix registration;
   it must not imply collateral deposit or an open trade.
3. Cancel the wallet request and confirm the account remains `Not created` with a safe retry action.
4. Retry, approve with the Privy Solana wallet, and confirm the user wallet pays network fees and
   account rent.
5. Confirm Warren waits for transaction confirmation, refreshes Portfolio, and changes Phoenix to
   `Ready` exactly once.
6. Confirm a repeated setup tap cannot create or submit a duplicate registration transaction.
7. Confirm the non-referral flow works when no referral code is configured.
8. With a valid referral code configured, confirm the UI is unchanged and the supported referral
   activation path is used.
9. Confirm Warren next explains that collateral is required before a perpetual trade.
10. Confirm `Open Phoenix` appears only as a fallback after a genuine integration failure.

## 5. Positions

1. Confirm Current exposure shows Unrealized PnL and Gross exposure separately.
2. Confirm Open orders appear before Open positions and are not included in the position count.
3. Confirm Spot/PreStock holdings remain separate from Phoenix positions for the same company.
4. Open an order. Confirm the detail is read-only and includes side, type, quantity, price, status,
   reduce-only state, subaccount, and update time.
5. Open a position. Confirm the detail is read-only and includes direction, quantity, margin,
   leverage when available, entry, mark, collateral, exposure, PnL, liquidation, funding,
   subaccount, and data state.
6. Confirm missing liquidation price or distance explicitly says unavailable.
7. Confirm a 0% funding rate says `No funding`, while missing rate/effect is labeled unavailable.
8. Confirm no Close, Reduce, Add collateral, Cancel, TP/SL, or other lifecycle action is present.
9. Confirm USDC is `Available to trade` and SOL is `Network fee balance`.
10. For New wallet or a ready-but-empty Phoenix account, confirm the screen shows a concise empty
    state without unavailable PnL, exposure, liquidation, or funding values.

## 6. Activity

1. Confirm the screen scrolls as one list; the search/filter area must not sit inside another
   vertically scrolling Portfolio container.
2. Search by company, ticker, symbol, and a transaction reference. Pause briefly for the debounced
   server query.
3. Test All, Trades, Perpetuals, Transfers, and Funding filters.
4. Test All statuses, Pending, Confirmed, Failed, and Unknown.
5. Confirm the active wallet scope shows the connected wallet, not an invented all-wallet result.
6. Confirm results group as Today, Yesterday, recent calendar date, then older month.
7. Scroll through at least three pages. Confirm no duplicate rows, missing boundary row, frozen
   spinner, or jump back to the top.
8. While an earlier page is loading, pull to refresh. Confirm the old page cannot append afterward
   and the loading footer does not remain stuck.
9. Open event details and confirm status, event/product/kind, quantity/value when available, time,
   wallet, and transaction/execution reference are truthful.
10. Confirm copying a reference stays in-app. `Open transaction in browser` must open only after an
    explicit tap; no event row may redirect automatically.
11. Confirm arbitrary tokens, NFTs, DeFi activity, and raw wallet spam do not appear.
12. For a successful response with zero events, confirm the screen says `No activity yet` and does
    not show Retry or a Phoenix warning.
13. Force an actual activity provider failure and confirm a scoped retry notice appears instead of
    the known-empty state.
14. Open and close both the Status filter and Activity detail sheets repeatedly. Confirm no duplicate
    React key warning appears in Metro.

## 7. Mobile layout and accessibility

1. Test the smallest supported Android device/font setting and one larger phone.
2. Confirm the Portfolio content and all bottom sheets stay above system navigation/gesture areas.
3. Confirm long company names, symbols, values, and wallet addresses do not overlap controls.
4. Confirm every tab, row, close button, filter, account control, and primary action has a usable
   touch target and screen-reader label.
5. Confirm status is communicated with text, not color alone.
6. Confirm the keyboard does not cover Activity search results or prevent dismissal.

## Reporting a finding

Include the screen/tab, signed-in state, active filters, device/OS, exact taps, expected result,
actual result, screenshot, and whether retrying or refreshing changes the outcome.
