# Market Details client: manual QA handoff

| Field | Value |
| --- | --- |
| Owner | Product/manual tester |
| Engineering status | Gate B implemented; awaiting manual acceptance |
| Surface | Mobile app, canonical company Market Details route |
| API contract | [Market Details API](../api/market_details_api.md) |
| PRD | [Market Details and Trade Preview](../prds/market_details_prd.md) |
| Last updated | 2026-09-21 |

## Setup

Run the current Warren API and mobile client using the existing project commands. A
physical phone must use the Mac's LAN API address. Provider keys stay in the API
environment and must never be added to the mobile environment.

Guest discovery and local Save can be checked without authentication. The signed-in
continuity check requires Warren's development/standalone build because Privy's native
runtime is intentionally unavailable in Expo Go.

## Pass 1 — canonical entry and restoration

1. From Home, open NVIDIA from the company board. Confirm the header says `From home`,
   Overview is selected, and the page identifies NVIDIA rather than a provider token.
2. Return to Home. Its company page, scroll position, and selected All/Saved/Earnings
   mode must remain unchanged.
3. Search NVIDIA on Home and open the result. Confirm the same `assetId` destination now
   says `From search`; return and confirm the query remains intact.
4. In Markets → Spot, open NVIDIA. The exact originating Spot instrument should be
   expanded and labelled `Opened from here`.
5. Return to Markets. Spot selection and list position must remain intact.
6. In Markets → Perpetuals, open NVIDIA. The Perpetual instrument should be emphasized,
   while the hero remains the backend-selected Spot value when verified Spot exists.
7. Search a company from Markets and open it. Confirm `From search` and return to the
   same query and product list.

## Pass 2 — value, chart, and product truth

1. On NVIDIA, confirm the hero says the exact value type, product, provider, freshness,
   and age. It must not use an unexplained `Reference price` label.
2. Confirm the page distinguishes US-equity identity from Solana product availability
   and does not claim that the token shares US exchange hours.
3. Change several chart ranges. The current real series should remain visible while the
   next exact-instrument series loads. A failure must identify the last range still being
   shown and offer retry when retryable.
4. Open a PreStock-only company such as Anthropic. Its hero must retain the provider's
   PreStock label, the page must show `History unavailable`, and it must not draw a
   synthetic chart or invent a public ticker.
5. Open a Perpetual-only company if the current registry supplies one. Its hero must say
   Perpetual mark value/provider and must not be presented as an owned share.
6. A company with no safe value should show `—`, not zero or a fabricated fallback.

## Pass 3 — tabs and partial failures

1. In Overview, expand every available market. Spot, PreStock, and Perpetual facts must
   remain separate and product-specific.
2. In Market data, copy an exact identifier and confirm `Identifier copied`. No provider
   key or raw provider object should be visible.
3. In News, open a story. Confirm the shared bottom sheet shows its image/fallback,
   headline, publisher, time, and summary fallback. `Read at [source]` should be an
   explicit secondary handoff rather than an automatic redirect.
4. If news is empty, the tab should remain company-specific. If news/history fails,
   healthy company and instrument data must remain visible and retry must remain bounded
   to that section.
5. Stop the API before opening an uncached company. Confirm a recoverable full-route
   error. Restart the API and use `Try again`.
6. Open an unknown company route and confirm `Company not available`, Back, and retry;
   no sample company should replace it.

## Pass 4 — guest and signed-in boundary

1. As a guest, save a company from Market Details. No sign-in, wallet, or signature
   prompt may appear.
2. Return to Home → Saved and confirm the company appears. Restart the app and confirm
   the local save survives.
3. Unsave it from Market Details and confirm Home → Saved updates.
4. Save a company as a guest, sign in using Warren's development build, and return to
   the same company. Home and Markets should say `Signed in`, Profile should offer
   `Manage Warren account`, the local save must not disappear, and the public market
   facts must remain identical.
5. Sign out and confirm Home and Markets return to `Guest` while the same device-local
   save still exists. Account-backed save
   synchronization and conflict resolution are intentionally outside this gate.
6. Spot/Perpetual companies must show an explicitly unavailable Trade preview until the
   separate Gate C APIs are approved. The control must not open a `Later` toast.
7. A PreStock-only company with a verified provider URL may show `View offering`; it
   should open only after an explicit tap.

## Pass 5 — accessibility and device behavior

- Check the narrowest supported phone and one larger text setting. Company identity,
  hero, provenance, instrument values, tabs, and the bottom dock must not overlap.
- Confirm Back, Share, Save, tabs, ranges, instruments, Copy, Retry, article close/source,
  and the primary action all have at least a 44-point target.
- With a screen reader, confirm hero value type/product/provider, chart movement, selected
  tabs/ranges, expanded instruments, availability, save state, and disabled Trade state
  are announced without depending on color.
- Confirm the bottom action respects Android/iOS safe areas and remains reachable without
  colliding with system navigation.
- Confirm no wallet balance, Max shortcut, executable quote, transaction payload, fake
  fundamentals, or generated chart appears anywhere on this Gate B surface.

## Finding record

For each failure, report the pass/check number, platform/build, entry surface, company,
expected result, actual result, and a screenshot or first stack trace. Engineering will
record and fix findings before checking the corresponding PRD acceptance item.

Gate B remains open until the manual tester confirms this checklist.
