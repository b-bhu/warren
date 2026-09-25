# Kamino xStocks Lending API

Warren exposes a pinned Solana mainnet Kamino market with private wallet positions and an unsigned-review-sign-submit lifecycle. All wallet-scoped routes require a verified Privy bearer token; wallet addresses are checked against that identity and responses are `no-store`.

## Public market catalog

`GET /v1/lending/kamino/xstocks` returns the nine pinned xStock mints and reserve identities, the USDC debt mint and reserve, current route status, APYs, liquidity and LTV terms. Terms are read from Kamino's collateral-route and reserve-stat APIs. Missing, inactive or unrecognized routes are unavailable; provider failure does not reuse old terms. `KAMINO_LENDING_ENABLED` controls discovery and defaults to `true`.

## Private wallet and action routes

- `GET /v1/lending/kamino/xstocks/positions?walletAddress=…` returns only the authenticated wallet's xStock token holdings, USDC, and Kamino obligations. Raw quantities and scaled UI quantities are separate. Only the associated token account is marked spendable. Unsupported Token-2022 extensions, frozen/non-ATA holdings, mixed positions and non-vanilla obligations remain visible and cannot be used for unsupported actions.
- `GET /v1/lending/kamino/xstocks/actions?walletAddress=…` returns that wallet's recent Warren lending action history without unsigned or signed transaction data.
- `POST /v1/lending/kamino/xstocks/preview` accepts a contract-validated action and exact raw base-unit amounts (or `ALL` for repayment/withdrawal). The pinned Kamino SDK calculates projected health, SDK borrow/withdraw limits are reduced by Warren's configured headroom, and current USDC liquidity also limits borrowing.
- `POST /v1/lending/kamino/xstocks/actions` creates a durable review. Replays with the same user and idempotency key return that review; reusing a key with different action details is rejected.
- `GET /v1/lending/kamino/xstocks/actions/:actionId` refreshes status. `POST .../:actionId/next-step` creates the second step for combined supply/borrow or repay/withdraw reviews only after step one confirms.
- `POST .../:actionId/steps/:stepId/refresh` rebuilds and simulates an expired unsigned review. `POST .../:actionId/steps/:stepId/submit` accepts a signed transaction and an idempotency key. Warren verifies the signed message is byte-for-byte the reviewed message and verifies the selected wallet's Ed25519 signature.

The transaction journal saves the verified signature and an `unknown` submission state before contacting Solana. Ambiguous submission results are reconciled by signature; the API does not resubmit them. The pinned SDK builds obligation collateral/debt instructions, checks program and account identities, compiles the unsigned transaction, runs RPC simulation, and requests network/priority fee and rent estimates (or reports rent as unavailable when it cannot safely quote a new protocol account). The mobile app signs only through the selected embedded Privy wallet. Users see simulation, amount, fee estimate, current/proposed health, wallet, and expiry before signing. The recent action journal can restore a review after app restart.

The current xStock Token-2022 allowlist includes the observed metadata pointer/metadata, permanent delegate, initialized default-account state, scaled-UI, unpaused pausable, confidential-transfer configuration, and inactive transfer-hook sentinel (System Program) extensions. An active transfer hook, paused mint, unknown extension, unsupported token program or non-spendable account blocks supply. These conditions are re-read for reviews and the transaction must also pass current RPC simulation. Scaled multipliers affect display and user input conversion; instructions retain raw base units. [Solana Token-2022 extension guidance](https://www.solana-program.com/docs/token-2022/extensions) describes the scaled-UI multiplier and paused-transfer behavior.

## Operational controls

New supply and borrowing require `KAMINO_LENDING_NEW_RISK_ENABLED=true`; repay and withdraw have separate `KAMINO_LENDING_REPAY_ENABLED` and `KAMINO_LENDING_WITHDRAW_ENABLED` controls. All three default to `false`. `KAMINO_BORROW_HEADROOM_BPS` defaults to `5000`, applying half of the SDK-computed remaining borrow amount as Warren's additional buffer. Recovery actions stay independent of the new-risk gate. These flags do not alter protocol math or bypass route, wallet, instruction, simulation, signature, or idempotency checks.

Set `KAMINO_API_BASE_URL`, `KAMINO_MARKET_TIMEOUT_MS`, and a mainnet `HELIUS_RPC_URL` (or `SOLANA_RPC_URL`). Never put Privy secrets or RPC credentials in the mobile bundle. `pnpm --filter @warren/api verify:lending:live` checks only public route/stat reads. Automated tests use deterministic fixtures and mocked send/status providers; they do not submit a transaction. Enabling any action flag in a real deployment is a separate production decision after device signing/recovery QA and risk approval.
