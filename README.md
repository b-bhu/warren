# Warren

Mobile-first spot trading for tokenized stocks. Milestone 1 is split into a design
foundation, wallet onboarding, and the later spot/profile experience. The current
mobile entry point is the approved Liquid Ledger Privy onboarding foundation.

## What is runnable

- An Expo SDK 57 Liquid Ledger sign-in experience with Apple and Google OAuth.
- Automatic Privy embedded EVM and Solana wallet provisioning and wallet-ready UI.
- Server-issued ERC-4361 and SIWS-compatible challenges with server-side proof
  verification.
- Opaque access/refresh sessions, secure native storage, session restoration, sign-out,
  and second-chain wallet linking.
- A deterministic EVM/Solana wallet provider for local development and automated tests.

The deterministic provider and API remain as an earlier provider-neutral security
prototype. Privy is now the selected mobile foundation, but it is not release-ready
until dashboard setup, backend profile binding, recovery/export, and physical-device
validation are complete.

## Workspace

- `apps/mobile` — Expo mobile application
- `apps/api` — Fastify API and SQLite persistence
- `packages/auth-contract` — request schemas and canonical signing messages
- `packages/provider-contract` — provider-neutral signing adapter
- `packages/test-wallet-provider` — deterministic development/test adapter
- `docs/modules/user-onboarding` — PRD, architecture, and Paybox feasibility spike

## Development

Requires Node.js 22 or later and pnpm 10.

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts the API on `http://localhost:3000` and Expo on its normal development
port (typically `http://localhost:8081`). For an explicitly web-only client, use
`pnpm web`; or run the services separately with `pnpm dev:api` and `pnpm dev:mobile`.

For real Privy sign-in, copy `apps/mobile/.env.example` to `apps/mobile/.env.local`,
add the public Privy App ID and mobile Client ID, and restart Expo. In the Privy
dashboard, enable Apple and Google, allow the `warren` URL scheme, and register
`com.warren.app` as both the iOS bundle identifier and Android application ID.
Use an iOS/Android development build; Privy's Expo SDK does not support web or Expo Go.
Never add a Privy app secret to an `EXPO_PUBLIC_*` variable.

For a physical phone, set `EXPO_PUBLIC_API_URL` to a reachable HTTPS or LAN API address;
`localhost` points to the phone itself. Server configuration is documented in
`.env.example`. Environment variables must be supplied by the shell or deployment
runtime; the API does not implicitly load `.env` files.

## Verification

```bash
pnpm test:api
pnpm typecheck
pnpm lint
```

Physical iOS/Android OAuth return, wallet restoration, accessibility, recovery, and
export validation remain release gates; they cannot be replaced by the browser preview.
