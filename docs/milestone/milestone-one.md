# Milestone 1: Discover and Buy Tokenized Stocks

> Milestones follow [How to Write Milestones](./how-to-write-milestones.md).

## Outcome

A user can discover a tokenized stock in a mobile app, connect a Solana wallet, and complete a spot purchase.

## Why It Matters

Buying a tokenized stock currently requires users to understand tokens, trading venues, and transaction flows. This milestone turns that fragmented process into one familiar investing journey.

## User Experience

The user opens the app and browses a simple list of available stocks. They choose one, understand what they are buying, connect their wallet, enter an amount, review the purchase, approve it, and see the completed investment in their portfolio.

The user should not need to find token addresses, choose a trading venue, or understand how the purchase is routed.

## Included

- Mobile-first stock discovery
- Search and browsing for a small, verified set of tokenized stocks
- A clear stock detail view explaining the asset and what the user receives
- Automatic creation of a default embedded Solana wallet
- A simple spot-buy flow with an understandable review step
- Clear purchase progress, success, and failure states
- A basic portfolio view confirming the completed purchase

## Delivery Phases

Milestone 1 will be explored and delivered through three bounded phases:

0. **Theme and design foundation** — establish the visual direction, design tokens,
   reusable mobile components, interaction patterns, and product voice used by the
   rest of the milestone.
1. **[User onboarding](../modules/user-onboarding/README.md)** — let a user authenticate
   with email OTP or an external Solana wallet and automatically receive user-owned
   default EVM and Solana wallets through the embedded-wallet provider. Restore the
   same profile and wallets across devices without making an external identity wallet
   a trading default.
2. **Spot experience and profile** — let the authenticated user discover a supported
   tokenized stock, review and complete a simple spot purchase, and see the resulting
   position and connected-wallet context in a basic profile/portfolio experience.

These phases are delivery boundaries, not separate user outcomes. Milestone 1 is
complete only when the full discovery-to-purchase journey meets the conditions below.

## Complete When

- A new user can go from opening the app to completing a real small-value purchase.
- The entire journey happens inside one understandable mobile experience.
- The user knows what they are buying, how much they will spend, and what they will receive before approval.
- The completed purchase appears in the user's portfolio.
- Common failures are explained clearly and allow the user to try again safely.

## Not Included

- Leverage, perpetuals, or short positions
- Cross-chain funding
- Automated or agent-controlled trading
- Chat, news, or investment recommendations
- Recurring investments or advanced order types
- Lending, borrowing, or earning against positions
- Support for every stock, issuer, or trading venue
