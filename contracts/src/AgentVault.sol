// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAgentVault} from "./interfaces/IAgentVault.sol";
import {IAgentRegistry, RiskEnvelope} from "./interfaces/IAgentRegistry.sol";
import {IVenueAdapter} from "./interfaces/IVenueAdapter.sol";

/// @title AgentVault
/// @notice One ERC-4626 vault per agent. Backers deposit the vault asset (AUSD by default);
/// the agent's session key trades it through allowlisted venue adapters under an onchain policy.
/// UNAUDITED. See the README threat model.
///
/// - NAV = idle asset balance + sum of venue exposures. totalAssets() is NAV minus the pending
///   performance fee, so every ERC-4626 conversion is already net of fee.
/// - Adapters are called with CALL, never DELEGATECALL. For each execute the vault approves the
///   adapter for exactly the quoted notional and clears the approval afterwards.
/// - A daily-loss breach does not revert: the trade stands and the vault freezes in the same tx.
contract AgentVault is ERC4626, ReentrancyGuard, IAgentVault {
    using SafeERC20 for IERC20;
    using Math for uint256;

    uint256 public constant FEE_BPS = 1_000; // 10% of profit above the high-water mark
    uint256 public constant UNFREEZE_COOLDOWN = 1 days;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant PRICE_SCALE = 1e18; // high-water mark = assets * 1e18 / shares
    uint8 internal constant DECIMALS_OFFSET = 6;

    IAgentRegistry public immutable registry;
    uint256 public immutable agentId;
    address public immutable guardian;
    uint256 public immutable maxTradeNotional;
    uint16 public immutable dailyLossCapBps;
    uint256 public immutable depositCapPerBacker;

    address public sessionKey;
    bool public frozen;
    uint256 public frozenAt;
    uint256 public highWaterMark;
    uint256 public dayStartNav;
    /// @dev 1-based UTC day index of the open trading day; 0 until the first execute.
    uint256 internal _currentDay;

    address[] internal _venues;
    mapping(address venue => bool) public isVenueAllowed;

    modifier onlyAgentOwner() {
        if (msg.sender != registry.ownerOf(agentId)) revert NotAgentOwner(msg.sender);
        _;
    }

    constructor(
        IERC20 asset_,
        IAgentRegistry registry_,
        uint256 agentId_,
        address sessionKey_,
        address guardian_,
        RiskEnvelope memory envelope,
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) ERC4626(asset_) {
        if (sessionKey_ == address(0)) revert InvalidSessionKey();
        registry = registry_;
        agentId = agentId_;
        sessionKey = sessionKey_;
        guardian = guardian_;
        maxTradeNotional = envelope.maxTradeNotional;
        dailyLossCapBps = envelope.dailyLossCapBps;
        depositCapPerBacker = envelope.depositCapPerBacker;
        for (uint256 i; i < envelope.venues.length; ++i) {
            address venue = envelope.venues[i];
            if (!isVenueAllowed[venue]) {
                isVenueAllowed[venue] = true;
                _venues.push(venue);
            }
        }
        highWaterMark = PRICE_SCALE / 10 ** DECIMALS_OFFSET; // 1 asset unit per 10^offset shares
    }

    // ------------------------------------------------------------------ trading

    /// @inheritdoc IAgentVault
    function execute(address venue, bytes calldata data) external nonReentrant {
        if (msg.sender != sessionKey) revert NotSessionKey(msg.sender);
        if (frozen) revert VaultFrozen();
        if (!isVenueAllowed[venue]) revert VenueNotAllowed(venue);

        uint256 notional = IVenueAdapter(venue).quoteNotional(data);
        if (notional > maxTradeNotional) revert TradeTooLarge(notional, maxTradeNotional);

        _rollDay();
        uint256 navBefore = nav();

        IERC20 token = IERC20(asset());
        token.forceApprove(venue, notional);
        int256 venueDelta = IVenueAdapter(venue).execute(data);
        token.forceApprove(venue, 0);

        uint256 navAfter = nav();
        emit Executed(venue, notional, venueDelta, navBefore, navAfter);

        uint256 floor = dayStartNav.mulDiv(BPS - dailyLossCapBps, BPS, Math.Rounding.Ceil);
        if (navAfter < floor) {
            emit PolicyBreach(BreachReason.DailyLossCap, navAfter, dayStartNav);
            _freeze(address(this));
        }
    }

    /// @notice Anyone may freeze the vault once NAV is below today's floor, without waiting for an
    /// execute (security review M1). The agent can stop trading while a leveraged position keeps
    /// losing, and the breach check in execute would never run. Uses the stored day baseline, so a
    /// loss overnight counts before the next execute opens a new day. Refused while a venue can't
    /// be priced: an unreadable venue counts as 0, which isn't a loss. Returns true if it froze.
    function checkLoss() external nonReentrant returns (bool) {
        if (frozen || _currentDay == 0) return false;
        if (!venuesReliable()) revert ExposureUnreliable();
        uint256 navNow = nav();
        uint256 floor = dayStartNav.mulDiv(BPS - dailyLossCapBps, BPS, Math.Rounding.Ceil);
        if (navNow >= floor) return false;
        emit PolicyBreach(BreachReason.DailyLossCap, navNow, dayStartNav);
        _freeze(address(this));
        return true;
    }

    // ------------------------------------------------------------------ controls

    function rotateSessionKey(address next) external onlyAgentOwner {
        if (next == address(0)) revert InvalidSessionKey();
        emit SessionKeyRotated(sessionKey, next);
        sessionKey = next;
    }

    function freeze() external {
        if (msg.sender != guardian && msg.sender != registry.ownerOf(agentId)) {
            revert NotOwnerOrGuardian(msg.sender);
        }
        _freeze(msg.sender);
    }

    function unfreeze() external onlyAgentOwner {
        if (!frozen) revert NotFrozen();
        uint256 readyAt = frozenAt + UNFREEZE_COOLDOWN;
        if (block.timestamp < readyAt) revert UnfreezeCooldown(readyAt);
        frozen = false;
        _currentDay = 0; // next execute opens a fresh day at the current NAV
        emit Unfrozen(msg.sender);
    }

    function _freeze(address by) internal {
        if (frozen) return;
        frozen = true;
        frozenAt = block.timestamp;
        emit Frozen(by);
    }

    // ------------------------------------------------------------------ accounting views

    /// @notice Gross NAV: idle balance plus every allowlisted venue's reported exposure.
    function nav() public view returns (uint256 total) {
        total = IERC20(asset()).balanceOf(address(this));
        for (uint256 i; i < _venues.length; ++i) {
            (uint256 value,) = _exposureOf(_venues[i]);
            total += value;
        }
    }

    /// @dev One venue's exposure. A revert or a malformed reply (a venue upgraded to a different
    /// struct shape, say) counts as 0 instead of reverting nav(), so withdrawals keep working
    /// (invariant 4; security review M2). venuesReliable() then reports the venue as unreliable.
    function _exposureOf(address venue) internal view returns (uint256 value, bool ok) {
        (bool success, bytes memory ret) = venue.staticcall(abi.encodeCall(IVenueAdapter.exposure, (address(this))));
        if (!success || ret.length < 32) return (0, false);
        return (abi.decode(ret, (uint256)), true);
    }

    /// @notice NAV net of the performance fee owed on profit above the high-water mark.
    function totalAssets() public view override returns (uint256) {
        return nav() - pendingFee();
    }

    function pendingFee() public view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 0;
        uint256 gross = nav();
        uint256 atHwm = supply.mulDiv(highWaterMark, PRICE_SCALE);
        if (gross <= atHwm) return 0;
        return (gross - atHwm).mulDiv(FEE_BPS, BPS);
    }

    function dayStart() external view returns (uint256) {
        return _currentDay == 0 ? 0 : (_currentDay - 1) * 1 days;
    }

    function venues() external view returns (address[] memory) {
        return _venues;
    }

    /// @notice True when every venue's exposure is complete. While one isn't (a stale price, a
    /// failed read), NAV understates the vault and deposits pause (security review H1). A venue
    /// whose check reverts counts as unreliable.
    function venuesReliable() public view returns (bool) {
        for (uint256 i; i < _venues.length; ++i) {
            (, bool read) = _exposureOf(_venues[i]);
            if (!read) return false;
            try IVenueAdapter(_venues[i]).exposureReliable(address(this)) returns (bool ok) {
                if (!ok) return false;
            } catch {
                return false;
            }
        }
        return true;
    }

    // ------------------------------------------------------------------ ERC-4626 limits

    /// @dev The cap applies to the receiver's position value after the deposit.
    function maxDeposit(address receiver) public view override returns (uint256) {
        if (frozen || !venuesReliable()) return 0;
        uint256 held = _convertToAssets(balanceOf(receiver), Math.Rounding.Ceil);
        return held >= depositCapPerBacker ? 0 : depositCapPerBacker - held;
    }

    function maxMint(address receiver) public view override returns (uint256) {
        return _convertToShares(maxDeposit(receiver), Math.Rounding.Floor);
    }

    /// @dev Withdrawals are limited only by what is idle in the vault, never by `frozen`.
    function maxWithdraw(address owner) public view override returns (uint256) {
        uint256 owned = _convertToAssets(balanceOf(owner), Math.Rounding.Floor);
        uint256 idle = IERC20(asset()).balanceOf(address(this)) - _unpaidFeeCash();
        return owned < idle ? owned : idle;
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        uint256 shares = balanceOf(owner);
        uint256 idle = IERC20(asset()).balanceOf(address(this)) - _unpaidFeeCash();
        // Compare in assets so a full exit from an all-idle vault is never blocked by rounding.
        if (_convertToAssets(shares, Math.Rounding.Floor) <= idle) return shares;
        return _convertToShares(idle, Math.Rounding.Floor);
    }

    // ------------------------------------------------------------------ ERC-4626 entry points

    function deposit(uint256 assets, address receiver) public override nonReentrant returns (uint256 shares) {
        if (frozen) revert VaultFrozen();
        if (!venuesReliable()) revert ExposureUnreliable();
        _takeFee();
        _checkCap(receiver, assets);
        shares = previewDeposit(assets);
        _deposit(_msgSender(), receiver, assets, shares);
        _onInflow(assets);
    }

    function mint(uint256 shares, address receiver) public override nonReentrant returns (uint256 assets) {
        if (frozen) revert VaultFrozen();
        if (!venuesReliable()) revert ExposureUnreliable();
        _takeFee();
        assets = previewMint(shares);
        _checkCap(receiver, assets);
        _deposit(_msgSender(), receiver, assets, shares);
        _onInflow(assets);
    }

    function withdraw(uint256 assets, address receiver, address owner)
        public
        override
        nonReentrant
        returns (uint256 shares)
    {
        _takeFee();
        uint256 maxAssets = maxWithdraw(owner);
        if (assets > maxAssets) revert ERC4626ExceededMaxWithdraw(owner, assets, maxAssets);
        shares = previewWithdraw(assets);
        _withdraw(_msgSender(), receiver, owner, assets, shares);
        _onOutflow(assets);
    }

    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        nonReentrant
        returns (uint256 assets)
    {
        _takeFee();
        uint256 maxShares = maxRedeem(owner);
        if (shares > maxShares) revert ERC4626ExceededMaxRedeem(owner, shares, maxShares);
        assets = previewRedeem(shares);
        _withdraw(_msgSender(), receiver, owner, assets, shares);
        _onOutflow(assets);
    }

    // ------------------------------------------------------------------ internals

    function _decimalsOffset() internal pure override returns (uint8) {
        return DECIMALS_OFFSET;
    }

    /// @dev Share transfers count against the receiver's cap too, so a transfer can't take a backer
    /// past it (security review L1). Mints and burns are checked in deposit/mint and need no cap.
    /// A frozen vault still allows transfers. Splitting across addresses is not something a vault
    /// can stop: the cap limits one address, not one person.
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (from == address(0) || to == address(0) || from == to) return;
        uint256 held = _convertToAssets(balanceOf(to), Math.Rounding.Ceil);
        if (held > depositCapPerBacker) revert DepositCapExceeded(to, held, depositCapPerBacker);
    }

    function _checkCap(address receiver, uint256 assets) internal view {
        uint256 room = maxDeposit(receiver);
        if (assets > room) {
            revert DepositCapExceeded(receiver, depositCapPerBacker - room + assets, depositCapPerBacker);
        }
    }

    /// @dev Crystallise the fee on profit above the high-water mark, then raise the mark.
    /// Runs before every deposit and withdrawal, so entrants never pay for profit made before
    /// they joined and the same profit is never charged twice. If the fee is not idle in the
    /// vault (it sits at a venue), it stays pending and totalAssets keeps it netted out.
    function _takeFee() internal {
        uint256 fee = pendingFee();
        if (fee == 0) return;
        IERC20 token = IERC20(asset());
        if (token.balanceOf(address(this)) < fee) return;

        // A recipient that can't be found (burned identity) or can't receive (a blocklisted
        // address) leaves the fee pending instead of reverting every withdrawal (security review
        // M3). totalAssets() and maxWithdraw() already keep a pending fee out of what backers own.
        address to;
        try registry.ownerOf(agentId) returns (address owner_) {
            to = owner_;
        } catch {
            return;
        }
        if (to == address(0) || !token.trySafeTransfer(to, fee)) return;
        _onOutflow(fee);
        highWaterMark = nav().mulDiv(PRICE_SCALE, totalSupply()); // gross price after paying the fee
        emit FeeTaken(to, fee, highWaterMark);
    }

    /// @dev Fee that is owed but could not be paid yet; kept out of what backers can withdraw.
    function _unpaidFeeCash() internal view returns (uint256) {
        uint256 fee = pendingFee();
        uint256 bal = IERC20(asset()).balanceOf(address(this));
        return fee < bal ? fee : bal;
    }

    /// @dev Open a new trading day on the first execute after a UTC day boundary.
    function _rollDay() internal {
        uint256 today = block.timestamp / 1 days + 1;
        if (today == _currentDay) return;
        _currentDay = today;
        dayStartNav = nav();
        emit DayRolled((today - 1) * 1 days, dayStartNav);
    }

    /// @dev Flows move the day's baseline so they never count as trading gains or losses.
    function _onInflow(uint256 assets) internal {
        if (_currentDay != 0) dayStartNav += assets;
    }

    /// A withdrawal scales the baseline by the share of NAV that stayed, so the day's loss in percent
    /// is unchanged (security review L2). Subtracting the amount instead let a withdrawal after a gain
    /// push the floor to almost 0. While a venue can't be priced NAV reads low, which would shrink the
    /// baseline too far, so it falls back to subtracting.
    function _onOutflow(uint256 assets) internal {
        if (_currentDay == 0 || assets == 0) return;
        if (!venuesReliable()) {
            dayStartNav = assets >= dayStartNav ? 0 : dayStartNav - assets;
            return;
        }
        uint256 navAfter = nav();
        dayStartNav = dayStartNav.mulDiv(navAfter, navAfter + assets, Math.Rounding.Ceil);
    }
}
