# xStocks Lending QA

## Automated validation

- `pnpm --filter @warren/api test` covers pinned route data, private wallet ownership, risk gates, durable journal/idempotency, exact signed-message verification, and mocked signature reconciliation.
- `pnpm --filter mobile test` covers base-unit precision and scaled-UI conversion. API calls and native signing use the shared lending contracts.
- `pnpm typecheck`, `pnpm --filter mobile lint`, and a web export validate the API and app builds.
- `pnpm --filter @warren/api verify:lending:live` performs public Kamino market reads only. It does not prepare, simulate, sign, or submit a wallet transaction.

## Market and wallet review

1. Open Markets → Lending and check the nine pinned assets, exact mint, active USDC route, current rates, liquidity and refresh behavior.
2. Open an asset with a Privy embedded Solana wallet. Confirm the screen shows the selected wallet, scaled xStock balance, raw identity, USDC balance, obligations, debt, LTV and any unsupported/mixed-position reason.
3. Test signed-out, loading, recovery-required, unavailable API, and wrong-wallet states. Private positions and action routes must never appear from a cached response.
4. Confirm the recent Warren action history is scoped to this wallet and an unsigned/signed transaction is not exposed in history.
5. Check each of Supply, Borrow, Repay and Withdraw. New-risk actions follow `KAMINO_LENDING_NEW_RISK_ENABLED`; recovery actions use their own flags. `ALL` is offered only for repay/withdraw. Unsupported token accounts cannot be supplied.

## Unsigned action review and recovery

1. With a deterministic test wallet and mocked transaction provider, preview a supported amount. Check exact wallet/mint, current and projected raw balances, current/projected LTV, liquidation headroom, USDC liquidity, SDK-derived safe limits, network fee estimate, simulation result and review expiry.
2. Confirm an expired unsigned review can be refreshed and a signed review cannot be replaced.
3. In a mocked submission test, reject signing and ensure the review stays available. Confirm the API rejects a substituted message or signature.
4. Simulate success, failure, pending and ambiguous status. An ambiguous submission must retain the verified signature and reconcile by signature; it must never send again after timeout/restart.
5. For combined actions, confirm that step two appears only after the first step confirms and that each step requires a separate approval.

## External release gate

No real mainnet transaction is part of automated validation. Physical iOS and Android QA must verify Privy cancellation, background/foreground recovery, expired blockhash refresh, connection loss after submission, and status reconciliation using a controlled test environment and explicit release authorization. Keep all action flags `false` until those checks and risk approval are complete.
