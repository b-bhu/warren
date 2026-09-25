# PRD: Market Details and Trade Preview

| Field | Value |
| --- | --- |
| Status | Gate A complete; Gate B ready for manual QA; execution handoffs specified |
| Parent | [Milestone 1: Discover and Buy a Tokenized Stock](../../../milestone/milestone-one.md) |
| Product surface | Warren mobile app, company Market Details route |
| Parent discovery surface | [Markets Instrument Registry](./markets_prd.md) |
| Experience reference | [`markets_details_mock.html`](../../../../markets_details_mock.html) |
| Existing backend foundation | [Markets API](../api/markets_api.md) |
| Market Details backend handoff | [Market Details API](../api/market_details_api.md) |
| Manual QA handoff | [Market Details manual QA](../qa/market_details_manual_qa.md) |
| Design foundation | [Phase 0 theme and design direction](../../theme-design/phase-zero.md) |
| Frontend acceptance owner | User/manual QA |
| Last updated | 2026-09-21 |

## 1. Summary

Market Details is Warren's company-first destination for understanding one company and
the stock-related Solana instruments Warren knows beneath it. A person opens one
canonical company, sees a truthful primary value, inspects available Spot, PreStock, and
Perpetual instruments, reads company-related news when available, and can begin an
appropriate trade or offering journey without first authenticating.

The screen does not pretend that all instruments are the same. A token market price, a
private-company provider value, and a perpetual mark price remain independently labelled
facts. The screen may select one deterministic value for the hero, but it never blends
prices or relabels one product's value as another.

This PRD also defines the interaction boundary from `Trade` through an order preview.
It does not authorize wallet signatures, transaction construction, transaction
broadcasting, perpetual position management, or PreStock execution. Those require
separate execution PRDs and API handoffs.

## 2. Approved decisions

- The route is company-first and uses the canonical Markets `assetId`.
- Product selection is not a dominant control on the details screen.
- Spot versus Perpetual selection lives inside the trade ticket.
- A generic Home entry defaults the ticket to Spot when a verified Spot instrument is
  available.
- A product-specific Markets entry preserves that product as the ticket default.
- Guests may inspect details and configure a preview without connecting a wallet.
- Wallet connection occurs only after the person selects `Review` and enters the later
  execution journey.
- Charts render only from real, instrument-matched historical data. No production chart
  uses mock or generated points.
- Tokens.xyz Spot data is the preferred hero value when an eligible Spot instrument is
  present.
- A PreStock-only or Perpetual-only company uses that provider's labelled value rather
  than inventing an underlying stock price.
- PreStock uses `View offering`, not the Spot/Perpetual ticket.
- Guest saves persist locally by `assetId`; authenticated synchronization is later.
- Spot's flexible asset picker represents Jupiter-supported Solana assets. The target
  stock token remains fixed when buying, and the source stock token remains fixed when
  selling.
- The user is the manual frontend QA owner. Automated rendering is not a substitute for
  the user's visual and interaction acceptance.

## 3. Problem

Markets can already answer which instruments exist, but it cannot yet provide a coherent
company destination. Opening a registry row must not lead directly into a provider-
specific transaction or force the user to understand mints, venues, leverage, and
private-market structures before understanding the company.

There is also a price-truth problem. The same company may have:

- a tokenized Spot market value;
- an underlying equity reference that is not executable;
- a PreStock token or mark value;
- a private-company implied valuation; and
- a Perpetual mark or oracle/index value.

Showing any of those as one unqualified “stock price” would be misleading. Market
Details must preserve a simple company-first experience without erasing product meaning.

## 4. Outcome

A guest can:

- open the same canonical company from Home, search, Spot, PreStocks, or Perpetuals;
- identify the company and the source and meaning of the hero value;
- view a real chart only when matching history exists;
- inspect every intentionally exposed instrument for that company;
- understand which products are available, preview, paused, or unavailable;
- read related market news when the provider establishes a real company association;
- save or unsave the company locally;
- open a Spot or Perpetual preview with the correct product preselected;
- choose the flexible Spot swap asset without changing the stock instrument;
- understand the essential risk of a proposed Perpetual position; and
- reach `Review` without a wallet prompt, signature, or transaction.

## 5. Goals

- Make one company the stable parent of all supported instruments.
- Explain what a person can do with the company on Solana without turning the details
  screen into an order form.
- Keep hero values, charts, instrument facts, and previews source-aligned.
- Let a guest learn and configure before authentication.
- Make Spot and Perpetual previews product-specific rather than forcing them through one
  generic Buy/Sell form.
- Provide clear handoffs to later Spot execution, Perpetual execution, and PreStock
  offering flows.
- Reuse the Markets registry contract instead of adding provider logic to the client.
- Remain truthful when history, news, a quote, a wallet balance, or a product is absent.

## 6. Non-goals

- Signing or broadcasting a Solana transaction.
- Building a Jupiter swap transaction.
- Opening, modifying, reducing, or closing a Phoenix position.
- Depositing collateral into a venue or creating a venue account.
- Executing a PreStock purchase or implying guaranteed eligibility.
- Portfolio balances, open-position monitoring, realized/unrealized PnL, or history.
- Take-profit and stop-loss execution.
- Lending, borrowing, yield, alerts, or recommendations.
- A general crypto asset-detail screen.
- Fabricating candles, fundamentals, 52-week ranges, technical indicators, company
  events, balances, route results, liquidation values, or news associations.

## 7. Product boundary

| Concern | Owning surface/document |
| --- | --- |
| Discover notable companies and general market context | Home |
| Browse exact Spot, PreStock, and Perpetual registry records | Markets |
| Understand one company and its supported instruments | This PRD |
| Configure an informational Spot/Perpetual preview through `Review` | This PRD |
| Build, sign, submit, and recover a Spot swap | [Spot Execution PRD](./spot_execution_prd.md) |
| Open a Perpetual position | [Perpetual Execution PRD](./perpetual_execution_prd.md) |
| Monitor, modify, reduce, or close a Perpetual position | Future Portfolio/Position Management PRD |
| Determine eligibility and execute a private-company offering | Future PreStock Execution PRD |
| View owned assets and positions | Future Portfolio/Profile PRD |

The HTML mock communicates the intended hierarchy and interaction language. It is not a
data contract, proof of provider support, or authority to ship sample balances or
client-calculated financial estimates.

## 8. Users and jobs

### Guest researching a familiar company

> I want one understandable NVIDIA page before deciding whether any token or derivative
> is relevant to me.

### Spot buyer

> I want to choose which Solana asset I pay with, understand the estimated stock token I
> receive, and review the route before connecting my wallet.

### Spot seller

> I want NVDAx to remain the thing I am selling while I choose which supported Solana
> asset I receive.

### Perpetual trader

> I want to understand direction, collateral, leverage, notional exposure, funding, and
> liquidation risk before reviewing an order.

### PreStock researcher

> I want the offering structure and provider facts without being sent into an unrelated
> Spot or Perpetual form.

## 9. Route and entry context

The canonical route uses the backend-supplied `assetId`. The client must not generate an
ID from the company name or ticker.

The navigation payload may also carry optional context:

- `product`: `spot`, `prestock`, or `perpetual`;
- `instrumentId`: a known instrument from the originating row; and
- `source`: `home`, `markets`, or `search` for state restoration and analytics.

Context affects initial focus but never removes the company's other instruments.

| Entry | Required initial behavior |
| --- | --- |
| Home company/search result | Open company Overview; Trade defaults to eligible Spot, then Perpetual. |
| Markets Spot row | Open company Overview with the originating Spot instrument emphasized; Trade defaults to Spot. |
| Markets Perpetual row | Open company Overview with the originating Perpetual instrument emphasized; Trade defaults to Perpetual. |
| Markets PreStock row | Open company Overview with the originating offering emphasized; primary action is `View offering`. |
| Saved company | Open company Overview using the normal product priority. |

Back navigation restores the originating screen's selected product/mode, query when
appropriate, vertical scroll, and horizontal page state.

## 10. Information hierarchy

Market Details renders:

1. Compact back header, company context, Share, and Save.
2. Company identity, ticker/private-company state, and market state when applicable.
3. Hero value with exact value label, provider, and freshness/state.
4. Real historical chart and supported ranges when available.
5. Overview, Market data, and News tabs.
6. Overview snapshot using only known product facts.
7. Available-market summaries for Spot, PreStock, and Perpetual instruments.
8. Company description when a verified source supplies it.
9. Persistent bottom action appropriate to the company's capabilities.

The screen does not place a Spot/Perpetual selector above the chart. Product choice
happens in the trade ticket.

## 11. Company identity and hero value

The header shows:

- logo or deterministic fallback;
- company name;
- public ticker when one exists;
- private-company language instead of a fabricated ticker; and
- applicable underlying-market status without claiming that a Solana product shares
  the same hours.

The backend chooses one deterministic `primaryInstrumentId`. Hero priority is:

1. verified, available Spot instrument selected by Warren's safe primary-variant rules;
2. verified PreStock instrument with a provider-supplied value;
3. verified Perpetual instrument with a mark value; then
4. the first preview/paused instrument with a known value.

Unavailable or missing values are skipped. The hero retains the chosen instrument's
exact label, currency, provider, `asOf`, and `dataState`.

Examples of truthful labels include `Token price`, `Provider token value`, `Mark value`,
and `Perpetual mark price`. The client may use `Reference price` only when the backend
actually supplies a separately verified underlying reference. The current Markets
contract does not establish one.

Changing the originating context does not silently replace the hero with another
instrument unless the backend explicitly returns a context-specific primary selection.

## 12. Historical chart

- A chart appears only when the backend supplies real, validated history for the hero's
  exact instrument/value type.
- Chart and hero must share instrument, provider/value semantics, and currency.
- The client never derives candles from current price, interpolates missing periods, or
  ships mock points in production.
- Only ranges backed by the provider are rendered. Unsupported ranges are absent, not
  disabled decoration.
- Changing range preserves the latest safe series while loading and does not flash an
  empty canvas.
- An empty or failed history response leaves the hero visible and omits the chart with a
  concise `History unavailable` state.
- Chart failure cannot make the whole company route fail.
- The initial Market Details release may ship without charts until a real history source
  is verified.

## 13. Overview

Overview uses facts already attached to the company's instruments. It does not create a
generic fundamental-data panel.

Possible Spot facts:

- signed 1-day change;
- 24-hour token volume;
- token liquidity;
- issuer and redeemability tier; and
- network and mint identity.

Possible PreStock facts:

- exposure structure;
- provider token/mark value;
- provider and mark valuations;
- supply and known transfer fee; and
- provider details handoff.

Possible Perpetual facts:

- mark value;
- funding rate and next funding time;
- open interest;
- maximum leverage and margin mode; and
- venue, market key, and oracle/index label.

Unknown facts are omitted. Zero is displayed only when the provider supplied a real
zero. The screen never fills gaps with `0`, `N/A` grids, or sample fundamentals.

## 14. Available markets

- Render every intentionally exposed instrument returned for the company.
- Keep distinct instruments distinct even when symbols look similar.
- Each summary states product type, symbol, provider/venue, value label, availability,
  and the most useful product-specific fact.
- Availability and freshness remain separate.
- Available Spot and Perpetual instruments may contribute to the single `Trade` entry.
- Preview, paused, and unavailable instruments are inspectable but cannot create an
  enabled Review action.
- PreStock instruments use offering language and never appear inside the Spot/Perpetual
  selector.
- If the company has no currently actionable market, the bottom action is absent and an
  honest informational state replaces it.

## 15. Market data

Market data exposes exact instrument identity and provider facts in a scan-friendly
list. It may include:

- instrument symbol and product type;
- issuer/provider or venue;
- network or market key;
- mint/exact identifier with copy support;
- value type, amount, source time, and data state;
- verification and availability state; and
- product-specific fields from Section 13.

Provider URLs open only through a clear external handoff. Raw provider payloads, API
keys, internal trust rules, and executable transaction data never reach this tab.

## 16. News

- News is optional and cannot block company details.
- An article appears only when the provider or Warren's normalized mapping establishes a
  company/ticker association.
- A title keyword alone is insufficient for an irreversible association unless the
  backend's documented mapping explicitly supports it.
- Each item includes headline, source, publication time, image when valid, and safe URL.
- Tapping an item opens the same read-only bottom-sheet pattern established on Home.
- The bottom sheet can hand off to the source; it never starts a trade.
- No qualifying articles produces a calm empty state, not generic market news.

## 17. Save behavior

- Save is available to a guest.
- The local record contains stable `assetId` and saved timestamp, not a duplicated
  company or price snapshot.
- Saving and unsaving update immediately and work offline.
- Local save failure restores the previous state and explains that the change was not
  stored.
- Signing in does not silently discard local saves. Account merge/sync requires a later
  conflict policy and is outside this PRD.
- Saving never requests a wallet signature.

## 18. Primary action rules

| Company capability | Bottom action |
| --- | --- |
| Available Spot and/or Perpetual | `Trade [Company]` |
| Available PreStock only | `View offering` |
| Preview/paused products only | No enabled financial action; show truthful status. |
| No actionable products | No action dock. |

`Trade` opens the ticket without authentication. The ticket contains `Spot` and
`Perpetual` only when the company has those products. If exactly one is eligible, that
product is selected without rendering a meaningless two-option switch.

`Review` is enabled only when the configured preview is valid and provider-backed. It is
the boundary of this PRD. Selecting it hands the preview to the later authentication and
execution journey; this PRD does not connect a wallet or submit anything.

Production must not ship a clickable Trade/Review control that merely shows a “Later”
toast. If provider preview support is not ready, the action is absent or explicitly
unavailable.

## 19. Spot preview

### 19.1 Direction

- `Buy` fixes the supported stock token as the receive asset and lets the person choose
  the pay asset.
- `Sell` fixes the supported stock token as the pay asset and lets the person choose the
  receive asset.
- Direction changes preserve independently entered Buy and Sell amounts.
- The company instrument cannot be replaced with an arbitrary stock token inside the
  ticket.

### 19.2 Asset picker

- The picker is sourced from the current Jupiter-supported Solana token catalogue or an
  equivalent backend-curated subset, never a hard-coded production list.
- Search matches symbol, name, and verified mint.
- Results show symbol, name, logo/fallback, wallet balance when a wallet is available,
  and a verified-mint distinction where needed.
- Duplicate symbols remain distinguishable by verified identity and mint.
- Unsafe, unverified, blocked, or unsupported assets do not appear as normal choices.
- Selecting a different flexible asset preserves the order's approximate USD intent
  when a trustworthy conversion value exists; otherwise the entered amount is cleared
  with an explicit explanation.
- The picker supports loading, search-empty, catalogue-unavailable, and token-image
  failure states.

### 19.3 Quote preview

- The backend, not the mobile client, obtains and validates the Jupiter quote.
- The request uses exact mints and integer base-unit amounts.
- The preview states input/output amounts, route, price impact, slippage, minimum
  received, network fee estimate when known, quote time, and expiry.
- Expired quotes cannot be reviewed and refresh without erasing user intent.
- Informational Markets values are never used to calculate executable receive amounts.
- The client does not calculate minimum received or claim a route from a static price.
- When no route exists, explain that the selected asset cannot currently reach this
  stock token and keep the picker available.
- Guest previews may omit balances. The UI never displays a fabricated balance.
- Percentage/Max shortcuts appear only when a real connected-wallet balance is known.

## 20. Perpetual preview

- The product uses `Long` and `Short`, not Buy and Sell.
- Always-visible inputs are direction, order type, collateral amount, and leverage.
- Market and Limit are supported only when verified by the venue integration.
- Limit price appears only for a Limit order.
- Leverage uses deterministic presets within the instrument's provider maximum; the
  default is conservative and no greater than 2×.
- The preview shows position notional, estimated entry, funding effect, and liquidation
  risk when the venue supplies or authoritatively supports those estimates.
- Positive funding is described directionally (`You pay` or `You receive`) rather than
  as an unexplained signed percentage alone.
- A liquidation value is never calculated with a generic client-side formula in
  production. If a venue-backed estimate is unavailable, omit it and prevent Review
  when the missing estimate makes the preview unsafe.
- High leverage receives a textual warning and cannot depend on caution color alone.
- Take-profit/stop-loss configuration, margin deposits, account creation, and position
  management are later execution scope.

## 21. Guest and authentication boundary

- Opening details, changing tabs, saving locally, choosing a product, entering an
  amount, selecting a Spot asset, and requesting a safe preview do not require sign-in.
- The ticket never invents a wallet balance for a guest.
- Balance percentage and Max controls are hidden or disabled until a wallet balance is
  actually available.
- Selecting `Review` begins the later authentication/wallet flow when required.
- Returning from authentication restores the still-valid preview or requests a fresh
  one without changing direction, product, amount, selected asset, order type, or
  leverage.
- Cancelling authentication returns to the configured ticket without a transaction.

## 22. Interaction contract

| Element | Interaction | Required result |
| --- | --- | --- |
| Back | Tap/back gesture | Return to origin and restore its state. |
| Share | Tap | Open native share with a stable company route; no price is encoded as permanent truth. |
| Save | Tap | Persist/remove local `assetId` without authentication. |
| Chart range | Tap | Request/render only supported real history for the same hero instrument. |
| Overview/Market data/News | Tap/swipe when supported | Switch content without refetching unchanged company identity. |
| Instrument summary | Tap | Expand or focus exact read-only instrument facts. |
| Trade | Tap | Open eligible Spot/Perpetual preview with entry context preserved. |
| View offering | Tap | Open read-only PreStock offering details/handoff. |
| Spot asset control | Tap | Open picker for only the flexible side of the swap. |
| Buy/Sell | Tap | Change which side is fixed while preserving separate user intent. |
| Long/Short | Tap | Change direction and refresh all direction-dependent risk copy. |
| Review | Tap | Hand a current valid preview to later auth/execution; no transaction here. |
| Close ticket | Tap/back gesture | Return to details with no financial or account change. |

## 23. Screen states

### Loading

- Show stable identity skeletons without sample values.
- Load company/instruments before optional history and news.

### Ready

- Show the selected hero value and every safe instrument.
- Optional sections may continue loading independently.

### Partial data

- Preserve healthy instruments when history, news, or one provider fails.
- Show bounded retry within the failed optional section.

### Company unavailable

- A contract-shaped 404 produces a recoverable `Company not found` route with Back to
  Markets.
- Registry outage with no safe cache produces a retryable full-route state.

### No history

- Keep hero and details; omit chart or show concise history-unavailable copy.

### No news

- Show a company-specific empty state without filling the tab with unrelated stories.

### Preview loading and expiry

- Keep entered intent visible while a quote/preview loads.
- Disable Review while loading or expired.
- Refresh expiry without resetting the form.

### No route or unsafe preview

- Explain the exact blocking reason.
- Keep editable fields and picker available.
- Never replace provider failure with sample output.

## 24. Accessibility and responsive behavior

- All controls meet the platform minimum 44-by-44-point target.
- Tabs, direction controls, product controls, save state, and asset selection expose
  selected/pressed semantics.
- Price movement, product availability, Long/Short direction, and risk never rely on
  color alone.
- Company, hero value, and instrument accessible labels include exact value type and
  product.
- The asset picker has dialog semantics, traps focus where applicable, closes with
  platform back/Escape, and restores focus to its trigger.
- Dynamic type may expand rows and move trailing values below labels; text cannot clip.
- The native decimal keyboard is used for amount entry. The app does not implement a
  custom numeric keypad in this slice.
- The amount, selected asset, and primary action remain reachable when the keyboard is
  open.
- Screen-reader announcements cover preview loading, updated receive amount, validation,
  expiry, and retry results without announcing every market-data refresh.
- Motion respects Reduce Motion.
- Warren semantic tokens meet WCAG 2.1 AA on the supported dark-mode baseline.

## 25. Performance and reliability

- Company identity and cached instruments should render independently of optional news
  and history.
- The client does not call Tokens.xyz, Jupiter, PreStocks, Tessera, or Phoenix directly.
- Re-entering a recently viewed company uses its safe cache while revalidating.
- Optional provider failures cannot erase healthy company data.
- Quote/preview requests are debounced or explicitly triggered and cancelled when stale.
- An older response cannot overwrite a newer amount, asset, direction, order type, or
  leverage selection.
- Logos and news images are bounded and cannot shift core layout.
- Raw provider failures and credentials never reach UI copy or logs.

## 26. Analytics

Permitted events include:

- `market_details_viewed`
- `market_details_tab_changed`
- `market_details_saved`
- `market_details_unsaved`
- `market_details_instrument_opened`
- `market_details_trade_opened`
- `trade_preview_product_changed`
- `trade_preview_direction_changed`
- `trade_preview_asset_changed`
- `trade_preview_requested`
- `trade_preview_ready`
- `trade_preview_failed`
- `trade_review_selected`
- `prestock_offering_viewed`

Events may include stable `assetId`, `instrumentId`, product, provider, availability,
data state, range, and non-sensitive failure code. They must not include raw wallet
addresses, balances, entered financial amounts, quote payloads, or search histories tied
to an identity.

## 27. Backend contract and required deltas

### 27.1 Existing foundation

`GET /v1/markets/companies/:assetId` already returns canonical company identity,
`availableNow`, distinct product instruments, and provider warnings. Market Details must
reuse this contract and its runtime-validated product union.

### 27.2 Company-detail delta

Before frontend handoff, the Warren contract must also define:

- deterministic `primaryInstrumentId` or equivalent backend-owned hero selection;
- optional company description with source;
- optional company-associated normalized news;
- optional history capabilities/series tied to exact `instrumentId` and value type; and
- section-level warnings so news/history failure does not invalidate instruments.

The exact endpoint shape may extend the existing company response or add separately
cacheable company news/history reads. It must be documented before client implementation.

### 27.3 Trade-preview boundary

Spot and Perpetual preview contracts are separate from the read-only registry even when
their UI begins on Market Details.

The backend handoff must define, before preview implementation:

- exact request identifiers and integer amount units;
- permitted guest access and rate limits;
- normalized Spot asset catalogue and quote response;
- normalized Perpetual preview and venue-risk response;
- quote/preview expiry and refresh semantics;
- safe provider error codes; and
- proof that provider transaction payloads or secrets are not exposed prematurely.

Wallet connection, transaction building, signing, submission, confirmation, recovery,
and position lifecycle remain outside these preview contracts.

## 28. Delivery gates

### Gate A — Market Details read model

Backend completes and documents hero selection, company detail, optional news/history
semantics, caching, partial failure, and runtime validation. The user can inspect terminal
responses for NVIDIA, a PreStock-only/private company, a Perpetual-only company when one
exists, unknown asset ID, optional-section failure, and registry outage.

### Gate B — Market Details client

The mobile app implements company identity, truthful hero value, conditional chart,
tabs, instruments, news, local Save, entry-context restoration, and correct primary
action. The user performs manual client QA.

### Gate C — Trade preview

After separate Spot and Perpetual preview API handoffs are accepted, the app implements
the product-specific ticket through Review. Gate C cannot use the mock's sample balances,
static quote math, or generic liquidation formula.

Gate B may ship before Gate C. In that case, production does not render an enabled Trade
button until an eligible preview handoff exists.

## 29. Backend acceptance criteria

Gate A is complete only when:

- [x] Company detail remains public, read-only, runtime-validated, and keyed by canonical
      `assetId`.
- [x] The backend selects one deterministic primary instrument without blending values.
- [x] Hero value retains exact label, provider, time, currency, and data state.
- [x] Spot, PreStock, and Perpetual-only fixtures prove truthful hero fallback.
- [x] Optional history is exact-instrument history or explicitly unavailable.
- [x] Optional news contains only normalized company-associated articles.
- [x] Optional history/news failure preserves company and instruments.
- [x] Unknown/malformed asset IDs and provider failures return normalized errors.
- [x] Safe cache and ETag behavior are documented and tested.
- [x] No response exposes API keys, raw provider errors, or provider-specific parsing to
      the client.
- [x] Contract and API typechecking and automated tests pass.

Gate C backend preview is complete only when:

- [ ] The Spot asset catalogue comes from current verified Jupiter-compatible data.
- [ ] Spot quote requests use exact mints and integer base units.
- [ ] Spot previews expose validated input/output, route, impact, slippage, minimum,
      expiry, and normalized no-route/error states.
- [ ] Perpetual previews use verified Phoenix market and risk semantics.
- [ ] Perpetual liquidation/risk values are venue-backed or explicitly unavailable.
- [ ] Expired or superseded previews cannot be reviewed.
- [ ] Guest preview rate limits and abuse bounds are documented and tested.
- [ ] Preview endpoints construct or submit no transaction in this PRD.

## 30. Frontend acceptance criteria

Gate B is complete only when the manual tester confirms:

- [ ] Home, Markets search, and every product row open the same company by `assetId`.
- [ ] Back returns to the exact originating product/mode, query, focus, and scroll state.
- [ ] Company name, ticker/private state, logo fallback, and market context are correct.
- [ ] The hero states its exact value type and never uses an unjustified `Reference price`.
- [ ] Spot, PreStock, and Perpetual hero fallback behaves as specified.
- [ ] No chart renders without real matching history; missing history leaves a complete
      usable screen.
- [ ] Overview and Market data use product-specific facts without fake fundamentals.
- [ ] Every returned instrument is inspectable and remains distinct.
- [ ] News contains only associated stories and uses the established bottom sheet.
- [ ] Save works locally for a guest, survives restart, and never prompts for a wallet.
- [ ] Primary action follows Section 18 and does not expose a dead enabled control.
- [ ] Loading, partial, empty, offline, stale, retry, and not-found states preserve all
      safe content.
- [ ] Dynamic type, screen reader, keyboard, 44-point targets, contrast, dark mode, and
      Reduce Motion checks pass on the supported device baseline.
- [ ] The client contains no provider key or raw provider response handling.

Gate C is complete only when the manual tester confirms:

- [ ] Product selection appears inside the ticket, not as the details-screen hero control.
- [ ] Entry context chooses the correct default product.
- [ ] A guest can configure through Review without an early authentication prompt.
- [ ] Spot Buy fixes the stock token as receive; Spot Sell fixes it as pay.
- [ ] The flexible Spot asset picker searches current supported assets and distinguishes
      duplicate/unverified identities safely.
- [ ] No guest sees a fabricated balance or enabled Max shortcut.
- [ ] Receive amount, route, minimum, impact, expiry, and validation come from the current
      backend preview rather than client-side mock math.
- [ ] Long/Short, order type, collateral, leverage, funding effect, notional, and available
      venue-backed risk values update consistently.
- [ ] High leverage and liquidation risk remain understandable without relying on color.
- [ ] Zero, insufficient balance/collateral, no route, stale preview, expired preview,
      unsupported order, and provider failure block Review with actionable copy.
- [ ] Closing the ticket changes no account or financial state.
- [ ] Review hands off the exact current preview and performs no transaction in this PRD.

## 31. Manual QA ownership

The user is the client-side manual tester.

Engineering must:

- provide the exact API/app state needed for each acceptance scenario;
- explain which screen and control changed before requesting a test;
- provide a short scenario checklist rather than running the mobile app as a substitute;
- keep backend typechecks, contract tests, and API tests automated; and
- record manual findings and apply fixes before marking Gate B or Gate C complete.

Automated screenshots, local render checks, simulators, and unit tests may support
development but do not replace the user's manual acceptance.

## 32. Implementation order

1. Finalize the Market Details read contract and backend acceptance examples.
2. Implement and explain Gate A endpoints to the user for terminal testing.
3. Implement the Market Details route and navigation from Home/Markets.
4. Hand Gate B to the user with a focused manual QA checklist.
5. Write and approve the Spot Preview/Execution PRD and backend handoff.
6. Implement Spot preview, then later wallet signing and transaction execution.
7. Write and approve the Perpetual Preview/Execution PRD and lifecycle requirements.
8. Implement Perpetual preview only after venue risk semantics are verified.

## 33. Implementation notes

- Reuse the canonical company and instrument schemas in `@warren/markets-contract`.
- Keep primary-instrument selection on the backend.
- Do not make the client infer provider trust, safe variants, or value meaning.
- Treat [`markets_details_mock.html`](../../../../markets_details_mock.html) as the approved
  hierarchy and interaction reference, not as production data logic.
- Remove every sample balance and calculated quote/risk value when implementing the real
  client unless a safe backend preview supplies it.
- Keep news and history independently cacheable and independently fallible.
- Use the shared Home article bottom sheet rather than creating a second reader pattern.
- Use local storage behind a small saved-company repository so later account sync does
  not leak into screen components.
- Do not begin Gate B until Gate A's exact response and empty/partial states are accepted.
