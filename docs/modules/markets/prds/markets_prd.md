# PRD: Markets Instrument Registry

| Field | Value |
| --- | --- |
| Status | Gate A complete; Gate B implemented and awaiting manual QA |
| Parent | [Milestone 1: Discover and Buy a Tokenized Stock](../../../milestone/milestone-one.md) |
| Product surface | Warren mobile app, Markets tab |
| Information architecture | [Markets information architecture](../../../../.design/markets/INFORMATION_ARCHITECTURE.md) |
| Experience reference | [`markets_mock.html`](../../../../markets_mock.html) |
| Backend handoff | [Markets API](../api/markets_api.md) |
| Manual QA | [Markets client checklist](../qa/markets_manual_qa.md) |
| Design foundation | [Phase 0 theme and design direction](../../theme-design/phase-zero.md) |
| Last updated | 2026-09-20 |

## 1. Summary

Markets is Warren's guest-first registry of stock-related products available or planned
through Warren. It lets a person browse **Spot**, **PreStocks**, and **Perpetuals**, then
inspect exactly which product, provider, instrument, and availability state sits beneath
a familiar company.

This is deliberately different from Home. Home is a concise market overview with
curated companies and news. Markets is the fuller, denser answer to “what can I access?”
and “what exactly is it?” It contains no indices, news carousel, earnings mode, or
promotional quick actions.

The Markets slice in this PRD is read-only. It does not request a quote, connect a
wallet, authenticate a user, open a leveraged position, or submit a transaction.

## 2. Decision summary

- Keep **Markets** as the second primary tab for Milestone 1.
- Do not replace it with **Earn** while lending and borrowing are future concepts.
- Make Spot, PreStocks, and Perpetuals first-class product families inside Markets.
- Default to Spot and do not create a mixed “All products” list.
- Search globally across product families and return one result per company.
- Group every known company capability in a `Markets for [Company]` inspection sheet.
- Keep product availability distinct from data freshness.
- Treat every company, instrument, provider, and product shown in the current mock as
  illustrative until its backend source and identity have been verified.

## 3. Problem

Home and the current Markets placeholder both present searchable company lists. If that
continues, users cannot tell why both tabs exist and the product has nowhere coherent to
explain multiple instruments for the same company.

Tokenized-stock discovery also has a truth problem. A public share reference price, a
token's executable market price, a private-company exposure value, and a perpetual mark
price are different facts. Combining them in one generic stock table would make Warren
look simpler while making the product less trustworthy.

Markets must create a stable registry that keeps the familiar company at the top while
accurately separating product type, provider, instrument identity, availability, and
market-data meaning.

## 4. Outcome

A guest can open Markets and, without signing in:

- browse the complete Warren-supported registry by product family;
- search by company, public ticker, or known instrument symbol;
- see which product families Warren knows for one company;
- distinguish spot ownership exposure, private-company exposure, and a perpetual
  derivative;
- understand whether a product is available, only a preview, paused, or unavailable;
- understand whether displayed market data is live, delayed, stale, sample, or absent;
- inspect the provider, network/venue, and exact instrument identity; and
- leave the screen without having initiated any financial or account action.

## 5. Goals

- Give Markets a clear job that does not duplicate Home.
- Keep discovery company-first while making the exact instrument inspectable.
- Support Spot, PreStocks, and Perpetuals without implying they are equivalent products.
- Normalize multiple providers and venues behind Warren-owned contracts.
- Communicate product and data truth before visual excitement or trading controls.
- Remain useful to a guest and avoid premature authentication.
- Scale to more companies, instruments, and providers without restructuring navigation.
- Establish the data boundary later company-detail and execution work can consume.

## 6. Non-goals

- Rebuilding Home's curated company grid, market indices, earnings view, or news.
- Adding a general crypto-token browser or arbitrary mint-address search.
- Requesting executable quotes or using reference values as order terms.
- Buying or selling spot instruments.
- Opening, closing, or configuring perpetual positions.
- Trading PreStocks.
- Wallet connection, funding, authentication, signatures, or transactions.
- Portfolio balances, position management, lending, borrowing, or yield comparison.
- Personalized recommendations, “hot” products, or investment advice.
- Claiming complete provider coverage before the relevant integrations are verified.

Milestone 1 may later route a verified Spot instrument from this registry into the
separately specified buy journey. That transaction flow is not authorized by this PRD.

## 7. Users and jobs

### Guest who knows the company

> I want to find NVIDIA or NVDA and see every stock-related way Warren supports it.

### Guest comparing product types

> I want to understand whether I am looking at a tokenized spot instrument, private-
> company exposure, or a perpetual contract before I go further.

### Detail-oriented investor

> I want to inspect the issuer/provider, network or venue, exact identifier, price
> meaning, freshness, and availability rather than trust a generic “verified” label.

### Active trader

> I want a dense, product-specific list that exposes the fields relevant to perpetuals
> without turning the screen into an order ticket.

## 8. Product boundary

| Question | Owning surface |
| --- | --- |
| What is happening in the market? | Home |
| Which familiar companies should I notice? | Home's curated board |
| What stock-related products can I access? | Markets |
| What exactly is this instrument? | Markets and instrument detail |
| What can I do with this one company? | Company capability sheet/detail |
| What do I own? | Future Portfolio/Profile scope |
| What can I lend or borrow? | Future Earn scope |

The Milestone 1 primary tabs remain Home, Markets, and Profile. A future Earn surface
requires a separate PRD, live protocols, eligibility rules, rate semantics, collateral
risk, and position context.

## 9. Information hierarchy

Markets renders these sections in order:

1. Compact Warren header with guest state.
2. `Markets` title and one-line registry purpose.
3. Full-width global search.
4. Sticky Spot, PreStocks, and Perpetuals selector with truthful counts.
5. Dense instrument registry rows.
6. Registry coverage/disclosure.
7. Persistent Home, Markets, and Profile navigation.

The search, product selector, and first rows are the visual focus. The screen must not
add hero statistics, decorative charts, gradients, “Trending”, or “Hot” treatments.

## 10. Interaction contract

| Element | Interaction | Required result |
| --- | --- | --- |
| Warren brand | Tap | Scroll Markets to the top. |
| Guest indicator | None in this slice | Show guest state without opening authentication. |
| Search field | Focus and type | Search companies and instruments across all product families. |
| Search clear | Tap | Clear the query, keep focus, and restore the prior registry state. |
| Search result | Tap | Open `Markets for [Company]` with all known capabilities. |
| Product selector | Tap or keyboard activation | Switch the registry to exactly one product family. |
| Registry row | Tap | Open `Markets for [Company]` focused on the selected product. |
| Available capability | Tap | Open its read-only detail destination when implemented. |
| Preview/paused capability | Tap | Show its truthful informational detail; do not start an action. |
| Later capability | None | Render as static content without enabled button semantics. |
| Sheet backdrop/close | Tap or Escape/back gesture | Close the sheet and restore focus to its trigger. |
| Home/Profile tab | Tap | Navigate to that primary tab. |

Closing a sheet or returning from detail preserves product family, query when
appropriate, and list scroll position.

## 11. Global search

- Search accepts company name, public ticker, and known instrument symbol.
- Matching is case-insensitive and ignores surrounding whitespace.
- Search uses Warren's normalized cached registry; it does not call providers for every
  keystroke.
- Results are grouped by canonical `assetId`, so one company appears once.
- Each result shows company identity and compact capability labels such as `Spot` or
  `Perpetual`.
- Private companies without a public ticker use plain copy such as `Private company
  exposure`; they must not receive a fabricated exchange ticker.
- Matching an instrument symbol still returns its canonical company result and may focus
  that capability when the sheet opens.
- Empty copy says no verified company or instrument matches. It never asks for an
  arbitrary contract address.
- Results must not claim a product is available merely because its company matched.

## 12. Product-family selector

- The options are `Spot`, `PreStocks`, and `Perpetuals`.
- Spot is selected by default.
- Exactly one family is selected at a time.
- There is no mixed `All` list.
- Counts include registry records for that family, not companies shown on Home.
- A count is hidden or marked unavailable when it cannot be computed reliably.
- The selected state uses semantics and shape/text in addition to color.
- The selector may remain visible while the list scrolls, provided it does not cover
  content or interfere with screen-reader order.

The screen does not insert a separate product-description row beneath the selector.
Product meaning remains explicit through the selected tab, product-specific row labels,
data fields, and the company capability sheet.

## 13. Registry ordering

- The client renders no separate product-description, result-title,
  availability-filter, or sort-control row.
- Each family opens directly into its complete registry so preview, paused, and
  unavailable products remain discoverable.
- Spot and Perpetuals use the backend's default activity ordering.
- PreStocks uses the backend's default alphabetical ordering.
- Filtering and alternative sorting remain API capabilities, not Milestone 1 Markets
  screen controls.

## 14. Registry rows

All rows share a calm, compact structure:

- company logo or deterministic fallback;
- company name and public ticker/private-company label;
- exact product symbol and issuer/provider or venue;
- the numeric product-appropriate value without a redundant price-type label;
- one product-specific secondary fact when useful; and
- a clear affordance that opens inspection, not trading.

Registry rows do not render `checked`, availability badges, or live/delayed/relative-age
copy. Those remain normalized API facts for detail, failure handling, and future
execution eligibility; omitting their badges from this dense list must not be
interpreted as making every product available.

Rows have no Buy, Long, Short, leverage, swap, or wallet action. A company may appear in
multiple product-family lists. Within one family, multiple rows for the same company are
allowed only when they are materially different instruments and the issuer/provider or
venue difference is visible.

### 14.1 Spot rows

Spot rows may show:

- company and public ticker;
- token/instrument symbol;
- issuer/provider and Solana network;
- informational numeric value; and
- signed period change when known.

An underlying equity reference price is not an executable token quote. A later detail
view must keep the underlying reference, token market price, and transaction quote as
separate labelled values.

### 14.2 PreStock rows

PreStock rows may show:

- private company name;
- plain private-company status instead of a fabricated public ticker;
- product symbol and provider;
- numeric provider value when known; and
- a concise structure/exposure label.

The required detail model includes legal/economic structure, company affiliation or
lack of affiliation, valuation source/date, fees, liquidity, transfer restrictions, and
exit/redemption terms. If Warren cannot populate and verify these fields, the product
may remain a clearly labelled preview but cannot appear `available`.

### 14.3 Perpetual rows

Perpetual rows may show:

- company/underlying and public ticker;
- exact contract symbol and venue;
- numeric mark value; and
- current funding rate when known.

Perpetual copy must say the contract gives no share ownership. Risk and product detail
must precede any future Long, Short, leverage, or collateral control.

## 15. Company capability sheet

Selecting a search result or registry row opens `Markets for [Company]`.

The sheet contains:

1. Canonical company identity.
2. Number of known markets and number available now.
3. An explicit statement that product availability and data freshness are separate.
4. `Invest` capabilities grouped as Spot, PreStock, and Equity perpetual.
5. Exact symbol plus issuer/provider/venue and current product state for each capability.
6. Optional `Use holdings` preview with Lend and Borrow marked `Later` and rendered as
   non-interactive content.

The sheet does not compare unlike prices, recommend a product, authenticate the user, or
request a quote. If only one capability exists, it still names that product explicitly.

## 16. Truth, verification, and state semantics

### Product availability

| State | Meaning |
| --- | --- |
| `available` | Warren has a verified current route to inspect this product; in this PRD that still does not enable trading. |
| `preview` | Warren is showing planned or research-stage coverage; no transaction route is implied. |
| `paused` | A previously known product is intentionally unavailable. |
| `unavailable` | Warren cannot currently expose the product safely or completely. |

Future regional eligibility may refine availability, but Milestone 1 does not introduce
geographic gating. Availability is never inferred from the underlying US market session.

### Data freshness

| State | Meaning |
| --- | --- |
| `live` | Source data is inside the approved live window. |
| `delayed` | Valid informational data is known to be delayed. |
| `stale` | Last-known data is retained beyond the delayed window. |
| `sample` | Controlled fixture data, never a current quote. |
| `unavailable` | No safe value is available. |

Every numeric market value has its own meaning, source timestamp, and data state.
Response-generation time is not a substitute for source freshness.

### Verification language

`Verified instrument` means Warren has matched the canonical company, product type,
provider/issuer or venue, network, and exact identifier using approved registry rules.
It does not mean Warren endorses the product or guarantees safety, liquidity, solvency,
price parity, redemption, or returns.

Tokens.xyz variants already owned by a dedicated private-market adapter, including
Tessera and PreStocks variants, are excluded from the Spot adapter. This prevents the
same OpenAI/Tessera mint from appearing once as Spot and again as PreStock. A redeemable
Backpack security such as SPCX may remain discoverable as a read-only Spot instrument,
but this PRD does not claim that Warren can execute it through Jupiter or Backpack.

## 17. Content and data model

Markets consumes normalized Warren models, never raw provider responses.

### Company capability summary

| Field | Purpose |
| --- | --- |
| `assetId` | Stable Warren identity for the underlying company. |
| `companyName` | Human-readable canonical company name. |
| `ticker` | Optional public-market ticker; absent for a private company without one. |
| `logoUrl` | Approved company mark or null for deterministic fallback. |
| `capabilities` | Product-family summaries grouped below the company. |

### Instrument summary

| Field | Purpose |
| --- | --- |
| `instrumentId` | Stable Warren identity for this exact product. |
| `assetId` | Canonical company relation. |
| `productType` | `spot`, `prestock`, or `perpetual`. |
| `symbol` | Provider/venue instrument symbol. |
| `provider` | Issuer, product provider, or venue display identity. |
| `networkOrVenue` | Solana network or derivative venue, as applicable. |
| `exactIdentifier` | Server-held canonical mint/contract identifier for detail and verification. |
| `verificationState` | Whether Warren completed its registry checks. |
| `availability` | Product availability independent of price freshness. |
| `primaryValue` | Optional normalized display value with explicit value type. |
| `secondaryMetric` | Optional product-appropriate metric with explicit type. |
| `asOf` | Source time for the primary value. |
| `dataState` | Freshness/availability state for that value. |
| `disclosureSummary` | Concise product-specific explanation. |

The mobile client may receive a display-safe exact identifier for inspection, but
provider keys and internal trust rules remain server-only. The current mock's prices,
availability, providers, and instruments are controlled examples, not registry facts.

## 18. Screen states

### Loading

- Render the header and controls immediately.
- Preserve final row geometry with a short skeleton list.
- Do not return partial search results as though the registry were complete.

### Ready

- Render product counts, controls, rows, and the disclosure from one coherent registry
  snapshot.

### Empty product family

- Keep the selected family and explanation visible.
- State that Warren has no verified records for this family right now.
- Do not redirect the user to crypto assets or another family automatically.

### Empty search

- Keep the query and product selector visible.
- Say no verified company or instrument matches the query.

### Partial data

- Preserve instrument identity and availability when optional price/activity data fails.
- Replace the affected metric with `Unavailable`; do not remove the row.

### Offline or refresh failure

- Keep the last safe cached registry when available and label stale values.
- Offer a retry without clearing the user's product or query state.

### Registry unavailable

- Show a bounded full-section error and retry when no safe catalogue exists.
- Do not fall back to unverified fixtures in a production response.

## 19. Accessibility and responsive behavior

- Interactive targets meet the platform minimum of 44 by 44 points.
- Product tabs expose selected state.
- Each row has one concise accessible label containing company, product type, instrument,
  availability, primary value/data state when present, and inspection action.
- Product availability and price movement never depend on color alone.
- The capability sheet has dialog semantics, traps focus while open where appropriate,
  closes with platform back/Escape, and restores focus to its trigger.
- Dynamic type may increase row height; content cannot clip or overlap.
- At larger text sizes, trailing values may move below identity rather than shrinking.
- Loading, empty, stale, paused, preview, and unavailable states are announced in text.
- Motion respects Reduce Motion and no list or carousel auto-scrolls.
- Light and dark modes use semantic Warren tokens and meet WCAG 2.1 AA contrast.

## 20. Analytics

The read-only slice may record:

- `markets_viewed`
- `markets_product_changed`
- `markets_search_started`
- `markets_search_result_selected`
- `markets_instrument_selected`
- `markets_capability_sheet_opened`
- `markets_capability_selected`
- `markets_data_retry_selected`

Events may include stable `assetId`, `instrumentId`, product family, result position,
availability, and data state. They must not include provider secrets, wallet addresses,
financial balances, or raw search histories tied to an identity.

## 21. Performance and reliability

- A cached first Spot page should render without waiting for optional activity metrics.
- Search over the milestone registry feels immediate and does not call a provider per
  keystroke.
- Product-family switching does not refetch unchanged fresh pages unnecessarily.
- Registry pagination is stable and cannot duplicate or skip instruments in an unchanged
  snapshot.
- Provider failures are normalized and cannot crash the tab or expose raw provider
  errors.
- Logos are bounded and use a fallback without shifting row geometry.

## 22. Backend contract for Gate A

The exact schema will live in a shared runtime-validated package. The first contract
should expose three public, read-only operations:

### `GET /v1/markets`

Returns one product-family registry page.

| Query | Rule |
| --- | --- |
| `product` | Required: `spot`, `prestock`, or `perpetual`. |
| `availability` | Optional: `all` or `available`; default `all`. |
| `sort` | Optional product-valid sort; defaults according to Section 13. |
| `cursor` | Optional opaque cursor from the previous response. |
| `limit` | Optional bounded page size; proposed default 24, maximum 50. |

The response includes snapshot generation time, product counts when reliable, normalized
instrument summaries, page information, and section-level warnings.

### `GET /v1/markets/search?q=<query>`

Returns company-grouped results across all product families. The trimmed query is 1–80
characters. Each result contains canonical company identity and capability summaries.
No match is a successful response with an empty result list.

### `GET /v1/markets/companies/:assetId`

Returns the `Markets for [Company]` capability model with every verified, preview,
paused, or unavailable product Warren intentionally exposes. Unknown IDs return a
contract-shaped `404`; malformed IDs return `400`.

All endpoints:

- require no user, wallet, or access token;
- are read-only and return no executable quote;
- use public caching and ETags appropriate to source freshness;
- validate requests and normalized responses at runtime;
- use bounded provider timeouts and safe stale-cache behavior;
- return normalized error and warning codes; and
- keep provider credentials, raw provider payloads, and internal trust decisions off the
  mobile client.

The existing Home `/v1/assets` company identity should be reused rather than creating a
second canonical company registry. Markets extends it with exact product capabilities.

## 23. Delivery gates

Markets is delivered in two sequential gates. Frontend implementation begins after the
backend contract is reviewed and accepted.

### Gate A — Registry API

The backend owns canonical companies, exact instruments, provider mapping, product
semantics, verification state, availability, freshness, search grouping, pagination,
partial failure, and caching.

At handoff, the user can test documented terminal requests against the local API and see:

- one page each for Spot, PreStocks, and Perpetuals;
- global search returning one company with grouped capabilities;
- one company capability response;
- available-only filtering and every supported sort;
- empty, invalid, stale, partial, and provider-unavailable responses; and
- explicit proof that sample data never reports itself as live or available by accident.

If a live provider for a product family is not yet verified, Gate A must return a truthful
empty or preview state. It must not promote `markets_mock.html` fixtures to live data.

### Gate B — Markets frontend

The mobile app implements this PRD against the accepted Warren contract. It does not call
Tokens.xyz, a PreStock provider, a perpetual venue, or another data source directly.

The user is the manual frontend tester. Engineering supplies the exact app state/API
setup and a short manual checklist; engineering does not treat a local automated render
or screenshot as manual acceptance.

## 24. Backend acceptance criteria

Gate A is complete only when:

- [x] All three Markets endpoints are public, read-only, runtime-validated, and
      documented with copy-paste terminal examples.
- [x] Home and Markets use the same stable `assetId` for the same company.
- [x] `GET /v1/markets` supports each product family, deterministic pagination,
      available-only filtering, and only valid family-specific sorts.
- [x] Global search matches company, public ticker, and known instrument symbol and
      returns one result per canonical company.
- [x] Company capability lookup groups every intentionally exposed product beneath one
      company without collapsing distinct instruments.
- [x] Spot, PreStock, and Perpetual records validate different required fields and cannot
      masquerade as one another.
- [x] Dedicated Tessera and PreStocks private-market variants are not duplicated under
      the Tokens.xyz Spot family.
- [x] A private company without a public ticker never receives a fabricated ticker.
- [x] Product availability and data state are independent validated fields.
- [x] Every displayed numeric market value has a value type, data state, and provider
      timestamp when supplied; an unknown source time is explicit.
- [x] `verified` cannot be derived from a logo, symbol match, or provider presence alone.
- [x] Empty and partial product families do not erase healthy families.
- [x] Stale-cache recovery is bounded and cannot label stale values live.
- [x] Invalid product, availability, sort, limit, cursor, query, and asset ID inputs return
      contract-shaped errors.
- [x] Raw provider errors, credentials, keys, and internal trust rules never appear in
      responses or logs.
- [x] Provider adapters and endpoints have automated tests for duplicates, conflicting
      symbols, missing prices, stale data, paused products, private companies, and partial
      outages.
- [x] Typechecking and the Markets API test suite pass before frontend handoff.

## 25. Frontend acceptance criteria

Gate B is complete only when the manual tester confirms:

- [ ] A guest opens Markets without authentication or a wallet prompt.
- [ ] Markets contains no Home indices, news, earnings switcher, or quick actions.
- [ ] Spot is the default and exactly one product family is selected.
- [ ] Product counts match the current registry response or are hidden when unavailable.
- [ ] Global search returns one company result with truthful capability labels.
- [ ] Search, clear, no-result, keyboard dismissal, and focus restoration feel continuous
      and never clear on each keystroke.
- [ ] Spot, PreStock, and Perpetual rows use their product-specific fields and language.
- [ ] Registry rows show the numeric value and useful product-specific secondary fact
      without `checked`, availability, freshness/age, or redundant price-label chrome.
- [ ] Every row opens the correct company sheet and focuses the selected capability.
- [ ] The company sheet separates Invest products from non-interactive future Lend/Borrow
      concepts.
- [ ] Detail and failure states do not imply that omitted row badges make a product
      executable or that an informational value is a current quote.
- [ ] No row or sheet action requests a quote, authenticates, connects a wallet, signs,
      or submits a transaction.
- [ ] Closing a sheet or returning from detail restores query when appropriate, selected
      family, focus, and scroll position.
- [ ] Loading, empty, partial, offline, stale, and retry states preserve all safe content.
- [ ] Dynamic type, screen reader, keyboard, 44-point targets, contrast, dark mode, and
      Reduce Motion checks pass on the supported device baseline.
- [ ] The app contains no provider API key or raw provider-specific response handling.

## 26. Future extension boundary

Later work may connect an available Spot capability to the Milestone 1 buy journey or
add live PreStock and Perpetual detail/action modules. Each financial action requires its
own quote, risk, authentication, approval, execution, recovery, and acceptance contract.

Lending and borrowing remain future **Earn** capabilities. Markets may show them only as
non-interactive `Later` context inside a company's capability sheet. They do not become
Markets filters or registry rows unless a later product decision explicitly changes this
architecture.

## 27. Implementation notes

- Treat [`markets_mock.html`](../../../../markets_mock.html) as a working interaction and
  visual reference, not as production architecture or verified product data.
- Replace the current duplicate Markets fixture list rather than extending it.
- Reuse Warren's semantic color, typography, spacing, shape, and disclosure rules.
- Implement product-family rows as separate renderers over a shared registry shell; do
  not force all products through a generic stock-row model.
- Keep all provider adapters on the backend and expose only normalized Warren contracts.
- Resolve provider coverage and source fields during Gate A before coding the frontend.
