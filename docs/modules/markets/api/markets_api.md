# Markets API: Backend Handoff

| Field | Value |
| --- | --- |
| Status | Gate A complete; live provider verification passes |
| PRD | [Markets Instrument Registry](../prds/markets_prd.md) |
| Runtime | Fastify, Node.js, TypeScript |
| Contract package | `@warren/markets-contract` |
| Last updated | 2026-09-19 |

## Purpose

The Markets API gives the mobile app one Warren-owned registry across tokenized spot
stocks, private-company exposure, and stock perpetuals. The client never calls a
provider directly and never needs provider credentials.

All three endpoints are public and read-only. They do not authenticate a user, connect a
wallet, request an executable quote, or construct a transaction.

## Providers and responsibilities

| Product | Source | Warren uses it for |
| --- | --- | --- |
| Spot | Tokens.xyz `stocks` curated list | Canonical company identity, preferred safe Solana variant, issuer, mint, token price, change, liquidity, and volume, excluding variants owned by the dedicated Tessera/PreStocks adapters. |
| PreStocks | `prestocks.com/api/prestocks` | Provider catalogue, official mint, provider token/mark values, valuations, supply, and product description. |
| PreStocks | Tessera official on-chain registry | tSpaceX, tKalshi, and tOpenAI mint identity, loan-participation structure, and transfer fee. |
| Perpetuals | Phoenix public API | Stock-market list, Phoenix market identity, mark price, funding, leverage, margin mode, and open interest. |

Jupiter is deliberately absent from this read-only API. It belongs to the later Spot
quote/execution boundary and must not be used as a catalogue or reference-price source.
Likewise, a Backpack Securities instrument in this registry is discovery data, not a
claim that Warren can execute it through Jupiter. Backpack stock execution uses its own
securities/RFQ integration boundary.

## Endpoints

### `GET /v1/markets`

Returns one product-family registry page.

| Query | Default | Rules |
| --- | --- | --- |
| `product` | `spot` | `spot`, `prestock`, or `perpetual`. |
| `availability` | `all` | `all` or `available`. |
| `sort` | Product-specific | Spot: `activity`, `alphabetical`, `change`; PreStocks: `alphabetical`; Perpetuals: `activity`, `alphabetical`. |
| `cursor` | omitted | Opaque cursor returned by the previous response and bound to the same filters/sort. |
| `limit` | `24` | Integer from 1 through 50. |

Default sort is `activity` for Spot and Perpetuals and `alphabetical` for PreStocks.
Spot activity uses provider 24-hour USD volume. Perpetual activity uses open interest.

Examples:

```sh
curl -sS 'http://127.0.0.1:3000/v1/markets?product=spot&limit=5'
curl -sS 'http://127.0.0.1:3000/v1/markets?product=prestock&sort=alphabetical&limit=20'
curl -sS 'http://127.0.0.1:3000/v1/markets?product=perpetual&availability=available&limit=10'
```

Abbreviated response:

```json
{
  "generatedAt": "2026-09-19T16:54:00.000Z",
  "query": {
    "product": "spot",
    "availability": "all",
    "sort": "activity"
  },
  "counts": {
    "spot": 396,
    "prestock": 11,
    "perpetual": 37
  },
  "items": [],
  "pageInfo": {
    "nextCursor": null,
    "hasNextPage": false
  },
  "warnings": []
}
```

Counts and values are examples from the 2026-09-19 live verification and will change as
providers change their catalogues.

### `GET /v1/markets/search`

Searches every product family and returns one result per canonical company.

| Query | Default | Rules |
| --- | --- | --- |
| `q` | required | Trimmed company, public ticker, instrument symbol, or provider; 1–80 characters. |
| `limit` | `12` | Integer from 1 through 20. |

Examples:

```sh
curl -sS 'http://127.0.0.1:3000/v1/markets/search?q=nvda'
curl -sS 'http://127.0.0.1:3000/v1/markets/search?q=anthropic'
curl -sS 'http://127.0.0.1:3000/v1/markets/search?q=tOpenAI'
```

Searching `nvda` returns one NVIDIA company with Spot and Perpetual capability summaries.
Matching an instrument symbol still returns its canonical company rather than a duplicate
provider row. No match is `200` with an empty `items` array.

### `GET /v1/markets/companies/:assetId`

Returns every intentionally exposed instrument beneath one canonical company.

```sh
curl -sS 'http://127.0.0.1:3000/v1/markets/companies/nvidia'
```

The response contains company identity, `availableNow`, exact Spot/PreStock/Perpetual
records, and provider warnings. Unknown asset IDs return `404 NOT_FOUND`.

The canonical ID may come from Tokens.xyz when a private or perpetual instrument matches
a Tokens company. Clients must use the `assetId` returned by search/list responses rather
than generating one from the company name.

## Product-specific records

Every instrument includes:

- `instrumentId`, `assetId`, company identity, symbol, provider, and exact identifier;
- `verificationState` and product `availability`;
- a labelled `marketValue` with independent data state; and
- the discriminating `productType`.

Spot records additionally include issuer, mint, redeemability tier, 1-day change,
24-hour volume, and liquidity.

PreStock records additionally include exposure structure, provider token/mark values,
valuations, supply, transfer fee when known, and provider details URL. The current
PreStocks endpoint supplies values without a source timestamp. Warren preserves those
numbers but reports their freshness as `unavailable`; it does not invent a live time.

Perpetual records additionally include Phoenix market pubkey, margin mode, maximum
leverage, funding rate, next funding time, open interest, and oracle/index label.

## Availability and data state

Product availability is separate from market-data freshness.

| Availability | Meaning in this read-only API |
| --- | --- |
| `available` | The provider currently exposes a verified instrument Warren can inspect. |
| `preview` | The instrument is known but current market/liquidity support is incomplete. |
| `paused` | Provider/advisory state prevents treating it as currently available. |
| `unavailable` | Warren cannot safely expose the product beyond identity. |

| Data state | Meaning |
| --- | --- |
| `live` | Source timestamp is inside the provider-specific live window. |
| `delayed` | Source data is valid but outside the live window. |
| `stale` | Last-known data is retained beyond the delayed window. |
| `sample` | Controlled development fixture. |
| `unavailable` | The value or its source freshness cannot be established. |

The PreStocks API's undated provider values are intentionally `unavailable` for freshness
even though their numeric values are preserved for labelled display.

## Canonical company normalization

1. Tokens spot instruments retain their Tokens `assetId`.
2. Tessera and PreStocks variants are removed from the Tokens Spot adapter so the same
   private-market mint cannot masquerade as both Spot and PreStock.
3. Perpetual and private-market records match a spot company by public ticker, product
   symbol, or normalized company name.
4. Matching records inherit the canonical `assetId`, company name, and logo fallback.
5. Provider instruments remain distinct through `instrumentId`; they are never merged
   into one generic price.
6. Global search groups the distinct instruments into one company result.

This is why NVIDIA search returns one company while its company response contains both
the Tokens spot instrument and the Phoenix perpetual.

## Partial failure and caching

- Each provider has its own fresh/stale cache.
- A provider failure returns healthy providers plus `PROVIDER_UNAVAILABLE`.
- A failed refresh with a safe cached value returns `PROVIDER_STALE` and marks timestamped
  values stale.
- If every provider fails without a safe cache, the API returns retryable
  `503 REGISTRY_UNAVAILABLE`.
- Provider errors and payloads are not exposed to the client.
- Successful responses use ETags and public `stale-while-revalidate` cache headers.

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
| `400` | `INVALID_REQUEST` | Invalid product, filter, sort, limit, cursor, query, or asset ID. |
| `404` | `NOT_FOUND` | No company exists for the supplied canonical asset ID. |
| `429` | `RATE_LIMITED` | Public-read rate limit exceeded; inspect `Retry-After`. |
| `503` | `REGISTRY_UNAVAILABLE` | No provider or safe cached registry is available. |
| `500` | `INTERNAL_ERROR` | Unexpected normalized server failure. |

## Configuration

```dotenv
TOKENS_API_BASE_URL=https://api.tokens.xyz
TOKENS_API_KEY=
PRESTOCKS_API_URL=https://prestocks.com/api/prestocks
PHOENIX_API_BASE_URL=https://perp-api.phoenix.trade
MARKETS_PROVIDER_TIMEOUT_MS=8000
MARKETS_REGISTRY_CACHE_SECONDS=60
MARKETS_REGISTRY_STALE_SECONDS=900
MARKETS_HTTP_CACHE_SECONDS=15
MARKETS_HTTP_STALE_SECONDS=60
```

Only Tokens.xyz currently needs a key, and it is already stored server-side. No provider
credential is shipped to the mobile client.

## Verification

Automated verification:

```sh
pnpm --filter @warren/markets-contract typecheck
pnpm --filter @warren/api typecheck
pnpm --filter @warren/api test
pnpm --filter @warren/api verify:markets:live
```

The live verifier uses Fastify injection rather than opening a localhost listener. It
checks all three product families, NVIDIA capability grouping, Anthropic private-market
discovery, runtime schemas, and provider availability without printing credentials.

As of 2026-09-19:

- both contract and API typechecking pass;
- all 46 API tests pass;
- the live verifier returns 396 Spot, 11 PreStock, and 37 stock-perpetual instruments;
- NVIDIA resolves to one company with Tokens Spot and Phoenix Perpetual capabilities; and
- Anthropic resolves with its live provider capabilities.
