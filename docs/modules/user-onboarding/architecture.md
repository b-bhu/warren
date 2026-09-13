# Phase 1 architecture: user onboarding and wallet ownership

**Status:** provider-neutral local prototype implemented; production integration and
external release remain gated. This design deliberately does not select Paybox as a
production dependency. It selects an adapter contract, a deterministic local
implementation, and a Paybox spike that must pass before a Paybox adapter can be
enabled.

## 0. Document boundary and implementation snapshot

This document records both the implemented local prototype and the intended production
architecture. Wording under **target state** is not a claim that the capability already
exists.

Implemented as of 2026-09-12:

- Fastify, SQLite migrations, a provider-neutral adapter, deterministic EVM/Solana
  credentials, canonical server-issued messages, exact-byte server verification,
  profiles, encrypted replayable completion results, opaque rotating sessions, rate
  limits, and private conflict handling.
- Expo onboarding/session/profile screens, native SecureStore handling, a closed UI
  state machine, and development-only API wiring. Production builds expose no wallet
  provider and fail closed.
- API idempotency is mandatory for signature-request creation and refresh-token
  rotation. Universal mutation idempotency remains target-state hardening.

Target state, not implemented yet:

- Provider OAuth authorization/return routes, a Paybox or other production adapter,
  Universal/App Links, provider-token storage, physical-device handoffs, and the launch
  support matrix.
- `siwe` parsing and Wallet Standard `verifySignIn` interoperability layers. The
  prototype signs the sole canonical serializer output and verifies those exact bytes
  with `viem` EOA recovery or TweetNaCl Ed25519 verification.
- ERC-1271, production chain RPCs, production telemetry, and Maestro/Detox suites.

## 1. Decisions and gates

### Chosen defaults

- Use a single TypeScript API service running **Node 22 LTS or later**, Fastify 5,
  SQLite and one application instance. This is intentionally small enough for local
  development and a single VM/container deployment.
- Use SQLite in WAL mode with backups, rather than introducing a hosted database in
  Phase 1. It is correct for one writer instance; it is not a horizontal-scaling
  design.
- The API, not the app or a wallet provider, creates challenges, verifies signatures,
  assigns profiles, and issues Stocklana sessions.
- The default provider-token architecture is a **backend-for-frontend (BFF)**:
  provider OAuth codes and refresh tokens are exchanged and held only by the API.
  Provider credentials never become the Stocklana session or a mobile bearer token.
- Phase 1 supports one active EVM wallet and one active Solana wallet per profile.
  A wallet identity is immutable once linked; conflicts are private and fail closed.
- EVM contract accounts are **unsupported at launch** until DG-04 selects and tests
  ERC-1271 verification per supported chain. Return `EVM_CONTRACT_ACCOUNT_UNSUPPORTED`,
  never an incorrect "bad signature" result.
- Challenge TTL is 15 minutes for the Paybox spike, then a configuration value subject
  to measurement and security review. Verify with a maximum 60-second clock skew.

### Must be decided before release

`DG-01` supported EIP-155 chain IDs and Solana clusters; `DG-02` identity/uniqueness
rules; `DG-03` launch device/wallet/provider matrix; `DG-04` ERC-1271; `DG-05`
provider-token lifecycle; and `DG-06` recovery operations remain release gates from
the PRD. In addition, record `AUTH_DOMAIN`, canonical HTTPS URI, mobile universal-link
host, callback host, and any provider registration as a security-owned decision. No
network, wallet, provider, OAuth redirect, or production domain is assumed here.

The safe initial DG-02 rule is:

| Family | Phase-1 canonical key | Unique constraint |
| --- | --- | --- |
| EVM EOA | `eip155:<chainId>:<lowercase-20-byte-address>` | `(namespace, chain_id, address_normalized)` |
| Solana | `solana:<cluster>:<base58-public-key>` | `(namespace, cluster, address_normalized)` |

This intentionally treats an EVM address on different chains as different identities.
Changing it for EOAs requires an explicit migration/decision; contract accounts must
remain chain-specific.

## 2. Monorepo layout

The current pnpm workspace already accepts `apps/*` and `packages/*`. Keep mobile
native code isolated from server-only crypto and provider credentials.

```text
apps/
  mobile/                         Expo SDK 57 app (existing)
  api/                            Node 22/Fastify API and SQLite deployment unit
    src/{http,auth,db,providers,session,observability}/
    drizzle/                      ordered, checked-in SQL migrations
packages/
  auth-contract/                  Zod schemas, error codes, endpoint types,
                                  exact EVM/SIWS serializers and fixtures
  provider-contract/              ProviderAdapter interface and safe DTOs
  test-wallet-provider/           deterministic OAuth/wallet/signing test adapter
```

`auth-contract` is runtime-neutral and contains no private key, RPC URL, or provider
SDK. `apps/mobile` imports only its public schemas/types, not `apps/api` internals.
`apps/api` owns storage, verification, rate limiting and session issuance. Publish no
package merely to share the local types; pnpm workspace dependencies are sufficient.

## 3. Backend and persistence

### Runtime and dependencies

Use `fastify@5.12.4`, TypeScript, `drizzle-orm@0.45.2` with
`better-sqlite3@13.0.3`, and checked-in Drizzle-generated SQL migrations. The npm
metadata inspected for `better-sqlite3@13.0.3` requires Node `>=22`; this is why the
service baseline is Node 22 rather than the workstation's current Node 24. Use
`PRAGMA journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, and
`synchronous=FULL`; make database backup/restore part of deployment, and run exactly
one writable API process per database volume.

Migrations run once at process deployment/startup under an external single-instance
lock. The API refuses to start if the migration version is behind. Never use
`drizzle-kit push` against non-development data; release only ordered migrations and a
restore-tested backup.

### Schema

All timestamps are UTC ISO-8601 text; IDs are UUIDv7/ULID; secrets and raw proofs are
not written to ordinary logs. The abbreviated schema below is the migration contract.

| Table | Important columns and constraints | Purpose |
| --- | --- | --- |
| `profiles` | `id`, `created_at`, `status` | Minimal durable Stocklana profile. |
| `wallets` | `id`, `profile_id FK`, `family`, `namespace`, `chain_id`, `cluster`, `address_normalized`, `address_display`, `provider_credential_id`, `verified_at`, `revoked_at`; unique canonical key and active `(profile_id, family)` | One verified active wallet per family, never silently reassigned. |
| `auth_attempts` | `id`, `purpose(sign_in/link_wallet)`, `initiating_profile_id?`, `family`, `provider_id`, `state`, `return_state_digest`, `expires_at`, `last_provider_request_id?` | Idempotent, resumable client journey. |
| `sign_challenges` | `id`, `attempt_id FK`, `protocol`, `nonce`, `message_utf8`, `message_sha256`, bound identity/context fields, `issued_at`, `not_before`, `expires_at`, `consumed_at?`, `invalidated_at?`; unique `nonce` | Single server-issued challenge. Encrypt raw message at rest only if operationally needed; its hash/fields are enough for audit. |
| `provider_credentials` | provider/user credential ref, encrypted access/refresh token ciphertext + key version, expiry, revoked timestamps | Server-only provider authorization, separate from Stocklana sessions. |
| `provider_requests` | `id`, `attempt_id`, provider request ID (unique), challenge ID, status, terminal reason, `result_ciphertext?` | Reconcile an existing provider request; never create another while pending. |
| `session_families` | `id`, `profile_id`, `device_installation_id_digest`, `created_at`, `revoked_at`, reason | Revocation boundary for a device login. |
| `refresh_tokens` / `access_tokens` | token id, family FK, keyed-secret digest, expiry, used/revoked/replaced timestamps | Opaque session credentials; only digests persist. |
| `audit_events` | actor/profile/attempt IDs, category, redacted metadata, hash-chain optional | Conflict, revoke, provider and security events without raw address/proof. |

`wallets.provider_credential_id` is an attribution/reference, not the identity key or
authority to authenticate. Add an application-level check and a partial unique index
for one non-revoked wallet per profile/family. Do not store seed phrases, private keys,
raw OAuth tokens in plaintext, complete signatures in analytics, or full wallet
addresses in logs. If proof retention is approved, encrypt it in a distinct column/key
with a documented retention period; otherwise retain only the message/proof hashes and
verification result.

### Atomic verification and nonce consumption

Cryptographic verification occurs before opening the short write transaction. Then use
one `BEGIN IMMEDIATE` transaction (SQLite writer reservation) to re-read and conditionally
consume the exact challenge, attach/create the profile, and create the session family
and credentials.

```text
BEGIN IMMEDIATE
UPDATE sign_challenges
   SET consumed_at = :now
 WHERE id = :challengeId AND attempt_id = :attemptId
   AND nonce = :nonce AND message_sha256 = :messageHash
   AND consumed_at IS NULL AND invalidated_at IS NULL
   AND expires_at >= :now AND not_before <= :now;
-- require exactly one changed row; otherwise return CHALLENGE_EXPIRED/REPLAYED.

SELECT wallet/profile under the canonical identity key;
-- sign-in: create profile+wallet only if absent, otherwise select the existing profile.
-- link: require the authenticated initiating profile and insert only if identity is absent
--       or already belongs to that same profile; any other owner => conflict + audit.
INSERT session family, opaque access token digest, opaque refresh token digest;
UPDATE auth_attempts SET state='complete';
COMMIT
```

The unique canonical-wallet index is the second line of defence against a concurrent
new-profile/link race. On uniqueness collision, roll back and return the same generic
`WALLET_CONFLICT` response (and record an audit event). A failed cryptographic proof
does not consume a nonce; a successful proof can only commit once. Expiring or changing
wallet invalidates old unconsumed challenges in the same transaction.

## 4. Protocol and verification libraries

The prototype dependencies and target interoperability layers are deliberately
distinguished below. Upgrade either only with the byte-level fixture suite.

| Protocol | Prototype implementation | Target interoperability layer |
| --- | --- | --- |
| ERC-4361 and EVM EOA recovery | `auth-contract.serializeEip4361V1` plus [`viem@2.56.3`](https://www.npmjs.com/package/viem) recovery over the exact persisted message. | Add [`siwe@3.0.0`](https://www.npmjs.com/package/siwe) parser fixtures before a production provider; add RPC only if DG-04 enables ERC-1271. |
| SIWS-compatible Solana Ed25519 proof | `auth-contract.serializeSiwsV1` plus `tweetnacl@1.0.3` over the exact persisted UTF-8 bytes. | Add [`@solana/wallet-standard-util`](https://www.npmjs.com/package/@solana/wallet-standard-util) `verifySignIn` compatibility when a provider returns the Wallet Standard envelope. |

The API owns `serializeEip4361V1()` and `serializeSiwsV1()` in `auth-contract`; neither
the app nor adapter may reconstruct, trim, normalize Unicode, or reorder fields.
Restrict v1 SIWS input to printable ASCII fields and UTF-8 with `\n` line endings.
Return `message`, `messageUtf8Hex`, and `sha256` from challenge creation. The prototype
requires the Ed25519 signature to verify over
`TextEncoder.encode(serializeSiwsV1(input))` exactly. A production Wallet Standard
adapter must additionally compare returned `signedMessage` bytes and call
`verifySignIn`; reject any wallet-generated variation.

For EVM, the single versioned serializer creates the ERC-4361 display message. Require protocol
version `1`, EIP-155 `chainId`, canonical recovered EOA address, the exact persisted
string/UTF-8 SHA-256, 65-byte `0x` lower-case-hex `r||s||v`, domain, URI, nonce,
issued-at, expiry, request ID and statement. Accept recovery parity variants only in the
verifier; retain the original artifact only under the approved proof-retention policy.
For Solana, accept exactly a 32-byte base58 public key and a 64-byte lower-case hex
Ed25519 signature at the API boundary; convert to the Wallet Standard `Uint8Array`
output solely inside the verifier. These rules satisfy the normative signing contract
without relying on provider-specific signing semantics.

`@siws/core@0.1.1` was evaluated but is not selected: while its package advertises
message construction and Ed25519 verification (Node `>=18`), the PRD references the
Phantom/Wallet-Standard SIWS format. The maintained Wallet Standard verifier is the
better interoperable primary path. `@solana/offchain-messages@8.3.0` is also not a
drop-in SIWS substitute; it implements the separate Solana off-chain-message envelope.

## 5. Versioned HTTP contract

All routes are JSON under `/v1`; production requires HTTPS. Responses use
`Cache-Control: no-store` and request IDs. The implemented signature-request and refresh
mutations require stable idempotency keys. Runtime Zod schemas validate request bodies;
shared response schemas cover security-critical shapes, while generated end-to-end DTOs
remain target work. Unknown request fields are rejected. The app treats the server as
authoritative.

| Endpoint | Authentication | Request → response (abridged) |
| --- | --- | --- |
| `POST /v1/auth/attempts` | optional session; required for `link_wallet` | `{purpose,family,providerId}` → `{attemptId,attemptCapability,state,expiresAt,supportedContext,developmentCredential?}`. The credential field is non-production only. |
| `GET /v1/auth/attempts/:id/credentials` | attempt capability | Development/test credential discovery only; production returns `PROVIDER_DISABLED`. |
| `POST /v1/auth/attempts/:id/challenges` | attempt capability | `{credentialRef,address,chainContext}` → `ChallengeV1` with exact message bytes/hash and expiry. |
| `POST /v1/auth/attempts/:id/signature-requests` | attempt capability + idempotency key | `{challengeId,credentialRef}` → `{requestId,state:'awaiting_signature',pollAfterMs}`; reserves once under `(attempt,challenge)`. |
| `GET /v1/auth/attempts/:id` | attempt capability or owner session | Returns state, selected *short/display* address, existing request ID and safe normalized error; it never causes signing. |
| `GET /v1/auth/attempts/:id/signature-requests/:requestId` | same | Reconciles the existing request. An approved result is verified server-side; encrypted-at-rest completion data lets a lost/repeated poll return the identical token pair until attempt expiry. |
| `POST /v1/auth/attempts/:id/proofs` | attempt capability | Development/test direct-proof path only. It invokes the same verifier and transaction and is disabled in production. |
| `POST /v1/sessions/refresh` | refresh token + idempotency key | Rotates atomically. A same-key retry returns the identical encrypted-at-rest replacement; proven different-key reuse revokes the family. |
| `POST /v1/sessions/revoke` | access token | Revokes its session family and returns `204`; app then clears secure storage. |
| `GET /v1/me` | access token | `{profileId,wallets:[{family,addressDisplay,context,verifiedAt}]}`; provider neutral. |

`POST /authorize` and `POST /provider-return` are reserved target routes for a future
BFF OAuth adapter. They are intentionally absent from the prototype.

`attempt capability` is a 256-bit, opaque attempt token delivered only to the app after
creation and stored with the pending attempt; its HMAC digest is stored in
`auth_attempts`. It limits unauthenticated operations to that attempt and expires with
it. It is not a session token.

Every error has this exact envelope:

```ts
type ApiError = {
  error: {
    code: ErrorCode;        // stable machine-readable enum
    message: string;        // safe, eighth-grade user/support text
    retryable: boolean;
    requestId: string;
    attemptId?: string;
    details?: { retryAfterSeconds?: number; supportedContexts?: string[] };
  };
};
```

Use 400 for invalid shape/context, 401 `SESSION_INVALID`, 403 `ATTEMPT_FORBIDDEN`, 404
for an unknown capability-safe resource, 409 for `CHALLENGE_REPLAYED`,
`ATTEMPT_STATE_INVALID`, `WALLET_CONFLICT` or duplicate request, 410 for expired
attempt/challenge, 422 for `PROOF_INVALID`, `ADDRESS_MISMATCH`, `WRONG_NETWORK` or
unsupported account, 429 for rate limits, and 502/503 for normalized provider outage.
The `WALLET_CONFLICT` body must not reveal which profile owns the wallet or any activity.
Provider error payloads never cross the boundary unchanged.

## 6. Session lifecycle

On a successful atomic verification, create a session family and return two opaque,
random 256-bit values: a 15-minute access token and a 30-day idle/90-day absolute
refresh token. Format is `st1.<tokenId>.<secret>`; only `HMAC-SHA-256(pepper-version,
secret)` plus token ID is stored. The HMAC pepper is a server secret with versioned
rotation, and comparisons are constant-time. A leaked database therefore does not
contain usable bearer credentials.

`POST /sessions/refresh` consumes the one-time refresh row and, in the same transaction,
inserts a successor refresh row and fresh access row. Reuse of a consumed/revoked refresh
token revokes the entire family and emits a security audit event. The mobile client sends
an idempotency key and retains the old pair until it durably stores the response; if a
response is lost, it makes one documented reconciliation attempt, otherwise returns to
re-verification rather than weakening replay detection. Access token expiry is normal;
logout or provider/session compromise revokes the family immediately. `POST /revoke`
clears only Stocklana authentication; provider-grant revoke is a distinct adapter action
with separately documented effect. Background token refresh does not itself invoke a
wallet signature.

## 7. Provider adapter boundary

`provider-contract` exposes only provider-neutral operations:

```ts
interface ProviderAdapter {
  readonly id: string;
  getSupport(build: BuildContext): Promise<SupportMatrix>;
  beginAuthorization(input: AuthorizationInput): Promise<AuthorizationStart>;
  redeemAuthorization(input: AuthorizationReturn): Promise<GrantedCredential[]>;
  requestMessageSignature(input: ExactMessageRequest): Promise<ProviderRequest>;
  getMessageSignature(input: ExistingRequest): Promise<ProviderRequestResult>;
  revokeGrant?(input: RevokeGrant): Promise<void>;
}
```

`ExactMessageRequest` has `requestId`, immutable credential reference, family, declared
network, `messageUtf8` and SHA-256. It cannot accept a transaction, seed phrase,
private key, or arbitrary provider token. The API checks adapter output against the
persisted challenge before verification. Persisted request IDs make `getMessageSignature`
the only resume/poll operation; never call `requestMessageSignature` to check status.

The prototype implements one adapter and reserves a second target:

1. **`DeterministicTestWalletAdapter`** is the default local/CI implementation. Public-
   label-derived non-production EVM and Solana test keys sign the exact supplied bytes.
   It has no OAuth or network call, auto-approves its polling path, and cannot be enabled
   outside `NODE_ENV=test|development`; tests inject failures where required.
2. **`PayboxAdapter`** is not implemented or configured. If the PRD's device spike
   reaches an adopt decision, the target uses Authorization Code + PKCE S256 at the BFF, exact
   registered HTTPS callback, encrypted server-side grant storage, credential listing,
   and one provider signing request mapped to one `provider_requests` row. Verify its
   mobile signing-window and return accessibility on actual iOS/Android hardware; do
   not import a Node/headless Paybox SDK into Expo or assume an embedded connection UI.

A later direct wallet or WalletConnect-compatible adapter implements the same interface
and uses `/proofs`; it does not change profile, challenge, session or mobile state rules.

## 8. Expo SDK 57 integration

The prototype root layout mounts `SessionProvider` and a single responsive route that
selects onboarding or the minimal verified-wallet profile after secure-storage
hydration. Authenticated tabs and route groups belong to Phase 2. The server still
protects every data route; mobile route selection is UX, not authorization.

```text
src/app/{_layout,index}.tsx
src/features/{onboarding,session}/
src/components/onboarding/
```

Persist only the active attempt capability/IDs/expiry, purpose, phase, family,
credential reference, shortened address, chain context, and non-secret challenge
metadata. Never persist the full wallet address or raw signing message. On a prototype
foreground/cold return, query `GET attempt`, revalidate the development credential and
chain context, and poll an existing signature request when one exists. A restored
`connected_unverified` attempt creates a fresh server challenge so the exact message can
be reviewed in memory before signing; an awaiting or completed attempt is poll-only and
cannot start another signing request. Use `AppState` to reconcile on active and focus the
current status heading once after a meaningful transition. Expired or malformed state is
cleared and retry begins a fresh attempt.

For a future OAuth provider, a validated Universal/App Link return will call the target
`provider-return` BFF route and then use the same `GET attempt`/existing-request
reconciliation rules. Those callback routes are not part of this prototype.

Use SDK-57 `expo-secure-store` installed through `pnpm expo install` (current SDK-57
package metadata resolves `expo-secure-store@57.0.4`). Store access/refresh tokens,
attempt capability and provider return code only there, using a small value per key,
`WHEN_UNLOCKED_THIS_DEVICE_ONLY`, and `keychainService: 'com.stocklana.session.v1'`.
SecureStore uses Android encrypted SharedPreferences/Keystore and iOS Keychain, but it
is not a source of truth; iOS keychain items can survive reinstall and Android values
do not. Therefore `SessionProvider` calls `/me`/refresh before declaring a restored
session valid, and clears stale items. Configure the SecureStore config plugin's Android
backup exclusion. Biometric `requireAuthentication` is not a substitute for server
authentication and is deferred unless product explicitly wants a local re-unlock step.

For a future provider OAuth adapter, use SDK-57 `expo-auth-session` and `expo-crypto`,
installed through the Expo installer at that time; AuthSession requires its
`expo-crypto` peer. It creates the
browser flow/PKCE verifier, but the API exchanges the authorization code. Use the
registered **HTTPS Universal/App Link**, not an Expo Go callback or a custom scheme for
production authorization. SDK-57 Linking documents that stable authorization callbacks
require a development/standalone build and configured scheme; its Expo Go published
URLs are not stable. Use `expo-linking`'s `useLinkingURL()`/`parse()` for warm and cold
returns, validate exact host/path/query state server-side, and test Universal Links/App
Links association files. Do not put a provider client secret or any server secret into
`EXPO_PUBLIC_*` configuration.

References: [Expo SDK 57 SecureStore](https://docs.expo.dev/versions/v57.0.0/sdk/securestore/),
[AuthSession](https://docs.expo.dev/versions/v57.0.0/sdk/auth-session/), and
[Linking](https://docs.expo.dev/versions/v57.0.0/sdk/linking/). These exact SDK 57
references were consulted before choosing the mobile APIs above.

## 9. Configuration and deployment

Validate config with a server Zod schema at startup and fail closed. Commit only
`.env.example` names, never real values.

| Scope | Required configuration |
| --- | --- |
| API (implemented) | `NODE_ENV`, `PORT`, `DATABASE_URL`, `AUTH_DOMAIN`, `AUTH_URI`, `CHALLENGE_TTL_SECONDS`, `ATTEMPT_TTL_SECONDS`, `ACCESS_TTL_SECONDS`, `REFRESH_TTL_SECONDS`, `SESSION_HMAC_PEPPER`, `SESSION_RESULT_ENCRYPTION_KEY`, network lists, `CORS_ORIGINS`, and rate-limit settings. |
| Networks | `EVM_SUPPORTED_CHAIN_IDS`, chain-specific RPC URLs (only required for approved ERC-1271), `SOLANA_SUPPORTED_CLUSTERS`; these remain DG-01 configuration. |
| Paybox (target only) | Issuer/authorization/token endpoints, public client ID, exact registered HTTPS callback, scopes, credential allowlist, and a disabled-by-default feature flag if adopted. |
| Mobile public config | only API base URL, app build/version, feature flags, declared supported-chain/provider display metadata, and universal-link host. No secret, provider access token, or signing key. |

Terminate TLS at a trusted reverse proxy, restrict API origins to the declared app/web
origins, send HSTS on the HTTPS hosts, and mount the SQLite volume outside the image
with encrypted backups and least-privilege filesystem permissions. A single instance
can be deployed with systemd or Compose; readiness checks include migrated schema and
key/config validation, not an external provider health dependency.

## 10. Trust boundaries and threats

| Boundary | Rule |
| --- | --- |
| Mobile app ↔ API | All client input is untrusted; access/refresh/attempt credentials are bearer secrets protected by SecureStore, short TTL and revocation. TLS plus server-side schema/authorization checks are mandatory. |
| API ↔ wallet | A wallet address/connection/grant proves nothing. Only a fresh signature over the exact persisted server challenge can authenticate. |
| API ↔ provider | Treat provider callback, credential, request status and signature as untrusted until state/PKCE/redirect, requested credential, exact message bytes and chain verifier all pass. Provider outage cannot create a session. |
| API ↔ database/logs/analytics | DB is durable but may be exposed; hash session tokens, encrypt provider tokens/proofs, redact sensitive values before log/event creation, and use attempt IDs plus one-way address pseudonyms for telemetry. |
| Profile ownership | Transactional uniqueness means a conflict creates no session/link, reveals no profile, and never auto-merges/reassigns. Recovery remains disabled until DG-06. |

Threat-model acceptance tests cover replay/concurrent consumption, message/domain/network/
address substitution, Unicode and line-ending changes, SIWS encoding, EVM recovery
malleability, callback interception and state mix-up, session fixation/refresh reuse,
stolen device token, provider compromise, duplicate request/resume, rate-limit abuse,
profile conflict takeover, and sensitive data in proxy/device/application logs. Rate
limit challenge/create/verify by network source, attempt, address pseudonym and device
installation pseudonym, with bounded retry windows and generic public failure text.

## 11. Test and release plan

### Automated tests

- **Unit:** serializers/parsers and schemas; all positive/negative EVM and SIWS fixtures;
  signature sizes/encodings; EOA recovery; address normalization; expiry/skew; every
  error mapping; token HMAC/rotation/reuse; redaction; provider state machine.
- **Integration:** temporary SQLite database with real migrations; transaction race of
  50 simultaneous valid verification submissions yields exactly one session; profile
  creation/resume/link/conflict; refresh reuse revokes family; provider callback PKCE/
  state/redirect mismatch; Fake adapter's pending/reject/expiry/revoke/outage paths.
- **API contract:** Fastify route validation and OpenAPI/contract snapshots verify every
  `/v1` response/error matches the shared Zod contract and no unversioned auth route is
  introduced.
- **Mobile E2E:** Maestro/Detox against the deterministic adapter on iOS and Android:
  both happy paths, cancellation, rejection, expired challenge, wrong address/network,
  offline/reconnect, background/cold return/process death, duplicate poll prevention,
  session restore/expiry/sign-out, second-wallet conflict/link and screen-reader/text
  scale assertions. Exercise real Universal/App Links in development builds, not Expo Go.
- **Provider acceptance:** after the Paybox spike, repeat the PRD matrix on physical
  devices for every declared provider/wallet/OS/build/chain. The provider UI itself,
  warm/cold callback, accessibility, approval window and token lifecycle are release
  evidence, not mocked evidence.

Fixtures are checked into `packages/auth-contract/fixtures/v1/` with source fields,
canonical string, UTF-8 hex, SHA-256, network context, signature encoding/result and
one mutation per bound field. Fixtures include LF/CRLF, non-ASCII rejection, case/base58
rules, expiry boundaries and the SQLite atomic-race case.

### Delivery slices

1. **Foundation:** add workspace packages/API, migrations, config validation, shared
   typed contract, deterministic adapter and the fixture/race/session test suite. No
   production provider.
2. **EVM vertical slice:** ERC-4361 challenge/EOA verification, profiles/sessions,
   public/authenticated routing and SecureStore restore/sign-out using the fake adapter.
3. **Solana vertical slice:** exact SIWS serializer plus Wallet-Standard verification,
   Solana fixtures, second-family link/conflict and Phase-2-ready `/me` wallet context.
4. **Lifecycle hardening:** handoff persistence, Universal/App Links, accessibility,
   telemetry redaction, rate limits, session/provider revocation and full E2E recovery.
5. **Paybox spike and gated rollout:** implement adapter behind allowlist/kill switch,
   record adopt/adopt-with-gaps/reject evidence, resolve DG-01..DG-06, security/privacy
   review, then limited beta by supported matrix. A rejected Paybox spike leaves the
   deterministic and contract work reusable for another adapter.

## 12. FR traceability

| FRs | Architectural evidence |
| --- | --- |
| FR-01–05 | explicit family/adapter support matrix, pre-handoff UI, attempt-bound HTTPS return, canonical/display address and route state. |
| FR-06–12 | server random nonce, persisted exact challenge/context/TTL, ERC-4361/SIWS verifiers, byte fixtures, `BEGIN IMMEDIATE` conditional consume. |
| FR-13–18 | transactional profile/wallet identity model, private conflict response, opaque hashed session family, distinct provider revoke/sign-out. |
| FR-19–23 | SecureStore pending attempt/request ID, foreground/cold reconciliation GETs, state machine/error enum, fresh challenge after expiry, change-wallet path. |
| FR-24–27 | wallet unique constraints + audit/no merge, DG-06 recovery block, BFF provider tokens independently encrypted/rotated/revoked/tested. |

The target architecture covers FR-01 through FR-27, subject to the named provider,
network, identity and recovery decision gates. The implementation snapshot above states
which evidence exists today; target rows are not release evidence and do not relax any
PRD requirement when Paybox is unavailable.
