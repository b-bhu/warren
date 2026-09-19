# Home API: Backend Handoff

| Field | Value |
| --- | --- |
| Status | Gate A complete; Tokens.xyz is the primary live Home provider |
| PRD | [Guest-First Home](../prds/home_prd.md) |
| Runtime | Fastify, Node.js, TypeScript |
| Contract package | `@warren/home-contract` |
| Last updated | 2026-09-19 |

## Purpose

The Home API gives the mobile app a Warren-owned, company-centred read model. The mobile
app does not know how Tokens.xyz or later providers structure their data and never
receives provider credentials.

The API is public and read-only. Neither endpoint authenticates a user, connects a wallet,
creates a quote, or changes financial state.

## Endpoints

### `GET /v1/home`

Returns the first Home payload in one request:

- US market status;
- ordered market indices;
- the first 24 curated companies;
- catalogue pagination state;
- Top News; and
- section-level warnings.

Example:

```http
GET /v1/home HTTP/1.1
Accept: application/json
```

```json
{
  "generatedAt": "2026-09-18T17:22:23.379Z",
  "market": {
    "region": "US",
    "session": "open",
    "label": "US market open",
    "asOf": "2026-09-18T17:22:23.379Z",
    "nextOpenAt": "2026-09-21T13:30:00.000Z",
    "nextCloseAt": "2026-09-18T20:00:00.000Z",
    "dataState": "live"
  },
  "indices": [],
  "companies": [],
  "pageInfo": {
    "nextCursor": null,
    "hasNextPage": false
  },
  "news": [],
  "warnings": []
}
```

The arrays are abbreviated here. Their complete runtime schemas live in
[`packages/home-contract/src/index.ts`](../../../../packages/home-contract/src/index.ts).

### `GET /v1/assets`

Returns company summaries for catalogue paging, search, the Earnings view, or resolving
an existing local watchlist.

| Query | Default | Meaning |
| --- | --- | --- |
| `q` | omitted | Case-insensitive company, ticker, or known token-symbol search. |
| `view` | `all` | `all` or `earnings`. |
| `ids` | omitted | Comma-separated canonical Warren asset IDs, maximum 50. |
| `cursor` | omitted | Opaque cursor from the previous response. |
| `limit` | `24` | Page size from 1 through 36. Ignored for ordered `ids` resolution. |

Examples:

```http
GET /v1/assets?q=nvda&limit=8
GET /v1/assets?view=earnings&limit=24
GET /v1/assets?ids=apple,nvidia,microsoft
GET /v1/assets?limit=24&cursor=<opaque-cursor>
```

A successful search response looks like:

```json
{
  "generatedAt": "2026-09-18T17:22:23.379Z",
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
      "logoUrl": "https://api.tokens.xyz/logos/xstocks/NVDAx.png",
      "referencePrice": 220.56,
      "currency": "USD",
      "changePercent": 2.38,
      "changePeriod": "1d",
      "priceAsOf": "2026-09-18T16:23:06.812Z",
      "priceDataState": "stale",
      "changeAsOf": "2026-09-18T16:23:06.812Z",
      "changeDataState": "stale",
      "earningsAt": null,
      "instrumentHints": ["NVDAx", "NVDAon"]
    }
  ],
  "pageInfo": {
    "nextCursor": null,
    "hasNextPage": false
  },
  "warnings": []
}
```

The values above illustrate the contract and may not be current when this file is read.
`priceDataState`/`priceAsOf` and `changeDataState`/`changeAsOf` independently tell the
client how to present freshness. Tokens.xyz is authoritative for both informational Home
values; neither value is an executable quote.

## How company normalization works

1. The backend requests the Tokens.xyz `stocks` curated list grouped by canonical asset.
2. Warren uses Tokens.xyz's `stock_redeemability` primary-variant strategy for provider
   context, but Home identity remains the underlying company.
3. Every provider variant and supported token symbol becomes an `instrumentHint`.
4. `blocked` and `compromised` variants are excluded from hints. A `caution` variant can
   remain discoverable, while later execution screens must surface its warning.
5. Duplicate rows with the same `assetId` merge into one company and combine safe hints.
6. Tokens.xyz catalogue statistics supply the informational reference price and 24-hour
   change. Warren derives freshness only when the selected token variant carries a source
   timestamp; missing timestamps never produce apparently live values.

The Home response never exposes Solana mints as the primary company identifier.

## Search behaviour

- Search trims leading and trailing whitespace.
- Matching is case-insensitive.
- It checks `companyName`, public `ticker`, and every safe `instrumentHint`.
- No match is `200` with an empty `items` array.
- `q` cannot be combined with `ids`.
- Search runs over the cached normalized catalogue; it does not call a provider for every
  keystroke.

## Watchlist behaviour

This API does not store or mutate a watchlist. The frontend can send already-saved asset
IDs to `GET /v1/assets?ids=...`.

- Known companies are returned in the requested order.
- Repeated IDs are collapsed to their first occurrence.
- Unknown IDs appear in an `UNKNOWN_ASSET_IDS` warning.
- Unknown IDs do not fail the full response.
- No authentication or profile is created.

## Earnings behaviour

`view=earnings` returns companies with a future `earningsAt`, ordered soonest first. The
current live Tokens catalogue does not supply earnings dates. Until the planned earnings
provider is connected, the live view returns an empty `items` array with an
`EARNINGS_DATA_UNAVAILABLE` warning. Controlled fixtures exercise populated and empty
states in automated tests.

## Current provider state

| Section | Current source | State |
| --- | --- | --- |
| Company catalogue and token hints | Tokens.xyz | Live server integration enabled. |
| Company prices/change | Tokens.xyz | Live server integration enabled; informational only. |
| US market session | Session-aware Warren fixture | Explicitly `sample`; observes US weekday/session hours, while a holiday-aware market-calendar source remains replaceable. |
| Indices | Deterministic Warren fixtures | Explicitly `sample`. |
| Top News | Tokens.xyz news feed | The latest 12 valid provider articles are normalized without editorial topic or source filtering. |
| Earnings | Provider boundary only | Live response currently unavailable/empty. |

Sample data is never marked `live`.

## Data states

| State | Client meaning |
| --- | --- |
| `live` | Recent source data inside Warren's live freshness window. |
| `delayed` | Valid informational data that is not sufficiently recent to call live. |
| `stale` | Last-known data retained beyond the delayed window. |
| `sample` | Controlled fixture content, never a live quote. |
| `unavailable` | No safe value is available. |

Every price has its own `priceAsOf`. `generatedAt` is response-generation time and does
not replace source freshness. A non-null price or percentage is accepted only with its
own non-null source timestamp and a non-`unavailable` state.

## News policy

- Warren requests the latest 12 Tokens.xyz items with `source=news`, `limit=12`, and no
  reserved social posts.
- Warren does not reject an otherwise valid article based on its topic, publisher, URL
  domain, or provider-related identifiers in this milestone.
- The API still rejects malformed records, invalid or unsafe URLs, and invalid timestamps,
  and deduplicates repeated article URLs.
- A valid provider image is normalized to optional `imageUrl`; missing or unsafe images
  become `null` without removing the article.
- Headline matches against a known company name or ticker populate `relatedAssetIds`;
  unmatched articles remain valid with an empty relationship list.
- An empty provider result returns an empty news list with `NEWS_EMPTY`.

## Partial failure behaviour

- Market status, indices, and news are loaded through independent boundaries. Failure or
  malformed data in one section preserves companies and healthy optional sections, while
  returning an unavailable value plus a warning only for the affected section.
- Catalogue refresh failure serves an in-window stale cache with `CATALOG_STALE`.
- Catalogue failure or an empty normalized provider catalogue without a safe cache returns
  `503 CATALOG_UNAVAILABLE`.
- Raw provider messages, stack traces, provider credentials, and API keys are not returned.

## Error response

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

| Status | Code | Meaning |
| --- | --- | --- |
| `400` | `INVALID_REQUEST` | Invalid query, query combination, limit, view, ID, or cursor. |
| `429` | `RATE_LIMITED` | Public-read rate limit exceeded; use `Retry-After`. |
| `503` | `CATALOG_UNAVAILABLE` | No live or safe cached catalogue is available. |
| `500` | `INTERNAL_ERROR` | Unexpected normalized server failure. |

## HTTP caching

Successful public responses currently send:

```http
Cache-Control: public, max-age=15, stale-while-revalidate=60
ETag: "<representation-hash>"
Vary: accept-encoding
```

Supplying the matching `If-None-Match` returns `304`. Authentication and session routes
retain `Cache-Control: no-store`.

The server separately caches the normalized company catalogue for 60 seconds and may use
it for another 15 minutes during a provider outage. These values are configurable.

## Configuration

Server-only variables:

```dotenv
TOKENS_API_BASE_URL=https://api.tokens.xyz
TOKENS_API_KEY=
HOME_PROVIDER_TIMEOUT_MS=5000
HOME_CATALOG_CACHE_SECONDS=60
HOME_CATALOG_STALE_SECONDS=900
HOME_HTTP_CACHE_SECONDS=15
HOME_HTTP_STALE_SECONDS=60
```

Provider secrets belong in an ignored API environment file. They must never use an
`EXPO_PUBLIC_*` name.

## Verification

The API is verified without starting localhost:

```sh
pnpm --filter @warren/home-contract typecheck
pnpm --filter @warren/api typecheck
pnpm --filter @warren/api test
pnpm --filter @warren/api verify:home:live
```

The live verifier uses Fastify injection and an in-memory database. It does not start a
localhost listener. It prints only normalized Warren responses and whether Tokens.xyz
authentication is configured; it never prints provider keys.

Tests cover:

- public bootstrap and runtime response validation;
- ETag revalidation and public cache headers;
- search by company, ticker, and token hint;
- canonical deduplication;
- stable pagination and invalid cursors;
- ordered watchlist resolution and unknown IDs;
- populated and empty earnings states;
- invalid queries and rate limiting;
- optional-section outages and empty news states;
- stale-cache recovery and no-cache failure;
- Tokens.xyz catalogue mapping, advisory filtering, and primary prices; and
- Tokens.xyz news normalization, company association, deduplication, freshness, and
  topic-agnostic latest-item mapping.

The live Tokens integration is exercised through Fastify injection against the real
provider without running a network listener. The verifier checks the company catalogue,
NVIDIA search and source freshness, and guarantees that Home returns no more than 12
normalized news items. Provider news may safely be empty when the feed has no valid items.
As of 2026-09-19, API typechecking and all 34 API tests pass, and the live verifier returns
a 24-company first page plus a fresh normalized NVIDIA price from Tokens.xyz.
