// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {BaseTest} from "../Base.t.sol";
import {AgentVault} from "../../src/AgentVault.sol";
import {IAgentVault} from "../../src/interfaces/IAgentVault.sol";
import {IAgentRegistry, RiskEnvelope} from "../../src/interfaces/IAgentRegistry.sol";

/// @notice Spec §6 invariants.
///
/// Semantics these tests pin down (change them here if you disagree):
/// - NAV = the vault's idle asset balance + the sum of allowlisted venues' exposure(vault).
/// - The day starts on the first execute after a UTC day boundary: dayStartNav = NAV then.
///   Deposits and withdrawals during the day move dayStartNav by the same amount, so flows are
///   never counted as trading loss.
/// - Venue and notional breaches revert. A daily-loss breach keeps the trade and freezes the vault.
/// - freeze: agent owner or guardian. unfreeze: agent owner only, after a cooldown (7 days is
///   assumed to be past it).
/// - Performance fee: 10% of profit above a share-price high-water mark, taken on withdrawal,
///   paid in the vault asset to the *live* IdentityRegistry.ownerOf(agentId).
/// - The deposit cap applies to the receiver's position value after the deposit.
///
/// Run: forge test --match-contract Invariant -vvv
contract PolicyInvariantTest is BaseTest {
    uint256 internal constant DEPOSIT = 10_000 * ONE_AUSD; // == default depositCapPerBacker
    uint256 internal constant MAX_TRADE = 1_000 * ONE_AUSD; // == default maxTradeNotional
    uint256 internal constant COOLDOWN_PASSED = 7 days;

    // ---------------------------------------------------------------------------------------
    // Inv 1: only the session key can call execute; funds leave only via an allowlisted adapter.
    // ---------------------------------------------------------------------------------------

    function testFuzz_Inv1_nonSessionKeyCannotExecute(address caller) public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, DEPOSIT);
        vm.assume(caller != sessionKey);

        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.NotSessionKey.selector, caller));
        vault.execute(address(venue), abi.encode(uint256(1), int256(0)));
    }

    function test_Inv1_sessionKeyCannotUseUnlistedVenue() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, DEPOSIT);

        vm.prank(sessionKey);
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.VenueNotAllowed.selector, address(unlistedVenue)));
        vault.execute(address(unlistedVenue), abi.encode(uint256(1), int256(-1)));
    }

    function test_Inv1_sessionKeyCannotTargetTheAssetDirectly() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, DEPOSIT);

        // A raw ERC20 transfer dressed up as a venue call must not be possible.
        vm.prank(sessionKey);
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.VenueNotAllowed.selector, address(ausd)));
        vault.execute(address(ausd), abi.encodeCall(ausd.transfer, (sessionKey, DEPOSIT)));
        assertEq(ausd.balanceOf(address(vault)), DEPOSIT);
    }

    function test_Inv1_sessionKeyHasNoBackerPowers() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, DEPOSIT);

        uint256 shares = vault.balanceOf(alice);
        vm.startPrank(sessionKey);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, sessionKey, 0, shares));
        vault.redeem(shares, sessionKey, alice);
        vm.stopPrank();
        assertEq(ausd.balanceOf(sessionKey), 0);
    }

    function test_Inv1_rotatedOutKeyLosesAccess() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, DEPOSIT);
        address nextKey = makeAddr("nextKey");

        vm.expectEmit(true, true, false, false, address(vault));
        emit IAgentVault.SessionKeyRotated(sessionKey, nextKey);
        vm.prank(builder);
        vault.rotateSessionKey(nextKey);

        vm.prank(sessionKey);
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.NotSessionKey.selector, sessionKey));
        vault.execute(address(venue), abi.encode(uint256(1), int256(0)));

        vm.prank(nextKey);
        vault.execute(address(venue), abi.encode(uint256(1), int256(0)));
    }

    function test_Inv1_onlyOwnerCanRotate() public {
        (, AgentVault vault) = _enter();
        vm.prank(attacker);
        vm.expectRevert();
        vault.rotateSessionKey(attacker);
        assertEq(vault.sessionKey(), sessionKey);
    }

    // ---------------------------------------------------------------------------------------
    // Inv 2: a single execute moves at most maxTradeNotional.
    // ---------------------------------------------------------------------------------------

    function test_Inv2_tradeAtCapPasses() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, DEPOSIT);
        _trade(vault, MAX_TRADE, 0);
    }

    function testFuzz_Inv2_tradeAboveCapReverts(uint256 notional) public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, DEPOSIT);
        notional = bound(notional, MAX_TRADE + 1, type(uint128).max);

        vm.prank(sessionKey);
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.TradeTooLarge.selector, notional, MAX_TRADE));
        vault.execute(address(venue), abi.encode(notional, int256(0)));
    }

    // ---------------------------------------------------------------------------------------
    // Inv 3: if nav < dayStartNav * (1 - dailyLossCap) after an execute, freeze in the same tx.
    // Default cap is 10%: on a 10,000 AUSD day the floor is 9,000.
    // ---------------------------------------------------------------------------------------

    function test_Inv3_lossUnderCapStaysLive() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, DEPOSIT);

        _trade(vault, MAX_TRADE, -600e6);
        _trade(vault, MAX_TRADE, -400e6); // NAV 9,000 == floor: not below it
        assertFalse(vault.frozen());
        assertEq(vault.nav(), 9_000e6);
    }

    function test_Inv3_lossPastCapFreezesInSameTx() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, DEPOSIT);
        _trade(vault, MAX_TRADE, -600e6);

        vm.expectEmit(false, false, false, true, address(vault));
        emit IAgentVault.PolicyBreach(IAgentVault.BreachReason.DailyLossCap, 8_999e6, 10_000e6);
        vm.expectEmit(true, false, false, false, address(vault));
        emit IAgentVault.Frozen(address(vault));
        _trade(vault, MAX_TRADE, -401e6); // must NOT revert: the trade stands

        assertTrue(vault.frozen());
        assertEq(vault.nav(), 8_999e6);

        vm.prank(sessionKey);
        vm.expectRevert(IAgentVault.VaultFrozen.selector);
        vault.execute(address(venue), abi.encode(uint256(1), int256(0)));
    }

    function test_Inv3_markDropCountsTowardLoss() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, DEPOSIT);
        venue.setExposure(address(vault), 2_000e6); // position valued at 2,000

        vm.warp(block.timestamp + 1 days); // new day
        _trade(vault, 1, 0); // opens the day: dayStartNav = 12,000
        assertEq(vault.dayStartNav(), 12_000e6);

        venue.setExposure(address(vault), 700e6); // mark pushed down by 1,300 (>10% of 12,000)
        _trade(vault, 1, 0);
        assertTrue(vault.frozen());
    }

    function test_Inv3_withdrawalsAreNotLosses() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, DEPOSIT);
        _trade(vault, 1, 0); // opens the day at 10,000

        vm.prank(alice);
        vault.withdraw(5_000e6, alice, alice); // NAV halves through a flow, not a loss

        _trade(vault, 1, 0);
        assertFalse(vault.frozen());
    }

    function test_Inv3_newDayResetsTheFloor() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, DEPOSIT);
        _trade(vault, MAX_TRADE, -900e6); // day 1 ends at 9,100

        vm.warp(block.timestamp + 1 days);
        _trade(vault, MAX_TRADE, -800e6); // day 2 floor is 8,190; NAV 8,300
        assertFalse(vault.frozen());
    }

    // ---------------------------------------------------------------------------------------
    // Inv 4: when idle, backers can always withdraw their pro-rata share, frozen or not.
    // ---------------------------------------------------------------------------------------

    function test_Inv4_idleFrozenVaultPaysEveryoneProRata() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, 6_000e6);
        _deposit(vault, bob, 4_000e6);
        _trade(vault, MAX_TRADE, -500e6); // NAV 9,500, below HWM: no fee in play

        vm.prank(guardian);
        vault.freeze();
        assertTrue(vault.frozen());

        uint256 aliceShares = vault.balanceOf(alice);
        uint256 bobShares = vault.balanceOf(bob);
        vm.prank(alice);
        uint256 aliceOut = vault.redeem(aliceShares, alice, alice);
        vm.prank(bob);
        uint256 bobOut = vault.redeem(bobShares, bob, bob);

        assertApproxEqAbs(aliceOut, 5_700e6, 1); // 60% of 9,500
        assertApproxEqAbs(bobOut, 3_800e6, 1); // 40% of 9,500
        assertEq(vault.totalSupply(), 0);
    }

    function test_Inv4_breachFrozenVaultStillPaysOut() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, DEPOSIT);
        _trade(vault, MAX_TRADE, -1_000e6);
        _trade(vault, MAX_TRADE, -1e6); // freezes
        assertTrue(vault.frozen());

        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 out = vault.redeem(shares, alice, alice);
        assertApproxEqAbs(out, 8_999e6, 1);
    }

    function testFuzz_Inv4_maxWithdrawIsFullShareWhenIdle(uint256 a, uint256 b, int256 pnl) public {
        (, AgentVault vault) = _enter();
        a = bound(a, 1e6, DEPOSIT);
        b = bound(b, 1e6, DEPOSIT);
        pnl = bound(pnl, -int256(Math.min(MAX_TRADE, a + b)), 0); // a venue cannot lose more than the vault holds
        _deposit(vault, alice, a);
        _deposit(vault, bob, b);
        _trade(vault, MAX_TRADE, pnl);

        assertApproxEqAbs(vault.maxWithdraw(alice), vault.convertToAssets(vault.balanceOf(alice)), 1);
        assertApproxEqAbs(vault.maxWithdraw(bob), vault.convertToAssets(vault.balanceOf(bob)), 1);
    }

    // ---------------------------------------------------------------------------------------
    // Inv 5: a deposit above depositCapPerBacker reverts.
    // ---------------------------------------------------------------------------------------

    function test_Inv5_depositAtCapPasses() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, DEPOSIT);
        assertEq(vault.maxDeposit(alice), 0);
    }

    function test_Inv5_depositAboveCapReverts() public {
        (, AgentVault vault) = _enter();
        ausd.mint(alice, DEPOSIT + 1);
        vm.startPrank(alice);
        ausd.approve(address(vault), DEPOSIT + 1);
        vm.expectPartialRevert(IAgentVault.DepositCapExceeded.selector);
        vault.deposit(DEPOSIT + 1, alice);
        vm.stopPrank();
    }

    function test_Inv5_depositsAccumulateTowardCap() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, 7_000e6);
        assertEq(vault.maxDeposit(alice), 3_000e6);

        ausd.mint(alice, 3_000e6 + 1);
        vm.startPrank(alice);
        ausd.approve(address(vault), 3_000e6 + 1);
        vm.expectPartialRevert(IAgentVault.DepositCapExceeded.selector);
        vault.deposit(3_000e6 + 1, alice);
        vm.stopPrank();
    }

    function test_Inv5_capAppliesToReceiverNotPayer() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, bob, DEPOSIT);

        ausd.mint(alice, 1e6);
        vm.startPrank(alice);
        ausd.approve(address(vault), 1e6);
        vm.expectPartialRevert(IAgentVault.DepositCapExceeded.selector);
        vault.deposit(1e6, bob); // bob is already at the cap
        vm.stopPrank();
    }

    function test_Inv5_mintPathIsCappedToo() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, DEPOSIT);

        uint256 shares = vault.previewDeposit(1e6);
        ausd.mint(alice, 2e6);
        vm.startPrank(alice);
        ausd.approve(address(vault), 2e6);
        vm.expectPartialRevert(IAgentVault.DepositCapExceeded.selector);
        vault.mint(shares, alice);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------------------------------
    // Inv 6: the performance fee applies only to profit above the high-water mark.
    // Fee = 10% of profit above HWM, paid on withdrawal to the live ERC-8004 owner.
    // ---------------------------------------------------------------------------------------

    function test_Inv6_feeOnProfitGoesToAgentOwner() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, DEPOSIT);
        _trade(vault, MAX_TRADE, 600e6);
        _trade(vault, MAX_TRADE, 400e6); // +1,000 profit

        uint256 shares = vault.balanceOf(alice);
        vm.expectEmit(true, false, false, false, address(vault));
        emit IAgentVault.FeeTaken(builder, 0, 0);
        vm.prank(alice);
        uint256 out = vault.redeem(shares, alice, alice);

        assertApproxEqAbs(ausd.balanceOf(builder), 100e6, 1); // 10% of 1,000
        assertApproxEqAbs(out, 10_900e6, 1);
    }

    function test_Inv6_noFeeWhenOnlyRecoveringToHwm() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, DEPOSIT);
        _trade(vault, MAX_TRADE, -500e6);
        _trade(vault, MAX_TRADE, 500e6); // back to exactly the starting share price

        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 out = vault.redeem(shares, alice, alice);

        assertEq(ausd.balanceOf(builder), 0);
        assertApproxEqAbs(out, DEPOSIT, 1);
    }

    function test_Inv6_feeNeverChargedTwiceOnSameProfit() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, DEPOSIT);
        _trade(vault, MAX_TRADE, 1_000e6); // +1,000

        vm.prank(alice);
        vault.withdraw(1_000e6, alice, alice); // crystallises the fee, HWM moves up
        uint256 feeAfterFirst = ausd.balanceOf(builder);
        assertGt(feeAfterFirst, 0);

        _trade(vault, MAX_TRADE, -300e6);
        _trade(vault, MAX_TRADE, 300e6); // dips and recovers, no new high

        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(shares, alice, alice);
        assertEq(ausd.balanceOf(builder), feeAfterFirst);
    }

    function test_Inv6_feeFollowsIdentityTransfer() public {
        (uint256 agentId, AgentVault vault) = _enter();
        address newOwner = makeAddr("newOwner");
        vm.prank(builder);
        identity.transferFrom(builder, newOwner, agentId);
        assertEq(registry.ownerOf(agentId), newOwner);

        _deposit(vault, alice, DEPOSIT);
        _trade(vault, MAX_TRADE, 1_000e6);
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(shares, alice, alice);

        assertEq(ausd.balanceOf(builder), 0);
        assertApproxEqAbs(ausd.balanceOf(newOwner), 100e6, 1);
    }

    function test_Inv6_noFeeOnDeposit() public {
        (, AgentVault vault) = _enter();
        _trade(vault, 1, 0);
        _deposit(vault, alice, DEPOSIT);
        assertEq(ausd.balanceOf(builder), 0);
        assertApproxEqAbs(vault.convertToAssets(vault.balanceOf(alice)), DEPOSIT, 1);
    }

    // ---------------------------------------------------------------------------------------
    // Inv 7: every state change emits an event; the leaderboard is derivable from events alone.
    // ---------------------------------------------------------------------------------------

    function test_Inv7_enterEmitsRegistrationAndLink() public {
        vm.recordLogs();
        (uint256 agentId, AgentVault vault) = _enter();
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertTrue(_has(logs, address(registry), IAgentRegistry.AgentRegistered.selector));
        assertTrue(_has(logs, address(registry), IAgentRegistry.VaultLinked.selector));
        assertEq(registry.vaultOf(agentId), address(vault));
    }

    function test_Inv7_lifecycleEmitsEveryEvent() public {
        (, AgentVault vault) = _enter();
        address nextKey = makeAddr("nextKey");

        vm.recordLogs();
        _deposit(vault, alice, DEPOSIT);
        assertTrue(_has(vm.getRecordedLogs(), address(vault), IERC4626.Deposit.selector));

        vm.recordLogs();
        _trade(vault, MAX_TRADE, 10e6);
        Vm.Log[] memory tradeLogs = vm.getRecordedLogs();
        assertTrue(_has(tradeLogs, address(vault), IAgentVault.Executed.selector));
        assertTrue(_has(tradeLogs, address(vault), IAgentVault.DayRolled.selector)); // first trade of the day

        vm.recordLogs();
        vm.prank(builder);
        vault.rotateSessionKey(nextKey);
        assertTrue(_has(vm.getRecordedLogs(), address(vault), IAgentVault.SessionKeyRotated.selector));

        vm.recordLogs();
        vm.prank(builder);
        vault.freeze();
        assertTrue(_has(vm.getRecordedLogs(), address(vault), IAgentVault.Frozen.selector));

        vm.warp(block.timestamp + COOLDOWN_PASSED);
        vm.recordLogs();
        vm.prank(builder);
        vault.unfreeze();
        assertTrue(_has(vm.getRecordedLogs(), address(vault), IAgentVault.Unfrozen.selector));

        uint256 shares = vault.balanceOf(alice);
        vm.recordLogs();
        vm.prank(alice);
        vault.redeem(shares, alice, alice);
        Vm.Log[] memory exitLogs = vm.getRecordedLogs();
        assertTrue(_has(exitLogs, address(vault), IERC4626.Withdraw.selector));
        assertTrue(_has(exitLogs, address(vault), IAgentVault.FeeTaken.selector)); // it was in profit
    }

    /// NAV rebuilt from Deposit, Withdraw, FeeTaken and Executed logs must equal vault.nav().
    function test_Inv7_navDerivableFromEvents() public {
        (, AgentVault vault) = _enter();
        vm.recordLogs();

        _deposit(vault, alice, 6_000e6);
        _deposit(vault, bob, 4_000e6);
        _trade(vault, MAX_TRADE, 300e6);
        _trade(vault, MAX_TRADE, -120e6);
        vm.prank(bob);
        vault.withdraw(1_000e6, bob, bob);
        _trade(vault, MAX_TRADE, 55e6);

        int256 derived = _navFromLogs(vm.getRecordedLogs(), address(vault));
        assertEq(uint256(derived), vault.nav());
    }

    function _navFromLogs(Vm.Log[] memory logs, address vault) internal pure returns (int256 nav) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != vault) continue;
            bytes32 sig = logs[i].topics[0];
            if (sig == IERC4626.Deposit.selector) {
                (uint256 assets,) = abi.decode(logs[i].data, (uint256, uint256));
                nav += int256(assets);
            } else if (sig == IERC4626.Withdraw.selector) {
                (uint256 assets,) = abi.decode(logs[i].data, (uint256, uint256));
                nav -= int256(assets);
            } else if (sig == IAgentVault.FeeTaken.selector) {
                (uint256 assets,) = abi.decode(logs[i].data, (uint256, uint256));
                nav -= int256(assets);
            } else if (sig == IAgentVault.Executed.selector) {
                (,, uint256 navBefore, uint256 navAfter) =
                    abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
                nav += int256(navAfter) - int256(navBefore);
            }
        }
    }

    function _has(Vm.Log[] memory logs, address emitter, bytes32 sig) internal pure returns (bool) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == emitter && logs[i].topics[0] == sig) return true;
        }
        return false;
    }

    // ---------------------------------------------------------------------------------------
    // Not a §6 invariant, required by .claude/rules/contracts.md: first-depositor inflation.
    // ---------------------------------------------------------------------------------------

    function test_firstDepositorInflationIsUnprofitable() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, attacker, 1);
        ausd.mint(attacker, 5_000e6);
        vm.prank(attacker);
        ausd.transfer(address(vault), 5_000e6); // donation to skew the share price

        _deposit(vault, alice, 5_000e6);
        uint256 aliceValue = vault.convertToAssets(vault.balanceOf(alice));
        assertApproxEqRel(aliceValue, 5_000e6, 0.001e18); // alice loses < 0.1%
    }
}
