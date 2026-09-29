// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IVenueAdapter} from "../interfaces/IVenueAdapter.sol";
import {IPerplExchange} from "../interfaces/external/IPerplExchange.sol";
import {VaultBoundAdapter} from "./VaultBoundAdapter.sol";

/// @title PerplAdapter
/// @notice Per-vault adapter that owns one Perpl perps account and trades it for its vault.
/// The Exchange authorises by msg.sender only, so this contract is the account holder.
/// UNAUDITED. See the README threat model.
///
/// Binding: see VaultBoundAdapter. Only the bound vault can call execute.
///
/// `data` for execute/quoteNotional is `abi.encode(uint8 action, bytes payload)`:
/// - DEPOSIT  payload `abi.encode(uint256 amountCNS)`: pull from the vault into Perpl margin.
///   The first deposit opens the account (Perpl minimum: getMinAccountOpenCNS, 10 AUSD).
/// - WITHDRAW payload `abi.encode(uint256 amountCNS)`: pull free margin back to the vault.
/// - ORDER    payload `abi.encode(IPerplExchange.OrderDesc)`: OpenLong/OpenShort/CloseLong/
///   CloseShort/Cancel only. amountCNS is forced to 0.
///
/// Notional (invariant 2): DEPOSIT counts its amount; WITHDRAW and Cancel count 0; open and close
/// orders count lotLNS x max(limit price, mark price). Perpl fills a sell at the book price even
/// when its limit is far below it, so the limit alone would let a short understate its size.
contract PerplAdapter is VaultBoundAdapter, IVenueAdapter {
    using SafeERC20 for IERC20;

    uint8 public constant DEPOSIT = 0;
    uint8 public constant WITHDRAW = 1;
    uint8 public constant ORDER = 2;

    uint8 internal constant OPEN_LONG = 0;
    uint8 internal constant CLOSE_SHORT = 3;
    uint8 internal constant CANCEL = 4;

    IPerplExchange public immutable exchange;
    IERC20 public immutable collateral;
    uint256 internal immutable _collateralScale;

    uint256 public accountId;

    event MarginDeposited(address indexed vault, uint256 amountCNS, uint256 accountId);
    event MarginWithdrawn(address indexed vault, uint256 amountCNS);
    event Recalled(address indexed vault, address indexed by, uint256 amountCNS);
    event OrderSent(
        address indexed vault,
        uint256 indexed perpId,
        uint8 orderType,
        uint256 orderId,
        uint256 pricePNS,
        uint256 lotLNS,
        uint256 leverageHdths,
        uint256 notional
    );

    error CollateralMismatch(address expected, address actual);
    error UnknownAction(uint8 action);
    error OrderTypeNotAllowed(uint8 orderType);

    constructor(IPerplExchange exchange_, IERC20 collateral_) VaultBoundAdapter(collateral_) {
        (,,, uint256 decimals, address token,) = exchange_.getExchangeInfo();
        if (token != address(collateral_)) revert CollateralMismatch(token, address(collateral_));
        exchange = exchange_;
        collateral = collateral_;
        _collateralScale = 10 ** decimals;
    }

    // ------------------------------------------------------------------ IVenueAdapter

    /// @inheritdoc IVenueAdapter
    function execute(bytes calldata data) external returns (int256 navDelta) {
        address v = _onlyVault();
        (uint8 action, bytes memory payload) = abi.decode(data, (uint8, bytes));

        uint256 before = _equity();
        uint256 pulled;
        uint256 returned;

        if (action == DEPOSIT) {
            pulled = abi.decode(payload, (uint256));
            collateral.safeTransferFrom(v, address(this), pulled);
            collateral.forceApprove(address(exchange), pulled);
            if (accountId == 0) accountId = exchange.createAccount(pulled);
            else exchange.depositCollateral(pulled);
            collateral.forceApprove(address(exchange), 0);
            emit MarginDeposited(v, pulled, accountId);
        } else if (action == WITHDRAW) {
            returned = abi.decode(payload, (uint256));
            _withdrawTo(v, returned);
            emit MarginWithdrawn(v, returned);
        } else if (action == ORDER) {
            IPerplExchange.OrderDesc memory d = abi.decode(payload, (IPerplExchange.OrderDesc));
            uint256 notional = _orderNotional(d);
            d.amountCNS = 0;
            IPerplExchange.OrderSignature memory sig = exchange.execOrder(d);
            emit OrderSent(v, d.perpId, d.orderType, sig.orderId, d.pricePNS, d.lotLNS, d.leverageHdths, notional);
        } else {
            revert UnknownAction(action);
        }

        navDelta = int256(_equity()) - int256(before) - int256(pulled) + int256(returned);
    }

    /// @inheritdoc IVenueAdapter
    function quoteNotional(bytes calldata data) external view returns (uint256) {
        (uint8 action, bytes memory payload) = abi.decode(data, (uint8, bytes));
        if (action == DEPOSIT) return abi.decode(payload, (uint256));
        if (action == WITHDRAW) return 0;
        if (action == ORDER) return _orderNotional(abi.decode(payload, (IPerplExchange.OrderDesc)));
        revert UnknownAction(action);
    }

    /// @inheritdoc IVenueAdapter
    /// @dev Free margin (resting-order locks included) + each position's margin and PnL at mark,
    /// each position floored at zero. Exit fees are not deducted. Never reverts: if the Exchange
    /// cannot be read (halted, upgraded, frozen) the Perpl leg counts as 0, which keeps NAV
    /// readable so backers can still withdraw what is idle (invariant 4).
    function exposure(address vault_) external view returns (uint256) {
        if (vault_ != vault || vault_ == address(0)) return 0;
        return _equity();
    }

    // ------------------------------------------------------------------ frozen-vault exit

    /// @notice While the vault is frozen, anyone may move free Perpl margin back to the vault so
    /// backers can withdraw it. Open positions stay open; only free margin moves. NAV is unchanged.
    function recall(uint256 amountCNS) external {
        address v = _onlyFrozenVault();
        _withdrawTo(v, amountCNS);
        emit Recalled(v, msg.sender, amountCNS);
    }

    // ------------------------------------------------------------------ internals

    function _withdrawTo(address v, uint256 amountCNS) internal {
        exchange.withdrawCollateral(amountCNS);
        collateral.safeTransfer(v, amountCNS);
    }

    function _orderNotional(IPerplExchange.OrderDesc memory d) internal view returns (uint256) {
        if (d.orderType == CANCEL) return 0;
        if (d.orderType > CLOSE_SHORT) revert OrderTypeNotAllowed(d.orderType);
        IPerplExchange.PerpetualInfo memory p = exchange.getPerpetualInfo(d.perpId);
        uint256 price = Math.max(d.pricePNS, p.markPNS);
        return
            Math.mulDiv(d.lotLNS, price * _collateralScale, 10 ** (p.priceDecimals + p.lotDecimals), Math.Rounding.Ceil);
    }

    function _equity() internal view returns (uint256 total) {
        total = collateral.balanceOf(address(this));
        if (accountId == 0) return total;
        try exchange.getAccountByAddr(address(this)) returns (IPerplExchange.AccountInfo memory a) {
            total += a.balanceCNS;
            total += _positionsValue(0, a.positions.bank1);
            total += _positionsValue(1, a.positions.bank2);
            total += _positionsValue(2, a.positions.bank3);
            total += _positionsValue(3, a.positions.bank4);
        } catch {
            return collateral.balanceOf(address(this));
        }
    }

    function _positionsValue(uint256 bank, uint256 bits) internal view returns (uint256 total) {
        while (bits != 0) {
            uint256 lowest = bits & (~bits + 1);
            uint256 perpId = bank * 256 + Math.log2(lowest);
            bits ^= lowest;
            try exchange.getPosition(perpId, accountId) returns (
                IPerplExchange.PositionInfo memory pos, uint256, bool
            ) {
                int256 value = int256(pos.depositCNS) + pos.pnlCNS;
                if (value > 0) total += uint256(value);
            } catch {}
        }
    }
}
