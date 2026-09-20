# Markets Information Architecture

| Field | Value |
| --- | --- |
| Status | Proposed for product review |
| Product surface | Warren mobile app, Markets tab |
| Parent milestone | [Milestone 1: Discover and Buy a Tokenized Stock](../../docs/milestone/milestone-one.md) |
| Product requirements | [Markets PRD](../../docs/modules/markets/prds/markets_prd.md) |
| Last updated | 2026-09-19 |

## Structural decision

Markets is Warren's company-first instrument registry. It answers two questions that
Home deliberately does not:

1. Which stock-related products can I access through Warren?
2. What exactly is each product?

The primary navigation remains **Home · Markets · Profile** for Milestone 1. `Earn` is
not a replacement for Markets. Lending and borrowing can become a separate primary
destination after Warren has real, inspectable positions and supported protocols.

## Ownership by surface

| Surface | Primary job | Owns | Does not own |
| --- | --- | --- | --- |
| Home | Understand what is happening | Market status, indices, curated companies, watchlist/earnings views, news | Full product inventory, venue comparison, lending/borrowing catalogue |
| Markets | Understand what is accessible | Complete normalized registry, product families, availability, instrument identity, company capabilities | News, indices, portfolio yield, order entry |
| Company detail | Understand one company and selected instrument | Company context, exact instrument disclosures, route toward later action | Cross-market browsing |
| Profile | Understand the user's Warren state | Guest/account state and, later, wallet/portfolio settings | Market discovery |
| Earn (future) | Use an owned position productively | Lend/borrow opportunities, rates, collateral and protocol risk | General stock discovery |

Home may show a small curated subset of companies. Markets owns the full searchable
catalogue and must not repeat Home's indices, news, earnings switcher, or promotional
quick actions.

## Primary users and entry patterns

1. A guest who knows a company searches by company name, public ticker, or known
   instrument symbol and opens all Warren-known capabilities for that company.
2. A guest exploring products selects Spot, PreStocks, or Perpetuals and scans the
   corresponding registry.
3. A cautious investor opens a row to distinguish the underlying company from the
   instrument, issuer/provider, venue, data source, and availability.
4. A later authenticated holder may move from a company or position to Earn, but this
   route is not active in the Markets milestone slice.

## Navigation model

```text
App
├── Home
│   ├── Curated company card
│   └── Read-only company detail
├── Markets
│   ├── Global company/instrument search
│   │   └── Markets for [Company] sheet
│   ├── Spot registry
│   │   └── Markets for [Company] sheet
│   ├── PreStocks registry
│   │   └── Markets for [Company] sheet
│   └── Perpetuals registry
│       └── Markets for [Company] sheet
└── Profile

Future
└── Earn
    ├── Lend
    └── Borrow
```

The existing `/stocks/[symbol]` route may remain during Milestone 1, but navigation
state should carry Warren's stable `assetId` and exact `instrumentId`. The public stock
ticker or token symbol is display/search data, not the canonical identity.

## Markets hierarchy

The screen renders in this order:

1. Compact Warren header, guest state, and Markets title.
2. Full-width search across every supported product family.
3. Sticky product-family selector: Spot, PreStocks, Perpetuals.
4. One concise explanation of the selected product family.
5. Result count plus product-appropriate availability filter and sort.
6. Dense instrument registry rows.
7. Registry coverage and disclosure.
8. Persistent primary tab navigation.

There is no mixed `All products` ranking. A spot ownership instrument, private-company
exposure product, and perpetual contract do not share sufficiently comparable price,
risk, or activity semantics.

## Domain hierarchy

```text
Company (assetId)
├── Public identity
│   ├── Company name
│   ├── Public ticker, when one exists
│   └── Company logo
└── Capabilities
    ├── Spot instrument(s)
    │   └── Issuer + mint + network + venue availability
    ├── PreStock product(s)
    │   └── Provider + legal/economic structure + valuation basis
    ├── Equity perpetual contract(s)
    │   └── Venue + contract + mark/index/oracle + funding
    └── Future position utility
        ├── Lend
        └── Borrow
```

A company is shown once in global search. Providers, mints, and venues belong beneath
that company. Product-family registry results may contain multiple instruments for one
company only when the rows represent materially different products and clearly name
that difference.

## Core flows

### Browse a product family

`Markets → choose product family → filter/sort → select registry row → inspect company
capabilities`

Changing product family resets product-incompatible filters and sort modes but preserves
the user's vertical position only when doing so is not disorienting. Returning from a
detail destination restores the chosen family, filters, sort, and scroll position.

### Search for a company

`Markets → enter query → see one result per company → select company → inspect all known
capabilities`

Search is global rather than restricted to the active product tab. Each result includes
small capability labels so a search for NVIDIA can reveal Spot and Perpetuals without
duplicating NVIDIA in the result list.

### Inspect company capabilities

`Company result/row → Markets for [Company] sheet → choose supported product → read-only
instrument detail`

The sheet groups capabilities under **Invest**. Future **Use holdings** entries such as
Lend and Borrow may be shown only when explicitly labelled `Later`; they are not active
controls in this slice.

## State model

Product availability and market-data freshness are separate dimensions:

- Product availability: `available`, `preview`, `paused`, `unavailable`.
- Data state: `live`, `delayed`, `stale`, `sample`, `unavailable`.

`Verified` means Warren has matched the instrument to its canonical company, provider,
network/venue, and identifier. It does not mean safe, endorsed, insured, liquid, or
guaranteed redeemable.

## Growth rules

- Add a new provider below an existing company and product family; do not create a new
  top-level navigation category for it.
- Add a new product family only when it has distinct user intent and data/risk semantics.
- Keep transaction controls out of compact registry rows.
- Keep portfolio-dependent capabilities out of Markets until they have a real protocol,
  eligibility contract, and risk model.
- Preserve a normalized Warren model between providers and the mobile client.

## Deliberately deferred decisions

- Which verified PreStock provider and fields satisfy the required structure,
  valuation, liquidity, fee, transfer, and exit disclosures.
- Which equity-perpetual venue and metadata are reliable enough for a live registry.
- Whether multiple spot instruments for the same company are compared in the company
  sheet or resolved to one Warren-preferred instrument.
- Whether Earn becomes a fourth tab or a position-level destination after its own PRD.
