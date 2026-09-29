// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IKuruOrderBook} from "../interfaces/external/IKuruOrderBook.sol";
import {IPerplExchange} from "../interfaces/external/IPerplExchange.sol";
import {SimToken} from "./SimToken.sol";

/// @title SimKuruOrderBook
/// @notice TESTNET SIMULATION ONLY. Speaks the Kuru v1 OrderBook ABI (IKuruOrderBook) for a native-MON
/// market so the production KuruAdapter runs against it unchanged; moving to mainnet swaps this address
/// for the real MON-USDC market (script/Chains.sol). Quote is a valueless SimToken. Prices are live:
/// the book is centred on a Perpl MON perp mark read from `priceSource`.
///
/// Copied from the real MON-USDC market (probed on a mainnet fork 2026-09-29, test/fork/SimParity.fork.t.sol):
/// getMarketParams (price precision 1e8, size precision 1e10, tick 100, min/max size, 0 fees), 1e18-scaled
/// bestBidAsk with (uint256 max, 0) for an empty book, base out rounded down to size precision, exact
/// msg.value on sells, and the errors SlippageExceeded, NativeAssetInsufficient, NativeAssetSurplus,
/// NativeAssetNotRequired, InsufficientBalance (margin orders) and InsufficientLiquidity (FOK not filled).
///
/// Simplified: one price level each side at mark +/- `spreadPer100K`; bids have unlimited depth (quote is
/// minted); asks are limited to the MON this contract holds (fund it by sending MON). No limit orders
/// and no margin account (isMargin orders revert InsufficientBalance).
contract SimKuruOrderBook is IKuruOrderBook, Ownable {
    using SafeERC20 for IERC20;

    error SlippageExceeded();
    error NativeAssetInsufficient();
    error NativeAssetSurplus();
    error NativeAssetNotRequired();
    error InsufficientBalance();
    error InsufficientLiquidity();

    event Trade(address indexed taker, bool isBuy, uint256 price, uint256 baseWei, uint256 quoteAmount);
    event InventoryWithdrawn(address indexed to, uint256 amount);

    uint32 public constant PRICE_PRECISION = 1e8;
    uint96 public constant SIZE_PRECISION = 1e10;
    uint32 public constant TICK_SIZE = 100;
    uint96 public constant MIN_SIZE = 2e12;
    uint96 public constant MAX_SIZE = 2e18;
    uint256 internal constant WAD = 1e18;
    uint256 internal constant PER_100K = 100_000;
    /// @dev bestBidAsk prices are multiples of one tick: 1e18 * TICK_SIZE / PRICE_PRECISION.
    uint256 internal constant TICK_WAD = WAD * TICK_SIZE / PRICE_PRECISION;
    /// @dev Base amounts are whole size units: 1e18 / SIZE_PRECISION wei.
    uint256 internal constant SIZE_WEI = WAD / SIZE_PRECISION;

    IERC20 public immutable quote;
    IPerplExchange public immutable priceSource;
    uint256 public immutable perpId;
    uint256 public immutable spreadPer100K;
    uint256 internal immutable _quoteDecimals;
    uint256 internal immutable _quoteScale;

    /// @param quote_ SimToken this book may mint (setMinter) to pay sellers.
    /// @param priceSource_ Perpl Exchange (real, or SimPerplExchange) whose `perpId_` mark centres the book.
    constructor(SimToken quote_, IPerplExchange priceSource_, uint256 perpId_, uint256 spreadPer100K_, address owner_)
        Ownable(owner_)
    {
        quote = IERC20(address(quote_));
        priceSource = priceSource_;
        perpId = perpId_;
        spreadPer100K = spreadPer100K_;
        _quoteDecimals = quote_.decimals();
        _quoteScale = 10 ** _quoteDecimals;
    }

    /// @notice MON sent here is the ask-side inventory.
    receive() external payable {}

    function withdrawInventory(address payable to, uint256 amount) external onlyOwner {
        Address.sendValue(to, amount);
        emit InventoryWithdrawn(to, amount);
    }

    // ------------------------------------------------------------------ IKuruOrderBook

    function placeAndExecuteMarketBuy(uint96 quoteSize, uint256 minAmountOut, bool isMargin, bool isFillOrKill)
        external
        payable
        returns (uint256 baseOut)
    {
        if (msg.value != 0) revert NativeAssetNotRequired();
        if (isMargin) revert InsufficientBalance();
        (, uint256 ask) = _bidAsk(address(this).balance);
        uint256 quoteIn = uint256(quoteSize) * _quoteScale / PRICE_PRECISION;
        if (ask != 0) {
            baseOut = Math.mulDiv(quoteIn, WAD * WAD, ask * _quoteScale) / SIZE_WEI * SIZE_WEI;
            if (baseOut > address(this).balance) {
                if (isFillOrKill) revert InsufficientLiquidity();
                baseOut = address(this).balance / SIZE_WEI * SIZE_WEI;
                quoteIn = Math.mulDiv(baseOut, ask * _quoteScale, WAD * WAD, Math.Rounding.Ceil);
            }
        }
        if (baseOut == 0) {
            if (isFillOrKill) revert InsufficientLiquidity();
            quoteIn = 0;
        }
        if (baseOut < minAmountOut) revert SlippageExceeded();
        if (quoteIn != 0) quote.safeTransferFrom(msg.sender, address(this), quoteIn);
        if (baseOut != 0) Address.sendValue(payable(msg.sender), baseOut);
        emit Trade(msg.sender, true, ask, baseOut, quoteIn);
    }

    function placeAndExecuteMarketSell(uint96 size, uint256 minAmountOut, bool isMargin, bool isFillOrKill)
        external
        payable
        returns (uint256 quoteOut)
    {
        if (isMargin) revert InsufficientBalance();
        uint256 baseIn = uint256(size) * SIZE_WEI;
        if (msg.value < baseIn) revert NativeAssetInsufficient();
        if (msg.value > baseIn) revert NativeAssetSurplus();
        (uint256 bid,) = _bidAsk(0);
        if (bid == type(uint256).max) {
            if (isFillOrKill) revert InsufficientLiquidity();
            if (minAmountOut != 0) revert SlippageExceeded();
            Address.sendValue(payable(msg.sender), baseIn); // nothing filled: refund
            return 0;
        }
        quoteOut = Math.mulDiv(baseIn, bid * _quoteScale, WAD * WAD);
        if (quoteOut < minAmountOut) revert SlippageExceeded();
        uint256 held = quote.balanceOf(address(this));
        if (held < quoteOut) SimToken(address(quote)).mint(address(this), quoteOut - held);
        quote.safeTransfer(msg.sender, quoteOut);
        emit Trade(msg.sender, false, bid, baseIn, quoteOut);
    }

    function bestBidAsk() external view returns (uint256 bestBid, uint256 bestAsk) {
        return _bidAsk(address(this).balance);
    }

    function getMarketParams()
        external
        view
        returns (uint32, uint96, address, uint256, address, uint256, uint32, uint96, uint96, uint256, uint256)
    {
        return (
            PRICE_PRECISION,
            SIZE_PRECISION,
            address(0),
            18,
            address(quote),
            _quoteDecimals,
            TICK_SIZE,
            MIN_SIZE,
            MAX_SIZE,
            0,
            0
        );
    }

    // ------------------------------------------------------------------ internals

    /// @dev Bid/ask around the Perpl mark, on the tick grid. No price: (max, 0). No inventory: no ask.
    function _bidAsk(uint256 inventory) internal view returns (uint256 bid, uint256 ask) {
        uint256 ref;
        try priceSource.getPerpetualInfo(perpId) returns (IPerplExchange.PerpetualInfo memory p) {
            ref = p.markPNS * WAD / 10 ** p.priceDecimals;
        } catch {}
        if (ref == 0) return (type(uint256).max, 0);
        bid = ref * (PER_100K - spreadPer100K) / PER_100K / TICK_WAD * TICK_WAD;
        if (bid == 0) bid = type(uint256).max;
        if (inventory >= SIZE_WEI) {
            ask = Math.mulDiv(ref, PER_100K + spreadPer100K, PER_100K * TICK_WAD, Math.Rounding.Ceil) * TICK_WAD;
        }
    }
}
