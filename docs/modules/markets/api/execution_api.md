# Spot and Perpetual Execution API

| Field | Value |
| --- | --- |
| Status | Implemented; physical-device mainnet QA pending |
| Contracts | `@warren/execution-contract` |
| Spot venue | Jupiter Swap API V2 |
| Perpetual venue | Phoenix enhanced isolated-order builders |
| Authentication | Privy access token plus linked embedded Solana wallet |

Every response uses `Cache-Control: no-store`. Executable requests require
`Authorization: Bearer <Privy access token>`. Submit requests also require an
`Idempotency-Key` header containing 16–128 URL-safe characters.

## Endpoints

### `GET /v1/execution/spot/assets?query=`

Public Jupiter Tokens V2 search for the Spot settlement-asset picker. An empty query
returns a short popular list. The response contains metadata only—never wallet balances.

### `POST /v1/execution/spot/orders`

Creates a short-lived Jupiter review. The server resolves `assetId` and `instrumentId`
against the Markets registry, locks the stock mint to the correct Buy/Sell side, verifies
that `walletAddress` belongs to the Privy user, and returns the provider's unsigned
transaction and review values. It does not sign or submit anything.

### `POST /v1/execution/spot/orders/:executionId/submit`

Accepts `{ "signedTransaction": "base64" }`. Warren verifies that the signed Solana
message is byte-for-byte identical to the reviewed message and that the bound Privy
wallet supplied a valid Ed25519 signature. It then passes the transaction and stored
request ID to Jupiter `/execute`.

### `POST /v1/execution/perpetual/orders`

Creates either:

- a Phoenix review with an isolated-margin transaction, mark price, quantity, funding,
  and provider liquidation estimate; or
- an `action_required` response when the trader account, collateral, or risk capability
  is missing.

The client cannot supply Phoenix instructions, symbols, market keys, or program IDs.

### `POST /v1/execution/perpetual/orders/:executionId/submit`

Validates the reviewed transaction and embedded-wallet signature, then submits the raw
transaction through the configured Solana mainnet RPC. The initial successful response
is `submitted`; it is not presented as confirmed.

## Stable error behavior

Execution failures use the shared envelope:

```json
{
  "error": {
    "code": "QUOTE_EXPIRED",
    "message": "This review expired. Get a fresh order.",
    "retryable": false,
    "requestId": "...",
    "executionId": "..."
  }
}
```

Important codes include `AUTH_REQUIRED`, `SESSION_INVALID`, `WALLET_MISMATCH`,
`INSTRUMENT_NOT_EXECUTABLE`, `QUOTE_UNAVAILABLE`, `QUOTE_EXPIRED`,
`EXECUTION_STATE_INVALID`, `PROVIDER_UNAVAILABLE`, `SUBMISSION_FAILED`, and
`RATE_LIMITED`.

## Required server configuration

- `PRIVY_APP_ID` and `PRIVY_APP_SECRET`
- `JUPITER_API_KEY` for dependable Jupiter access
- `SOLANA_RPC_URL` for Phoenix transaction construction/submission
- the existing `PHOENIX_API_BASE_URL`

No secret belongs in the Expo environment. The mobile app needs only a reachable
`EXPO_PUBLIC_API_URL` and its public Privy identifiers.
