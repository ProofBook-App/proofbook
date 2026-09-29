// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPerplExchange} from "../interfaces/external/IPerplExchange.sol";
import {SimToken} from "./SimToken.sol";

/// @title SimPerplExchange
/// @notice TESTNET SIMULATION ONLY. Speaks the Perpl Exchange ABI (IPerplExchange) so the production
/// PerplAdapter runs against it unchanged; moving to mainnet swaps this address for the real Exchange
/// (script/Chains.sol). Collateral is a valueless SimToken. Prices are live: every mark, oracle price
/// and decimal is read from a real Perpl Exchange (`priceSource`, testnet 0x1964…80cc).
///
/// Copied from the real Exchange (probed on a testnet fork 2026-09-29, test/fork/SimParity.fork.t.sol):
/// - Accounts: one per address, opened by createAccount(>= min open), errors AccountExists,
///   AccountDoesNotExist, InsufficentAmountToOpenAccount (sic), AmountExceedsAvailableBalance.
///   getAccountByAddr reverts for an address without an account.
/// - One position per perp. An open against an opposite position reduces it and flips with the
///   remainder. Closes are reduce-only (CloseOrderExceedsPosition, CloseOrderPositionMismatch).
/// - Margin: after an increase, depositCNS = max(old deposit, ceil(entry notional / leverage) + loss at
///   mark). Leverage is clamped to the perp's max (testnet: BTC 15x, ETH 12x, SOL 10x, MON 3x).
///   A reduce releases deposit pro rata and credits realised PnL to balanceCNS.
/// - Taker fee: ceil(fill notional x 345 / 1e6) (3.45 bps), charged from balanceCNS.
/// - Sells fill at the bid whatever their limit; a non-crossing IOC/FOK order fills nothing and returns
///   orderId 0 without reverting.
///
/// Simplified (documented, not hidden):
/// - Fills are at mark +/- `spreadPer100K`, with unlimited depth, not against a real book.
/// - No resting orders: postOnly, Cancel, IncreaseCollateral, Change, and non-crossing GTC orders revert
///   NotSimulated. lockedBalanceCNS is always 0.
/// - No funding, no liquidations, no withdraw rate limit. A position below zero equity stays open;
///   closing it floors the account balance at 0.
/// - `positions` bitmap is always zero (the real one is not keyed by perp ID either; never use it).
/// - Profit is paid by minting SimToken, so the exchange is always solvent.
contract SimPerplExchange is IPerplExchange, Ownable {
    using SafeERC20 for IERC20;

    // ---- Real Perpl errors (same names and arguments, so the same selectors)
    error AccountDoesNotExist(address account);
    error AccountExists(address account, uint256 accountId);
    error InsufficentAmountToOpenAccount(address account, uint256 amountCNS);
    error AmountExceedsAvailableBalance(uint256 amountCNS, uint256 balanceCNS, uint256 availableCNS);
    error CloseOrderPositionMismatch(uint8 positionType, uint8 orderType);
    error CloseOrderExceedsPosition(uint256 positionLotLNS, uint256 orderLotLNS);

    // ---- Sim-only errors (the real Exchange reports these through other paths)
    error PerpNotListed(uint256 perpId);
    error NotSimulated(uint8 orderType);
    error NoPrice(uint256 perpId);
    error InsufficientCollateral(uint256 requiredCNS, uint256 availableCNS);
    error NegativePnlExceedsLimit(uint256 negPnlCNS, uint256 limitCNS);

    event PerpListed(uint256 indexed perpId, uint256 maxLeverageHdths);
    event AccountCreated(address indexed account, uint256 indexed accountId, uint256 amountCNS);
    event CollateralDeposited(uint256 indexed accountId, uint256 amountCNS);
    event CollateralWithdrawn(uint256 indexed accountId, uint256 amountCNS);
    event Fill(
        uint256 indexed perpId,
        uint256 indexed accountId,
        uint256 orderId,
        uint8 orderType,
        uint256 pricePNS,
        uint256 lotLNS,
        uint256 feeCNS,
        int256 realizedPnlCNS
    );

    uint8 internal constant LONG = 0;
    uint8 internal constant SHORT = 1;
    uint8 internal constant OPEN_LONG = 0;
    uint8 internal constant OPEN_SHORT = 1;
    uint8 internal constant CLOSE_LONG = 2;
    uint8 internal constant CLOSE_SHORT = 3;

    uint256 public constant TAKER_FEE_PER_MILLION = 345;
    uint256 internal constant PER_100K = 100_000;

    IERC20 public immutable collateral;
    IPerplExchange public immutable priceSource;
    uint256 public immutable collateralDecimals;
    uint256 internal immutable _collateralScale;
    uint256 public immutable minAccountOpenCNS;
    uint256 public immutable spreadPer100K;

    struct Account {
        uint256 id;
        uint256 balanceCNS;
    }

    struct Position {
        uint8 positionType;
        uint256 depositCNS;
        uint256 pricePNS;
        uint256 lotLNS;
        uint256 entryBlock;
    }

    struct Perp {
        uint256 maxLeverageHdths; // 0 = not listed
        uint256 longOpenInterestLNS;
        uint256 shortOpenInterestLNS;
    }

    uint256 public nextAccountId = 1;
    uint256 public nextOrderId = 1;
    mapping(address => Account) internal _accounts;
    mapping(uint256 perpId => Perp) public perpConfig;
    mapping(uint256 perpId => mapping(uint256 accountId => Position)) internal _positions;

    /// @param collateral_ SimToken this exchange may mint (setMinter) to pay out profit.
    /// @param priceSource_ Real Perpl Exchange whose marks and oracle prices this sim trades at.
    constructor(
        SimToken collateral_,
        IPerplExchange priceSource_,
        uint256 minAccountOpenCNS_,
        uint256 spreadPer100K_,
        address owner_
    ) Ownable(owner_) {
        collateral = IERC20(address(collateral_));
        priceSource = priceSource_;
        collateralDecimals = collateral_.decimals();
        _collateralScale = 10 ** collateralDecimals;
        minAccountOpenCNS = minAccountOpenCNS_;
        spreadPer100K = spreadPer100K_;
    }

    /// @notice Lists a perp that exists on the price source. Leverage in hundredths (300 = 3x).
    function listPerp(uint256 perpId, uint256 maxLeverageHdths) external onlyOwner {
        if (priceSource.getPerpetualInfo(perpId).markPNS == 0) revert NoPrice(perpId);
        perpConfig[perpId].maxLeverageHdths = maxLeverageHdths;
        emit PerpListed(perpId, maxLeverageHdths);
    }

    // ------------------------------------------------------------------ accounts

    function createAccount(uint256 amountCNS) external returns (uint256 accountId) {
        Account storage a = _accounts[msg.sender];
        if (a.id != 0) revert AccountExists(msg.sender, a.id);
        if (amountCNS < minAccountOpenCNS) revert InsufficentAmountToOpenAccount(msg.sender, amountCNS);
        collateral.safeTransferFrom(msg.sender, address(this), amountCNS);
        accountId = nextAccountId++;
        a.id = accountId;
        a.balanceCNS = amountCNS;
        emit AccountCreated(msg.sender, accountId, amountCNS);
    }

    function depositCollateral(uint256 amountCNS) external {
        Account storage a = _account(msg.sender);
        collateral.safeTransferFrom(msg.sender, address(this), amountCNS);
        a.balanceCNS += amountCNS;
        emit CollateralDeposited(a.id, amountCNS);
    }

    function withdrawCollateral(uint256 amountCNS) external {
        Account storage a = _account(msg.sender);
        if (amountCNS > a.balanceCNS) revert AmountExceedsAvailableBalance(amountCNS, a.balanceCNS, a.balanceCNS);
        a.balanceCNS -= amountCNS;
        uint256 held = collateral.balanceOf(address(this));
        if (held < amountCNS) SimToken(address(collateral)).mint(address(this), amountCNS - held);
        collateral.safeTransfer(msg.sender, amountCNS);
        emit CollateralWithdrawn(a.id, amountCNS);
    }

    // ------------------------------------------------------------------ orders

    function execOrder(OrderDesc memory d) external returns (OrderSignature memory sig) {
        Account storage a = _account(msg.sender);
        Perp storage perp = perpConfig[d.perpId];
        if (perp.maxLeverageHdths == 0) revert PerpNotListed(d.perpId);
        if (d.orderType > CLOSE_SHORT || d.postOnly) revert NotSimulated(d.orderType);

        PerpetualInfo memory p = priceSource.getPerpetualInfo(d.perpId);
        if (p.markPNS == 0) revert NoPrice(d.perpId);
        bool isBuy = d.orderType == OPEN_LONG || d.orderType == CLOSE_SHORT;
        uint256 fill = isBuy
            ? Math.mulDiv(p.markPNS, PER_100K + spreadPer100K, PER_100K, Math.Rounding.Ceil)
            : Math.mulDiv(p.markPNS, PER_100K - spreadPer100K, PER_100K);
        if (isBuy ? d.pricePNS < fill : d.pricePNS > fill) {
            if (d.immediateOrCancel || d.fillOrKill) return OrderSignature(d.perpId, 0);
            revert NotSimulated(d.orderType); // would rest on the book
        }

        uint256 unit = 10 ** (p.priceDecimals + p.lotDecimals);
        uint256 fee = _takerFee(d, fill, p.markPNS, unit);
        if (a.balanceCNS < fee) revert InsufficientCollateral(fee, a.balanceCNS);
        a.balanceCNS -= fee;
        int256 realized = _settle(a, perp, d, fill, p.markPNS, unit);

        sig = OrderSignature(d.perpId, nextOrderId++);
        emit Fill(d.perpId, a.id, sig.orderId, d.orderType, fill, d.lotLNS, fee, realized);
    }

    /// @dev Checks the fill's loss against mark (the spread) against maxNegPnlCollatBPS; returns the fee.
    function _takerFee(OrderDesc memory d, uint256 fill, uint256 mark, uint256 unit) internal view returns (uint256) {
        uint256 notional = Math.mulDiv(d.lotLNS, fill * _collateralScale, unit);
        uint256 gap = fill > mark ? fill - mark : mark - fill;
        uint256 negPnl = Math.mulDiv(d.lotLNS, gap * _collateralScale, unit);
        uint256 negLimit = notional * d.maxNegPnlCollatBPS / 10_000;
        if (negPnl > negLimit) revert NegativePnlExceedsLimit(negPnl, negLimit);
        return Math.mulDiv(notional, TAKER_FEE_PER_MILLION, 1e6, Math.Rounding.Ceil);
    }

    function _settle(Account storage a, Perp storage perp, OrderDesc memory d, uint256 fill, uint256 mark, uint256 unit)
        internal
        returns (int256 realized)
    {
        Position storage pos = _positions[d.perpId][a.id];
        if (d.orderType == CLOSE_LONG || d.orderType == CLOSE_SHORT) {
            uint8 want = d.orderType == CLOSE_LONG ? LONG : SHORT;
            if (pos.lotLNS != 0 && pos.positionType != want) {
                revert CloseOrderPositionMismatch(pos.positionType, d.orderType);
            }
            if (d.lotLNS > pos.lotLNS) revert CloseOrderExceedsPosition(pos.lotLNS, d.lotLNS);
            return _reduce(a, perp, pos, d.lotLNS, fill, unit);
        }
        uint8 side = d.orderType == OPEN_LONG ? LONG : SHORT;
        uint256 remaining = d.lotLNS;
        if (pos.lotLNS != 0 && pos.positionType != side) {
            uint256 r = Math.min(remaining, pos.lotLNS);
            realized = _reduce(a, perp, pos, r, fill, unit);
            remaining -= r;
        }
        if (remaining != 0) {
            uint256 lev = Math.min(Math.max(d.leverageHdths, 100), perp.maxLeverageHdths);
            _increase(a, perp, pos, side, remaining, fill, mark, lev, unit);
        }
    }

    function _increase(
        Account storage a,
        Perp storage perp,
        Position storage pos,
        uint8 side,
        uint256 lot,
        uint256 fill,
        uint256 mark,
        uint256 lev,
        uint256 unit
    ) internal {
        uint256 newLot = pos.lotLNS + lot;
        uint256 entry = pos.lotLNS == 0 ? fill : (pos.pricePNS * pos.lotLNS + fill * lot) / newLot;
        uint256 required = Math.mulDiv(newLot, entry * _collateralScale * 100, unit * lev, Math.Rounding.Ceil);
        int256 pnl = _pnl(side, entry, mark, newLot, unit);
        if (pnl < 0) required += uint256(-pnl);
        uint256 add = required > pos.depositCNS ? required - pos.depositCNS : 0;
        if (a.balanceCNS < add) revert InsufficientCollateral(add, a.balanceCNS);
        a.balanceCNS -= add;
        if (pos.lotLNS == 0) pos.entryBlock = block.number;
        pos.positionType = side;
        pos.depositCNS += add;
        pos.pricePNS = entry;
        pos.lotLNS = newLot;
        if (side == LONG) perp.longOpenInterestLNS += lot;
        else perp.shortOpenInterestLNS += lot;
    }

    function _reduce(
        Account storage a,
        Perp storage perp,
        Position storage pos,
        uint256 lot,
        uint256 fill,
        uint256 unit
    ) internal returns (int256 realized) {
        realized = _pnl(pos.positionType, pos.pricePNS, fill, lot, unit);
        uint256 released = lot == pos.lotLNS ? pos.depositCNS : pos.depositCNS * lot / pos.lotLNS;
        if (pos.positionType == LONG) perp.longOpenInterestLNS -= lot;
        else perp.shortOpenInterestLNS -= lot;
        if (lot == pos.lotLNS) {
            delete pos.positionType;
            delete pos.depositCNS;
            delete pos.pricePNS;
            delete pos.lotLNS;
            delete pos.entryBlock;
        } else {
            pos.depositCNS -= released;
            pos.lotLNS -= lot;
        }
        int256 bal = int256(a.balanceCNS) + int256(released) + realized;
        a.balanceCNS = bal > 0 ? uint256(bal) : 0;
    }

    /// @dev PnL of `lot` entered at `entry`, valued at `price`, in collateral units (truncated toward zero).
    function _pnl(uint8 side, uint256 entry, uint256 price, uint256 lot, uint256 unit) internal view returns (int256) {
        int256 move = side == LONG ? int256(price) - int256(entry) : int256(entry) - int256(price);
        return move * int256(lot) * int256(_collateralScale) / int256(unit);
    }

    function _account(address who) internal view returns (Account storage a) {
        a = _accounts[who];
        if (a.id == 0) revert AccountDoesNotExist(who);
    }

    // ------------------------------------------------------------------ views

    function getAccountByAddr(address accountAddress) external view returns (AccountInfo memory info) {
        Account storage a = _account(accountAddress);
        info.accountId = a.id;
        info.balanceCNS = a.balanceCNS;
        info.accountAddr = accountAddress;
    }

    /// @dev The price source's info (name, decimals, mark, oracle, funding) with this sim's book and
    /// open interest. Best bid is basePricePNS + maxBidPriceONS, best ask basePricePNS + minAskPriceONS,
    /// as on the real Exchange.
    function getPerpetualInfo(uint256 perpId) public view returns (PerpetualInfo memory p) {
        Perp storage perp = perpConfig[perpId];
        if (perp.maxLeverageHdths == 0) revert PerpNotListed(perpId);
        p = priceSource.getPerpetualInfo(perpId);
        uint256 bid = Math.mulDiv(p.markPNS, PER_100K - spreadPer100K, PER_100K);
        uint256 ask = Math.mulDiv(p.markPNS, PER_100K + spreadPer100K, PER_100K, Math.Rounding.Ceil);
        p.positionBalanceCNS = 0;
        p.insuranceBalanceCNS = 0;
        p.longOpenInterestLNS = perp.longOpenInterestLNS;
        p.shortOpenInterestLNS = perp.shortOpenInterestLNS;
        p.basePricePNS = 0;
        p.maxBidPriceONS = bid;
        p.minBidPriceONS = bid;
        p.maxAskPriceONS = ask;
        p.minAskPriceONS = ask;
        p.numOrders = 0;
    }

    function getPosition(uint256 perpId, uint256 accountId)
        external
        view
        returns (PositionInfo memory info, uint256 markPricePNS, bool markPriceValid)
    {
        PerpetualInfo memory p = getPerpetualInfo(perpId);
        Position storage pos = _positions[perpId][accountId];
        markPricePNS = p.markPNS;
        markPriceValid = p.markPNS != 0;
        if (pos.lotLNS == 0) return (info, markPricePNS, markPriceValid);
        info.accountId = accountId;
        info.positionType = pos.positionType;
        info.depositCNS = pos.depositCNS;
        info.pricePNS = pos.pricePNS;
        info.lotLNS = pos.lotLNS;
        info.entryBlock = pos.entryBlock;
        info.pnlCNS =
            _pnl(pos.positionType, pos.pricePNS, p.markPNS, pos.lotLNS, 10 ** (p.priceDecimals + p.lotDecimals));
        info.deltaPnlCNS = info.pnlCNS;
    }

    function getMinAccountOpenCNS() external view returns (uint256) {
        return minAccountOpenCNS;
    }

    function getExchangeInfo()
        external
        view
        returns (
            uint256 balanceCNS,
            uint256 protocolBalanceCNS,
            uint256 recycleBalanceCNS,
            uint256 collateralDecimals_,
            address collateralToken,
            address verifierProxy
        )
    {
        return (collateral.balanceOf(address(this)), 0, 0, collateralDecimals, address(collateral), address(0));
    }
}
