# Phase 0 — The Ownership Register

## Subject grounding

**Subject:** a mobile ownership register for a tokenized-stock investor: the place where
a person proves control of a wallet before they can later buy anything.

**Audience:** crypto-aware and crypto-curious retail investors. They may recognise a
wallet address, but should never be expected to infer what a signature, external
handoff, or an unfinished connection means.

**Single job:** make wallet sign-in feel inspectable and safe. The experience is about
proving ownership, not depositing, trading, or celebrating a balance.

The chosen direction is **The Ownership Register**: quiet mineral surfaces, confident
ink, and the information hierarchy of a well-kept record rather than a trading terminal.
It borrows from the useful parts of a stock certificate and a signing log—precise labels,
evidence in order, and a final recorded result—without faux paper texture, seals, or
nostalgic ornament. This is deliberately not a dark crypto dashboard or a neon-fintech
launch screen.

## Visual thesis

Every screen has one persistent question in its top third: **what is known, and what
still needs the owner's approval?** A compact **Proof Thread** answers it. It is a
three-stop vertical line with a deliberately open final segment:

`Stocklana domain -> wallet address -> your signature`

The first two stops can become solid only when confirmed; the final stop closes only
after server verification. It is a visual status record, not a progress bar and never a
completion cue before verification. The line is rendered with native `View` blocks and
short labels—no SVG, gradients, or chain-specific symbolism required. On success it
quietly resolves into a continuous line; on an error its last known confirmed stop stays
solid and the unresolved segment becomes dashed. This makes evidence, not excitement,
the signature visual device.

Keep the surrounding layout deliberately spare: one sentence of explanation, a single
primary action anchored above the safe-area bottom edge, and details available only when
they help an owner check something.

## Tokens

The existing `Colors`, `Fonts`, and 4-point `Spacing` scale in
`apps/mobile/src/constants/theme.ts` are a usable implementation base. Phase 1 should
extend them with semantic aliases rather than scatter literal values. The values below
are the foundation; components use the semantic role, never a raw hex.

| Token | Light | Dark | Semantic use and contrast notes |
| --- | --- | --- | --- |
| `canvas` — Quarry | `#F3F5F2` | `#131918` | Main app surface: cool, faintly mineral, never pure white/black. Pair Ink / Chalk text at AA or better. |
| `surface` — Archive | `#FFFFFF` | `#1C2523` | Cards, bottom action dock, disclosure sheet. Its boundary comes from outline/elevation, not a shadow alone. |
| `ink` — Graphite | `#17211F` | `#F2F5F1` | Primary headings, body, and active iconography. Target at least 7:1 against Canvas and Surface. |
| `muted` — Field Note | `#53625E` | `#B8C4BF` | Explanations, captions, inactive steps. Do not use below 16 pt regular on Canvas/Surface unless final contrast measurement passes AA. |
| `proof` — Registry Blue | `#0B5C78` | `#74C7DF` | Primary CTA, keyboard focus, confirmed Proof Thread stops, links. White text is used only on the light value; dark value is foreground on dark surfaces. It is not a generic “success” color. |
| `caution` — Verification Red | `#A63632` | `#FFAAA2` | Error text, blocked state marker, destructive action. Pair with an icon and explicit text; never use it as the only error signal. |

### Component state semantics

- Default cards use `surface` on `canvas`, with `muted` outline; selected chain/provider
  uses a 2 pt `proof` outline plus a leading “Selected” label.
- Disabled actions reduce contrast only to a still-legible AA label where practical; they
  additionally use an unavailable state label, not opacity as the sole cue.
- Success is **verified**, rendered with `proof` + a completed Proof Thread + words.
  A green “money gained” treatment is intentionally absent: no money has moved.
- Error/blocked uses `caution`, a named heading, and a concrete recovery action. Do not
  recolor the entire screen red.

## Typography and content voice

Use fonts already feasible in Expo without a font-loading dependency:

| Role | Expo family | Use |
| --- | --- | --- |
| Register heading | `Fonts.serif` (`ui-serif` on iOS; `serif` fallback elsewhere) | Screen title only; 28/34, 700. Its restrained use gives the product a record-like voice without turning pages into a finance editorial. |
| Interface text | `Fonts.sans` (`system-ui` / platform default) | Body 16/24 regular; labels 14/18 medium; CTA 16/20 semibold. |
| Evidence | `Fonts.mono` (`ui-monospace` / `monospace`) | Address, domain, network, attempt reference; 13/18 medium with tabular numbers where the platform supports them. |

Use sentence case and short, factual verbs: “Choose a wallet”, “Review signature”,
“Check verification”. Prefer “wallet” and “signature” over provider internals. Name the
chain plainly. State the boundary before the handoff: **“This signature is free. It
cannot move funds or approve a trade.”** Never say “secure” as a vague reassurance;
show the concrete evidence that makes it safe to inspect. Errors describe the condition
and the next safe action: “The signing request expired. Get a new request.”

## Layout, shape, elevation, and motion

- **Grid:** 4 pt base. Screen horizontal inset 24 pt (16 pt only at compact widths); top
  safe-area plus 20 pt; sections at 24 or 32 pt. Action dock is pinned inside the safe
  area with 16 pt top padding and a Surface background.
- **Shape:** 12 pt card radius, 10 pt control radius, 999 pt only for compact labels.
  Avoid oversized pill buttons and glassy floating cards.
- **Elevation:** cards use a 1 pt outline (`muted` at low alpha) and, only when
  separated from Canvas, a restrained 0/2/10 shadow at 10% black in light and no
  stronger than a 1 pt outline in dark. The action dock uses a top rule; it must not
  look like it floats over content.
- **Iconography:** 20–24 pt outlined, round-capped icons from one platform-consistent
  set. Use chain names and text labels alongside marks; a chain logo alone cannot carry
  the meaning.
- **Motion:** one orchestrated moment only: when a result arrives, the unresolved Proof
  Thread segment draws to its next stop over 220 ms, then the status heading fades in
  over 120 ms. Selection gets a 120 ms color/outline transition. No looping loaders:
  pending uses a static status sentence and an optional 1.2 s low-contrast dot pulse.
  With Reduce Motion, replace all transitions with an immediate state change; do not
  animate the thread or pulse the dots.

## Onboarding state specification

The state naming follows the Phase 1 PRD. “Complete” always means server-verified
session, never merely a successful wallet handoff.

| State / screen | Proof Thread | Primary content and action | Secondary / recovery |
| --- | --- | --- | --- |
| Welcome / `not_started` | Domain is solid; wallet and signature open | “Investing starts with ownership.” Explain that a wallet signs in now and approves future actions later. **Get started**. | “How wallet sign-in works” disclosure; it says no seed phrase, no funds moved. |
| Choose chain / `choosing_chain` | Domain solid; rest open | “Which wallet do you use?” Two equal, labelled cards: **EVM wallet** and **Solana wallet**, each with a one-line plain-language description. **Continue** activates after selection. | Back. Selection persists after background/return. |
| Provider explanation / before `connecting` | Domain solid; chosen family label appears by wallet stop | Name the provider and destination: “You’ll leave Stocklana to choose a wallet, then return here.” **Open [provider]**. | “Why am I leaving the app?” disclosure; Cancel / choose another chain. |
| External handoff / `connecting` | Domain solid; wallet stop is dashed and labelled “Waiting for wallet” | “Choose a wallet in [provider]. Keep this screen open when you return.” Static “Waiting for approval” status, not a spinner-only screen. | Cancel; **Resume connection** only reconciles the existing attempt, never creates a new one. |
| Connected, unverified / `connected_unverified` | Domain + wallet stop solid; signature open | “Wallet connected. Prove it’s yours.” Card shows chain and shortened `0x12ab…8F91` / `7M…pK` address; full address is copyable in Details. **Review signature**. | Change wallet; details include network/cluster when decided. Do not use a checkmark as sign-in success. |
| Pre-sign / before `awaiting_signature` | First two stops solid; signature open | “Review your sign-in.” Show Stocklana domain, shortened address, chain, and the exact reassurance: “This signature is free. It cannot move funds or approve a trade.” **Sign in with wallet**. | Back; “What you will see” expands to a readable, non-editable challenge preview. |
| Signature request / `awaiting_signature` | Signature stop is dashed, never filled | “Approve the sign-in in your wallet.” State the request is waiting and preserve the exact address/chain context. **Open approval**. | Cancel; return reconciliation. If rejected, go to recoverable error with connected wallet preserved. |
| Checking proof / `verifying` | Signature stop has a small static “Checking” marker; no check | “Checking your signature with Stocklana.” Explain that this may take a moment and suppress duplicate primary actions. | Details exposes a safe attempt reference only; background/resume rechecks the existing attempt. |
| Verified / `complete` | All three stops solid and joined | “Wallet verified.” Show shortened address, chain, and “Your Stocklana session is ready.” **Continue**. | Copy full address; “Add another wallet later” only as a quiet note. No confetti, balance, or purchase prompt. |
| Recoverable error / `recoverable_error` | Last confirmed stop remains solid; failed next segment dashed in `caution` | Specific heading and cause: rejected signature, expired request, offline, provider unavailable, wrong network, or verification failed. **Try again** performs the safe state-specific retry. | Change wallet / choose chain; Details has redacted error category and attempt reference safe to share. Expiry gets **Get a new request**, not retry. |
| Blocked / `blocked` | Previously confirmed stops persist; unresolved stop uses `caution` label “Cannot verify this wallet” | Plain, privacy-preserving explanation for unsupported wallet/network or address already linked elsewhere. **Choose another wallet**. | **Get help** only where approved support policy exists; never imply a merge or reveal another profile. |
| Returning / session restored | Thread need not appear as a gate; profile context uses a compact all-solid mark | “You’re signed in.” Return directly to the authenticated surface. If expired, explain “Your session ended. Sign in again to continue,” then resume at known wallet/chain with a fresh challenge. | Use another wallet; never silently replace identity. |
| Link second wallet (authenticated) | A separate, labelled Proof Thread begins below “Your verified wallets” | “Add an EVM wallet” / “Add a Solana wallet”; reuse choice, handoff, pre-sign, pending, and result patterns. Completion says “Wallet added.” | Existing wallet list remains visible. Conflict stays blocked and privacy-preserving. |

## Compact wireframes

```text
WELCOME                         CHOOSE CHAIN
┌────────────────────────┐      ┌────────────────────────┐
│ STOCKLANA   DOMAIN ●    │      │ Back     YOUR WALLET   │
│                          │      │ ●──○──○  domain > ... │
│ Investing starts with    │      │                          │
│ ownership.               │      │ Which wallet do you use?│
│                          │      │ [ EVM wallet        ]  │
│ ●──○──○                  │      │ [ Solana wallet     ]  │
│ domain  wallet  sign     │      │                          │
│                          │      │ [ Continue          ]  │
│ [ Get started          ]│      └────────────────────────┘
└────────────────────────┘

CONNECTED / PRE-SIGN             AWAITING SIGNATURE
┌────────────────────────┐      ┌────────────────────────┐
│ Back    SIGN-IN RECORD  │      │ Back    SIGN-IN RECORD  │
│ ●──●──○                  │      │ ●──●──┄                  │
│ domain  wallet  sign     │      │ domain wallet waiting    │
│                          │      │                          │
│ Wallet connected.        │      │ Approve the sign-in in   │
│ Prove it's yours.        │      │ your wallet.             │
│ [ EVM · 0x12ab…8F91  ]  │      │ [ Open approval        ] │
│                          │      │ Cancel                   │
│ This signature is free. │      └────────────────────────┘
│ It cannot move funds.   │
│ [ Sign in with wallet  ]│      VERIFIED / RECOVERY
└────────────────────────┘      ┌────────────────────────┐
                                 │ SIGN-IN RECORD          │
                                 │ ●──●──●  Wallet verified │
                                 │                          │
                                 │ EVM · 0x12ab…8F91        │
                                 │ Session ready.           │
                                 │ [ Continue             ] │
                                 └────────────────────────┘
```

At 200% text size, these become a single vertical column: the thread labels wrap below
their stops, cards grow vertically, and the bottom dock scrolls into view rather than
overlaying the last line of content.

## Component inventory

| Component | Responsibility and essential variants |
| --- | --- |
| `OnboardingScaffold` | Safe-area screen, scroll content, persistent action dock, restoration-safe focus target. |
| `ProofThread` | `domain`, `wallet`, `signature` steps; `open`, `waiting`, `confirmed`, `checking`, `error`; accepts accessible textual summary. |
| `RegisterHeader` | Back action, screen label, serif title, concise status. |
| `ChainChoiceCard` | EVM/Solana name, mark, description, selected/disabled/unsupported state. |
| `ProviderHandoffCard` | Provider mark/name, destination explanation, current request state, supported-device caveat. |
| `WalletEvidenceCard` | Chain, shortened address, copy full address, optional decided network/cluster, no full address in the default visual. |
| `SignaturePreview` | Domain, address, chain, validity window, human-readable message preview; read-only. |
| `StatusPanel` | Pending, verifying, verified, error, blocked variants; semantic icon plus heading/body. |
| `ActionDock` | Exactly one primary action, optional text secondary action; responsive to keyboard, safe area, and dynamic type. |
| `DetailsDisclosure` | Progressive disclosure for full address, network, safe diagnostic category and attempt reference; never secrets, raw challenge, signature, or credentials. |
| `InlineNotice` | Informational, caution, unsupported, and privacy-preserving conflict variants; icon + text + optional action. |

## Accessibility and resilience behavior

- Meet WCAG 2.1 AA minimum for text and essential icon contrast in both themes; test
  actual foreground/background pairs rather than assuming token names guarantee it.
  Status meaning is always duplicated by text and an icon/shape.
- Every pressable target, including copy and disclosure controls, is at least 44 × 44 pt
  (or the larger platform minimum). Cards expose selected state to VoiceOver/TalkBack.
- Respect dynamic type through the platform maximum: no fixed card height, title may wrap,
  horizontal rows can become vertical, and the action dock remains reachable without
  horizontal scrolling or clipped text.
- Screen-reader order is: back, status heading, short explanation, Proof Thread textual
  summary, evidence/details, primary action, secondary action. The graphical thread is
  announced once as, for example, “Sign-in record: domain confirmed; wallet confirmed;
  signature needed.”
- After return from a wallet app, move focus to the current status heading and announce
  the meaningful state once. Polling and time updates are not live-announced repeatedly.
- Use `accessibilityLiveRegion="polite"` / platform-equivalent only for a changed result,
  with an assertive announcement reserved for blocked or verification-failed states.
- Preserve chain selection, masked address, and attempt/request ID across backgrounding.
  On reconnect, reconcile the existing attempt before enabling a new request. Do not
  persist or announce raw signatures, challenges, provider tokens, seed phrases, or full
  addresses outside the explicit copy control.
- Honor system light/dark mode by default (the app is already configured for `automatic`);
  manual theme control, if later added, must preserve the same semantic role mappings.

## Implementation-ready acceptance checklist

- [ ] Theme exports the six semantic colors above for light and dark, plus component
      aliases; no onboarding component uses raw color literals.
- [ ] The default mobile surface is Quarry/Archive, not the starter Expo white/black
      theme, and it follows the app’s automatic light/dark setting.
- [ ] All onboarding screens use the same 4 pt spacing scale, specified text roles,
      12 pt cards, 10 pt controls, and restrained outline-first elevation.
- [ ] Proof Thread appears on every onboarding attempt screen and accurately distinguishes
      connected, awaiting signature, checking, verified, error, and blocked; it cannot
      render a false completion.
- [ ] Welcome, chain selection, provider explanation, connecting, connected-unverified,
      pre-sign, awaiting signature, verifying, success, recoverable error, blocked,
      returning-session, and second-wallet-link states match the specification above.
- [ ] EVM and Solana are equal choices; selected family, address, and later-decided
      network/cluster are visible before signing, while the address is shortened by default.
- [ ] Pre-sign copy exactly communicates that the signature is free, off-chain, cannot
      move funds, and cannot approve a trade; no screen asks for a seed phrase.
- [ ] The signature preview makes the Stocklana domain, selected chain, wallet context,
      and validity inspectable without modifying or reconstructing message bytes.
- [ ] Handoff, pending, background/return, cancellation, rejection, expiry, offline,
      provider failure, unsupported conditions, wrong network, and address conflict have
      named, safe recovery paths and never issue duplicate signing requests.
- [ ] Every state satisfies AA contrast, 44 pt targets, VoiceOver/TalkBack labels,
      maximum dynamic type, logical focus order, focus restoration, and Reduce Motion.
- [ ] Status loading identifies the operation in words; no state depends on an indefinite
      generic spinner, color-only signal, or decorative success animation.
- [ ] Full addresses, attempt references, and technical error categories are behind a
      deliberate disclosure/copy action; analytics and UI logs never expose secrets or
      raw signing artifacts.

## Design self-critique

The Proof Thread is intentionally a little more formal than a typical consumer wallet
onboarding. That is its value: Stocklana needs to teach the difference between “wallet
seen,” “signature requested,” and “server verified.” The risk is visual density on a small
phone. The mitigation is strict compression—three short labels, no card around the
thread, and a spoken summary that can replace the visual for assistive technology.

I removed the generic idea of a glowing wallet-orb / animated chain-network graphic.
It would imply asset movement, look like most crypto onboarding, add little information,
and compete with the actual evidence users need before signing. The register and proof
thread instead make the security boundary visible in a way Phase 2 can extend without
pretending a trade has happened.
