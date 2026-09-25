# Markets client: manual QA handoff

| Field | Value |
| --- | --- |
| Owner | Product/manual tester |
| Engineering status | Implemented; not runtime-tested by engineering |
| Surface | Mobile app, Markets tab |
| API contract | [Markets API](../api/markets_api.md) |
| PRD | [Markets Instrument Registry](../prds/markets_prd.md) |
| Last updated | 2026-09-21 |

## Setup

The mobile client only talks to Warren's API. Provider keys remain in the API's local
environment and are not needed in the app.

In terminal 1, from the repository root:

```sh
pnpm dev:api
```

Confirm the API before opening the app:

```sh
curl -sS http://127.0.0.1:3000/v1/health
curl -sS 'http://127.0.0.1:3000/v1/markets?product=spot&limit=1'
```

For a simulator or web session, use the existing mobile command in terminal 2:

```sh
pnpm dev:mobile
```

For Expo Go on a physical phone, replace the placeholder with the Mac's LAN address:

```sh
EXPO_PUBLIC_API_URL=http://YOUR_MAC_LAN_IP:3000 pnpm dev:mobile
```

The phone and Mac must be on the same network. Do not put a Tokens.xyz or provider key
in `EXPO_PUBLIC_API_URL` or any mobile environment file.

## Core walkthrough

1. Open the app as a guest and select **Markets**. No sign-in, wallet, or transaction
   prompt should appear.
2. Confirm **Spot** is selected by default and Spot rows show company identity, exact
   instrument symbol/provider, numeric price, and 1-day change when known.
3. Switch to **PreStocks**. Rows should use private-market language such as SPV exposure
   or loan participation; they must not imply ownership of a listed share.
4. Switch to **Perpetuals**. Rows should show the numeric mark value and funding when
   available without presenting the contract as a share.
5. Type `nvda` slowly in search. The query must remain intact on every keystroke. One
   NVIDIA result should appear with its grouped Spot and Perp capabilities.
6. Clear search. Focus and the currently selected registry should remain usable; the
   list must not flash back to a different product family.
7. Search `anthropic`. Open the result and confirm the canonical Market Details route
   uses private-company language without inventing a public ticker.
8. Tap any registry row. Market Details should open the same canonical company and
   emphasize the exact originating instrument while keeping its other known products
   inspectable.
9. Return with the header Back control and platform back gesture. The selected product,
   query, and list position should remain intact.
10. Confirm the list begins directly after the product tabs: there should be no product
    explanation, `Spot stocks`/result-title row, `Available now` filter, or sort control.
11. Confirm registry rows contain no `checked`, availability badge, live/delayed/age
    label, or redundant `Token price`/`Mark price` label.
12. Search `OpenAI`. It may appear under PreStocks through PreStocks or Tessera, but a
    Tessera instrument must not be duplicated under Spot.
13. Confirm the Markets and Home search fields have the same height and compact leading
    icon/text inset. On Home, Search fills the remaining space beside the compact,
    fixed-width All/Saved/Earnings control.
14. Scroll to the end of a list and use **Load more instruments**. Existing rows must not
    duplicate. Switch tabs quickly during a load and confirm results never cross tabs.

## State and presentation checks

- Stop the API, reload Markets, and confirm a bounded error with **Try again** appears.
  Restart the API and retry; current controls should remain usable.
- If a provider warning appears, healthy rows must remain visible with the warning above
  them.
- Check light and dark mode. Text, outlines, selected tabs, and negative
  movement should remain legible without relying on color alone.
- Check the narrowest supported phone and one larger text setting. No company name,
  trailing value, capability row, or close control should overlap.
- With a screen reader, confirm the product tabs announce selected state, rows describe
  company/product/value, and all interactive targets are reachable.
- Confirm the bottom tab bar leaves a visible safe gap above Android/iOS system navigation
  and does not compete with native controls.
- Confirm there are no indices, news, earnings control, quick actions, Buy/Long/Short,
  wallet controls, or crypto-market rows on Markets.

## Report format

For a failure, send:

- platform and device/browser;
- the numbered check above;
- what you tapped or typed;
- expected versus actual result; and
- a screenshot plus the first visible error/stack trace, if any.

Gate B remains open until this checklist and the PRD frontend acceptance criteria are
confirmed by the manual tester.
