# PRD: xStocks Lending in Markets

| Field | Decision |
| --- | --- |
| Status | Approved for implementation |
| Product surface | Fourth section inside Markets: Spot · PreStocks · Perpetuals · Lending |
| Initial network and protocol | Solana mainnet; Kamino xStocks market |
| Initial user action | Supply an owned, supported xStock as collateral and borrow USDC |
| Date | 24 September 2026 |
| Relation to existing Markets PRD | On approval, replaces its future Earn/read-only assumptions for Lending only |
| Related product work | [Markets registry](./markets_prd.md) · [Spot execution](./spot_execution_prd.md) |

## Objective and user story

A Warren user who already holds a supported xStock in their selected Solana wallet can find the matching Kamino market, supply that token as collateral, borrow USDC, then monitor health, repay and withdraw in Warren.

The product must make **“supply xStock to borrow USDC”** explicit. Borrowing an xStock is a different action and is outside this release. Lending belongs inside the existing Markets tab; it does not create an Earn tab or change the meaning of Spot, PreStocks or Perpetuals.

## Scope and eligibility

The initial catalog covers **SPYx, QQQx, TSLAx, GOOGLx, NVDAx, CRCLx, HOODx, AAPLx and MSTRx** in Kamino’s xStocks market. The table pins the candidate collateral identity for execution. On 24 September 2026 at 14:45 UTC, all nine reserves were active and each had a USDC debt route. This observation is not a promise that the route or capacity will remain available. [Kamino reserve statistics](https://api.kamino.finance/reserves/batch/stats?market=5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua), [collateral and debt routes](https://api.kamino.finance/markets/collateral-reserves?market=5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua)

| Asset | Exact collateral mint | Kamino reserve |
| --- | --- | --- |
| SPYx | `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` | `UvXjBuC7YZYaGB9Rn1PpBD1GySmjzunXgE8Zev9ua8d` |
| QQQx | `Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ` | `2jerdAXR8r2B6z3P7P6VgSiePQX7wqcpbEqdDbm8mgeB` |
| TSLAx | `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` | `5iTiczqgUegqA3PpoNpotizMbY9n1sRWr3oL6igKvWuf` |
| GOOGLx | `XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN` | `4wg6rEkGgHaEuxMduP46C1xFZ24Lnp5YgdNkZAHxFzsN` |
| NVDAx | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` | `7B66Az3tJhAo4bLkX8PzTixQ9ZGyHkkjxfVLhF26sP5q` |
| CRCLx | `XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1` | `57qagnQFuWw1seEqi6Z5JBvkm5xH5svdmq9dtqxG1rYy` |
| HOODx | `XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg` | `4UBJu5Xp1aziV9frBQBhc1RnKrgXHAWHYejQytkYr8gq` |
| AAPLx | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` | `CKJbqakbPGyhziowm19LPYz636UszuezfkitmpRtcLSH` |
| MSTRx | `XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ` | `Cwy2WJoswCMyfPtWTrmiaDLXC3phz3qwr1TaT4kaSAyD` |

All pairs use program `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`, market `5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua`, and USDC mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` / reserve `97zoywd8mPZsGTg8q1wdD2Wgkdrs2tqusp1Qqcxbyj7E`.

**Execution eligibility** requires a server verified user and selected wallet, the exact mainnet/program/market/collateral mint/reserve/USDC tuple, a spendable balance in a supported token account, current Kamino permissions and caps, a fresh valid oracle and a safe projected position. A ticker, company name or the primary Spot variant is never proof of eligibility. Dynamic Kamino discovery drives the public catalog and current terms; the pinned identities and current on-chain state gate transactions. A paused or removed market stops new risk but must not hide an existing position or its repayment path when the protocol permits repayment.

Initial execution uses the explicitly selected Privy embedded Solana wallet. Signing in with an external wallet does not move its holdings into that wallet. Supporting external-wallet transactions requires a separate tested adapter. Outside scope: buying or swapping collateral, on-ramp/funding, borrowing stock tokens, leverage loops, agent delegation, other lending protocols, arbitrary mints and automatic liquidation management. Current stock-borrow caps are positive for SPYx, QQQx, TSLAx and NVDAx but zero for several other assets; this does not affect the separate USDC debt routes and is not a promise to offer stock borrowing.

## Markets experience

Guests can inspect the nine markets and their current status, then sign in to see holdings and positions. The Lending section shows the asset, protocol, usable collateral status, current USDC borrowing terms and freshness. Supply APY is secondary in discovery; the applicable supply/borrow rates are present in detail and review. Selecting a market shows the bound wallet, exact issuer/mint, spendable balance, maximum safe action amount and an explanation of liquidation risk.

The screen distinguishes **no holdings**, **unsupported issuer or mint**, **supported balance**, **already supplied**, **active debt**, **wallet/network unavailable**, **stale market data** and **action paused**. A market may be visible without a wallet position. A held stock variant from another issuer may be visible as an unsupported holding, with no Supply action. Existing debt and health take priority over new borrowing. Company sheets link to the exact lending market by stable asset/market ID; symbols are only labels.

Before each signature, review shows asset and raw/display quantities, collateral or debt before and after, variable rates, estimated network/rent/priority fees, current and projected health, borrowing/withdrawal limits, liquidation warning, selected wallet/network and the number of approvals. A rejection returns to review. After broadcast, the app shows submitted, confirming, confirmed or unresolved status and a safe recovery action. It never calls an uncertain transaction failed or offers a duplicate one tap retry.

## Functional requirements

1. **Discover:** read Kamino’s supported collateral → USDC routes and reserve metrics, join the nine pinned mints, show status, freshness and action specific availability. Never hardcode APYs, liquidity or LTV as current values.
2. **Identify holdings:** verify Privy identity and the selected embedded mainnet wallet using Warren’s existing execution identity checks. Reuse the portfolio’s SPL and Token-2022 account reads, then distinguish total from spendable balance and handle scaled xStock display units without changing raw execution amounts.
3. **Supply:** validate the exact mint and account, current caps and fees; deposit into the user’s Kamino borrowing obligation, including required setup. A reserve liquidity deposit without obligation collateral does not satisfy this action.
4. **Borrow:** after confirmed collateral, compute the maximum safe USDC amount from the complete obligation, oracle, debt, current liquidity/caps and Warren’s launch buffer. Deposit and borrow are separate approvals.
5. **Repay:** support partial and repay all using refreshed accrued debt and wallet USDC balance. Repayment must work even if new borrowing is paused.
6. **Withdraw:** support partial and full withdrawal, enforce projected health and reserve liquidity, and return the underlying xStock after debt is cleared. Do not equate reserve collateral shares with wallet token units.
7. **Position and recovery:** show all collateral/debt legs, accrued interest, current/projected health and Warren action history. Journal each prepared/signed/submitted step; reconcile ambiguous sends and resume after app or server interruption without duplicating an economic action. Display mixed or unsupported obligations but block unvalidated risk increasing operations.

## Architecture and delivery gates

Warren’s API owns exact mint and wallet validation, live position/risk reads, a version pinned Kamino SDK adapter, unsigned transaction construction, simulation, instruction inspection, durable idempotency, broadcast and confirmation. Mobile owns the review and explicit user signature through Privy. Reuse the existing Privy identity verifier, transaction wallet signer, portfolio token-account reads and [execution API](../api/execution_api.md) patterns; Kamino still needs its own obligation logic and multi-step recovery. Share a dedicated lending contract and private action endpoints; keep the existing three instrument response types intact. The API never receives a wallet private key. [Kamino API/SDK guidance](https://kamino.com/docs/build/developers/api-vs-sdk), [Privy Solana transaction signing](https://docs.privy.io/wallets/using-wallets/solana/sign-a-transaction)

| Phase | Deliverable | Exit gate |
| --- | --- | --- |
| 0. Integration proof | Pin the Kamino SDK against Warren’s existing Privy/web3 transaction adapter; verify wallet/mainnet binding for lending; build and inspect exact obligation transactions against controlled state. | Physical iOS/Android signing of legacy and versioned transactions; exact instruction/owner/mint checks; no transaction sent with real funds. |
| 1. First complete slice | NVDAx → USDC behind a flag, with holdings, supply, borrow, partial/full repay, withdraw, health and restart safe journal. | Automated contract/risk/idempotency tests and device QA pass the full unwind and interruption cases. No deposit only pilot. |
| 2. Initial catalog and launch | Enable the other eight after each exact mint’s extension, route, caps and complete lifecycle tests; connect the Markets UI and operational controls. | All nine show correct states; safe action gating, access policy, monitoring and an explicitly authorized small mainnet end to end test pass before accepting user funds. |

## Acceptance checklist

- [ ] Lending appears as the fourth Markets section; Spot, PreStocks and Perpetuals still parse and behave as before.
- [ ] The nine pinned mints resolve to current USDC routes; a missing/paused route blocks new risk and preserves position access.
- [ ] Guest, wrong wallet/network, zero balance, unsupported variant, eligible holding, stale/illiquid market and existing debt have distinct states.
- [ ] A user can supply NVDAx, borrow USDC, repay part/all, withdraw part/all and see correct balances and health after each confirmed step.
- [ ] Each review uses fresh values and clearly separates borrowing USDC from borrowing the stock; applicable APYs, fees and liquidation risk are shown.
- [ ] Rejection, expired blockhash, lost response, app restart, partial setup and RPC timeout reconcile to one action without duplicate borrowing or supply.
- [ ] Cross-user wallet/action access and unexpected transaction instructions are rejected; both token programs and xStock multiplier changes are tested.
- [ ] Physical iOS and Android builds pass wallet recovery, signing, full unwind, accessibility and background/resume QA.

## Confidence and decisions

**Medium confidence that Warren can implement this now; low confidence that this checkout is ready for real funds today.** The nine active USDC routes, protocol addresses and Kamino SDK builders are supported by current provider data and published package types. The main checkout now contains Privy authenticated execution, a transaction signer and portfolio token-account reads in active development, with physical-device QA pending. It still lacks Kamino obligation/risk handling and a loan-specific multi-step journal. Existing signing code does not prove Token-2022 collateral execution in this app.

Before accepting funds, prove the pinned SDK against the deployed market, native signing on both platforms, exact instruction validation, repay all/full withdrawal, ambiguous transaction recovery, and a complete authorized small mainnet lifecycle. Product owners must set the operating health buffer, supported geography/issuer policy and treatment of pre-existing mixed Kamino positions.
