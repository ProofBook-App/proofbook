# Kuru (onchain spot CLOB) reference

- **Docs:** https://docs.kuru.io (index at https://docs.kuru.io/llms.txt)
- **SDK:** `@kuru-labs/kuru-sdk` (TS; ABIs in `/abi`). Python and Rust SDKs also exist.
- **Contracts:** `Kuru-Labs/Kuru-contracts-dex-public` (the old `kuru-contracts` repo is gone). Both official markets are ERC1967 proxies to impl `0x5e3446c600524be453bbcefd46a9e4c9be8899a0`, which is **unverified** on Sourcify and Monadscan.

## Mainnet addresses

Source: https://docs.kuru.io/contracts/Contract-addresses

| Contract | Address |
|---|---|
| Router | `0xd651346d7c789536ebf06dc72aE3C8502cd695CC` ✅ |
| MarginAccount | `0x2A68ba1833cDf93fa9Da1EEbd7F46242aD8E90c5` ✅ |
| KuruForwarder | `0x974E61BBa9C4704E8Bcc1923fdC3527B41323FAA` |
| KuruFlowRouter | `0x0d3a1BE29E9dEd63c7a5678b31e847D68F71FFa2` |
| MON-AUSD market | `0x131a2e70a5b31a517a74b8c567149bc294470da9` ✅ |
| MON-USDC market | `0x065C9d28E428A0db40191a54d33d5b7c71a9C394` ✅ **the live one** (~$10.9M 24h volume, 2026-09-29) |
| KuruFlowEntrypoint (aggregator) | `0xb3e6778480b2E488385E8205eA05E20060B813cb` |

## MON-AUSD market params (read onchain ✅)

| Param | Value |
|---|---|
| Base / quote | **native MON** (`address(0)`, 18 dp) / AUSD (6 dp) |
| pricePrecision | 1e8 |
| sizePrecision | 1e10 |
| tickSize | 100 |
| minSize | 2e12, which is **200 MON** |
| maxSize | 2e19 |

- **`minSize` applies only to resting limit orders** (`addBuyOrder`/`addSellOrder`/flip/`batchUpdate`, which revert with `SizeError()`). `placeAndExecuteMarketBuy/Sell` and Router swaps have no size check. This was confirmed from source (`OrderBook.sol` L185, L255, L732, L790) and by a mainnet fork test: a 5 MON market sell filled, and a 199.99 MON limit order reverted. At MON ≈ $0.0287, 200 MON ≈ $5.7 anyway.
- ⚠️ **MON-AUSD is dead (2026-09-29).** `bestBidAsk()` = (max, 0), meaning no bid and no ask. The book is empty, the AMM vault is empty, and the last trade was 2026-09-02. A market order reverts with `InsufficientLiquidity`. **Every AUSD-quoted Kuru market is idle.** The liquid stablecoin markets are USDC-quoted: MON-USDC, WETH-USDC `0xa6afd386…`, cbBTC-USDC `0x40c49f17…`, XAUt0-USDC `0x851145ea…` (params from the Kuru API, not checked with `cast`).
- Taker and maker fees are currently 0 bps on both official markets. Gas: a market sell ≈ 320–540k and a market buy ≈ 800k, so set tight limits.
- Because the base asset is native MON, a vault trading this market needs `receive()` and must value MON in NAV.
- **The MON-USDC book is thin (2026-10-04, MON ≈ $0.034).** Against Perpl's MON oracle a market buy slipped 0.9% at $10, 2.6% at $100 and 3.1% at $200, past KuruAdapter's 3% band. The spread was 1.4% (bid 0.0340, ask 0.0345). Fork tests rest a maker's bid and ask at the top of book first (`contracts/test/fork/KuruSeed.sol`). A live Kuru agent should keep trades under about $100.

## MON-USDC market params (read onchain ✅ 2026-09-29)

`getMarketParams()` on `0x065C…C394` decodes as (pricePrecision 1e8, sizePrecision 1e10, base `address(0)` 18 dp, quote USDC 6 dp, tickSize 100, minSize 2e12, maxSize 2e18, takerFeeBps 0, makerFeeBps 0). `IKuruOrderBook` in `contracts/src/interfaces/external/` uses this order.

## Fork findings for KuruAdapter (2026-09-29, block ~109.10M)

- Market-buy `quoteSize` is quote × pricePrecision / 10^quoteDecimals (1 USDC = 1e8). Market-sell `size` is wei × sizePrecision / 1e18, so sell amounts must be multiples of 1e8 wei.
- **A limit bid above the best ask crosses and fills as a buy.** It does not rest. Raising the top bid means buying the whole ask side first.
- **Dumping ~20M MON emptied the bid side.** `bestBidAsk()` then returns `type(uint256).max` for the bid, and FOK market sells revert with `InsufficientLiquidity()` (`0xbb55fd27`).
- Kuru's book can still be moved inside one transaction, so KuruAdapter never values MON off the book alone. The reference is Perpl's MON perp (id 10) `oraclePNS` (6 dp, ~7 s old on the fork; Perpl's own `refPriceMaxAgeSec` is 60). Kuru's bid and Perpl's oracle were within ~0.1%.

## Trading flow

- **Limit orders draw from a MarginAccount deposit, not from the wallet.** Deposit first, or the order reverts.
  - `MarginAccount.deposit(address user, address token, uint256 amount) payable`. Use `address(0)` + `msg.value` for MON.
  - `MarginAccount.withdraw(uint256 amount, address token)`, `batchWithdrawMaxTokens(address[])`, `getBalance(user, token)`
- **OrderBook:**
  - `addBuyOrder(uint32 price, uint96 size, bool postOnly)` / `addSellOrder(...)`
  - `placeAndExecuteMarketBuy(uint96 quoteSize, uint256 minAmountOut, bool isMargin, bool isFillOrKill) payable` / `placeAndExecuteMarketSell(uint96 size, uint256, bool, bool)`
  - `batchCancelOrders(uint40[])`
  - `batchUpdate(uint32[] buyPrices, uint96[] buySizes, uint32[] sellPrices, uint96[] sellSizes, uint40[] cancelIds, bool postOnly)`
  - `s_orders(id)` returns (owner, size, prev, next, flippedId, price, flippedPrice, isBuy)
- **A contract can be the trader.** A mainnet-fork spike deposited, rested an order, cancelled it and withdrew, all from a contract (https://github.com/emmanuelist/curb/pull/10). `Trade.txOrigin` records the sending EOA.

## The docs and the live ABI disagree

Trust the SDK ABI plus a fork test, not docs.kuru.io:
- `minAmountOut` is **uint256**, not uint96, which changes the selector.
- `addBuyOrder` / `addSellOrder` **return nothing**. Read the orderId from `OrderCreated` or from storage.
- `bestBidAsk()` returns `(uint256, uint256)`, 1e18-scaled. "No bid" is `type(uint256).max` and "no ask" is **0**.
- `getMarketParams()`: decode against a live market, because the published struct order was reported wrong.

Reference: https://github.com/Synsight-lab/Optara/pull/2

## Events

- `OrderCreated(orderId, owner, size, price, isBuy)`
- `Trade(orderId, makerAddress, isBuy, price, updatedSize, takerAddress, txOrigin, filledSize)`
- `OrdersCanceled(uint40[] orderIds, owner)` (plural in the ABI)
- `FlipOrderCreated(...)`
- Router: `MarketRegistered`
- MarginAccount: `Deposit`, `Withdrawal`

## Open risks

- **Kuru "v2"** (`Kuru-Labs/ts-sdk`, npm `@toxicflow-labs/ts-sdk`, AccountCore, 7702) is still testnet-only as of 2026-09-29. Mainnet docs list v1 only, and v1 is trading. The SDK is moving fast (commits the same day), so recheck before the demo.
- **Kuru Flow** (aggregator API with integrator fees): the base URL and auth are unverified ⚠️.

## MON-USDC behaviour probed on a mainnet fork (2026-09-29)

`SimKuruOrderBook` copies these rules, and `test/fork/SimParity.fork.t.sol` re-checks them against the real market.

- **`getMarketParams`:**
  - Precision: price 1e8, size 1e10.
  - Tick 100, minSize 2e12, maxSize 2e18.
  - **Taker and maker fees are 0.**
- **`bestBidAsk`** prices sit on a 1e12 grid (1e18-scaled, one tick).
- **A market buy** spends exactly `quoteSize` and returns base floored to 1e8 wei. Example: $10 bought 362.1351488375 MON at ask 0.027614.
- **A market sell needs `msg.value` exactly equal to `size × 1e8`.** With 100 MON at bid 0.027578, it returned 2.7578 USDC.
- **A large IOC sell** fills what it can and refunds the rest of the MON. The FOK version reverts.
- **Errors:**
  - `0x8199f5f3 SlippageExceeded()` (minAmountOut)
  - `0xfd993161 NativeAssetInsufficient()` / `0x48223ccc NativeAssetSurplus()` (sell value mismatch)
  - `0xead59376 NativeAssetNotRequired()` (value sent with a buy)
  - `0xf4d678b8 InsufficientBalance()` (isMargin without a margin balance)
  - `0xbb55fd27 InsufficientLiquidity()` (FOK not filled)
