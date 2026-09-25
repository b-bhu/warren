# Portfolio backend acceptance checks

Automated coverage lives in `apps/api/test/portfolio.test.ts` and the execution persistence case in
`apps/api/test/execution.test.ts`.

The backend slice is accepted only when these checks pass:

- Private routes reject missing/invalid Privy sessions.
- Only the authenticated user's linked Solana wallet is queried.
- Spot and PreStock balances require an exact verified mint match.
- SPL balances are aggregated as integer strings before decimal conversion.
- Unknown tokens are excluded; unpriced supported holdings remain visible and excluded from totals.
- Perpetual notional is reported as gross exposure and is never added to net equity.
- Open orders and open positions remain separate collections.
- Helius, registry, and Phoenix failures degrade independently without returning a false total.
- A missing Phoenix account is a healthy empty state.
- Warren, Helius, and Phoenix Activity records are filtered, deduplicated, ordered, and cursor paged.
- Another user's execution records never enter the response.
- Execution results and idempotency survive an API service restart and review expiry.
- Provider-shaped errors and secrets do not cross the API boundary.

Run:

```bash
pnpm --filter @warren/api typecheck
pnpm --filter @warren/api test
```
