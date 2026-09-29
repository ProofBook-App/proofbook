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
  - Built: `contracts/src/adapters/PerplAdapter.sol`, tested in `contracts/test/fork/PerplAdapter.fork.t.sol` (includes the `_dealAUSD` helper). Our interface `IPerplExchange` re-declares only what the adapter uses; Perpl's `IExchange.sol` is UNLICENSED and is not vendored.

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

## Testnet (10143) addresses (checked with `cast code`, 2026-09-29)

| Contract | Address |
|---|---|
| Exchange | `0x1964C32f0bE608E7D29302AFF5E61268E72080cc` (owner `0x9BE11AD8…56EF`) |
| Collateral AUSD (6 dp, proxy) | `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` |

- Testnet perp IDs are multiples of 16: BTC 16, ETH 32, SOL 48, **MON 64** (price dp 5, lot dp 0), then ZEC 256, LIT 272, VVV 288, TAO 304, PUMP 320, NEAR 336, UNI 352, ARB 368, AAVE 384, MORPHO 400.
- Minimum account open on testnet is **100 AUSD** (`getMinAccountOpenCNS` = 1e8), versus 10 on mainnet.
- **Getting testnet AUSD (checked 2026-09-29):** Agora's faucet contract `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C` (proxy, impl `0xba80…2a49`, listed in Agora's docs at docs.agora.finance/developer/contract-deployments). Call `requestFunds(address recipient)`. Drip: 10,000 AUSD per call, at most once per 60 s, and only while the recipient holds under 100,000. **On 2026-09-29 it was empty**: `requestFunds` reverted with `InsufficientFunds`, the faucet held 1 unit, and the last drip was about 4 days earlier. Ask Agora (a hackathon sponsor) to refill it.
- Perpl's API docs (github.com/PerplFoundation/api-docs) list testnet collateral as `USD 0xdf5b718d…c027`. That is **stale**: the Exchange's `getExchangeInfo()` returns AUSD `0xa9012a05…22dC`. The chain wins.

## Account and position semantics (fork-verified 2026-09-29, block ~109.09M)

- `AccountInfo.balanceCNS` **includes** `lockedBalanceCNS` (collateral reserved by resting orders). Position margin is **not** in it: it moves to `PositionInfo.depositCNS` when a position opens.
- ⚠️ `AccountInfo.positions` is a bitmap of open positions but **not keyed by perp ID**. On mainnet BTC (1) + MON (10) gave `bank1 = 2 + 1024`, which looked like it was. On testnet (2026-09-29), MON perp 64 set **bank1 bit 253** and ZEC perp 256 set **bank2 bit 3**. PerplAdapter does not use it: it records the perps it trades (max 8) and values those.
- `PositionInfo.pnlCNS` is PnL at mark in collateral units (BTC: 0.001 BTC × $12 move = 12000 CNS). It equalled `deltaPnlCNS` with `premiumPnlCNS` = 0. Whether it includes accrued funding is unverified.
- Account equity = `balanceCNS` + Σ (`depositCNS` + `pnlCNS`) over the perps held. `PerplAdapter.exposure` sums over the perps it has traded.
- **A sell fills at the book price whatever its limit.** An IOC OpenShort with `pricePNS = 1` filled at the best bid. Size checks must value orders at max(limit, mark), never the limit alone. PerplAdapter also rejects limits more than 3% from mark, so agents must send a real limit (e.g. best ask + 0.5%), not `1`.
- **Closes are reduce-only.** CloseLong for more lots than the position reverts, so a close cannot flip the position.
- Withdraw allowance at the fork block was ~856k AUSD, refilling ~117 AUSD per block.
- Notional in collateral units = `lotLNS × pricePNS × 10^6 / 10^(priceDecimals + lotDecimals)`.

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

- Event names for indexing (not read yet). PerplAdapter emits its own `MarginDeposited`, `MarginWithdrawn`, `OrderSent`, `Recalled`, `Bound`, so the leaderboard does not depend on them.
- Perp IDs above 100, and price/lot decimals for HYPE and later markets.
- Whether liquidation events are public onchain in a usable form.

## Exchange behaviour probed on testnet (2026-09-29)

Found on a testnet fork with direct Exchange calls. `SimPerplExchange` copies these rules, and `test/fork/SimParity.fork.t.sol` re-checks them against the real Exchange.

- **Margin after an open or increase:** `depositCNS = max(old deposit, ceil(entry notional × 100 / leverageHdths) + max(0, −pnl at mark))`. An increase re-targets the whole position's leverage and never releases margin.
  - Probe: 1000 MON at fill 2779 with mark 2766, 1x, gave 27,920,000. Adding 1000 at 2x gave 28,050,000.
- **Leverage above the perp's max is clamped, not rejected.** Testnet maximums: BTC 15x, ETH 12x, SOL 10x, MON 3x. A 50x MON order held 9,403,334 = ceil(27.79M / 3) + 140,000.
- **Taker fee:** `ceil(fill notional × 345 / 1e6)`, i.e. 3.45 bps, charged from `balanceCNS`. It matched to the unit on the opens and on a close.
- **Opposite opens net against the position.** The opposite side reduces the position and releases margin pro rata. If it's larger than the position, the rest flips it the other way. A close is reduce-only.
- **A non-crossing IOC order** returns `orderId 0` and doesn't revert.
- **`getAccountByAddr` for an address with no account reverts** with `AccountDoesNotExist`.
- **Errors (selector, name):**
  - `0x03a0e277 AccountDoesNotExist(address)`
  - `0x646095e8 AccountExists(address,uint256)`
  - `0xcfe73bb0 InsufficentAmountToOpenAccount(address,uint256)` (the misspelling is Perpl's)
  - `0xb853e584 AmountExceedsAvailableBalance(uint256 amount, uint256 balance, uint256 available)`
  - `0x189a4ff8 CloseOrderPositionMismatch(uint8 positionType, uint8 orderType)`
  - `0x604559a5 CloseOrderExceedsPosition(uint256 positionLot, uint256 orderLot)`
