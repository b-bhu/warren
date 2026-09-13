# User Onboarding

User Onboarding is Phase 1 of
[Milestone 1: Discover and Buy Tokenized Stocks](../../milestone/milestone-one.md).

## Module Outcome

A new or returning user can authenticate with an approved social identity and receive
the same user-owned, embedded EVM and Solana wallets on every device. Both wallets are
created automatically and become the defaults for their chain families. External
wallet linking remains optional.

The earlier connection-and-signature flow remains implemented as a provider-neutral
development prototype and security reference; it is not the agreed production
onboarding experience.

## Place in Milestone 1

- **Before this module — Phase 0:** theme and design foundation
- **This module — Phase 1:** social identity, embedded-wallet provisioning, recovery,
  and session creation
- **After this module — Phase 2:** simple spot experience and profile/portfolio

## Documents

- [Privy wallet and identity PRD](./wallet_privy_prd.md) — agreed production direction
  and current implementation baseline
- [Product requirements document](./prd.md)
- [Implemented prototype and target architecture](./architecture.md)
- [Paybox feasibility spike](./paybox-spike.md)
- [Phase 0 theme and design foundation](../theme-design/phase-zero.md)

## Current Delivery Boundary

The approved Liquid Ledger screen is now connected to Privy's native Expo SDK for
Apple/Google identity and automatic user-owned EVM and Solana wallet provisioning.
The browser keeps a visual-only preview because Privy's Expo SDK is native-only. The
earlier provider-neutral deterministic flow remains as a test and security reference,
but it is no longer the app entry point. Privy dashboard configuration, API profile
binding, protected recovery and export flows, and a physical-device matrix remain
required before release. Until those flows ship, the app fails closed instead of
creating a replacement wallet when Privy reports that recovery is needed.

## Scope Boundary

This module ends when identity is verified, both embedded wallets are ready and
recoverable, and an authenticated session is usable. It does not include funding,
transaction signing, stock discovery, trading, portfolio valuation, KYC, investment
recommendations, or enabled-by-default agent delegation.
