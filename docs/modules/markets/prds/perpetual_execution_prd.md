# PRD: Perpetual Stock Execution

| Field | Value |
| --- | --- |
| Status | Backend and client implemented; physical-device manual QA pending |
| Parent | [Market Details and Trade Preview](./market_details_prd.md) |
| Product surface | Warren mobile trade ticket |
| Experience reference | [`markets_details_mock.html`](../../../../markets_details_mock.html) |
| Execution venue | Phoenix equity perpetuals on Solana mainnet |
| Wallet | Privy embedded Solana wallet owned by the signed-in user |
| Frontend acceptance owner | User/manual QA |
| Last updated | 2026-09-21 |

## 1. Summary

Perpetual execution lets an authenticated person open a long or short position in the
exact Phoenix equity-perpetual market attached to a Warren company. The first release
uses Phoenix isolated-order builders even though the parent account may be cross margin:
collateral assigned to the order is explicit, position risk is bounded to an isolated
subaccount, and Phoenix returns the liquidation estimate.

The mock supplies hierarchy and interaction language. It is not a source for balances,
funding effects, liquidation prices, leverage math, account state, or executable
instructions.

## 2. Provider decision

Warren uses Phoenix's current API and Solana instructions:

- Privy authentication is exchanged through `POST /v1/auth/login/privy`;
- public market facts stay in the Markets registry;
- executable Market orders use
  `POST /v1/ix/place-isolated-market-order-enhanced`;
- executable Limit orders use
  `POST /v1/ix/place-isolated-limit-order-enhanced`;
- Phoenix supplies `estimatedLiquidationPriceUsd` and instruction DTOs;
- Warren builds a short-lived Solana transaction from those exact instructions;
- the Privy embedded wallet signs it; and
- Warren submits the signed transaction to the configured Solana mainnet RPC.

References:

- [Phoenix auth](https://docs.phoenix.trade/sdk/auth)
- [Phoenix accounts](https://docs.phoenix.trade/sdk/accounts)
- [Phoenix orders](https://docs.phoenix.trade/sdk/orders)
- [Phoenix collateral](https://docs.phoenix.trade/sdk/collateral)
- [Phoenix enhanced market order](https://docs.phoenix.trade/api/trader/build-isolated-market-order-transaction-with-liquidation-estimate)
- [Phoenix enhanced limit order](https://docs.phoenix.trade/api/trader/build-isolated-limit-order-transaction-with-liquidation-estimate)

## 3. User outcome

A person with a ready, funded Phoenix account can:

- select the Perpetual product from the company trade ticket;
- choose Long or Short;
- enter USDC collateral;
- select leverage no higher than the market's server-returned maximum;
- choose Market or Limit and provide a limit price when applicable;
- review Phoenix market, mark price, notional, quantity, estimated liquidation price,
  current funding, fees when available, collateral movement, and wallet;
- sign one transaction that creates/funds the isolated subaccount as required and places
  the order; and
- see a Solana signature and explicit submitted/confirmed/failed state.

If the Phoenix account or collateral is not ready, Warren shows the exact prerequisite.
It never substitutes a sample balance or silently turns a position order into a deposit.

## 4. Scope

### In scope

- Available Phoenix equity perpetual instruments already attached to a company.
- Long and Short.
- Market and Limit order previews.
- Isolated order construction with explicit USDC collateral transfer.
- 1x through the server-advertised market maximum leverage.
- Phoenix-supplied liquidation estimate.
- Privy authentication exchange, embedded-wallet signing, and Solana RPC submission.
- Detection of missing trader account, unavailable capability, and insufficient
  transferable collateral.
- Stable execution states and safe errors.

### Out of scope

- Take-profit, stop-loss, attached conditional orders, and trailing orders.
- Closing, reducing, editing, or cancelling a position/order.
- Cross-chain deposits or an in-app Phoenix collateral deposit flow.
- Portfolio, live position PnL, order history, liquidation history, or notifications.
- Delegated/server-side wallet signing.
- External-wallet transaction signing.
- Client-calculated liquidation, account health, fees, or funding payment.
- Non-stock Phoenix markets.

## 5. Product invariants

1. `assetId` and `instrumentId` must resolve to the same verified, available Phoenix
   perpetual instrument in the server-side Markets registry.
2. The Phoenix symbol and market public key come from the registry/provider, never from
   client string construction.
3. Order creation requires a valid Privy access token and its embedded Solana wallet.
4. The wallet sent in the body must match the wallet bound into the Phoenix login and
   the Warren execution intent.
5. Collateral is USDC and is represented in base units at the provider boundary.
6. Quantity and notional are derived server-side from explicit collateral, leverage,
   current provider market data, and market lot constraints.
7. Requested leverage may never exceed the lower of registry maximum and current
   Phoenix risk-tier maximum.
8. Liquidation price is displayed only when Phoenix returns it.
9. A missing Phoenix trader account or insufficient transferable collateral produces an
   `actionRequired` result, not an executable transaction.
10. A wallet signature is requested only after explicit review.
11. Transaction expiry invalidates the review and requires a rebuild.
12. Warren does not claim the position is open until on-chain confirmation succeeds.

## 6. Experience and interaction contract

### 6.1 Configure

The Perpetual ticket follows the approved mock:

- product switch: `Spot | Perpetual`;
- direction switch: `Long | Short`;
- a prominent USDC collateral input;
- leverage presets clipped to the market maximum;
- Market/Limit selector and conditional limit-price field;
- an execution spine such as `$100 collateral x 2 -> $200 exposure` only after a real
  provider preview supplies sufficient inputs;
- a risk ledger led by provider-estimated liquidation; and
- an explicit perpetual/liquidation disclosure.

Guest users may inspect public market facts and enter a proposed collateral/leverage
configuration. Warren must not show a Phoenix balance or executable risk result before
authentication.

The primary action offers authentication only after collateral is a locally valid,
positive USDC base-unit amount and, for Limit orders, the limit price is also a valid
positive decimal. Empty, zero, malformed, over-precision, or oversized values keep the
action disabled and must not open sign-in.

### 6.2 Authentication and prerequisites

Continuing as a guest opens Privy sign-in and states that sign-in does not place an
order. Once signed in, Warren exchanges the current Privy access token with Phoenix and
reads trader state for the embedded Solana wallet.

Possible prerequisites are:

- `Phoenix account required`;
- `Deposit USDC collateral on Phoenix`;
- `Trading is restricted for this account`;
- `Market is not accepting risk-increasing orders`; or
- `Requested leverage is not available for this size`.

The first execution release does not hide these states behind a disabled button.

### 6.3 Review

The backend creates a Phoenix enhanced isolated-order preview. Review displays:

- Long/Short and Market/Limit;
- exact market symbol;
- collateral moved from parent to isolated account;
- position quantity and notional;
- mark or limit price with timestamp;
- effective leverage;
- Phoenix-estimated liquidation price, or `Not supplied by Phoenix`;
- funding rate and next funding time from current market data;
- margin mode and isolated subaccount index;
- fee/rent/network estimates when known;
- shortened signing wallet; and
- blockhash expiry.

Changing any order field discards the transaction and requires a fresh review.

### 6.4 Sign and submit

The embedded Solana wallet signs the exact transaction assembled from Phoenix-returned
instructions. Warren submits the signed bytes through its configured mainnet RPC and
stores only the safe execution result. It does not retain or log signed transaction
bytes.

### 6.5 Result

- Confirmed: show `Position order confirmed`, Solana signature, company, direction,
  quantity, and explorer action.
- Submitted/pending: show that the transaction was sent but is not yet confirmed; never
  imply the position exists.
- Failed: show a safe mapped error and require a fresh preview where relevant.
- Rejected: show `You rejected the wallet approval. Nothing was submitted.`
- Expired: discard and rebuild.

## 7. Visual direction

Perpetuals reuse Spot's full-screen execution shell and Warren's theme. The distinct
element is the **risk ledger**, not a wall of red/green trading chrome.

- Registry Blue identifies selected product, confirmed facts, and primary actions.
- Verification Red appears only for Short selection, liquidation risk, and actionable
  failure text; it never floods the screen.
- Serif remains limited to the company/title. Mono carries collateral, leverage,
  quantity, prices, funding, and signatures.
- The amount stage and risk ledger are vertically ordered so collateral and exposure
  precede liquidation.
- 44 pt minimum targets, dynamic-height rows, and safe-area action docking are required.

Self-critique: the mock's instant client-side liquidation and funding values look
polished but are unsafe. The implementation replaces them with a restrained unavailable
state until Phoenix supplies an executable preview.

## 8. API contract

All routes require `Authorization: Bearer <Privy access token>` and return
`Cache-Control: no-store`.

### `POST /v1/execution/perpetual/orders`

```json
{
  "assetId": "nvidia",
  "instrumentId": "perpetual:phoenix:nvda",
  "direction": "long",
  "orderType": "market",
  "collateralAmount": "100000000",
  "leverage": 2,
  "limitPrice": null,
  "walletAddress": "..."
}
```

The server validates identity and registry ownership, exchanges the Privy token with
Phoenix, reads the current market/account state, chooses a safe isolated subaccount,
calls the enhanced builder, converts instruction DTOs into a short-lived Solana
transaction, and returns either:

- `state: "review"` with provider values and `unsignedTransaction`; or
- `state: "action_required"` with a stable prerequisite code and no transaction.

### `POST /v1/execution/perpetual/orders/:executionId/submit`

```json
{
  "signedTransaction": "base64..."
}
```

The same Privy identity and wallet must own the unexpired intent. An idempotency key is
required. The server sends the bytes through Solana mainnet RPC, then confirms the
signature to the configured commitment or returns an explicit submitted/pending state.

## 9. Security and failure handling

- Privy JWT signature, issuer, audience, and expiry are verified by Warren.
- Phoenix access/refresh tokens remain server-side and are never logged or returned.
- Phoenix provider instructions are validated for well-formed public keys, account
  metadata, byte ranges, and expected signer before transaction assembly.
- The transaction fee payer and authority must equal the bound embedded wallet unless a
  future PRD explicitly introduces sponsorship.
- The API never accepts arbitrary instructions, program IDs, Phoenix symbols, or market
  public keys from the client.
- Raw provider errors and RPC simulation logs never cross the public error boundary.
- Submitted transaction bytes are held only for the request lifetime.
- Duplicate submit calls are idempotent.

## 10. Acceptance criteria

### Backend

- [x] Invalid/expired Privy tokens and wallet mismatch fail before Phoenix order calls.
- [x] Non-Phoenix, unavailable, unverified, or cross-company instruments are rejected.
- [x] Direction, collateral, leverage, order type, and limit price are strictly
      validated.
- [x] Phoenix account/collateral/capability prerequisites return action-required
      contracts without fabricated values.
- [x] Market and Limit paths call their matching enhanced Phoenix builders.
- [x] Liquidation appears only from Phoenix's response.
- [x] Instruction DTO validation and signer binding fail closed.
- [x] Submission is identity-bound, wallet-bound, expiry-aware, and idempotent.
- [x] Provider and RPC adapter tests pass without mainnet submission.

### Client

- [x] Perpetual preselection works from a Perpetual market entry.
- [x] Long/Short, collateral, leverage, Market/Limit, and limit-price controls match the
      approved mock hierarchy and Warren theme.
- [x] Guest configuration survives sign-in without creating or signing an order.
- [x] Action-required states explain the exact next prerequisite.
- [x] Review uses only backend/provider values and asks for one explicit approval.
- [x] Rejection, expiry, pending, confirmed, and failure remain visibly distinct.
- [ ] Runtime and visual acceptance remain owned by the user/manual QA.

## 11. Delivery gate

Perpetual execution is implementation-complete when contracts, API/provider adapters,
mobile configuration/review/signing states, and non-live automated verification are
present. Physical-device confirmation with a funded Phoenix account remains a manual QA
gate and is never simulated by Warren.
