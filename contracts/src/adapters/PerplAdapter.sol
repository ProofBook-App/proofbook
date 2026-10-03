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
///
/// Price band: open and close orders must carry a limit within BAND_BPS of Perpl's mark (buys at
/// most mark + 3%, sells at least mark - 3%). The limit bounds the worst fill, so a compromised
/// session key cannot trade the vault into a counterparty's off-market order.
contract PerplAdapter is VaultBoundAdapter, IVenueAdapter {
    using SafeERC20 for IERC20;

    uint8 public constant DEPOSIT = 0;
    uint8 public constant WITHDRAW = 1;
    uint8 public constant ORDER = 2;

    uint8 internal constant OPEN_LONG = 0;
    uint8 internal constant CLOSE_SHORT = 3;
    uint8 internal constant CANCEL = 4;

    uint256 public constant BAND_BPS = 300;
    /// @notice Every open and close order must expire within this many blocks (about 30 minutes at
    /// 300 ms), so nothing rests on the book for long after a freeze (security review H2).
    uint256 public constant MAX_ORDER_BLOCKS = 6_000;
    uint256 internal constant BPS = 10_000;

    IPerplExchange public immutable exchange;
    IERC20 public immutable collateral;
    uint256 internal immutable _collateralScale;

    /// @dev Perps this adapter has ever sent an open/close order on. Exposure values exactly these.
    /// Perpl's AccountInfo.positions bitmap is not keyed by perp ID (testnet: perp 64 sets bank1
    /// bit 253), so it is not used.
    uint256 public constant MAX_PERPS = 8;

    uint256 public accountId;
    uint256[] internal _perps;
    mapping(uint256 perpId => bool) public isTrackedPerp;

    event MarginDeposited(address indexed vault, uint256 amountCNS, uint256 accountId);
    event MarginWithdrawn(address indexed vault, uint256 amountCNS);
    event Recalled(address indexed vault, address indexed by, uint256 amountCNS);
    event PerpTracked(address indexed vault, uint256 indexed perpId);
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
    error PriceOutsideBand(uint256 limitPNS, uint256 markPNS);
    error TooManyPerps(uint256 perpId);
    error OrderExpiryTooFar(uint256 expiryBlock, uint256 latest);

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
            if (d.orderType != CANCEL && !isTrackedPerp[d.perpId]) {
                if (_perps.length == MAX_PERPS) revert TooManyPerps(d.perpId);
                isTrackedPerp[d.perpId] = true;
                _perps.push(d.perpId);
                emit PerpTracked(v, d.perpId);
            }
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
    /// @dev Free margin (resting-order locks included) + each tracked perp's margin and PnL at mark,
    /// each position floored at zero. Exit fees are not deducted. Never reverts: if the Exchange
    /// cannot be read (halted, upgraded, frozen) the Perpl leg counts as 0, which keeps NAV
    /// readable so backers can still withdraw what is idle (invariant 4).
    function exposure(address vault_) external view returns (uint256) {
        if (vault_ != vault || vault_ == address(0)) return 0;
        (uint256 total,) = _equityChecked();
        return total;
    }

    /// @inheritdoc IVenueAdapter
    /// @dev False when the account or a tracked position can't be read, so exposure() left it out.
    function exposureReliable(address vault_) external view returns (bool) {
        if (vault_ != vault || vault_ == address(0)) return true;
        (, bool ok) = _equityChecked();
        return ok;
    }

    // ------------------------------------------------------------------ frozen-vault exit

    /// @notice While the vault is frozen, anyone may move free Perpl margin back to the vault so
    /// backers can withdraw it. Open positions stay open; only free margin moves. NAV is unchanged.
    function recall(uint256 amountCNS) external {
        address v = _onlyFrozenVault();
        _withdrawTo(v, amountCNS);
        emit Recalled(v, msg.sender, amountCNS);
    }

    /// @notice While the vault is frozen, anyone may cancel a resting order on a tracked perp. A
    /// freeze stops execute, so without this an order the agent left on the book could still fill
    /// and open a position in a frozen vault (security review H2). Cancelling only removes risk.
    /// Emits OrderSent with orderType Cancel and notional 0, like an agent's own cancel.
    function cancel(uint256 perpId, uint256 orderId) external {
        address v = _onlyFrozenVault();
        IPerplExchange.OrderDesc memory d;
        d.perpId = perpId;
        d.orderType = CANCEL;
        d.orderId = orderId;
        IPerplExchange.OrderSignature memory sig = exchange.execOrder(d);
        emit OrderSent(v, perpId, CANCEL, sig.orderId, 0, 0, 0, 0);
    }

    // ------------------------------------------------------------------ internals

    function _withdrawTo(address v, uint256 amountCNS) internal {
        exchange.withdrawCollateral(amountCNS);
        collateral.safeTransfer(v, amountCNS);
    }

    function _orderNotional(IPerplExchange.OrderDesc memory d) internal view returns (uint256) {
        if (d.orderType == CANCEL) return 0;
        if (d.orderType > CLOSE_SHORT) revert OrderTypeNotAllowed(d.orderType);
        uint256 latest = block.number + MAX_ORDER_BLOCKS;
        if (d.expiryBlock == 0 || d.expiryBlock > latest) revert OrderExpiryTooFar(d.expiryBlock, latest);
        IPerplExchange.PerpetualInfo memory p = exchange.getPerpetualInfo(d.perpId);
        bool isBuy = d.orderType == OPEN_LONG || d.orderType == CLOSE_SHORT;
        if (isBuy ? d.pricePNS * BPS > p.markPNS * (BPS + BAND_BPS) : d.pricePNS * BPS < p.markPNS * (BPS - BAND_BPS)) {
            revert PriceOutsideBand(d.pricePNS, p.markPNS);
        }
        uint256 price = Math.max(d.pricePNS, p.markPNS);
        return
            Math.mulDiv(d.lotLNS, price * _collateralScale, 10 ** (p.priceDecimals + p.lotDecimals), Math.Rounding.Ceil);
    }

    function _equity() internal view returns (uint256 total) {
        (total,) = _equityChecked();
    }

    /// @dev Equity, and whether every read succeeded. A failed read leaves that part out (counts 0).
    function _equityChecked() internal view returns (uint256 total, bool ok) {
        total = collateral.balanceOf(address(this));
        ok = true;
        if (accountId == 0) return (total, ok);
        try exchange.getAccountByAddr(address(this)) returns (IPerplExchange.AccountInfo memory a) {
            total += a.balanceCNS;
        } catch {
            return (total, false);
        }
        for (uint256 i; i < _perps.length; ++i) {
            try exchange.getPosition(_perps[i], accountId) returns (
                IPerplExchange.PositionInfo memory pos, uint256, bool
            ) {
                int256 value = int256(pos.depositCNS) + pos.pnlCNS;
                if (value > 0) total += uint256(value);
            } catch {
                ok = false;
            }
        }
    }

    /// @notice Perps whose positions are counted in exposure.
    function perps() external view returns (uint256[] memory) {
        return _perps;
    }
}
