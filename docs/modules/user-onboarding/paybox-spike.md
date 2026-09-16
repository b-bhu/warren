# Paybox feasibility spike — Expo SDK 57 onboarding

| Field | Value |
| --- | --- |
| Status | Research spike; no Paybox client, account, package, or credential was created or used |
| Scope | Expo iOS/Android OAuth return, MCP credential discovery, off-chain EVM/Solana signing, and Warren server verification |
| Investigated | 2026-09-12 (public Paybox documentation and unauthenticated discovery only) |
| Preliminary decision | **Do not adopt yet.** OAuth return is plausible; native rendering of the required MCP signing window is unproven and is currently a decision-blocking gap. |

## Reading key and evidence boundary

- **Verified** means explicitly documented by Paybox or observed from its unauthenticated public endpoint during this spike.
- **Inference** is a constrained implementation conclusion; it needs the executable device test below.
- **Unknown** must be resolved by Paybox documentation/support or a credentialed, physical-device spike. It is not safe to assume.

This is a provider feasibility document, not an authorization to create an embedded wallet, store a seed phrase, move funds, or make provider authorization equivalent to a Warren session. The PRD remains authoritative: Warren alone issues the single-use challenge and accepts ownership only after its own server verifies the exact signed bytes.

## Verified public surface and exact flow

**Verified:** Paybox exposes the following public origins and endpoints. The two discovery documents were fetched successfully without credentials during this spike; `GET https://api.paybox.sh/mcp` returned `401` and a `WWW-Authenticate` reference to protected-resource metadata.

| Purpose | Exact endpoint | Method / auth |
| --- | --- | --- |
| OAuth server metadata | `https://api.paybox.sh/.well-known/oauth-authorization-server` | `GET`, none |
| MCP protected-resource metadata | `https://api.paybox.sh/.well-known/oauth-protected-resource` | `GET`, none |
| Dynamic public-client registration | `https://api.paybox.sh/oauth/register` | `POST`, none |
| Browser authorization | `https://api.paybox.sh/oauth/authorize` | `GET`, user browser session |
| Code / refresh exchange | `https://api.paybox.sh/oauth/token` | `POST`, public client, no client secret |
| MCP (streamable HTTP, documented protocol `2025-06-18`) | `https://api.paybox.sh/mcp` | `POST`, `Authorization: Bearer <access token>` |
| Consent / first-party app UI | `https://app.paybox.sh` | browser / app UI |

The live discovery response advertises issuer `https://api.paybox.sh`, resource `https://api.paybox.sh/mcp`, authorization-code and refresh-token grants, mandatory `S256` PKCE, public-client token authentication (`none`), and scopes `mcp` and `offline_access`. It additionally advertises a device-authorization endpoint; that endpoint is not described as the mobile onboarding flow and is out of scope for this app flow.

**Verified authorization-code flow:**

1. Discover both metadata documents; do not hard-code endpoints beyond a bootstrap default.
2. Register a public client with `token_endpoint_auth_method: "none"` and an HTTPS redirect URI. This creates a `pbx-oauth-…` client ID; Paybox has no client secret for this flow.
3. Open `/oauth/authorize` in the system browser with `response_type=code`, `client_id`, the registered `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, `scope=mcp` (plus `offline_access` only if refresh is needed), `resource=https://api.paybox.sh/mcp`, and Warren's random attempt-bound `state`.
4. The person signs in to Paybox, chooses credentials and an approval mode, and performs the passkey grant. Paybox returns to the registered redirect URI with `code` and `state`.
5. Verify the returned `state` and its attempt/expiry before using the code. Exchange the code at `/oauth/token`, supplying the original `redirect_uri` and retained PKCE verifier. The authorization code is documented as single-use and valid for five minutes.
6. Call MCP with the access token. Access tokens are documented as 60-minute, JWT, audience-bound to the MCP resource. `offline_access` yields a 30-day sliding refresh token that is rotated on every use; replay of a used refresh token revokes the client.

**Verified exact-match constraint:** `redirect_uri` must be HTTPS (except `http://localhost` for local development) and is matched *exactly* against the registered value. A mismatch or malformed URI produces a Paybox error page rather than redirecting to an unverified destination. The documentation's own example registers a URI without query parameters and receives `?code=…&state=…` at that URI.

Sources: [OAuth 2.1](https://docs.paybox.sh/connect/oauth), [API & endpoints](https://docs.paybox.sh/api-reference), [MCP connector](https://docs.paybox.sh/connect/mcp).

## Expo HTTPS Universal/App Link feasibility

**Inference — plausible, not verified:** A production `https://auth.warren.example/paybox/callback` can simultaneously be (1) the exact, registered Paybox redirect URI, and (2) an iOS Universal Link / Android App Link. Paybox's exact URI rule is compatible with that pattern because OAuth appends `code` and `state` after the registered path; Warren must register the exact scheme, host, path, trailing-slash form, and any static query component it uses. It must not generate per-attempt redirect URIs or substitute an Expo custom scheme.

Required conditions:

- Warren controls a stable HTTPS domain and serves the exact route without an intermediate URL rewrite that loses OAuth parameters.
- iOS has a valid `apple-app-site-association` mapping for that host/path and the production iOS app's team ID + bundle ID.
- Android has a valid `assetlinks.json` mapping for that host/path and the production Android package + signing certificate fingerprint.
- Expo's production native build handles the link on a warm start and cold start, retains the PKCE verifier and one-time `state` securely across the browser handoff, and rejects wrong/missing/replayed/expired state before token exchange.
- The installed-app case returns directly to the app. The uninstalled, disassociated, or browser-fallback case serves a safe Warren web page that does not expose the code, cannot create a session merely by loading, and gives an install/retry path. It must not redirect the code to a custom scheme.

**Unknown:** Paybox has not publicly documented a tested Expo, Universal Link, or Android App Link integration, browser/session behavior on these platforms, or whether an authorization cancellation is returned to the redirect route. The exact deployment behavior (including iOS link association caching and Android verified-link selection) therefore requires device proof.

## MCP: initialization, tools, resources, and lifecycle

**Verified:** `/mcp` is a streamable-HTTP MCP endpoint using protocol version `2025-06-18`. A bearer access token is required. Paybox documents these required tool-level calls:

| Need | Tool / resource | Verified input and result requirements |
| --- | --- | --- |
| Discover a granted wallet | `list_credentials` | No input. Call first. Select only `kind: "wallet"`; `metadata.chains` is family-level (`["evm"]` or `["solana"]`), and `metadata.address` may be null. `ungranted_summary` exposes counts only, not identities. |
| Create exactly one sign request | `request_wallet_sign` | `credential_id` plus `intent`. EVM uses `{ "op":"message", "message":"<exact SIWE text>" }`; Solana uses `{ "op":"solanaMessage", "address":"<base58>", "message":"<exact SIWS text>" }`. Never use `raw` for this product flow. |
| Reconcile the same request | `get_request` | `request_id` from the original request. This is idempotent and only the client that created the request may read it. |
| Required signing UI resource | `ui://paybox/wallet-sign` | Paybox documents this as the interactive signing window shown by the **MCP host in chat** once status is `pending_signature`. It signs client-side and posts the artifact to Paybox; external clients do not call the window's internal tools. |

**Inference — client protocol work:** An Expo client acting as its own MCP host must implement the standard streamable-HTTP MCP initialization/negotiation, preserve the returned session/transport state if the protocol requires it, then discover `tools/list` and resource/UI capabilities before calling `tools/call`. It must use the server-advertised schemas rather than hand-copy assumptions. It must also implement resource/UI handling sufficient for `ui://paybox/wallet-sign`. These are normal MCP-host responsibilities, but Paybox's public pages do not publish an Expo-specific initialization transcript or resource-rendering contract.

**Unknown / critical:** The available unauthenticated surface cannot expose `tools/list`, schemas, resource metadata, or a `resources/read` response. Paybox documents `ui://paybox/wallet-sign` as an in-chat UI, not an HTTPS page or a WebView URL. There is no verified mechanism for an Expo app to render, host, deep-link to, or complete that resource. Treating `ui://` as a URL to load in `WebBrowser` or a `WebView` would be unsupported.

**Verified request state machine:** `request_wallet_sign` returns a result envelope. `pending_approval` contains an `approval_url`; surface it and let the person approve with a passkey in Paybox. That approval is operation-bound and expires after approximately ten minutes. After approval (or an autonomous grant), status is `pending_signature`; the signing window produces the signature; terminal `success` places the artifact in `output`. `denied` carries a reason and `error` a message. Submit once, then poll `get_request`; reissuing creates a distinct signing operation.

**Native rendering conclusion:** `approval_url` is plausibly an external authenticated Paybox browser/app handoff and can be opened accessibly with the system browser, then reconciled by polling. It is not, by itself, the signing surface. If approval advances the request to `pending_signature`, an Expo implementation still needs the MCP signing-window capability. A native app cannot claim feasibility by rendering only `approval_url`. This gap is an initial **reject** condition unless Paybox supplies and the device spike proves a supported native host/rendering path.

Sources: [MCP tools](https://docs.paybox.sh/reference/mcp-tools#list_credentials), [request lifecycle and signing window](https://docs.paybox.sh/concepts/requests), [approvals and passkeys](https://docs.paybox.sh/concepts/approvals).

## Token ownership: native public client vs BFF

| Design | What holds Paybox tokens | Advantages | Principal risks / constraints | Current assessment |
| --- | --- | --- | --- | --- |
| Native public client | Expo securely holds access token and, if requested, rotating refresh token; app itself is the OAuth/MCP client | Direct PKCE code exchange, simpler OAuth return, request ownership naturally follows the app instance | A bearer plus refresh token on a consumer device; secure storage, rotation atomicity, device compromise, logout/revocation, state/verifier persistence, and a full native MCP host/UI implementation are required. A Warren session still must be minted only after server-side signature verification. | Only viable if Paybox proves native signing-window support. Default to `mcp` only; avoid `offline_access` until continuity is justified. |
| Backend-for-frontend (BFF) | Warren server holds Paybox access/refresh tokens and is the MCP client; device holds only a short-lived Warren session | Centralized refresh rotation/revocation/audit controls; tokens absent from device; server can own request IDs and polling | OAuth callback and PKCE association must bind safely to the app attempt; user-specific Paybox token storage is high-value; it does **not** solve a browser/chat-only `ui://` signing window. Server-side SDK/CLI requires a `pbxk1.` signing key for in-process signing, which is not appropriate to place in a mobile app and changes the custody/security review. | Preferred token containment if Paybox supports an approved user-facing signing handoff that works with a BFF. Not a workaround for absent native UI. |

**Verified:** the Node SDK/CLI is Node/headless-oriented; it talks to REST rather than an MCP host and signs in-process when a `pbxk1.` signing key is configured. The docs say that key is provisioned to the agent and must not be exposed. **Inference:** do not put this key in Expo, and do not substitute the Node SDK for a React Native integration.

In both designs, provider access is a separate authorization layer. Store provider credential ID, chain family, returned address, provider request ID, and Warren attempt ID as data; never treat an OAuth grant, `list_credentials` address, or Paybox `success` alone as a Warren login.

Source: [SDK & CLI](https://docs.paybox.sh/sdk-cli), [OAuth tokens](https://docs.paybox.sh/connect/oauth#tokens).

## Inputs required before a real device spike

1. A Paybox account with a passkey, an existing permitted EVM credential, and an existing permitted Solana credential; record the exact approval mode used for each. Connecting/creating wallets and credential management are first-party Paybox app functions, not public APIs.
2. A dedicated development Paybox public client registration for each callback environment (not a shared production client) and its exact HTTPS callback URI.
3. A Warren-controlled callback domain, DNS/TLS, iOS associated-domain entitlement + association file, Android intent-filter + asset-links file, actual iOS team/bundle ID, Android application ID, and release signing certificate SHA-256 fingerprint.
4. The declared launch matrix: physical iOS/Android versions, Expo SDK 57 production build, Paybox app/browser availability, supported EVM CAIP-2/chain ID, Solana cluster, wallet/credential types, and contract-wallet policy.
5. Warren backend endpoints for one-time challenge issue, exact-byte EVM/Solana verification, profile conflict handling, and Warren session issuance. Challenge TTL starts at 15 minutes for this test so it exceeds Paybox's documented ~10-minute approval window, then is reduced/approved based on measurement.
6. Security operational decisions: token owner above; SecureStore/keychain versus BFF vault; refresh rotation locking; token/log redaction; logout and provider revocation; data retention; support/recovery owner; privacy/legal review.
7. A Paybox answer or written supported integration material for native rendering of `ui://paybox/wallet-sign`, including its accessibility and warm/cold-app behavior. This is required before participant testing.

## No-credentials mock contract

Use this contract to build Warren's provider-neutral state machine and server verifier before any Paybox account/client is used. It deliberately models only public artifacts and uses no real tokens, keys, identifiers, addresses, challenges, or signatures.

```json
{
  "oauthCallback": {
    "redirectUri": "https://auth.warren.test/paybox/callback",
    "query": { "code": "mock-single-use-code", "state": "attempt-bound-state" }
  },
  "list_credentials": {
    "credentials": [
      { "credential_id": "mock-evm", "kind": "wallet", "metadata": { "chains": ["evm"], "address": "0x<fixture-address>" }, "approval_mode": "always_approve" },
      { "credential_id": "mock-solana", "kind": "wallet", "metadata": { "chains": ["solana"], "address": "<fixture-base58-public-key>" }, "approval_mode": "iframe" }
    ],
    "ungranted_summary": { "wallet": { "evm": 0, "solana": 0 }, "card": 0, "secret": 0 }
  },
  "request_wallet_sign": [
    { "request_id": "mock-evm-request", "status": "pending_approval", "approval_url": "https://paybox.test/mock/approval/evm" },
    { "request_id": "mock-solana-request", "status": "pending_signature" }
  ],
  "get_request": {
    "pending": { "request_id": "<same-request-id>", "status": "pending_signature" },
    "evmSuccess": { "request_id": "mock-evm-request", "status": "success", "output": { "signature": "0x<65-byte-fixture-signature>" } },
    "solanaSuccess": { "request_id": "mock-solana-request", "status": "success", "output": { "signature": "<64-byte-lowercase-hex-fixture-signature>" } },
    "denied": { "request_id": "<same-request-id>", "status": "denied", "reason": "user_rejected" },
    "error": { "request_id": "<same-request-id>", "status": "error", "message": "provider unavailable" }
  }
}
```

Mock assertions: call `list_credentials` first; filter by requested family and `kind`; require non-null address; submit exactly the backend-issued UTF-8 message once with the selected mock credential; persist the request ID; transition only via `get_request`; accept `success` only after Warren's local fixture verifier accepts the exact message/address/signature; never log the raw message, full address, signature, code, access token, refresh token, or `approval_url` query. Include fixtures for replay, wrong chain/cluster, changed domain/URI/nonce/issued-at/expiry/attempt, malformed output, null address, wrong credential family, and terminal status received twice.

## Executable physical-device spike

Run on each declared physical iOS and Android release build. Do not run a signing key, CLI provisioning, wallet creation, transaction, `raw` signing intent, or autonomous grant in this spike.

1. **Discovery check (safe, repeatable).** Fetch the two metadata URLs above and assert issuer/resource/endpoints/scopes match this document. Call unauthenticated `/mcp` once and assert `401` plus `resource_metadata`; do not attempt tool calls without a token.
2. **OAuth return.** Register the test public client with the exact Universal/App Link callback, create a fresh PKCE verifier/challenge and attempt-bound state, authorize with `scope=mcp` and the exact resource, then approve. Pass only if iOS and Android each return to the intended Expo state on warm and cold starts, the `state` verifies once, the code exchange succeeds once, and wrong/replayed state, verifier, code, callback path, trailing slash, and host fail closed.
3. **MCP capability inspection.** With a least-privilege test token, initialize the documented MCP transport, record (redacted) initialization response, `tools/list` schemas, and resource/UI capability metadata. Pass only if the three named tools and a documented usable native equivalent for `ui://paybox/wallet-sign` exist. A resource that exists only as opaque chat UI is a failure for direct native adoption.
4. **EVM ownership proof.** Grant only one EVM wallet credential. Call `list_credentials`, confirm a wallet / EVM family / non-null address, request exactly one `op: message` containing the Warren server's exact ERC-4361 text, handle approval, resume after backgrounding, and poll the same ID. Pass only if terminal output is a 65-byte `0x` signature that Warren verifies by ERC-191 recovery to the selected canonical address and chain ID; issue a Warren session only then.
5. **Solana ownership proof.** Repeat independently with only one Solana credential and one `op: solanaMessage`, with selected base58 address and exact SIWS-compatible UTF-8 text. Pass only if terminal output is exactly 64 bytes encoded as lowercase hex and Warren Ed25519 verification succeeds for the selected public key and cluster; issue a Warren session only then.
6. **Second-wallet link.** From an existing Warren session, repeat the other family. Pass only if it attaches to the authenticated profile, cannot create a duplicate profile, and a known conflict gets the PRD's privacy-preserving failure.
7. **Timing and recovery.** Measure authorization, approval, signing, return, and end-to-end durations (median/p95); use a 15-minute challenge only for this spike. Pass only if the user can resume one persisted request after backgrounding and no refresh/resume creates a second request.

## Required security, accessibility, and failure tests

- **OAuth / tokens:** PKCE S256 only; state binding, expiry, one-time use, and callback correlation; authorization-code replay; refresh rotation race/replay; token expiry/revocation; logout; no tokens/verifiers in URL history, analytics, crash reports, ordinary logs, screenshots, clipboard, or support exports.
- **Provider grants:** no granted wallet; ungranted count only; null address; both EVM and Solana offered; wrong family; revoked credential/client; changed approval mode; unknown provider request; request belonging to another client; provider 401/429/5xx/timeout/offline.
- **Signing:** user cancel/deny; ~10-minute approval expiry; signing-window unavailable; pending approval/signature survives app background/termination; duplicate tap/network retry; output missing/malformed; changed exact message bytes; nonce replay; EVM wrong address/chain/domain/URI/times or EIP-1271 unsupported; Solana wrong key/cluster/bytes/encoding; backend verifier outage and profile conflict. No terminal provider event alone creates a Warren session.
- **Native handoffs:** Universal/App Link opens browser versus installed app, verified/unverified domain, cold/warm startup, browser back, app switch, no Paybox app/passkey, expired Paybox session, and safe fallback when the app is not installed.
- **Accessibility:** VoiceOver and TalkBack labels, focus restoration and state announcements from Warren to browser/app and back; maximum text scale; minimum 44 pt / 48 dp targets; contrast; reduced motion; external-app warning; approval URL purpose; cancellation and retry discoverability. The Paybox signing surface itself must be tested with both screen readers—an inaccessible opaque resource fails the journey even if its signature succeeds.

## Decision criteria

**Adopt** only when every declared EVM and Solana device/OS combination passes OAuth return, supported native signing-window rendering, exact server verification, no-duplicate lifecycle, recovery, accessibility, token security, and profile-linking tests; Paybox also supplies a supportable production integration contract for the native UI.

**Adopt with gaps** only when the core mobile flow—including the signing window—is demonstrated on both platforms and all security/session invariants pass, but a non-security, non-accessibility launch-matrix limitation is explicitly documented, hidden from unsupported users, owned, time-bound, and accepted by product, mobile, backend, QA, and security. A missing native signing renderer, missing Solana or EVM proof, or token compromise control is not an acceptable gap.

**Reject** if the `ui://paybox/wallet-sign` resource cannot be securely and accessibly rendered or handed off by the Expo app; if it leaves a request permanently `pending_signature`; if either chain cannot produce a server-verifiable exact-message signature; if Universal/App Links cannot complete the exact registered redirect on both platforms; or if any replay, duplicate-request, token, session, or provider-authorization-as-login invariant fails. In that case, evaluate direct wallet adapters, WalletConnect-compatible providers, and embedded-wallet providers against the unchanged PRD.

## Official sources verified

- [Paybox OAuth 2.1](https://docs.paybox.sh/connect/oauth)
- [Paybox API & endpoints](https://docs.paybox.sh/api-reference)
- [Paybox MCP tools](https://docs.paybox.sh/reference/mcp-tools)
- [Paybox request lifecycle](https://docs.paybox.sh/concepts/requests)
- [Paybox approvals & passkeys](https://docs.paybox.sh/concepts/approvals)
- [Paybox MCP connector](https://docs.paybox.sh/connect/mcp)
- [Paybox SDK & CLI](https://docs.paybox.sh/sdk-cli)
