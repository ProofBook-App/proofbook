// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IVenueAdapter} from "../interfaces/IVenueAdapter.sol";
import {IKuruOrderBook} from "../interfaces/external/IKuruOrderBook.sol";
import {IPerplExchange} from "../interfaces/external/IPerplExchange.sol";
import {VaultBoundAdapter} from "./VaultBoundAdapter.sol";

/// @title KuruAdapter
/// @notice Per-vault adapter for one Kuru v1 market whose base is native MON (MON-USDC). Market
/// orders only. Quote (the vault asset) is pulled per buy and returned after every sell; MON
/// bought is held here between trades and counted in the vault's NAV. UNAUDITED.
///
/// Binding: see VaultBoundAdapter. Only the bound vault can call execute.
///
/// `data` for execute/quoteNotional is `abi.encode(uint8 action, bytes payload)`:
/// - BUY  payload `abi.encode(uint256 quoteAmount, uint256 minBaseOut)`: spend quote from the vault.
/// - SELL payload `abi.encode(uint256 baseAmount, uint256 minQuoteOut)`: sell held MON (wei).
/// Both are fill-or-kill market orders.
///
/// Pricing. Kuru's book can be moved inside one transaction (post a bid, act, cancel), so it is
/// never trusted alone. The reference is Perpl's MON perp oracle (Chainlink Data Streams, signed
/// off-chain), falling back to Perpl's mark when the oracle is older than MAX_REFERENCE_AGE.
/// - Held MON is valued at the Kuru best bid clamped to [ref * (1 - BAND), ref]. A spoofed high
///   bid cannot raise NAV; pushing the bid down (by selling into it) moves NAV by at most BAND.
/// - Every fill must be within BAND of the reference. A compromised session key cannot dump
///   the vault into a counterparty's order at an off-market price.
/// - If no fresh reference exists, trades revert and held MON is valued at 0 (NAV never reverts).
/// - Held MON is capped at `maxHeld` (quote units, at the reference): a BUY that would take it past
///   the cap reverts. Pricing uses the top of book, so it is only honest for a position the book can
///   absorb; the cap is set per chain below the bid depth within BAND (docs/security-review.md, M4).
///
/// Notional (invariant 2): BUY counts its quote amount; SELL counts the MON at the higher of the
/// best bid and the reference.
contract KuruAdapter is VaultBoundAdapter, IVenueAdapter {
    using SafeERC20 for IERC20;

    uint8 public constant BUY = 0;
    uint8 public constant SELL = 1;

    uint256 public constant BAND_BPS = 300;
    uint256 public constant MAX_REFERENCE_AGE = 5 minutes;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;

    IKuruOrderBook public immutable market;
    IPerplExchange public immutable priceReference;
    uint256 public immutable referencePerpId;
    /// @notice Most MON this adapter may hold after a BUY, valued at the reference (quote units).
    uint256 public immutable maxHeld;

    uint256 internal immutable _pricePrecision;
    uint256 internal immutable _sizePrecision;
    uint256 internal immutable _quoteScale;
    uint256 internal immutable _refPriceScale;

    event Bought(address indexed vault, uint256 quoteIn, uint256 baseOut, uint256 referencePrice);
    event Sold(address indexed vault, uint256 baseIn, uint256 quoteOut, uint256 referencePrice);
    event Unwound(address indexed vault, address indexed by, uint256 baseIn, uint256 quoteOut);

    error UnsupportedMarket(address market);
    error UnknownAction(uint8 action);
    error AmountNotRepresentable(uint256 amount);
    error NoReferencePrice();
    error PriceOutsideBand(uint256 paidOrValue, uint256 receivedOrValue);
    error PositionTooLarge(uint256 heldValue, uint256 maxHeld);
    error ZeroMaxHeld();

    /// @param market_ Kuru OrderBook with native MON base and `quote_` as quote.
    /// @param quote_ The vault asset (USDC for MON-USDC).
    /// @param reference_ Perpl Exchange; `referencePerpId_` is its MON perp (mainnet id 10).
    /// @param maxHeld_ Cap on held MON after a BUY, in quote units at the reference.
    constructor(
        IKuruOrderBook market_,
        IERC20 quote_,
        IPerplExchange reference_,
        uint256 referencePerpId_,
        uint256 maxHeld_
    ) VaultBoundAdapter(quote_) {
        if (maxHeld_ == 0) revert ZeroMaxHeld();
        (uint32 pp, uint96 sp, address base, uint256 baseDec, address quoteAsset, uint256 quoteDec,,,,,) =
            market_.getMarketParams();
        if (base != address(0) || baseDec != 18 || quoteAsset != address(quote_)) {
            revert UnsupportedMarket(address(market_));
        }
        if (IERC20Metadata(address(quote_)).decimals() != quoteDec) revert UnsupportedMarket(address(market_));
        market = market_;
        priceReference = reference_;
        referencePerpId = referencePerpId_;
        maxHeld = maxHeld_;
        _pricePrecision = pp;
        _sizePrecision = sp;
        _quoteScale = 10 ** quoteDec;
        _refPriceScale = 10 ** reference_.getPerpetualInfo(referencePerpId_).priceDecimals;
    }

    /// @dev Receives MON from market buys.
    receive() external payable {}

    // ------------------------------------------------------------------ IVenueAdapter

    /// @inheritdoc IVenueAdapter
    function execute(bytes calldata data) external returns (int256 navDelta) {
        address v = _onlyVault();
        (uint8 action, bytes memory payload) = abi.decode(data, (uint8, bytes));
        uint256 before = _value(_mark());
        uint256 pulled;
        uint256 returned;

        if (action == BUY) {
            (uint256 quoteAmount, uint256 minBaseOut) = abi.decode(payload, (uint256, uint256));
            settlementToken.safeTransferFrom(v, address(this), quoteAmount);
            pulled = quoteAmount;
            uint256 baseOut = _buy(quoteAmount, minBaseOut);
            returned = _sweepQuote(v); // FOK leaves none; return dust if any
            emit Bought(v, quoteAmount - returned, baseOut, _requireReference());
        } else if (action == SELL) {
            (uint256 baseAmount, uint256 minQuoteOut) = abi.decode(payload, (uint256, uint256));
            _sell(baseAmount, minQuoteOut);
            returned = _sweepQuote(v);
            emit Sold(v, baseAmount, returned, _requireReference());
        } else {
            revert UnknownAction(action);
        }

        navDelta = int256(_value(_mark())) - int256(before) - int256(pulled) + int256(returned);
    }

    /// @inheritdoc IVenueAdapter
    function quoteNotional(bytes calldata data) external view returns (uint256) {
        (uint8 action, bytes memory payload) = abi.decode(data, (uint8, bytes));
        if (action == BUY) {
            (uint256 quoteAmount,) = abi.decode(payload, (uint256, uint256));
            return quoteAmount;
        }
        if (action == SELL) {
            (uint256 baseAmount,) = abi.decode(payload, (uint256, uint256));
            (uint256 bid,) = market.bestBidAsk();
            uint256 ref = _requireReference();
            uint256 price = bid == type(uint256).max ? ref : Math.max(bid, ref);
            return _quoteFor(baseAmount, price, Math.Rounding.Ceil);
        }
        revert UnknownAction(action);
    }

    /// @inheritdoc IVenueAdapter
    /// @dev Quote held here (normally 0) + MON held at the clamped mark. Never reverts.
    function exposure(address vault_) external view returns (uint256) {
        if (vault_ != vault || vault_ == address(0)) return 0;
        return _value(_mark());
    }

    /// @inheritdoc IVenueAdapter
    /// @dev False while the adapter holds MON and the reference is stale: exposure() then counts it as 0.
    function exposureReliable(address vault_) external view returns (bool) {
        if (vault_ != vault || vault_ == address(0)) return true;
        return address(this).balance == 0 || _reference() != 0;
    }

    /// @notice Price per MON (quote per base, 1e18-scaled) used to value held MON. 0 if no fresh reference.
    function markPrice() external view returns (uint256) {
        return _mark();
    }

    // ------------------------------------------------------------------ frozen-vault exit

    /// @notice While the vault is frozen, anyone may sell the held MON for the vault asset and send
    /// it to the vault so backers can withdraw. The fill must still be within BAND of the reference.
    function unwind(uint256 baseAmount) external {
        address v = _onlyFrozenVault();
        _sell(baseAmount, 0);
        uint256 quoteOut = _sweepQuote(v);
        emit Unwound(v, msg.sender, baseAmount, quoteOut);
    }

    // ------------------------------------------------------------------ trading internals

    function _buy(uint256 quoteAmount, uint256 minBaseOut) internal returns (uint256 baseOut) {
        uint256 quoteSize = quoteAmount * _pricePrecision / _quoteScale;
        if (quoteSize * _quoteScale / _pricePrecision != quoteAmount || quoteSize > type(uint96).max) {
            revert AmountNotRepresentable(quoteAmount);
        }
        uint256 ref = _requireReference();
        uint256 monBefore = address(this).balance;
        settlementToken.forceApprove(address(market), quoteAmount);
        market.placeAndExecuteMarketBuy(uint96(quoteSize), minBaseOut, false, true);
        settlementToken.forceApprove(address(market), 0);
        baseOut = address(this).balance - monBefore;
        // Received MON must be worth at least (1 - BAND) of the quote paid, at the reference.
        uint256 got = _quoteFor(baseOut, ref, Math.Rounding.Floor);
        if (got * BPS < quoteAmount * (BPS - BAND_BPS)) revert PriceOutsideBand(quoteAmount, got);
        uint256 held = _quoteFor(address(this).balance, ref, Math.Rounding.Ceil);
        if (held > maxHeld) revert PositionTooLarge(held, maxHeld);
    }

    function _sell(uint256 baseAmount, uint256 minQuoteOut) internal returns (uint256 quoteOut) {
        uint256 size = baseAmount * _sizePrecision / WAD;
        if (size * WAD / _sizePrecision != baseAmount || size > type(uint96).max) {
            revert AmountNotRepresentable(baseAmount);
        }
        uint256 ref = _requireReference();
        uint256 quoteBefore = settlementToken.balanceOf(address(this));
        market.placeAndExecuteMarketSell{value: baseAmount}(uint96(size), minQuoteOut, false, true);
        quoteOut = settlementToken.balanceOf(address(this)) - quoteBefore;
        // Quote received must be at least (1 - BAND) of the MON's value at the reference.
        uint256 worth = _quoteFor(baseAmount, ref, Math.Rounding.Ceil);
        if (quoteOut * BPS < worth * (BPS - BAND_BPS)) revert PriceOutsideBand(worth, quoteOut);
    }

    function _sweepQuote(address v) internal returns (uint256 amount) {
        amount = settlementToken.balanceOf(address(this));
        if (amount != 0) settlementToken.safeTransfer(v, amount);
    }

    // ------------------------------------------------------------------ pricing internals

    /// @dev Quote held + MON held at `price` (1e18-scaled quote per base).
    function _value(uint256 price) internal view returns (uint256) {
        return settlementToken.balanceOf(address(this)) + _quoteFor(address(this).balance, price, Math.Rounding.Floor);
    }

    /// @dev Quote-token amount for `baseWei` MON at `price` (quote per base, 1e18-scaled).
    function _quoteFor(uint256 baseWei, uint256 price, Math.Rounding r) internal view returns (uint256) {
        return Math.mulDiv(baseWei, price * _quoteScale, WAD * WAD, r);
    }

    /// @dev Kuru best bid clamped to [ref * (1 - BAND), ref]; 0 without a fresh reference.
    function _mark() internal view returns (uint256) {
        uint256 ref = _reference();
        if (ref == 0) return 0;
        uint256 floor = ref * (BPS - BAND_BPS) / BPS;
        uint256 bid;
        try market.bestBidAsk() returns (uint256 b, uint256) {
            bid = b == type(uint256).max ? 0 : b;
        } catch {}
        return Math.min(ref, Math.max(bid, floor));
    }

    function _requireReference() internal view returns (uint256 ref) {
        ref = _reference();
        if (ref == 0) revert NoReferencePrice();
    }

    /// @dev Perpl MON oracle if fresh, else Perpl mark if fresh, else 0. 1e18-scaled quote per MON.
    function _reference() internal view returns (uint256) {
        try priceReference.getPerpetualInfo(referencePerpId) returns (IPerplExchange.PerpetualInfo memory p) {
            uint256 price;
            if (p.oraclePNS != 0 && block.timestamp <= p.oracleTimestampSec + MAX_REFERENCE_AGE) {
                price = p.oraclePNS;
            } else if (p.markPNS != 0 && block.timestamp <= p.markTimestamp + MAX_REFERENCE_AGE) {
                price = p.markPNS;
            } else {
                return 0;
            }
            return price * WAD / _refPriceScale;
        } catch {
            return 0;
        }
    }
}
