# PRD: Guest-First Home

| Field | Value |
| --- | --- |
| Status | Approved for implementation |
| Parent | [Milestone 1: Discover and Buy a Tokenized Stock](../../../milestone/milestone-one.md) |
| Product surface | Warren mobile app, Home tab |
| Experience reference | [`homescreen_mock.html`](../../../../homescreen_mock.html) |
| Design foundation | [Phase 0 theme and design direction](../../theme-design/phase-zero.md) |
| Backend contract | [Home API handoff](../api/home_api.md) |
| Last updated | 2026-09-18 |

## 1. Summary

Home is Warren's guest-first, stock-first discovery surface. It gives a person an
immediate view of the US stock market, helps them find a familiar company, and shows
the market context around it without first asking for authentication or a wallet.

This PRD covers the Home screen only. The screen is read-only: it can search, filter,
scroll, and navigate to read-only destinations, but it cannot create an order, request
a quote, connect a wallet, sign a message, or submit a transaction.

The Main Actions and Quick Actions remain visible to communicate the future shape of
Warren. In this slice they are presentational placeholders and do nothing.

## 2. Product Direction

Warren's long-term goal is to bring together what a person can do with tokenized stocks
on Solana. This includes spot access, pre-IPO exposure, equity perpetuals, swaps, alerts,
lending, borrowing, and other future capabilities.

Home does not attempt to expose every capability at once. It establishes the stable
discovery layer that those capabilities can grow from:

1. A company is the primary thing a person discovers.
2. A company may have multiple tokenized instruments or actions underneath it.
3. Providers and token mints do not create duplicate company entries on Home.
4. Financial actions begin on later screens, never directly from a compact Home card.

## 3. Problem

Tokenized-stock products often begin with token symbols, contract addresses, venues,
or wallet setup. That makes a familiar investment category feel like an unfamiliar
crypto workflow.

Warren needs a Home screen that starts with recognizable companies and familiar market
signals. A guest should understand what is happening in the market and find a company
before any account, wallet, instrument, or execution detail becomes relevant.

## 4. Outcome

A guest can open Warren and, without signing in:

- understand whether the US market is open and how fresh the displayed data is;
- scan major market indices;
- browse a compact, curated company catalogue;
- search by company, stock ticker, or supported token symbol;
- switch between all companies, saved companies, and upcoming earnings;
- open a company for further read-only inspection; and
- read the latest news supplied by the configured provider.

## 5. Goals

- Make useful market information visible immediately to a guest.
- Present companies before tokens, venues, or protocols.
- Keep the primary stock board dense, calm, and easy to scan on a mobile screen.
- Make search the fastest route to a known company.
- Support a local read-only view of saved companies and upcoming earnings.
- Distinguish sample, delayed, stale, and live information clearly.
- Establish reusable Home sections that can accept new capabilities later without a
  structural redesign.
- Preserve the visual direction approved in the Home mock and Phase 0 theme.
- Keep the company catalogue and market data focused on stocks and public markets; the
  News section uses the latest provider feed without editorial topic filtering.

## 6. Non-goals

- Authentication, account creation, or wallet connection.
- Adding or removing a company from the watchlist on Home.
- Requesting an executable quote or showing an order preview.
- Buying, selling, swapping, depositing, sending, lending, or borrowing.
- Signing or broadcasting a Solana transaction.
- Opening a perpetual position or presenting leverage controls.
- Portfolio balances, positions, transaction history, or personalized recommendations.
- A complete Markets screen, company-detail PRD, or article-reader PRD.
- Supporting every stock, index, news source, instrument, or provider.
- Treating displayed prices as executable quotes.

## 7. Users and Jobs

### Guest who knows the company

> I want to search for a company by its familiar name or ticker and inspect it without
> creating an account.

### Guest exploring the market

> I want a quick sense of today's market and a compact list of recognizable companies.

### Returning user with saved companies

> I want to switch to my existing watchlist and see the companies I already care about.

### Earnings-focused user

> I want to see which supported companies have upcoming earnings without opening a
> separate calendar tool.

## 8. Information Hierarchy

Home renders these sections in order:

1. App header with Warren identity and guest state.
2. US market status and data-freshness line.
3. Search and the All, Watchlist, and Earnings view controls.
4. Horizontally scrollable market-index strip.
5. Horizontally paged company board.
6. Main Actions: Deposit, Send, and Buy Stock, presented as inactive placeholders.
7. Top News.
8. Quick Actions, presented as inactive placeholders.
9. Data/product disclosure.
10. Persistent Home, Markets, and Profile tab navigation.

The company board is the visual and product focus. Main Actions, news, and Quick Actions
must not displace it above the fold.

## 9. Interaction Contract

“Read-only” means that Home may change local presentation or navigate to another
read-only surface. It may not change a financial position, create an account, alter a
wallet, or submit any transaction.

| Element | User interaction | Required result |
| --- | --- | --- |
| Warren brand | Tap | Scroll Home to the top. |
| Guest indicator | None in this slice | Display the current guest state without opening authentication. |
| Search field | Focus and type | Show matching companies in an inline results panel. |
| Search clear control | Tap | Clear the query and restore the unfiltered result set. |
| Search result | Tap | Open the selected company-detail route in read-only mode. |
| All | Tap | Show the complete curated Home catalogue. |
| Watchlist | Tap | Show companies already saved by the current local/user state. |
| Earnings | Tap | Show supported companies with upcoming earnings, ordered by date. |
| Index strip | Horizontal swipe | Reveal more indices; index items themselves are not actions in this slice. |
| Company board | Horizontal swipe | Move between fixed pages of company cards. |
| Pagination indicator | Tap, when rendered as a control | Move to its corresponding company page. |
| Company card | Tap | Open that company's read-only detail route. |
| Main Action item | None | Remain static; no press, navigation, authentication, or transaction. |
| News card | Tap | Open the read-only article/source handoff when available. |
| See all news | Tap | Open the future news/Markets destination when available. |
| Quick Action item | None | Remain static; no press, navigation, authentication, or transaction. |
| Home tab | Tap | Keep Home active and return its scroll view to the top. |
| Markets/Profile tab | Tap | Navigate to the corresponding tab; their content is outside this PRD. |

Inactive Main Action and Quick Action items must not expose button semantics, pressed
feedback, haptics, or misleading chevrons. If the design keeps a future-state label,
the label must be explicit, such as **Later**. A control that appears enabled but does
nothing is not acceptable.

## 10. Section Requirements

### 10.1 Header and market status

- Show the Warren identity and the current guest state.
- Display one market-state label: `Open`, `Closed`, `Pre-market`, `After hours`, or
  `Status unavailable`.
- Show a human-readable update time or an explicit `Sample data` label.
- Never infer that tokenized instruments are tradable merely because the underlying US
  market is open.
- Do not restore the removed “Market window” or “Find a company to own” headings.

### 10.2 Search

- Search accepts company name, public stock ticker, and known token symbol.
- Matching is case-insensitive and ignores leading/trailing whitespace.
- Each result identifies one company, not one row per provider or token mint.
- A result shows company identity, public ticker, representative price/change when
  available, and a concise supported-instrument hint.
- Search results must not claim that an instrument is tradable or available without
  verified availability data.
- The empty result says that no company matches the search; it must not suggest pasting
  an arbitrary token address.
- Clearing or dismissing search returns focus predictably and preserves the selected
  All/Watchlist/Earnings mode.

### 10.3 Market modes

- `All` is selected by default.
- Exactly one of All, Watchlist, or Earnings is selected at a time.
- The selected state is conveyed through semantics and text/shape, not color alone.
- `Watchlist` is a view only. Home does not add, remove, or sync saved companies.
- An empty Watchlist explains that no companies are saved and does not force sign-in.
- `Earnings` includes only supported companies with a known upcoming report date.
- In Earnings mode, the card's secondary value may change from daily percentage to the
  earnings date while retaining the same card geometry.
- An empty Earnings view says that no upcoming earnings data is available.

### 10.4 Index strip

- The strip is horizontally scrollable with a visible partial next item when space
  permits, signalling that more content is available.
- Index items use the same compact visual language and left inset as the company board.
- Each item shows index name, value, and percentage movement as a stacked group.
- Positive and negative movement use a sign plus a textual value; color is secondary.
- Index items have restrained corner radii and small, consistent gaps rather than a
  connected table appearance.
- The strip never auto-scrolls and does not compete with the user's vertical scroll.

### 10.5 Company board

- The default board contains three columns and four rows per horizontal page: up to 12
  companies per page.
- Pages snap horizontally and do not require precise dragging.
- Page indicators appear only when more than one page exists.
- Company cards are compact, individually separated pills/cards with restrained corner
  radii and small gaps.
- The left side contains company logo followed by company name.
- The right side contains public ticker followed by daily percentage movement, stacked
  vertically and aligned to the end.
- The entire card is one tap target and opens the company; it contains no Buy control.
- A company appears once even when Warren knows about multiple spot tokens, venues, or
  future capabilities for it.
- Company ordering is curated and deterministic for this milestone; live ranking or
  personalization is not required.
- Returning from company detail restores Home's selected mode, horizontal page, search
  state when appropriate, and vertical scroll position.

### 10.6 Main Actions

- Render Deposit, Send, and Buy Stock in the approved three-item layout.
- These items are presentational only in this Home slice.
- They do not open sheets, show toasts, navigate, authenticate, request wallet access,
  or perform any financial action.
- They must be implemented so assistive technology does not announce unavailable
  actions as enabled buttons.

### 10.7 Top News

- Show the latest 12 valid stories supplied by the configured news provider.
- Do not reject an otherwise valid story based on its topic or publisher in this milestone.
- Continue to reject malformed records, invalid or unsafe URLs, invalid timestamps, and
  duplicate article URLs.
- Each story includes category, publication age/time, headline, source, and related
  ticker context when available.
- A story must distinguish publisher/source content from Warren-authored education.
- Opening a story is read-only and cannot lead directly into an order.
- If no article destination exists in this delivery slice, news cards render as static
  content rather than dead pressables.
- Missing news does not prevent the company board from rendering.

### 10.8 Quick Actions

- Keep the approved three-column Quick Actions layout as a preview of future Warren
  capabilities.
- Initial concepts may include pre-market availability, opening a long, and swapping
  supported stock instruments.
- All Quick Actions are inactive in this PRD and may be marked `Later`.
- Future capability types such as lending and borrowing must be addable through data or
  configuration rather than a Home-screen structural rewrite.
- No Quick Action copy may imply that a currently unavailable product is live.

### 10.9 Bottom navigation

- Home, Markets, and Profile are the only primary tabs in this milestone.
- Home clearly exposes its selected state.
- The navigation remains reachable without covering the final disclosure or content.
- Markets and Profile behavior is owned by their respective modules.

## 11. Content and Data Model

Home consumes company-centred presentation models rather than provider responses.

### Company summary

| Field | Purpose |
| --- | --- |
| `assetId` | Stable Warren identity for the underlying company. |
| `companyName` | Human-readable company name. |
| `ticker` | Familiar public-market ticker. |
| `logo` | Approved company mark or deterministic fallback. |
| `referencePrice` | Informational reference price, when available. |
| `changePercent` | Signed movement for an explicitly defined period. |
| `priceAsOf` | Timestamp used to communicate freshness. |
| `priceDataState` | Freshness/availability state for the reference price. |
| `changeAsOf` | Independent timestamp for the percentage movement. |
| `changeDataState` | Freshness/availability state for the percentage movement. |
| `earningsAt` | Optional next earnings date/time. |
| `instrumentHints` | Known supported token symbols/capability hints used by search. |

### Index summary

Each index requires a stable identifier, display name, value, signed percentage change,
period, timestamp, and data-state label.

### News summary

Each story requires a stable identifier, headline, category, source, published time,
optional summary, optional destination, and zero or more related `assetId` values.

The first implementation may use controlled fixtures. The view model must allow those
fixtures to be replaced with server-normalized Tokens.xyz catalogue, price, and news
data without changing Home components. Provider credentials must never be included in the
mobile application.

## 12. Data Truth and Freshness

- Every price and percentage has an `as of` time and defined comparison period.
- Sample data is labelled `Sample`; it must not look live.
- Delayed data is labelled `Delayed` when that status is known.
- Stale data may remain visible with a stale label; it must not silently appear current.
- A failed refresh keeps the last known data when safe and explains that it may be old.
- Market status, reference equity pricing, and token trading availability are separate
  facts and must not be collapsed into one label.
- Home values are informational and are never reused as executable transaction terms.

## 13. Screen States

### Loading

- Preserve the final section geometry with skeletons for market status, indices, and
  company cards.
- Search controls may render immediately but must not return incomplete results as if
  the catalogue were complete.
- Do not block the whole screen on news.

### Ready

- Render available sections independently.
- Display the data timestamp/state close to the market status.

### Partial data

- A missing news or indices response does not hide search and company discovery.
- Use a small section-level unavailable message instead of a full-screen error.

### Empty catalogue

- Explain that company data is temporarily unavailable and provide a retry action.
- Do not render Main Actions as a substitute path to trading.

### Offline or refresh failure

- Keep the last safe cached catalogue when available.
- Label it as potentially stale and offer retry.

### Empty Watchlist or Earnings

- Keep the toolbar and mode selection visible.
- Render the specific empty-state copy defined in Section 10.3.

## 14. Accessibility and Responsive Behaviour

- All interactive targets meet the platform minimum of 44 by 44 points.
- Search, market modes, page indicators, company cards, news cards, and tabs have
  descriptive accessibility labels and appropriate roles/states.
- Horizontal sections are announced with a useful name and do not trap vertical scroll.
- Company-card labels include company, ticker, signed change, and whether the value is
  sample, delayed, stale, or current.
- Movement is never communicated by red/green color alone.
- Dynamic type may increase card height; text must not clip or overlap.
- At larger text sizes, the fixed visual grid may reduce columns rather than shrinking
  text below the approved readable size.
- Loading, empty, stale, and failed states are available to screen readers.
- Motion respects Reduce Motion; no section depends on automatic carousel movement.
- Both light and dark modes use semantic theme tokens and meet WCAG 2.1 AA contrast.

## 15. Analytics

This slice may record product interactions without requiring identity:

- `home_viewed`
- `home_search_started`
- `home_search_result_selected`
- `home_market_mode_changed`
- `home_company_page_changed`
- `home_company_selected`
- `home_news_selected`
- `home_data_retry_selected`

Events may include a stable asset ID, selected mode, result position, data-state label,
and anonymous session identifier. They must not include raw search histories tied to an
identity, wallet addresses, provider credentials, or financial balances.

Main Action and Quick Action placeholders emit no click events because they are not
interactive.

## 16. Performance and Reliability

- Cached Home content should render without waiting for optional news.
- Horizontal paging and vertical scrolling remain responsive on the supported physical
  Android device baseline.
- Company logos use bounded dimensions and fall back without shifting card geometry.
- Search over the milestone catalogue feels immediate and does not make a provider
  request for every keystroke.
- A provider outage is contained behind the Home data boundary and does not crash the
  tab or expose provider-specific errors to the user.

## 17. Delivery Gates

Home is delivered in two sequential gates. Frontend implementation does not begin
until the backend gate is reviewed and accepted.

### Gate A — Backend API

The backend owns provider access, company normalization, deduplication, freshness,
partial-failure handling, and public response contracts. Completion means the Home API
can be exercised and understood without the mobile app.

At the backend handoff, Warren must have:

- versioned, public, read-only Home and asset-catalogue endpoints;
- shared request and response schemas validated at runtime;
- deterministic fixture adapters for tests and local development;
- server-only Tokens.xyz integration for the stock catalogue, informational prices,
  token variants, and latest normalized news feed;
- explicit sample/live/delayed/stale/unavailable data states;
- caching, timeouts, rate limits, and normalized error responses;
- automated endpoint and provider-mapping tests; and
- example requests and responses that explain the contract to the frontend phase.

No mobile Home component is part of Gate A.

### Gate B — Frontend Home

After Gate A is accepted, the mobile app implements the Home screen against the stable
Warren API contract. It must not call Tokens.xyz or another data provider directly.

Completion means the interaction, layout, state, accessibility, and visual acceptance
criteria in this PRD pass manual testing against both controlled API states and the
connected backend.

## 18. Backend API Contract

### 18.1 `GET /v1/home`

Returns the public bootstrap model needed to render the first Home view in one request.
It requires no access token, profile, or wallet.

The response contains:

- US market status and its timestamp/data state;
- the ordered index strip;
- the first curated page of company summaries;
- page information for the company catalogue;
- the current Top News set when available;
- section-level warnings for partial provider failures; and
- response generation and source-freshness metadata.

Example response shape:

```json
{
  "generatedAt": "2026-09-18T10:00:00.000Z",
  "market": {
    "region": "US",
    "session": "open",
    "label": "US market open",
    "asOf": "2026-09-18T10:00:00.000Z",
    "dataState": "live"
  },
  "indices": [
    {
      "id": "spx",
      "name": "S&P 500",
      "value": 6644.31,
      "changePercent": 0.23,
      "period": "1d",
      "asOf": "2026-09-18T10:00:00.000Z",
      "dataState": "delayed"
    }
  ],
  "companies": [],
  "pageInfo": {
    "nextCursor": null,
    "hasNextPage": false
  },
  "news": [],
  "warnings": []
}
```

Main Actions and Quick Actions are frontend presentation content and are deliberately
absent from this endpoint because they have no active backend capability in this slice.

### 18.2 `GET /v1/assets`

Returns company-centred summaries for catalogue paging, search, earnings, or resolving
an existing watchlist. The route remains public and read-only.

Supported query parameters:

| Parameter | Rule | Purpose |
| --- | --- | --- |
| `q` | Optional, trimmed, 1–80 characters | Match company name, public ticker, or known supported token symbol. |
| `view` | `all` or `earnings`; default `all` | Select the normal catalogue or companies with upcoming earnings. |
| `ids` | Optional comma-separated asset IDs, maximum 50 | Resolve a locally supplied watchlist without storing or modifying it. |
| `cursor` | Optional opaque cursor returned by the API | Request the next stable page. |
| `limit` | Optional integer, 1–36; default 24 | Bound the result page. |

`q` and `ids` cannot be combined. Invalid combinations return the standard `400
INVALID_REQUEST` response. An unknown search or an empty watchlist returns `200` with an
empty `items` array; it is not an error.

The earnings view defaults to the next 30 calendar days and orders known dates from
soonest to latest. Items without a verified earnings date are excluded.

Example response shape:

```json
{
  "generatedAt": "2026-09-18T10:00:00.000Z",
  "query": {
    "q": "nvda",
    "view": "all",
    "ids": []
  },
  "items": [
    {
      "assetId": "nvidia",
      "companyName": "NVIDIA",
      "ticker": "NVDA",
      "logoUrl": null,
      "referencePrice": 185,
      "currency": "USD",
      "changePercent": 2.34,
      "changePeriod": "1d",
      "priceAsOf": "2026-09-18T10:00:00.000Z",
      "priceDataState": "live",
      "changeAsOf": "2026-09-18T09:58:00.000Z",
      "changeDataState": "live",
      "earningsAt": null,
      "instrumentHints": ["NVDAx"]
    }
  ],
  "pageInfo": {
    "nextCursor": null,
    "hasNextPage": false
  },
  "warnings": []
}
```

Every `assetId` identifies one underlying company. Provider listings, Solana mints, and
instrument symbols may enrich `instrumentHints`, but they cannot create duplicate Home
companies.

### 18.3 Watchlist behaviour

This Home slice has no watchlist mutation endpoint.

The frontend supplies already-saved canonical asset IDs through `GET /v1/assets?ids=...`.
The API returns known companies in the supplied order and reports unknown or unavailable
IDs in a warning without failing the entire response. It does not create a profile, save
the list, or require authentication.

### 18.4 Success and error rules

- Successful responses use validated Warren models rather than raw provider payloads.
- Existing API errors retain the shared shape:

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "The request could not be processed.",
    "retryable": false,
    "requestId": "request-id"
  }
}
```

- `400 INVALID_REQUEST` covers invalid query values or combinations.
- `429 RATE_LIMITED` includes a retry interval.
- `503 CATALOG_UNAVAILABLE` is used only when the core company catalogue has no safe
  live, fixture, or cached result.
- Optional-section failures normally produce a successful partial response with a
  section-level warning instead of failing all of Home.
- Provider names, credentials, stack traces, and raw provider errors are never returned.

### 18.5 Cache and freshness rules

- The API caches normalized provider results, not credentials or raw authenticated
  responses.
- Public Home responses support an `ETag` or equivalent revalidation mechanism.
- Cache headers are defined separately from authentication endpoints; the current
  authentication-wide `no-store` behavior must not accidentally disable safe public
  Home caching.
- A cache entry past its live window may be returned as `stale` during a provider outage
  when its age remains inside the documented stale window.
- Each section and price retains its own `asOf` value; `generatedAt` alone is not treated
  as source freshness.

### 18.6 Provider boundary

- Tokens.xyz is accessed only by the API and supplies the canonical stock catalogue,
  known token/instrument mappings, informational prices, and 24-hour changes.
- Tokens.xyz supplies the latest 12 news items without editorial topic or source filtering.
- Warren applies only technical validation and URL deduplication; an empty provider result
  produces an explicit empty news state.
- News, earnings, index, or session providers remain independently replaceable.
- Missing optional providers can use clearly labelled deterministic fixtures during
  development; fixture values never claim `live` status.
- Tokens.xyz and other provider secrets remain server-only and never appear in success
  bodies, errors, logs, mobile environment variables, or committed files.

## 19. Backend Acceptance Criteria

Gate A is complete only when all of the following pass:

- [x] `GET /v1/home` returns a schema-valid public bootstrap response without requiring
      authentication or a wallet.
- [x] `GET /v1/assets` supports catalogue paging, company/ticker/token-symbol search,
      earnings view, and ordered ID resolution.
- [x] The same underlying company is returned once even when multiple providers,
      instruments, or Solana mints exist.
- [x] Search matching is case-insensitive, trims whitespace, and returns an empty success
      for no matches.
- [x] Invalid limits, cursors, views, IDs, and query combinations return contract-shaped
      `400` errors.
- [x] Market, index, company, price, earnings, and news data carry explicit timestamps
      and `sample`, `live`, `delayed`, `stale`, or `unavailable` states as applicable.
- [x] A news, index, earnings, or market-status failure cannot erase an otherwise valid company
      catalogue.
- [x] A core catalogue failure returns a cached/stale response when safe and a retryable
      contract-shaped failure when no safe result exists.
- [x] Pagination is deterministic: no duplicate or missing company appears while walking
      an unchanged catalogue.
- [x] Watchlist ID resolution does not store data, mutate a user, or require a session.
- [x] Runtime request and response schemas reject malformed internal/provider data before
      it reaches the client.
- [x] Provider transformations are covered by fixtures for duplicate instruments,
      missing prices, unknown earnings, absent logos, negative movement, and stale data.
- [x] Tokens.xyz news mapping returns no more than the latest 12 valid provider stories,
      preserves them without topic/source filtering, and returns an explicit empty state
      when none are available.
- [x] Endpoint tests cover complete, empty, partial, stale, invalid, rate-limited, and
      provider-unavailable responses using Fastify injection without starting localhost.
- [x] Provider access has bounded timeouts, normalized catalogue caching, and public-read
      rate protection.
- [x] The Tokens.xyz key and every other provider credential remain server-only and are
      redacted from logs and errors.
- [x] API typechecking and the complete API test suite pass.
- [x] The backend handoff includes example requests, example responses, field meanings,
      possible error codes, cache behavior, and a test-results summary for review.
- [x] The live verifier passes with the server-side Tokens.xyz credential while keeping it
      out of responses and logs and proving that Home returns no more than 12 news items.

## 20. Frontend Acceptance Criteria

- [ ] A fresh install opens Home as a guest without an authentication or wallet prompt.
- [ ] Home follows the section order and visual hierarchy in Section 8.
- [ ] Market status and data freshness/sample state are visible and unambiguous.
- [ ] Search finds companies by name, public ticker, and known supported token symbol.
- [ ] Search never renders multiple Home results for the same underlying company.
- [ ] All, Watchlist, and Earnings are mutually exclusive and render their correct data
      or specific empty state.
- [ ] The index strip scrolls horizontally, never auto-scrolls, and its items are not
      pressable in this slice.
- [ ] The company board displays up to three columns by four rows per page at the
      default supported phone size and snaps between horizontal pages.
- [ ] Every company card follows the approved left/right content structure and opens the
      correct read-only company detail.
- [ ] Returning from company detail restores the Home context and scroll position.
- [ ] Main Actions and Quick Actions are present but have no button semantics, press
      feedback, navigation, authentication, or financial behavior.
- [ ] A news card opens read-only content when a destination exists; otherwise it is
      correctly rendered as static content.
- [ ] No Home interaction requests a quote, signs a message, connects a wallet, submits
      a transaction, or changes a financial position.
- [ ] Sample, delayed, stale, and unavailable data cannot be mistaken for a current
      executable quote.
- [ ] Loading, partial, empty, offline, stale, and retry states work without hiding all
      available Home content.
- [ ] The screen passes keyboard/screen-reader semantics, dynamic type, 44-point target,
      contrast, and Reduce Motion checks on the supported device baseline.
- [ ] Home contains no provider API key or direct provider-specific response handling.

Gate B also requires the frontend to use the validated Warren API contract without
depending on raw Tokens.xyz, news-provider, or fixture-specific field shapes.

## 21. Future Extension Boundary

Later modules may activate Main Actions and Quick Actions or introduce new Home sections
for spot purchasing, PreStocks, equity perpetuals, alerts, swaps, lending, borrowing, or
portfolio context. Each financial capability requires its own PRD, risk states, data
contract, and acceptance criteria.

Those additions must preserve the Home rules established here:

- company first;
- guest discovery before authentication;
- one underlying company rather than duplicated provider tokens;
- explicit data freshness and availability;
- no transaction from a compact card; and
- no mixing informational reference prices with executable terms.

## 22. Implementation Notes

- Treat [`homescreen_mock.html`](../../../../homescreen_mock.html) as the agreed visual
  reference, not as the production architecture or final data source.
- Implement each Home section as an independent component with explicit loading, ready,
  empty, stale, and error inputs.
- Keep provider adaptation outside the mobile view layer. Home consumes normalized
  Warren models.
- Complete and review Gate A before beginning Gate B. Backend endpoint tests use Fastify
  injection and do not require the user to run a localhost process.
- This PRD does not authorize changes to company detail, Markets, Profile, authentication,
  wallets, or execution flows.
