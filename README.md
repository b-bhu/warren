# Warren

**Tokenized stock markets on Solana, organized around companies.**

Stock-linked products are spread across issuers, trading venues, and lending protocols. The same company can have a spot token, private-market exposure, an equity perpetual, and a lending route—each with different prices and risks. Warren brings those markets into one mobile app while keeping the exact instrument, provider, network, and availability visible.

Start with a company. Understand the market behind it. Sign in only when you are ready to act.

## See the app

<table>
  <tr>
    <th>Home</th>
    <th>Markets</th>
    <th>Company detail</th>
  </tr>
  <tr>
    <td><img src="docs/screenshots/home-dark.jpg" alt="Warren Home in dark mode with market status, indices, search, and market movers" width="250"></td>
    <td><img src="docs/screenshots/markets-dark.jpg" alt="Warren Markets in dark mode with the spot stock catalog" width="250"></td>
    <td><img src="docs/screenshots/stock-detail-dark.jpg" alt="Apple company detail in dark mode with token price history and available instruments" width="250"></td>
  </tr>
</table>

These are dark-mode captures of the running app's guest web preview at a phone-sized viewport. Market values change, and values labeled *Sample* are sample data. Native wallet signing is not shown in these screenshots.

## The Warren experience

1. **Discover without a wallet.** Home shows market context, movers, news, search, and locally saved companies.
2. **Choose the right market.** Markets separates Spot, PreStocks, Perpetuals, and Lending rather than treating them as interchangeable versions of a stock.
3. **Inspect the instrument.** A company page shows the relevant price history, provider, network, liquidity, and available instruments before a trade begins.
4. **Review before signing.** A supported spot or perpetual ticket can be configured as a guest. Executable terms require sign-in and a fresh provider quote; a wallet signature is requested only after review.
5. **Return to your portfolio.** The signed-in workspace is designed to show verified wallet holdings, positions, and Warren activity together.

Warren's API binds actions to the verified instrument and the user's wallet. A displayed market price is never reused as an executable quote.

## What is available today

| Area | Current state |
| --- | --- |
| Home, Markets, and company details | Runnable guest experience in the Expo web preview and mobile app. |
| Spot trading | Jupiter Swap V2 client and server flow implemented; physical-device transaction QA pending. |
| Equity perpetuals | Phoenix client and server flow implemented; physical-device transaction QA pending. |
| Sign-in and portfolio | Privy embedded Solana wallet integration and portfolio views are implemented; native configuration and device validation are required. |
| Lending | Kamino xStocks markets and terms are visible; lending actions are paused by default. |
| PreStocks | Discovery and instrument inspection; trading is not part of this flow. |

This repository is a working project build. Real-money readiness still depends on provider configuration, wallet recovery and export validation, transaction reconciliation, accessibility checks, and physical-device QA. The [Milestone 1 plan](docs/milestone/milestone-one.md) describes the first end-to-end spot purchase goal.

## Run the guest demo

Requires Node.js 22 or later and pnpm 10.

```bash
pnpm install
```

Start the API and web preview in separate terminals:

```bash
pnpm dev:api
```

```bash
pnpm web
```

Open `http://localhost:8081`. Explore Home, switch to Markets, and select a company such as Apple. The API runs at `http://localhost:3000`. Without a Tokens.xyz key, Home and Spot use fixture data and some detail history is unavailable. To use provider-backed stock data like the screenshots, set `TOKENS_API_KEY` in `apps/api/.env.providers.local`. Other API settings are described in [`.env.example`](.env.example); the API development scripts load `apps/api/.env.local` and `apps/api/.env.providers.local` when present.

For native development, use `pnpm dev` to start the API and Expo together. Privy sign-in requires an iOS or Android development build, not Expo Go or the browser preview. Copy `apps/mobile/.env.example` to `apps/mobile/.env.local`, add the public Privy App ID and mobile Client ID, and configure the `warren` URL scheme and `com.warren.app` identifier in Privy. On a physical phone, set `EXPO_PUBLIC_API_URL` to an API address the phone can reach. Never put a Privy app secret in an `EXPO_PUBLIC_*` variable.

## How it is built

- **Mobile:** Expo SDK 57, React Native, Expo Router, and Privy.
- **API:** Fastify, SQLite, and shared request/response contracts in `packages/*-contract`.
- **Market data and actions:** Warren's API integrates with Tokens.xyz, PreStocks, Phoenix, Jupiter, Kamino, and Solana data sources. Provider keys stay on the server.
- **Project docs:** Product requirements, API contracts, and QA notes live in [`docs/modules`](docs/modules).

## Checks

```bash
pnpm test:api
pnpm typecheck
pnpm lint
```
