# Market Details API: Backend Handoff

| Field | Value |
| --- | --- |
| Status | Gate A complete; automated and live-provider verification pass |
| PRD | [Market Details and Trade Preview](../prds/market_details_prd.md) |
| Parent API | [Markets API](./markets_api.md) |
| Runtime | Fastify, Node.js, TypeScript |
| Contract | `@warren/markets-contract` |
| Last updated | 2026-09-21 |

## Boundary

The Market Details API is public and read-only. Guests and signed-in users receive the
same company, history, and news data. An access token is neither required nor interpreted
by these routes.

The API does not return balances, portfolio data, executable quotes, transactions, or
provider credentials. Guest saves remain mobile-local in this milestone; account-backed
save synchronization is later scope.

## Endpoints

### `GET /v1/markets/companies/:assetId`

Returns the company identity and every intentionally exposed instrument, plus the
backend-owned hero selection.

New Market Details fields:

- `company.description`: verified instrument description, source, and source URL, or
  `null`;
- `primaryInstrumentId`: exact instrument used by the hero, or `null` when no safe value
  exists;
- `hero`: exact product, provider, and labelled `marketValue` copied from that instrument;
- `history`: exact-instrument chart capability and ranges, or `null`; and
- section-labelled `warnings`.

Hero priority is deterministic:

1. verified available Spot with a known token value;
2. verified available PreStock with a known provider value;
3. verified available Perpetual with a known mark value; then
4. a verified preview/paused instrument with a known value.

No values are averaged or relabelled. If every instrument has an unknown value,
`primaryInstrumentId` and `hero` are both `null`.

```sh
curl -sS 'http://127.0.0.1:3000/v1/markets/companies/nvidia' | jq
curl -sS 'http://127.0.0.1:3000/v1/markets/companies/anthropic' | jq
```

The NVIDIA response should select the available Spot instrument even when a Phoenix
Perpetual also exists. Anthropic currently selects its labelled PreStock provider value
and intentionally reports no Spot chart capability.

### `GET /v1/markets/companies/:assetId/history`

Returns real candles for one exact instrument.

| Query | Required | Values |
| --- | --- | --- |
| `instrumentId` | yes | Exact ID returned by the company response. |
| `range` | no | `1d`, `1w`, `1m`, `3m`, `6m`, `1y`, or `5y`; default `1m`. |

The current implementation supports verified Spot instruments through Tokens.xyz
mint-scoped OHLCV. It passes the exact Solana mint to the provider, so a token chart is
not silently replaced by an underlying-equity chart. Supported range/interval mappings
are backend-owned:

| Range | Provider interval |
| --- | --- |
| `1d` | `5m` |
| `1w` | `1H` |
| `1m` | `4H` |
| `3m`, `6m`, `1y` | `1D` |
| `5y` | `1W` |

```sh
curl -sS \
  'http://127.0.0.1:3000/v1/markets/companies/nvidia/history?instrumentId=spot%3Anvidia%3AxStock&range=1m' \
  | jq
```

Use the actual `instrumentId` from your company response; provider identifiers can
change. A known instrument without matching history returns `200` with:

- `dataState: "unavailable"`;
- `points: []`; and
- a section `history` warning explaining whether retry can help.

An instrument that does not belong to the company returns `404 NOT_FOUND`. An invalid
range or malformed ID returns `400 INVALID_REQUEST`.

History has its own fresh/stale cache. A failed refresh can serve safe cached candles
with `dataState: "stale"` and `HISTORY_STALE`. A failure without a cache returns the
explicit unavailable response and never affects the company endpoint.

### `GET /v1/markets/companies/:assetId/news`

Returns up to 12 newest provider-associated company articles.

```sh
curl -sS 'http://127.0.0.1:3000/v1/markets/companies/nvidia/news' | jq
```

The server calls Tokens.xyz in token mode using canonical `asset_id`, company `name`,
and public `symbol` when one exists. It does not fill the result with unrelated global
market news. Each normalized item contains:

- stable `id` and canonical `assetId`;
- headline, source, and publication time;
- safe image and article URLs; and
- freshness `dataState`.

No matching articles is a valid `200` with `items: []`. Provider failure also preserves a
`200` empty result but adds retryable `NEWS_UNAVAILABLE`; a safe cached result may be
returned with `NEWS_STALE`. News failure never invalidates company or instrument data.

## Cache and validation

- Company, history, and news responses have ETags and public
  `stale-while-revalidate` headers.
- Registry, history, and news caches fail independently.
- Every response is parsed by a strict Zod runtime schema before it leaves the service.
- Raw provider errors, payloads, request IDs, and API keys are never returned.
- Every warning identifies `registry`, `company`, `history`, or `news` as its section.

## Manual terminal acceptance

Start the API in one terminal:

```sh
pnpm dev:api
```

In another terminal, inspect the main scenarios:

```sh
# Public company with Spot + Perpetual. Hero must be Spot.
curl -sS 'http://127.0.0.1:3000/v1/markets/companies/nvidia' | jq '{company, primaryInstrumentId, hero, history, instruments: [.instruments[] | {instrumentId, productType, provider}]}'

# Private/PreStock-only company. Hero must be labelled PreStock; history is null.
curl -sS 'http://127.0.0.1:3000/v1/markets/companies/anthropic' | jq '{company, primaryInstrumentId, hero, history}'

# Copy NVIDIA's current history instrument ID rather than assuming it.
INSTRUMENT_ID=$(curl -sS 'http://127.0.0.1:3000/v1/markets/companies/nvidia' | jq -r '.history.instrumentId')
curl -sS --get 'http://127.0.0.1:3000/v1/markets/companies/nvidia/history' \
  --data-urlencode "instrumentId=$INSTRUMENT_ID" \
  --data-urlencode 'range=1m' \
  | jq '{instrumentId, range, interval, valueLabel, provider, dataState, pointCount: (.points | length), warnings}'

# Company-associated news only.
curl -sS 'http://127.0.0.1:3000/v1/markets/companies/nvidia/news' | jq '{assetId, articleCount: (.items | length), items: [.items[] | {headline, source, publishedAt}], warnings}'

# Unknown company.
curl -sS -i 'http://127.0.0.1:3000/v1/markets/companies/not-a-company'
```

To confirm guest and signed-in reads share the public contract, compare the response with
and without an Authorization header. The ETag and payload remain the same because user
identity does not alter market facts.

## Automated verification

```sh
pnpm --filter @warren/markets-contract typecheck
pnpm --filter @warren/api typecheck
pnpm --filter @warren/api test
pnpm --filter @warren/api verify:markets:live
```

The test suite proves Spot, PreStock-only, Perpetual-only, unknown-value, invalid-input,
section-failure, stale-cache, public guest/signed-in parity, redaction, and provider-shape
cases. The live verifier proves current NVIDIA Spot hero selection, exact-mint history,
company news, and Anthropic's PreStock-only fallback without printing credentials.
