# PRD: Spot Stock Execution

| Field | Value |
| --- | --- |
| Status | Backend and client implemented; physical-device manual QA pending |
| Parent | [Market Details and Trade Preview](./market_details_prd.md) |
| Milestone | [Milestone 1: Discover and Buy a Tokenized Stock](../../../milestone/milestone-one.md) |
| Experience reference | [`markets_details_mock.html`](../../../../markets_details_mock.html) |
| Execution venue | Jupiter Swap V2 on Solana mainnet |
| Wallet | Privy embedded Solana wallet owned by the signed-in user |
| Frontend acceptance owner | User/manual QA |
| Last updated | 2026-09-21 |

## 1. Summary

Spot execution lets a person swap a Jupiter-supported Solana asset for the exact
tokenized-stock mint shown on a Warren company page, or sell that stock token into a
chosen Jupiter-supported asset. The stock side stays locked to the verified Markets
instrument. The person may configure the ticket as a guest, but Warren creates an
executable order only after Privy sign-in and an embedded Solana wallet are ready.

The execution sequence is deliberately explicit:

`configure -> sign in -> fresh Jupiter order -> review -> wallet signature -> submit -> result`

Signing in never approves a trade. Reviewing never broadcasts a transaction. Warren
shows success only after Jupiter reports successful execution.

## 2. Provider decision

Warren uses Jupiter's current **Swap API V2 Meta-Aggregator**:

- `GET https://api.jup.ag/swap/v2/order` returns pricing and an assembled, unsigned
  versioned transaction;
- the user's Privy embedded Solana wallet signs that exact transaction; and
- `POST https://api.jup.ag/swap/v2/execute` lands and confirms the signed transaction.

The older Ultra endpoints are not used because Jupiter documents Swap V2 as their
replacement. Warren's server owns the Jupiter API key and provider calls. No provider
key is shipped in the mobile bundle.

References:

- [Jupiter Swap V2 overview](https://developers.jup.ag/docs/swap)
- [Jupiter order and execute](https://developers.jup.ag/docs/swap/order-and-execute)
- [Jupiter Tokens V2](https://developers.jup.ag/docs/tokens/token-information)

## 3. User outcome

A person can:

- open the trade ticket from a verified, available Spot instrument;
- choose Buy or Sell;
- search and select a Jupiter-supported settlement asset;
- keep the stock token locked to the exact Markets mint;
- enter an exact-input amount without seeing a fabricated estimate;
- sign in only when they continue toward an executable order;
- review a fresh provider quote, price impact, fees, route, and minimum output;
- approve exactly one wallet transaction;
- see pending, successful, failed, rejected, and expired states; and
- return to the same company after the result.

## 4. Scope

### In scope

- Buy and Sell exact-input swaps on Solana mainnet.
- Any settlement asset returned by Jupiter Tokens V2 and accepted by Swap V2.
- A curated popular-asset starting list plus backend search.
- Privy access-token verification on Warren's API.
- Privy embedded Solana wallet address binding.
- Fresh order creation, review, signing, execution, and result handling.
- Provider-normalized, machine-readable errors.
- Idempotent submission for the same Warren execution intent.
- Manual mobile QA handoff.

### Out of scope

- Limit orders, recurring orders, DCA, trigger orders, or routing controls.
- PreStock execution.
- Deposits, fiat on-ramp, bridging, lending, or borrowing.
- A Warren fee or referral fee in Milestone 1.
- An arbitrary token swap screen unrelated to a stock company.
- External-wallet transaction signing. The first implementation signs only with the
  Privy embedded Solana wallet already created by Warren.
- Server-side or delegated wallet signing.
- Fabricated balances, token metadata, price impact, fees, or route estimates.

## 5. Product invariants

1. The selected `assetId` and `instrumentId` must resolve to the same verified,
   available Spot instrument in the server-side Markets registry.
2. Buy always uses the Spot instrument mint as `outputMint`; Sell always uses it as
   `inputMint`.
3. The mobile client cannot override the stock mint supplied by the registry.
4. The settlement mint must be different from the stock mint and must resolve through
   Jupiter token metadata.
5. An executable order requires a valid Privy access token and the authenticated user's
   embedded Solana wallet address.
6. The returned transaction is short-lived and bound to the wallet, direction, exact
   input amount, mints, provider request ID, and Warren execution intent.
7. Warren never edits a Jupiter Meta-Aggregator transaction.
8. A signature is requested only from the explicit review state.
9. A rejected signature is terminal for that signing attempt but does not submit.
10. A stale or expired order must be replaced by a new order and reviewed again.
11. `Success` is shown only when Jupiter `/execute` returns `status: "Success"`.
12. Access tokens, signed or unsigned transactions, and provider responses are never
    written to logs or analytics.

## 6. Experience and interaction contract

### 6.1 Ticket entry

The Market Details action dock says `Trade {company}` when an available Spot or
Perpetual instrument exists. Opening it presents a full-screen ticket. Entry from a
Spot row preselects Spot; entry from a Perpetual row preselects Perpetual; a general
company entry prefers Spot.

### 6.2 Configure as guest

The Spot ticket follows the approved mock:

- product switch: `Spot | Perpetual`;
- direction switch: `Buy | Sell`;
- one prominent amount stage;
- stock side locked to the exact instrument;
- settlement asset picker on the flexible side;
- quick percentages only when a real wallet balance is known;
- an execution spine such as `USDC -> Jupiter -> NVDAx`; and
- a quiet issuer disclosure beneath quote details.

Before sign-in the screen must not show a wallet balance, output estimate, price impact,
minimum received, or network fee. It may show public token metadata and the current
Markets value, labelled as context rather than a quote.

### 6.3 Continue and sign in

If the person is a guest, `Review buy` / `Review sell` opens Warren sign-in while
preserving only non-sensitive ticket configuration. The copy must say that sign-in does
not approve the trade. After Privy and the embedded Solana wallet are ready, the user
returns to the ticket and explicitly requests a fresh order.

Authentication is offered only after the exact-input amount is locally valid for the
selected input asset's decimals. Empty, zero, malformed, over-precision, metadata-loading,
or contract-size-overflow values keep the primary action disabled with truthful guidance;
they must not open sign-in.

### 6.4 Review

The review state displays provider-returned values only:

- exact input and expected output;
- minimum output or provider threshold;
- input and output USD values when supplied;
- price impact;
- total fee and fee mint;
- router/route identity;
- signature, priority, and rent fees where supplied;
- quote expiry or last valid block height; and
- shortened wallet address.

The primary action is `Approve buy` or `Approve sell`. A separate Back/Edit action
returns to configuration and discards the executable order.

### 6.5 Signing and submission

The Privy embedded wallet signs the exact versioned transaction returned for the
reviewed order. Warren then submits the signed bytes with the matching Jupiter request
ID. The primary control is disabled while signing or submitting so one tap cannot cause
parallel requests.

### 6.6 Result

- Success: show executed input/output amounts, transaction signature, and a Solana
  explorer action.
- Failed: show a safe reason and `Get a new quote` when retry can help.
- Rejected: show `You rejected the wallet approval. Nothing was submitted.`
- Expired: discard the transaction and require a new review.
- Unknown/pending: do not imply failure or success; allow safe status reconciliation.

## 7. Visual direction

The ticket extends Warren's Ownership Register rather than introducing a generic crypto
swap card.

- **Palette:** Quarry `#F3F5F2` / `#131918`, Archive `#FFFFFF` / `#1C2523`, Graphite
  `#17211F` / Chalk `#F2F5F1`, Registry Blue `#0B5C78` / `#74C7DF`, Verification Red
  `#A63632` / `#FFAAA2`, Outline `#B9C3BF` / `#51615C`.
- **Type:** restrained serif for the company/screen title, sans for controls and
  explanations, mono for amounts, mints, routes, and transaction state.
- **Layout:** one amount stage, one conversion spine, one review ledger, and one safe-area
  action dock. Cards use the existing 12 pt radius; controls use 10 pt.
- **Signature element:** the conversion spine changes from public context to executable
  proof: `asset -> Jupiter -> stock`, followed by the exact wallet and request expiry.

Self-critique: a pair of large Buy/Sell cards, decorative gradients, token-logo clouds,
or green success chrome would make this feel like a generic exchange. The implementation
keeps the boldness in the conversion spine and makes the rest an inspectable ledger.

## 8. API contract

All execution responses use `Cache-Control: no-store`.

### `GET /v1/execution/spot/assets?query={text}`

Public token search used by the picker. The server proxies Jupiter Tokens V2, validates
the response, removes suspicious/banned entries, and returns at most 20 normalized
assets. An empty query returns a small verified popular list. It never returns a wallet
balance.

### `POST /v1/execution/spot/orders`

Requires `Authorization: Bearer <Privy access token>`.

```json
{
  "assetId": "nvidia",
  "instrumentId": "spot:nvidia:xstocks",
  "direction": "buy",
  "settlementMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "amount": "100000000",
  "walletAddress": "..."
}
```

`amount` is the exact input amount in base units. The server resolves the stock mint,
binds direction, calls Jupiter `/order`, stores a short-lived in-memory execution
intent, and returns a normalized review plus the base64 unsigned transaction.

### `POST /v1/execution/spot/orders/:executionId/submit`

Requires the same Privy identity and wallet as order creation plus an idempotency key.

```json
{
  "signedTransaction": "base64..."
}
```

The server confirms that the intent is unexpired and not already terminal, then calls
Jupiter `/execute` with the provider request ID belonging to that intent. Repeating the
same idempotency key returns the stored terminal result. A different submission for a
terminal intent is rejected.

## 9. Security and failure handling

- Warren verifies the Privy JWT issuer, audience, signature, and expiry before creating
  or submitting an order.
- Wallet address equality is exact after base58 canonicalization.
- Provider API keys exist only in API environment variables.
- Provider errors are mapped to Warren codes; raw payloads never cross the boundary.
- Transaction fields are never accepted independently from the stored intent.
- Per-IP mutation limits and per-identity execution limits apply.
- `transaction`, `signedTransaction`, access tokens, and provider request IDs are
  redacted from logs.
- Unknown provider shapes fail closed.

## 10. Acceptance criteria

### Backend

- [x] Spot asset search returns normalized Jupiter assets and filters unsafe shapes.
- [x] Order creation rejects guests, invalid JWTs, invalid wallets, unknown companies,
      non-Spot instruments, unavailable/unverified instruments, mint drift, equal mints,
      malformed base-unit amounts, and missing provider transactions.
- [x] Buy and Sell bind the stock mint to the correct side.
- [x] The response preserves provider price/fee/expiry semantics without client math.
- [x] Submission cannot cross identity, wallet, intent, provider request, or
      idempotency boundaries.
- [x] Provider timeout, quote failure, expiry, execution failure, and unknown results
      return stable safe errors.
- [x] Unit/integration tests pass without a live Jupiter key.

### Client

- [x] Available Spot companies open the full-screen ticket from Market Details.
- [x] Product and direction defaults respect entry context.
- [x] The flexible Spot side has a searchable asset picker; the stock side is locked.
- [x] Guest configuration survives sign-in without triggering an order or signature.
- [x] Review renders only backend/provider values.
- [x] Exactly one Privy wallet approval is requested after explicit review.
- [x] Pending, success, failure, rejection, and expiry have distinct accessible states.
- [ ] Runtime and visual acceptance remain owned by the user/manual QA.

## 11. Delivery gate

Spot execution is implementation-complete when the contracts, API, automated provider
adapter tests, mobile ticket, Privy signing path, and manual-QA handoff are present.
Release acceptance still requires the user's physical-device mainnet test with a small
amount and a configured Jupiter API key.
