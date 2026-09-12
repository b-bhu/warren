# PRD: User Onboarding and Wallet Ownership Verification

| Field | Value |
| --- | --- |
| Status | Draft for exploration |
| Parent | [Milestone 1: Discover and Buy Tokenized Stocks](../../milestone/milestone-one.md) |
| Phase | 1, after the Phase 0 theme and design foundation |
| Product surface | Expo mobile app, iOS and Android |
| Last updated | 2026-09-12 |
| Review | Independent product/UX/security/feasibility audit integrated; ready for exploration, not implementation until DG-01 through DG-06 are resolved |

## 1. Summary

Stocklana needs a trustworthy first-run experience before it can offer tokenized-stock
trading. This module lets a user connect a supported EVM or Solana wallet, prove that
they control its address by signing a clear, off-chain challenge, and enter an
authenticated Stocklana session.

The product capability covers both EVM and Solana. The default product assumption is
that a person needs to verify only one wallet to finish onboarding; they can link one
wallet from the other chain family later. Both chain-specific paths must independently
pass acceptance testing. A Solana wallet remains a prerequisite at the point where a
user attempts a Solana purchase in Phase 2.

[Paybox](https://docs.paybox.sh/) is a candidate connection and signing provider, not
yet a committed dependency. Its fit must be proven through the validation spike in
Section 16 before implementation architecture is locked.

## 2. Problem

The full Milestone 1 journey assumes an authenticated user and a wallet that can
approve future actions. Wallet onboarding often fails because people do not understand
why an app wants a signature, leave the app during a wallet handoff, reject an opaque
message, select the wrong account or network, or cannot recover when a session expires.

Stocklana needs one understandable mobile flow that establishes wallet ownership
without asking for a seed phrase, moving funds, or making the user understand wallet
protocol details.

## 3. Outcome

A new or returning user can connect an EVM or Solana wallet, knowingly sign a
Stocklana login challenge, and reach the authenticated product experience with the
verified address associated with the correct profile.

## 4. Goals

- Support wallet connection and ownership verification for both EVM and Solana.
- Explain what connecting and signing do before every wallet handoff.
- Create or resume the correct Stocklana profile only after server-side verification.
- Let a signed-in user link and separately verify one wallet from the other chain
  family without creating an accidental duplicate profile.
- Recover safely from cancellation, backgrounding, expiry, network loss, provider
  errors, and rejected signatures.
- Establish a secure session that the later spot experience can rely on.
- Instrument the funnel without placing wallet secrets, signatures, raw challenges,
  or full wallet addresses in analytics.

## 5. Non-goals

- Selecting the visual theme or creating the design system; that is Phase 0.
- Signing or broadcasting a transaction.
- Funding a wallet or checking whether it has enough gas or token balance.
- Discovering or buying a tokenized stock.
- Portfolio valuation or the full profile interface planned for Phase 2.
- KYC, accreditation, jurisdiction, tax, or investment-suitability checks.
- Importing seed phrases, exporting private keys, or custodying wallet secrets.
- Cross-chain transfers, swaps, agent-controlled actions, or delegated trading.
- Supporting every EVM network, wallet provider, smart-contract wallet, or Solana
  wallet in the first release.
- A Stocklana-native email/password recovery system unless later research selects one.

## 6. Users and Jobs

### New user with a wallet

> I want to connect the wallet I already use so I can enter Stocklana without making
> another password-based account.

### New user without the required wallet family

> I want to understand what I need and get a safe path forward without believing that
> my account or money is lost.

Wallet creation is not assumed to be available inside Stocklana in this phase. If the
selected provider owns wallet creation, the handoff must say that clearly and return
the user to the same onboarding step afterward.

### Returning user

> I want the app to restore my valid session or let me re-verify the same wallet without
> creating a second profile.

### Existing user adding another chain family

> I want to link a second verified wallet to my existing profile so that I can use both
> EVM and Solana capabilities later.

## 7. Product Decisions and Assumptions

The following decisions define the draft. Changing one should update requirements and
acceptance criteria, not only implementation notes.

1. **One wallet completes onboarding.** Support for both chain families is a product
   requirement, not a requirement that every individual connect two wallets.
2. **Ownership requires a fresh signature.** Merely receiving an address after a
   connection or OAuth grant is not sufficient authentication.
3. **The signature is off-chain.** It moves no assets, grants no trade approval, and
   should not cost a network fee.
4. **The server is the source of truth.** The mobile app never declares ownership or
   creates an authenticated session based only on a client-side result.
5. **One canonical wallet identity maps to one Stocklana profile.** Chain namespace,
   network/cluster, canonical address, wallet type, and provider credential ID are stored
   as separate concepts. The final identity key is a pre-implementation decision because
   EVM contract accounts can be network-specific while EVM externally owned accounts
   commonly reuse one address across networks.
6. **Linking a second wallet is authenticated account maintenance.** It starts from an
   existing valid session and requires a new ownership proof for the new address.
7. **Provider choice remains reversible.** User-facing copy and the profile model use
   wallet/chain concepts rather than exposing provider-specific internals.
8. **Conflicts fail closed.** The initial release never auto-merges profiles, reassigns a
   wallet, or reveals whether the conflicting profile has other wallets or activity.
9. **Provider authorization is not Stocklana authentication.** Receiving an OAuth token,
   wallet grant, address, or provider success status never creates a Stocklana session;
   only Stocklana's verification of its own challenge can do that.

### 7.1 Pre-implementation decision gates

Exploration may continue with these open, but implementation cannot be committed until
the accountable product, mobile, backend, and security owners record the decisions:

- **DG-01 — Network scope:** supported EVM chain ID(s), supported Solana cluster(s), and
  how the chosen network appears in connection, challenge, storage, and Phase 2 gating.
- **DG-02 — Identity key:** canonical address normalization and uniqueness rules for EVM
  externally owned accounts, EVM contract accounts, and Solana accounts across networks.
- **DG-03 — Launch matrix:** exact provider/wallet, iOS/Android version, device, and wallet
  type combinations that Stocklana claims to support.
- **DG-04 — Contract wallets:** support ERC-1271 with chain-aware verification or mark
  EVM contract accounts unsupported with a tested, explicit error.
- **DG-05 — Provider token architecture:** native public client or backend-for-frontend;
  token holder, protected storage, minimum grants/scopes, refresh rotation, revocation,
  logout, and compromise response.
- **DG-06 — Recovery operations:** safe conflict policy, support owner and service level,
  acceptable proof, audit/hold requirements, and whether manual merge or reassignment
  will ever be permitted. The default until this is approved is no merge/reassignment.

## 8. Experience Principles

- **Explain before handing off.** State the destination, purpose, and expected return.
- **Make signing legible.** Show the requesting app, wallet address, chain family, and
  the fact that signing is free and does not move funds.
- **Preserve progress.** Backgrounding the app or opening another app must not reset
  onboarding.
- **Show one primary action.** At each step, the next action and a safe cancel/back path
  are obvious.
- **Use progressive disclosure.** Plain language comes first; address, network, and
  diagnostic details remain available.
- **Never imply completion early.** Connected, signature requested, signature verified,
  and session ready are distinct states.

## 9. Primary Journeys

### 9.1 New user verifies the first wallet

1. The user sees Stocklana's short value proposition and selects **Get started**.
2. The app explains that a wallet is used for sign-in now and trading approval later.
3. The user chooses **EVM** or **Solana**.
4. The app shows the available supported connection path and explains any external
   provider handoff.
5. The user connects or grants access to one wallet address.
6. Stocklana shows the shortened address and asks the backend for a single-use sign-in
   challenge bound to that address, chain context, app domain, and attempt.
7. Before the signing handoff, the app says: **This is free. It will not move funds or
   approve a trade.**
8. The wallet presents the human-readable challenge and the user approves it.
9. The backend verifies the exact challenge and signature, consumes the challenge, and
   creates or resumes the matching Stocklana profile.
10. The app confirms the verified wallet and enters the authenticated experience.

### 9.2 Existing user links the other chain family

1. From an authenticated wallet/profile area, the user selects **Add EVM wallet** or
   **Add Solana wallet**.
2. The app repeats the connection and explanation flow.
3. The new wallet signs its own fresh chain-specific challenge.
4. The backend verifies that the address is not attached to another profile.
5. The app shows both verified wallets under one profile.

### 9.3 Returning user

- If a valid Stocklana session exists, the app resumes without asking for an unnecessary
  signature.
- If the session has expired, the app explains that the user needs to sign in again,
  reconnects the known wallet if necessary, and requests a fresh challenge.
- Re-verifying the same chain/address resumes the existing profile.
- Choosing a different address never silently replaces the previous identity.

### 9.4 Cancellation and recovery

- Cancelling provider consent returns to the chain-selection or connection step with an
  explanation and retry action.
- Rejecting a signature leaves the wallet connected but unverified and offers **Try
  again** and **Choose another wallet**.
- An expired challenge generates a new challenge only after invalidating the old one.
- A pending provider request is resumed or reconciled after app foregrounding; the app
  does not submit a duplicate request merely to check status.
- Network and provider failures preserve safe local progress and show a retry action.

## 10. State Model

| State | User meaning | Allowed next actions |
| --- | --- | --- |
| `not_started` | No onboarding attempt exists | Get started |
| `choosing_chain` | Select EVM or Solana | Choose, back |
| `connecting` | Provider/wallet handoff is active | Cancel, resume |
| `connected_unverified` | Address is known but ownership is not proven | Sign, change wallet |
| `awaiting_signature` | A single request is awaiting user action | Open approval, cancel |
| `verifying` | Stocklana is checking the returned proof | Wait; no duplicate submit |
| `complete` | Verified profile and session are ready | Continue |
| `recoverable_error` | The attempt can safely be retried | Retry, change wallet |
| `blocked` | A conflict or unsupported condition needs a different path | Get help, change wallet |

No screen may render `connected_unverified` or `awaiting_signature` as a completed
sign-in.

## 11. Functional Requirements

### Connection and discovery

- **FR-01:** The user can deliberately select EVM or Solana before connection.
- **FR-02:** The app lists only connection methods verified as supported on the current
  operating system and build.
- **FR-03:** Before leaving Stocklana, the app names the external provider and describes
  what the user will approve and how they return.
- **FR-04:** On return, the app validates the pending attempt and rejects unsolicited,
  mismatched, expired, or replayed callbacks.
- **FR-05:** The app shows the connected chain family and a shortened address with a way
  to inspect/copy the full address.

### Challenge and signature

- **FR-06:** Every attempt uses a server-generated, cryptographically random,
  single-use nonce bound to the exact address, chain context, app domain/URI, and
  onboarding attempt.
- **FR-07:** The challenge includes issued-at and expiration times and expires within a
  short documented window. Its TTL must be long enough to complete the selected
  provider's approval flow while remaining replay-resistant. Use 15 minutes for the
  Paybox spike because its documented approval can remain pending for about 10 minutes;
  finalize the production TTL from measured flow time and security review.
- **FR-08:** EVM authentication uses a human-readable
  [ERC-4361 Sign-In with Ethereum](https://eips.ethereum.org/EIPS/eip-4361) message and
  ERC-191 verification for externally owned accounts.
- **FR-09:** Solana authentication uses a human-readable
  [Sign In With Solana](https://github.com/phantom/sign-in-with-solana) compatible
  message. A provider-specific equivalent is acceptable only if it preserves the
  normative fields and exact server-issued bytes in Section 11.1 and passes the same
  conformance fixtures. Verification uses the exact bytes shown for signing and the
  claimed public key.
- **FR-10:** The pre-sign screen explicitly says that the action is free, off-chain,
  does not move funds, and does not approve a purchase.
- **FR-11:** The backend validates message shape and expected fields, cryptographic
  signature, address, chain context, domain/URI, nonce, expiry, and attempt state before
  consuming the challenge.
- **FR-12:** A nonce is consumed atomically on the first successful verification and
  cannot create a second session.

### Profile and session

- **FR-13:** A first verified wallet creates one minimal Stocklana profile; the full
  profile interface is deferred to Phase 2.
- **FR-14:** A previously verified chain/address resumes the same profile.
- **FR-15:** A signed-in user can link one verified EVM wallet and one verified Solana
  wallet in the first release, subject to a final account-model decision.
- **FR-16:** The app must not auto-merge profiles or move a wallet between profiles.
- **FR-17:** Session credentials are stored using operating-system protected storage,
  are never logged, and are cleared on sign-out or confirmed revocation.
- **FR-18:** Disconnecting a provider session and signing out of Stocklana are presented
  as separate actions when they have different effects.

### Progress and errors

- **FR-19:** The app survives backgrounding, provider handoff, and process restoration
  without losing or duplicating the active attempt.
- **FR-20:** Pending operations are checked by their existing attempt/request identifier;
  checking status must not create another signing request.
- **FR-21:** User cancellation, user rejection, timeout, unsupported wallet, wrong chain,
  address mismatch, conflict, provider outage, connectivity loss, and verification
  failure each have distinct safe handling and useful copy.
- **FR-22:** Retrying after an expired or invalid challenge always uses a fresh challenge.
- **FR-23:** The user can choose another wallet without reinstalling or clearing app data.

### Account conflict and recovery

- **FR-24:** A wallet already attached to another profile returns a privacy-preserving
  conflict response, records an audit event, creates no session, and reveals no other
  profile information.
- **FR-25:** Phase 1 provides no automatic profile merge or wallet reassignment. A manual
  path must remain disabled until DG-06 defines evidence, authorization, audit, hold, and
  rollback requirements.
- **FR-26:** A user who loses one wallet can regain the same profile only through a valid
  existing session or another wallet already verified on that profile. If neither is
  available, Phase 1 states clearly that self-service recovery is unavailable and routes
  to the approved support policy without promising recovery.
- **FR-27:** All provider access and refresh credentials follow DG-05 and remain separate
  from Stocklana session credentials. Revoking either credential type has documented,
  independently tested effects.

### 11.1 Normative signing contract

The backend owns versioned challenge serialization. It returns both a display string and
the exact byte sequence/hash reference expected back for verification. Mobile and provider
layers must not trim, translate, normalize Unicode, reorder fields, or rebuild the
challenge. Every supported provider signs the same server-issued bytes for a given test
fixture.

| Property | EVM v1 | Solana v1 |
| --- | --- | --- |
| Standard | ERC-4361 over ERC-191 | Sign In With Solana-compatible plaintext over Ed25519 |
| Required identity | Checksummed/canonical EVM address and decided EIP-155 chain ID | Canonical base58 public key and decided Solana cluster/chain identifier |
| Required context | Stocklana domain, HTTPS URI, version, statement/purpose, nonce, issued-at, expiration, request/attempt ID | Stocklana domain, HTTPS URI, version, statement/purpose, nonce, issued-at, expiration, request/attempt ID, and cluster/chain context where supported by the standard/provider |
| Message bytes | UTF-8 bytes of the canonical ERC-4361 message; the wallet applies the ERC-191 prefix | UTF-8 bytes of the canonical SIWS message; v1 uses printable ASCII fields where possible for wallet/hardware compatibility |
| Signature input | Plain message, never an app-supplied pre-hashed digest | Plain message bytes, never a transaction or an app-supplied digest |
| Signature output | At the Stocklana API boundary: 65-byte `r || s || v`, `0x`-prefixed hex. Preserve the original artifact, normalize accepted recovery-parity variants only during verification, and require EOA recovery to equal the claimed address | At the Stocklana API boundary: exactly 64 Ed25519 signature bytes encoded as lowercase hex. Verification must succeed for the claimed public key |
| Time policy | Server time; reject expired/not-yet-valid messages, with at most 60 seconds of documented verification skew | Same |

Before implementation, the backend/security owner must publish machine-readable positive
and negative fixtures for both families: canonical challenge string and UTF-8 hex, address,
network context, signature encoding, expected result, and one mutation per bound field.
Fixtures must cover line endings, non-ASCII rejection/handling, hex/base58 parsing, address
case/normalization, signature length/malleability rules, expiry boundaries, wrong domain,
wrong network/cluster, wrong address, and atomic replay/race behavior.

## 12. Content and Design Requirements

Phase 0 must provide the typography, color, spacing, icon, motion, component-state, and
voice foundations used here. The onboarding design must include:

- Welcome, chain selection, provider explanation, connected-unverified, pre-sign,
  pending, success, recoverable error, and blocked/conflict states.
- Shortened addresses with recognizable first/last characters; full addresses are
  available without dominating the interface.
- Provider and wallet marks used according to their brand rules.
- Loading states that identify what is happening instead of showing an indefinite
  generic spinner.
- No color-only status communication, WCAG AA text contrast, dynamic type support,
  screen-reader labels, logical focus order, and touch targets of at least 44 by 44
  points (or the platform-equivalent minimum, if larger).
- On return from an external app, focus lands on the current status heading and screen
  readers announce the meaningful result once, without repeatedly announcing polling.
- Every state keeps its primary and error-recovery actions visible at the platform's
  maximum supported text scale without clipping or horizontal scrolling.
- Plain-language copy at an approximately eighth-grade reading level. Technical error
  details may be exposed behind **Details** and must be safe to share with support.

Minimum pre-sign copy:

> Sign in to Stocklana with **[short address]** on **[chain]**. This signature is free
> and cannot move funds or approve a trade.

The signed challenge itself must also identify Stocklana's verified domain, address,
purpose, nonce, and validity window in the selected standard's format.

## 13. Security and Privacy Requirements

- Stocklana never asks for, receives, stores, screenshots, or transmits a seed phrase or
  private key.
- All callbacks and deep/universal links use an attempt-bound state value. OAuth-based
  integrations also require PKCE S256 and exact redirect validation.
- Challenges are generated and verified server-side, use sufficient entropy, expire,
  and are single-use.
- Verification compares the exact signed bytes; Unicode normalization, prefixing, and
  encoding rules are covered by test vectors for each chain family.
- EVM contract-account signatures require ERC-1271 validation and chain-aware session
  rules if included. Otherwise the first release must reject them clearly rather than
  misclassify them as invalid EOA signatures.
- Solana verification uses Ed25519 against the selected address and keeps off-chain
  authentication payloads distinguishable from transaction messages.
- Session rotation, expiration, revocation, sign-out, and stolen-token response are
  documented before production rollout.
- Provider OAuth/grant credentials and Stocklana session credentials are separately
  scoped, stored, rotated, revoked, and observed. A provider token is never accepted as
  proof of Stocklana identity.
- Logs and analytics must not contain access/refresh tokens, provider keys, signatures,
  complete challenges, seed phrases, or full wallet addresses. Use internal attempt IDs
  and one-way pseudonymous identifiers where correlation is necessary.
- Rate limits cover challenge creation and verification by device/session, address, and
  network source without making legitimate retries impossible.
- Terms or privacy acceptance, if required, is a separate explicit interaction; a wallet
  signature is not silently treated as consent to unrelated legal terms.
- A threat-model review covers replay, phishing/domain mismatch, callback interception,
  address substitution, profile-conflict takeover, session fixation, duplicate requests,
  malicious/compromised providers, and sensitive-data leakage.

## 14. Analytics and Success Measures

### Funnel events

- `onboarding_started`
- `chain_selected`
- `wallet_handoff_started`
- `wallet_handoff_returned`
- `wallet_connected`
- `signature_requested`
- `signature_approved` or `signature_rejected`
- `verification_succeeded` or `verification_failed`
- `onboarding_completed`
- `second_wallet_linked`

Each event may include chain family, provider identifier, operating system, app version,
attempt ID, duration bucket, and normalized error category. It must not include a full
address, raw challenge, signature, or authorization credential.

Before beta, analytics owns a versioned event schema with one event per transition per
attempt, server-side success as the completion source of truth, and deduplication by
`(attempt_id, event_name, schema_version)`. Privacy review defines attempt-ID retention,
access, deletion, and the eligible funnel population. Dashboards segment by chain family,
provider, OS, app version, and new/returning user while enforcing minimum cohort sizes.

### Provisional alpha targets

- At least 90% of controlled happy-path runs complete from **Get started** to verified
  session for each chain family on supported physical devices.
- Median completion time is under 90 seconds for a user who already has a supported
  wallet/provider account.
- 100% of rejection, cancellation, timeout, and background/resume test cases return to a
  safe recoverable or explicitly blocked state.
- No duplicate signing requests are created by resume, refresh, or status checks.
- No critical or high-severity open finding remains from the security review.

Public launch targets should be reset from alpha funnel data rather than treating these
initial numbers as permanent product KPIs.

Limited beta must additionally establish per-chain/provider/OS baselines for handoff
return rate, onboarding completion, recovery success, median and p95 duration, and each
normalized error rate. Product and analytics must record launch thresholds after the
baseline window and before broad rollout.

## 15. Acceptance Criteria

### EVM path

- Given a supported EVM wallet, the user can connect, review an ERC-4361 message, sign
  it, and enter a server-authenticated Stocklana session.
- Changing the signed address, domain, chain ID, nonce, issued-at/expiration field, or
  signature causes verification to fail without creating a session.
- Replaying an already consumed challenge fails.

### Solana path

- Given a supported Solana wallet, the user can connect, review a SIWS-compatible
  message, sign it, and enter a server-authenticated Stocklana session.
- Changing the signed public key, domain, nonce, validity field, message bytes, encoding,
  or signature causes verification to fail without creating a session.
- Replaying an already consumed challenge fails.

### Cross-chain profile behavior

- Either chain path can complete first-time onboarding independently.
- A signed-in user can verify the other chain family and see it attached to the same
  profile.
- An address already owned by another profile is never silently linked or merged.

### Mobile recovery

- Cancelling or rejecting returns a user to an understandable retry path.
- Backgrounding during connection, approval, or verification does not create a duplicate
  attempt and does not show success before server verification.
- An expired challenge cannot be retried; the user receives a fresh challenge.
- Losing connectivity and restoring it reconciles the existing attempt before offering
  another submission.

### Accessibility and observability

- Every onboarding state is operable with VoiceOver and TalkBack on physical devices.
- At maximum supported text scale, no primary or recovery action is clipped or hidden.
- External-app return places focus predictably and announces verification, success, and
  error state changes once. The selected provider's screens/handoffs meet the same tested
  journey standard or the gap blocks provider adoption.
- Error categories and funnel transitions are observable through redacted telemetry.
- Support diagnostics identify an attempt and normalized failure without exposing wallet
  secrets or authentication artifacts.

## 16. Paybox Candidate Evaluation

Paybox is promising for a prototype because its public surface supports scoped wallet
access and both required message-signing families. It is not yet proven as the mobile
onboarding provider for Stocklana. It is being evaluated as an OAuth/MCP credential and
signing service—not assumed to be a WalletConnect-style native wallet connector.

### Relevant capabilities

| Paybox capability | Product implication |
| --- | --- |
| [OAuth 2.1 authorization-code with PKCE](https://docs.paybox.sh/connect/oauth) for public clients | Stocklana may be able to obtain scoped access without holding a client secret. The documented exact HTTPS redirect rule must be validated with iOS Universal Links and Android App Links. |
| [`list_credentials`](https://docs.paybox.sh/reference/mcp-tools#list_credentials) exposes granted wallet address and EVM/Solana family | Stocklana can distinguish granted chain families. EVM and Solana appear as separate wallet credentials, so dual-chain linking may require separate grants. |
| [`request_wallet_sign`](https://docs.paybox.sh/reference/mcp-tools#request_wallet_sign) supports EIP-191 messages and `solanaMessage` | Both ownership proofs are represented, but standards-compatible challenge formatting and Stocklana server verification remain Stocklana responsibilities. |
| [Request lifecycle](https://docs.paybox.sh/concepts/requests) separates approval, signature, and terminal success | The UI can model pending states accurately. Stocklana must submit once and poll the existing request instead of issuing duplicates. |
| [Passkey step-up](https://docs.paybox.sh/concepts/approvals) protects sensitive signing | The user may see Paybox authentication/approval in addition to Stocklana screens; this friction and recovery model need usability testing. |

### Constraints and unknowns

- Paybox states that connecting/creating wallets and managing credentials happen inside
  its first-party app and are **not a public API**. Stocklana therefore cannot assume an
  embedded, Stocklana-owned wallet-creation flow.
- Its documented Node SDK/headless signing-key flow is not evidence of Expo/React Native
  compatibility. Do not select the SDK for the mobile runtime without a working spike.
- MCP wallet signing relies on a signing-window UI resource. Stocklana must validate how
  a native mobile client securely renders or hands off that experience.
- OAuth documentation requires registered HTTPS redirects. Universal/App Link return,
  cancelled authorization, cold start, and installed/not-installed behavior need tests.
- A user may need a Paybox account, email sign-in, passkey setup, wallet creation, and
  credential grant before Stocklana can request a signature. The combined completion
  rate is unknown.
- Access scopes are combined with per-credential grants. The consent screen must be
  checked to ensure users understand the exact wallet and approval mode Stocklana gets.
- Stocklana must decide whether the native app or a backend-for-frontend holds and refreshes
  Paybox OAuth credentials. Either design must keep Paybox authorization separate from the
  Stocklana session and prove that only server verification creates that session.
- Revocation, refresh-token rotation, profile-session invalidation, service availability,
  data processing, geographic availability, pricing, and production support require due
  diligence outside the happy-path prototype.

### Required Paybox validation spike

On physical iOS and Android devices, prove all of the following before committing:

1. Start authorization from Expo, complete Paybox sign-in/consent, and return through a
   verified HTTPS Universal/App Link on warm and cold app starts. Confirm Stocklana owns
   and can serve the production redirect domain and platform association files.
2. Grant an existing EVM credential, list it, request exactly one human-readable sign-in
   message, complete approval/signing, and verify the signature on the Stocklana server.
3. Repeat independently with a Solana credential and Solana message.
4. Link both verified credentials to one already authenticated Stocklana profile.
5. Resume a pending approval/signature after backgrounding without issuing a new request.
   Verify the exact native behavior and accessibility of both `approval_url` and the MCP
   wallet-sign UI resource rather than assuming an embedded wallet-connection screen.
6. Handle rejection, expiry, revoked grant, rotated refresh token, no existing wallet,
   and provider outage with safe user-facing recovery.
7. Confirm that no signing key, private credential, full signature, raw challenge, or
   bearer/refresh token enters analytics or ordinary application logs.

The spike ends with a recorded **adopt**, **adopt with gaps**, or **reject** decision. If
Paybox cannot satisfy it, compare direct wallet adapters, WalletConnect-compatible
providers, and embedded-wallet providers against the same PRD rather than weakening the
user or security requirements.

## 17. Dependencies

- Phase 0 visual direction, design tokens, product voice, and component states.
- A backend challenge, verification, profile-linking, and session service.
- Chain-specific signature verification with maintained conformance test vectors.
- Secure mobile storage and verified Universal/App Link configuration.
- Provider integration selected after the Paybox spike or equivalent evaluation.
- Privacy, legal, security, analytics, QA, and support review before external release.

## 18. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| External handoffs cause abandonment | Explain each handoff, preserve state, measure every transition, test cold/warm return. |
| A signature looks like a transaction or blind approval | Use standard human-readable challenges and explicit pre-sign reassurance. |
| Replay or callback interception creates an account takeover | Single-use bound challenges, PKCE/state, exact redirects, server verification, short expiry. |
| The same person creates duplicate profiles with two wallets | Make second-wallet linking an authenticated flow; never infer identity across addresses. |
| An address conflict enables unsafe auto-merging | Block and route to support/recovery with no automatic merge. |
| Provider lifecycle produces duplicate signature requests | Persist request IDs and reconcile/poll; never resubmit to check progress. |
| Paybox requires too much prerequisite setup | Measure the complete first-use journey and retain a provider-neutral fallback evaluation. |
| EVM and Solana message encoding diverges across wallets | Maintain provider/device compatibility matrix and positive/negative byte-level test vectors. |

## 19. Release and Verification Plan

1. **Design prototype:** Test comprehension of wallet connection, external handoff, and
   pre-sign reassurance with at least five target users before implementation.
2. **Provider spike:** Complete the Paybox decision gate on physical iOS and Android.
3. **Internal alpha:** Test both chain families, session restore, second-wallet linking,
   and every named failure state with controlled accounts.
4. **Security gate:** Complete threat modeling, verifier test vectors, secret/log review,
   callback review, and dependency review.
5. **Limited beta:** Roll out by app version/provider allowlist, monitor the funnel and
   normalized failures, and keep a kill switch for new connection attempts.
6. **Phase handoff:** Declare Phase 1 complete only when Phase 2 can consume a reliable
   authenticated profile and can detect whether a verified Solana wallet is available.
   Phase 2 must block purchase review/submission unless a verified wallet exists for the
   supported Solana cluster, then route the authenticated user through wallet linking and
   return to the preserved purchase context.

### Required verification matrix

| Area | Required evidence and pass condition | Owner |
| --- | --- | --- |
| Server verifier | Automated positive/negative fixtures for every normative field and signature encoding; replay and concurrent verification tests prove no more than one success | Backend + Security |
| Declared launch matrix | Every DG-03 provider/wallet/OS/device/chain combination passes on physical devices; unsupported combinations are not shown | Mobile + QA |
| App handoff | Warm return, cold return, cancel, reject, timeout, offline/reconnect, wrong address/network, provider revocation, and process death all reach the expected state without duplicate requests | Mobile + QA |
| Identity/session | New profile, returning profile, second-wallet link, address conflict, sign-out, provider-token expiry/rotation/revocation, and Stocklana-session expiry/revocation pass independently | Backend + QA + Security |
| Accessibility | VoiceOver and TalkBack, maximum text scale, focus restoration, state announcements, reduced motion, contrast, and touch targets pass for every Stocklana state and the end-to-end provider journey | Design + QA |
| Sensitive data | Automated log/telemetry checks plus manual proxy/device-log inspection find none of the prohibited credentials or artifacts | Security + Analytics |

Each owner records a dated pass/fail result and evidence link. All rows must pass for the
declared matrix; an exception requires explicit product and security sign-off and removal
of the affected combination from user-visible support.

## 20. Definition of Done

- Phase 0 dependencies used by onboarding are approved and implemented.
- DG-01 through DG-06 are resolved in dated decision records.
- Every combination in the declared EVM/Solana launch matrix passes on physical iOS and
  Android devices as specified in the required verification matrix.
- Server-side EVM and Solana verifier fixtures, field-mutation tests, nonce replay tests,
  and concurrent-consumption race tests are automated and required in CI.
- Mobile/provider lifecycle and accessibility cases that cannot be automated are recorded
  as mandatory repeatable tests with dated evidence for each supported release.
- Session restore, sign-out, provider revocation, cancellation, rejection, background
  resume, timeout, offline recovery, and address-conflict behavior are verified.
- Analytics and support diagnostics are present and pass sensitive-data review.
- Accessibility review passes for every state.
- The Paybox provider decision and any accepted gaps are documented.
- Product, design, mobile, backend, QA, security/privacy, legal/compliance, analytics,
  and support owners approve their relevant sections.
- Phase 2 can receive a stable profile ID, authenticated session, verified wallet family,
  verified network/cluster, and verified wallet address without depending on
  provider-specific UI state; its Solana purchase gate and return path are tested.

## 21. Open Questions

1. Is Paybox the preferred provider, one provider option, or only a research reference?
2. Is completion after one verified wallet the intended rule, or must every user connect
   both EVM and Solana? This draft recommends one.
3. Which EVM network/chain ID and Solana cluster are supported for the first release?
4. Which wallet/provider combinations and minimum iOS/Android versions form the launch
   compatibility matrix?
5. Are EVM smart-contract wallets in the initial release, or explicitly deferred?
6. What is the durable account recovery path when the user's original wallet or Paybox
   passkey is unavailable?
7. Should a profile support more than one address per chain family after the first
   release?
8. At what point must a Solana wallet be present: onboarding completion or only before a
   trade? This draft recommends before a trade.
9. Are age, jurisdiction, sanctions, or KYC gates required before connection, before
   browsing, or only before purchase?
10. What session lifetime and re-sign policy balance security with mobile usability?
11. Which legal copy, privacy notice, and provider disclosures must precede the external
    handoff?
12. Who owns account-conflict support, and what proof is required for any manual recovery?
