# PRD: Privy Wallet and Identity Foundation

| Field | Value |
| --- | --- |
| Status | Foundation implementation in progress |
| Parent | [Milestone 1: Discover and Buy Tokenized Stocks](../../milestone/milestone-one.md) |
| Working name | `wallet_privy_prd` |
| Dependency | Phase 0 Liquid Ledger direction approved |
| Product surface | Stocklana mobile app on iOS and Android |
| Last updated | 2026-09-13 |

## 1. Decision

Stocklana will explore Privy as the embedded identity and wallet infrastructure for
the production onboarding flow. A user signs in with a familiar social method, and
Stocklana automatically provisions one user-owned EVM wallet and one user-owned Solana
wallet. Both wallets are available inside Stocklana and become the defaults for their
chain families.

An external wallet is optional. It may be linked later for deposits, withdrawals, or
power-user workflows, but it is not required to create or recover a Stocklana account.

Agent access is supported as a separate, explicit delegation. An agent never receives
the wallet private key or becomes the wallet owner. It may act only as a revocable
signer within policies approved by the user.

## 2. Product model

| Concept | Role |
| --- | --- |
| Social identity | Creates and restores the Stocklana account across devices. |
| Stocklana profile | Stable internal user record, independent of a device. |
| Embedded Solana wallet | Automatically created default wallet for Solana activity. |
| Embedded EVM wallet | Automatically created default wallet for supported EVM networks. |
| External wallet | Optional linked wallet controlled outside Stocklana. |
| Stocklana agent | Optional additional signer with narrow, policy-limited permissions. |

“Managed wallet” in this document means provisioned and operated through Privy inside
Stocklana. It does not mean Stocklana receives or stores the user's private key.

## 3. First-time experience

1. The user selects **Continue with Apple**, **Continue with Google**, or another
   approved identity method.
2. Stocklana creates or restores the profile associated with that authenticated
   identity.
3. If the profile has no embedded wallets, provisioning creates one Solana wallet and
   one EVM wallet idempotently.
4. Stocklana records their public addresses and Privy wallet references and marks them
   as the defaults for their chain families.
5. The user sees a clear confirmation that both wallets are ready and enters the app.
6. The user may later link an external wallet; this never silently replaces a default
   wallet or merges another profile.

The user is not asked to understand chains, create seed phrases, install a separate
wallet, or visit Privy during normal onboarding.

## 4. Returning user and new-device recovery

The user signs in with the same linked social identity. Stocklana restores the same
profile, queries its existing Privy wallet references, and shows the same EVM and
Solana addresses. It must never create replacement wallets merely because the device
or local app installation changed.

Account recovery and wallet-key export are different operations. Social recovery
restores access to the Stocklana profile; wallet export lets the user take an embedded
wallet to another compatible client. Both capabilities require dedicated security UX.

## 5. Ownership, storage, and signing

- Privy protects embedded-wallet key material and performs authorized signing in its
  wallet infrastructure.
- Stocklana stores the Privy user reference, opaque wallet references, public wallet
  addresses, chain family, default status, policy references, and audit metadata.
- Stocklana application databases, logs, analytics, and support tools never store raw
  private keys, seed phrases, recovery shares, or unredacted exported keys.
- The mobile device stores only the minimum application session material in the
  platform-backed secure store.
- User-initiated trades show a review screen before authorization and signing.
- Key export must be available to the wallet owner through a protected, intentional
  flow. Export availability and the React Native handoff must pass a physical-device
  spike before launch.

Privy documents automatic EVM and Solana wallet creation, user key export, and
user-owned wallets with additional policy-scoped signers. These capabilities remain
vendor validation items until proven in Stocklana's exact Expo and deployment setup.

## 6. Agent delegation

Creating a wallet does **not** automatically grant an agent control. Delegation is a
separate opt-in flow that explains who will act, what it may do, the limits, duration,
and how to revoke access.

The initial policy is deny-by-default. An approved Stocklana agent signer must be
restricted by all applicable controls:

- supported chain and network allowlists;
- approved trading contracts and Solana programs;
- approved action/RPC types and transaction parameter validation;
- per-transaction and rolling-period value limits;
- expiration and immediate revocation;
- no wallet ownership, signer, policy, or export changes;
- no arbitrary transfers, withdrawals, raw message signing, or unknown contracts;
- user confirmation for withdrawals, new destinations, permission changes, and values
  above the approved threshold; and
- a user-visible audit record for every request and result.

The user remains the wallet owner. The agent is an additional signer and cannot export
the key, change ownership, add other signers, or weaken its own policies.

## 7. Functional requirements

- **FR-01:** Support at least Apple and Google sign-in on both iOS and Android.
- **FR-02:** Map every authenticated identity to one stable Stocklana profile.
- **FR-03:** Automatically create exactly one initial EVM and one initial Solana wallet
  when the profile has neither.
- **FR-04:** Provisioning is idempotent and safe under retries, concurrent requests,
  partial provider failure, backgrounding, and app restarts.
- **FR-05:** Never replace or orphan an existing wallet during login or recovery.
- **FR-06:** Persist only public addresses and opaque provider references in Stocklana.
- **FR-07:** Mark the initial wallet in each chain family as the default without making
  an external wallet the default silently.
- **FR-08:** Restore the same profile and wallets after a device change.
- **FR-09:** Provide a protected wallet-export path for both EVM and Solana.
- **FR-10:** Allow an authenticated user to link an external wallet through a fresh
  ownership proof.
- **FR-11:** Require explicit user consent before adding an agent signer.
- **FR-12:** Enforce agent permissions in wallet-level policies, not only in Stocklana
  UI or API code.
- **FR-13:** Let the wallet owner view and revoke every active agent delegation.
- **FR-14:** Record wallet creation, default changes, exports, signer changes, policy
  changes, transaction requests, approvals, denials, and revocations in an audit trail.
- **FR-15:** Fail closed when Privy, authentication, policy evaluation, or wallet status
  is unavailable or ambiguous.

## 8. Scope and sequencing

### Implementation baseline (2026-09-13)

The Phase 0 Liquid Ledger direction is approved. The Expo app now contains the native
Privy provider boundary, Apple and Google OAuth entry points, automatic embedded EVM
and Solana wallet creation, wallet preparation/error states, and a wallet-ready state
that displays both default addresses. This slice does not yet implement Stocklana API
profile binding, a protected cross-device recovery ceremony, or the mobile-to-web key
export handoff. Privy dashboard configuration and physical-device validation are still
required before this foundation is considered releasable.

### Wallet foundation delivery

- Social authentication and cross-device session restoration
- Automatic EVM and Solana embedded-wallet provisioning
- Default-wallet assignment
- Minimal wallet/profile display
- Protected export entry point
- Optional external-wallet linking boundary

### Prepared now, activated later

- Agent signer consent
- Trading-specific policies and thresholds
- Autonomous or offline trading
- Advanced audit and approval management

Agent delegation must not be enabled merely because the wallet SDK supports it. Its
user experience, risk limits, and operational controls require their own release gate.

## 9. Not included in the wallet foundation

- Tokenized-stock discovery or order execution
- Autonomous trading enabled by default
- Unrestricted Stocklana server access to user wallets
- Custody of raw user keys by Stocklana
- Silent key export, ownership transfer, or wallet replacement
- A promise to support every social provider, chain, external wallet, or jurisdiction

## 10. Acceptance criteria

- A new user signs in once and receives one EVM and one Solana wallet without leaving
  Stocklana or creating either wallet manually.
- Retrying onboarding cannot create duplicate default wallets.
- Signing in on another device restores the same profile and wallet addresses.
- The user can intentionally export both wallet types through an authenticated flow.
- Stocklana contains no raw wallet secret before, during, or after normal use or export.
- No agent can act before explicit delegation.
- A delegated agent can perform only policy-allowed actions and cannot withdraw,
  export, change ownership, or expand its own access.
- Revocation prevents new agent operations and appears in the audit history.
- All supported iOS/Android login, provisioning, signing, export, interruption, and
  recovery paths pass physical-device testing.

## 11. Decisions required before development

1. Approved social sign-in methods and account-linking/conflict rules.
2. Privy user-owned wallet configuration and whether any server co-signature/quorum is
   required for sensitive actions.
3. Supported EVM networks and Solana cluster at launch.
4. Exact default-wallet, funding, withdrawal, and external-wallet behavior.
5. Mobile wallet-export UX, warnings, reauthentication, and post-export policy.
6. Agent policy boundaries, limits, approval thresholds, duration, and emergency stop.
7. Compliance, regional availability, data-processing, incident-response, SLA, pricing,
   and vendor-exit requirements.
8. Migration procedure that preserves user access if Stocklana later leaves Privy.

## 12. Reference material

- [Privy React Native automatic wallet creation](https://docs.privy.io/basics/react-native/advanced/automatic-wallet-creation)
- [Privy wallet export](https://docs.privy.io/wallets/wallets/export)
- [Privy owners and signers](https://docs.privy.io/controls/authorization-keys/owners/overview)
- [Privy delegated permissions](https://docs.privy.io/controls/common-use-cases/delegation)
- [Privy policies](https://docs.privy.io/controls/policies/overview)
