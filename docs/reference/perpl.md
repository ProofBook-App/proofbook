# Perpl (onchain perps) reference

- **Docs:** https://docs.perpl.xyz (index at https://docs.perpl.xyz/llms.txt)
- **API docs:** https://github.com/PerplFoundation/api-docs
- **Rust SDK:** `perpl-sdk` v0.2.0 and `perpl-cli`
- **GitHub org:** https://github.com/PerplFoundation

## Mainnet addresses

| Contract | Address |
|---|---|
| Exchange (UUPS proxy) | `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F` ✅ (impl `0xa9ab97a404a0bca04d6a5b4a39995fea9e791b2a`, owner `0xd0a0205e9188998E0bE7F2600a715aD3CD289Cb1`) |
| Collateral | AUSD `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` ✅ (`getExchangeInfo()`: 6 decimals) |
| DelegatedAccount factory | `0xc535276e3e446e4f28d95ed27ccd5c32e4c8907a` ✅ |

## Account model: a contract can own a Perpl account

- Matching and settlement are fully onchain.
- **Orders can be entered two ways:**
  - Direct Exchange calls (`execOrder` / `execOrders`).
  - The trading WebSocket, which uses Ed25519 API keys enrolled once by wallet signature and needs `allowOrderForwarding(true)` onchain.
- **Perpl's own `DelegatedAccount`** (https://github.com/PerplFoundation/delegated-account) is a contract that owns the Exchange account.
  - It calls:
    - `createAccount(amount)`
    - `depositCollateral`
    - `execOrder(s)`
    - `increasePositionCollateral`, `requestDecreasePositionCollateral`
    - `buyLiquidations`
    - `withdrawCollateral`, which pays `msg.sender`
  - Minimum initial collateral is about $10.
- **→ `PerplAdapter` is feasible. Mainnet fork spike passed on 2026-09-29 (block ~109.05M).**
  - A plain contract did create → deposit → post-only order → cancel → withdraw, and IOC open → close. The Exchange checks only `msg.sender`. There's no `tx.origin`/EOA check and no signature path. `whitelistingEnabled()` is false.
  - **Design:** the vault or adapter owns the account directly. That fits invariants 1–3 better than wrapping DelegatedAccount, whose operator can also deposit and enable order forwarding.
  - The spike source (with `MiniPerplAdapter` and the `_dealAUSD` helper) is in the session scratchpad `perpl-spike/`. Move it into `contracts/test/fork/` when building the adapter.

## Exchange ABI (from `interfaces/IExchange.sol`, confirmed on the fork)

- `createAccount(uint256 amountCNS) returns (uint256 accountId)`: pulls AUSD by `transferFrom`, so approve the Exchange first. Minimum is `getMinAccountOpenCNS()` = `10_000_000` (10 AUSD).
- `depositCollateral(uint256 amountCNS)` and `withdrawCollateral(uint256 amountCNS)` (pays `msg.sender`).
- `execOrder(OrderDesc) returns (OrderSignature{perpId, orderId})` and `execOrders(OrderDesc[], bool revertOnFail)`.
- **`OrderDesc` fields:** `orderDescId`, `perpId`, `orderType` (uint8), `orderId`, `pricePNS`, `lotLNS`, `expiryBlock`, `postOnly`, `fillOrKill`, `immediateOrCancel`, `maxMatches`, `leverageHdths` (100 = 1x), `lastExecutionBlock`, `amountCNS`, `maxNegPnlCollatBPS`.
- **`orderType` values:** 0 OpenLong, 1 OpenShort, 2 CloseLong, 3 CloseShort, 4 Cancel, 5 IncreasePositionCollateral, 6 Change.
  - **There is no separate cancel function.** Call `execOrder` with `orderType = 4`, `orderId` and the same `perpId`.
- **Views:**
  - `getAccountByAddr(address)` → `{accountId, balanceCNS, lockedBalanceCNS, frozen, accountAddr, positions}`
  - `getPosition(perpId, accountId)`
  - `getOrder`
  - `getExchangeInfo()`
  - `getPerpetualInfo(perpId)`: best bid is `basePricePNS + maxBidPriceONS`, best ask is `basePricePNS + minAskPriceONS`.
- **Gas (from traces):** `createAccount` ≈ 147k, taker `execOrder` ≈ 200–260k.

## Mainnet perp IDs (probed 1–100)

| ID | Market | Price dp | Lot dp |
|---|---|---|---|
| 1 | BTC | 1 | 5 |
| 10 | MON | 6 | 0 |
| 20 | ETH | 2 | 3 |
| 31 | SOL_v2 (30 is the old SOL) | 3 | 3 |
| 40, 50, 60, 70, 80, 90 | HYPE, ZEC, LIT, VVV, TAO, PUMP | | |

The upstream DelegatedAccount fork test uses testnet values (BTC = `0x10`, testnet Exchange and AUSD). Don't copy them.

## Gotchas

- **`maxNegPnlCollatBPS` must be set explicitly (use 300).** Onchain, 0 means "refuse any fill with negative PnL against mark", so taker orders fail with `TakerOrderSettlementFailed(…, 14)`. The API's "omit for default (300)" doesn't exist onchain.
- **Withdrawals are rate-limited** (`WithdrawRateLimitExceeded`, `getWithdrawAllowanceData`). 150 AUSD withdrew fine, but large amounts weren't tested. Collateral parked on Perpl isn't always instantly withdrawable, so account for it in invariant 4.
- **Admin powers (threat model):** the owner can upgrade the proxy, block addresses, freeze accounts, turn on whitelisting and halt the exchange.
- **Tests:** forge `deal` doesn't work on AUSD, which packs `{uint8 flags; uint248 balance}` into one slot. Use the spike's `_dealAUSD` slot-rewrite helper.
- **Onchain result codes differ from the API's `fr` enum.** 14 = exceeds max negative-PnL collateral, 1 = insufficient collateral.

## APIs (for the risk dashboard)

- **REST:** `https://app.perpl.xyz/api`. Public endpoints include `/api/v1/pub/context`, candles, and the ticker, book and funding endpoints.
- **WebSocket:** `wss://app.perpl.xyz`
  - `/ws/v1/market-data` is public: market state (price, volume, OI), funding, candles, order book, trades, market config.
  - `/ws/v1/trading`
- **Per-account data** (positions, fills, account events including liquidations) needs an API key. There is **no public global liquidation feed**. Index Exchange events onchain with Envio instead.

## Unverified ⚠️

- Event names for indexing (not read yet).
- Perp IDs above 100, and price/lot decimals for HYPE and later markets.
- Whether liquidation events are public onchain in a usable form.
