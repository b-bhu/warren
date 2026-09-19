# Milestone 1: Discover and Buy a Tokenized Stock

> Milestones follow [How to Write Milestones](./how-to-write-milestones.md).

## Outcome

A guest can discover a verified tokenized stock in Warren, authenticate only when
they are ready to buy, and complete a real spot purchase that appears in their
portfolio.

## Why It Matters

Buying a tokenized stock currently requires users to understand tokens, trading
venues, wallets, and transaction flows. This milestone turns that fragmented
process into one familiar, stock-first investing journey.

Users browse companies and understand the investment first. Warren handles the
verified instrument, wallet, funding, and transaction details when they become
relevant.

## Product Boundary

Warren is stock-first, not crypto-first. Users discover companies and choose from
verified stock instruments; they never need to browse arbitrary tokens or paste
token addresses.

Milestone 1 proves one action: buying and holding a spot stock token. Later actions
such as selling, setting alerts, or trading equity perpetuals should grow from the
same company and instrument experience, but they are not part of this milestone.

## User Experience

The user can:

1. Open Warren as a guest and browse or search a small, verified stock catalog.
2. Choose a company and inspect the exact spot stock-token instrument, including
   what it represents, who issued it, its network, availability, and price freshness.
3. Enter a USDC budget and begin a purchase without first navigating an account or
   wallet setup flow.
4. Authenticate at the point of purchase without losing the company, instrument,
   or amount they selected.
5. Return to the same profile and embedded wallet, or have them created on first use.
6. Receive USDC into that wallet, refresh the balance, and understand when the
   wallet is ready to purchase.
7. Review current purchase terms: the amount spent, expected and minimum amount
   received, fees, price impact or slippage, and quote expiry.
8. Explicitly approve the exact purchase and see clear submitting, pending,
   confirmed, or failed states.
9. See a confirmed receipt with the actual result and transaction reference, then
   see the resulting position in the portfolio.
10. Safely resume or reconcile the purchase after an interruption without creating
    a duplicate order or showing a false success.

## Included

- Guest-first Home and Markets discovery for a small allowlist of verified stocks
- Search, browsing, and stock/instrument detail views
- Clear instrument identity, rights, limitations, availability, and price freshness
- Contextual authentication that preserves the user's purchase intent
- A stable user profile with user-owned embedded wallets; an external identity
  wallet is not silently made the trading default
- Minimal Solana USDC receive flow, balance refresh, and purchase-readiness guidance
- A buy-only spot flow with live quote, review, explicit approval, and receipt
- Clear handling of expiry, rejection, insufficient funds, provider outages, and
  transaction results that are temporarily unknown
- A basic activity and portfolio view showing the confirmed position
- Safe recovery after the app closes, loses connectivity, or returns from approval
- Physical Android-device support, accessible interaction states, and no exposure of
  seed phrases, private keys, or raw secrets

## Delivery Approach

Milestone 1 will be built as an experience-first, contract-led vertical slice:

1. **Lock the journey and state contract** — define every screen, state, transition,
   user decision, and recovery path from guest discovery through portfolio.
2. **Build the complete experience with controlled data** — make the entire journey
   usable in the app, including loading, empty, expired, rejected, pending, and
   interrupted states.
3. **Connect identity, wallet, catalog, and funding** — replace controlled data at
   each boundary while preserving the agreed experience and purchase intent.
4. **Connect live quote and execution** — quote, approve, submit, reconcile, and
   prevent duplicate purchases through the real transaction path.
5. **Close the loop on a physical device** — verify the actual receipt, portfolio
   position, restart recovery, accessibility, and failure handling end to end.

Each slice must keep the full journey demonstrable. A finished screen or isolated
service does not make the milestone complete on its own. Provider choices, fee and
gas policy, eligibility rules, and transaction architecture belong in the detailed
product requirements for the relevant slice.

## Complete When

- A new user can browse the verified catalog and understand an instrument without
  signing in.
- The user can choose a USDC budget and authenticate contextually without losing
  their prepared purchase.
- The same user profile and embedded wallet are restored reliably.
- The user can fund the wallet with enough USDC and clearly understand whether it is
  ready to buy, including any fee or gas requirement.
- Before approval, the user sees the exact instrument, spend, expected and minimum
  receive amounts, fees, price impact or slippage, and quote expiry.
- The user can complete a real, small-value purchase on the supported live network
  and distinguish submitting, pending, confirmed, failed, and unknown outcomes.
- The confirmed receipt shows the actual result and transaction reference, and the
  resulting position appears in the portfolio.
- Closing, backgrounding, reconnecting, or reopening the app does not duplicate the
  purchase or turn an unknown result into a false success.
- The full flow passes on the supported physical Android-device matrix with critical
  accessibility states and secret-handling requirements intact.

A UI-only walkthrough, simulated fill, or development-network-only transaction is a
checkpoint, not completion of Milestone 1.

## Not Included

- Selling a spot position
- Leverage, perpetuals, or short positions
- Alerts, reminders, or price notifications
- Themes, baskets, contributions, or automatic rebalancing
- Fiat onramps, bridging, or cross-chain funding
- EVM stock trading
- Automated or agent-controlled trading
- Chat, news, or investment recommendations
- Recurring investments or advanced order types
- Lending, borrowing, or earning against positions
- Support for every stock, issuer, network, or trading venue
