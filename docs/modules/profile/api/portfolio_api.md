# Portfolio API

All Portfolio endpoints are private. Send the current Privy access token as:

```http
Authorization: Bearer <privy-access-token>
```

Responses use Warren's normalized Portfolio contract; provider payloads and credentials are never
returned. Every successful response uses `Cache-Control: no-store`.

Each endpoint accepts an optional `walletAddress` query parameter. The mobile app sends its active
embedded Solana wallet so Portfolio and execution use the same account. The API rejects an address
that is not linked to the verified Privy user with `403 WALLET_MISMATCH`.

## `GET /v1/portfolio/overview`

Returns the Portfolio landing view:

- connected Solana wallet and authoritative supported-asset state;
- Phoenix account state plus in-app registration metadata when the default trader account is
  confirmed absent;
- reconciled net account equity;
- priced holdings, cash, Phoenix equity, and gross perpetual exposure;
- unresolved execution attention;
- previews of open orders, open positions, and holdings;
- section-scoped warnings when one provider is unavailable.

`netAccountEquity` is unavailable unless the exact-mint registry, wallet balances, and Phoenix
account state all load. Unpriced holdings remain in `holdings` with `valuationIncluded: false` and
are excluded from totals.

### Account capability fields

`wallet.supportedAssetState` is one of:

- `funded` — at least one supported stock token, USDC, or native SOL balance is non-zero;
- `empty` — balances and the complete supported registry loaded and no token balance exists;
- `unsupported_only` — balances and registry loaded, but only unsupported token balances exist;
- `unavailable` — wallet balances or the registry required to classify them failed;
- `not_loaded` — the endpoint intentionally does not load balances, currently Activity only.

`perpetuals.accountState` is `ready`, `not_initialized`, or `unavailable`. These states are not
interchangeable. Only `not_initialized` includes `perpetuals.registration`:

```json
{
  "accountState": "not_initialized",
  "registration": {
    "feePayer": "user_wallet",
    "mode": "non_referral"
  }
}
```

`mode` becomes `referral` only when Warren has a valid Phoenix referral code configured. No setup
URL is required by the contract. Registration is completed through Warren's transaction review,
the user's Privy Solana wallet, and the Phoenix registration API.

## Phoenix account registration

### `POST /v1/portfolio/phoenix/registrations`

Body:

```json
{ "walletAddress": "<linked-solana-wallet>" }
```

For the current non-referral path, Warren calls Phoenix
`POST /v1/exchange/build-register-ixs`, validates the returned fee payer and signer set, and builds
a short-lived Solana transaction. The response is a review containing the default cross-margin
account indexes, `maxPositions`, the user-paid network-fee/rent disclosure, expiry, and an unsigned
transaction. Phoenix credentials and referral codes are never returned.

### `POST /v1/portfolio/phoenix/registrations/:registrationId/submit`

Send `Idempotency-Key` and:

```json
{ "signedTransaction": "<base64-wire-transaction>" }
```

Warren verifies that the signed message exactly matches the review and that the linked wallet
signed as fee payer. It then calls Phoenix `POST /v1/exchange/send-register-ixs`. The transaction
creates only the default Phoenix trader account; it does not deposit collateral or place an order.

### `GET /v1/portfolio/phoenix/registrations/:registrationId`

Returns `submitted`, `confirmed`, or `failed` from Solana signature status. A confirmed result tells
the client to refresh Portfolio and explains that USDC collateral is still required before trading.
Once submission has been attempted Warren never blindly resubmits an unknown transaction.

`PHOENIX_REFERRAL_CODE` is optional. When configured, Warren uses Phoenix Rise's wallet-signed
referral activation transaction and submits it to `POST /v1/referral/activate-tx`. The code remains
server-side and is never returned in the review payload. Without a code, Warren continues to use
the non-referral builder endpoints. If the referral builder is unavailable, Warren fails closed
with `503 REFERRAL_ONBOARDING_UNAVAILABLE`; it never silently downgrades to non-referral onboarding.

## `GET /v1/portfolio/positions`

Returns the complete current-state collections:

- `openOrders`: Phoenix orders that are not positions;
- `openPositions`: Phoenix perpetual exposure and venue-backed PnL/risk fields;
- `holdings`: exact-mint-matched Spot and PreStock balances;
- `cashBalances`: USDC available to trade and SOL reserved for network fees.

Unavailable risk fields are `null`; clients must not calculate or invent liquidation data.

## `GET /v1/portfolio/activity`

Query parameters:

| Parameter | Values | Default |
| --- | --- | --- |
| `cursor` | Opaque value returned by the previous page | none |
| `limit` | `1`–`50` | `20` |
| `kind` | `all`, `trades`, `perpetuals`, `transfers`, `funding` | `all` |
| `status` | `all`, `pending`, `confirmed`, `failed`, `unknown` | `all` |
| `query` | Company, ticker, symbol, or transaction reference | none |

The result is reverse chronological. Warren execution records take precedence over their matching
wallet transfers, and Phoenix fills take precedence over matching submitted orders. Follow
`pageInfo.nextCursor` only when `pageInfo.hasNextPage` is true.

## Data authorities

| Portfolio fact | Authority |
| --- | --- |
| User and linked Solana wallet | Privy |
| SOL/SPL/Token-2022 balances and transfers | Helius |
| Supported stock-token identity and prices | Warren Markets registry (Tokens.xyz, PreStocks, Tessera) |
| Perpetual collateral, positions, orders, fills, and funding | Phoenix |
| Review, submission, outcome, and idempotency lifecycle | Warren SQLite ledger |

## Failure behavior

- Missing bearer token: `401 AUTH_REQUIRED`.
- Expired or invalid Privy token: `401 SESSION_INVALID`.
- Signed-in user without a Solana wallet: `422 WALLET_REQUIRED`.
- Invalid cursor or filters: `400 INVALID_CURSOR` / `400 INVALID_REQUEST`.
- Missing/expired registration review: `404 REGISTRATION_NOT_FOUND` /
  `410 REGISTRATION_EXPIRED`.
- Replayed or mismatched registration submission: `409 REGISTRATION_STATE_INVALID` or
  `400 INVALID_REQUEST`.
- A provider section failing normally returns `200` with its healthy sections and a scoped warning.
- Raw provider, RPC, configuration, and credential errors are never exposed to the client.
