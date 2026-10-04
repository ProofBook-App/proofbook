// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {IAgentVault} from "../src/interfaces/IAgentVault.sol";
import {IIdentityRegistry} from "../src/interfaces/IIdentityRegistry.sol";
import {IVenueAdapter} from "../src/interfaces/IVenueAdapter.sol";
import {BaseTest} from "./Base.t.sol";

/// @notice Security review M1, M2 and M3 (docs/security-review.md).
contract LossNavFeeTest is BaseTest {
    // ------------------------------------------------------------------ M1: checkLoss

    /// @dev 1,000 idle + 500 at the venue when the day opens: dayStartNav 1,500, floor 1,350.
    function _openDay() internal returns (uint256 agentId, AgentVault vault) {
        (agentId, vault) = _enter();
        _deposit(vault, alice, 1_000 * ONE_AUSD);
        venue.setExposure(address(vault), 500 * ONE_AUSD);
        _trade(vault, 0, 0);
        assertEq(vault.dayStartNav(), 1_500 * ONE_AUSD);
    }

    function test_M1_anyoneFreezesAVaultThatLostPastTheCapBetweenTrades() public {
        (, AgentVault vault) = _openDay();
        venue.setExposure(address(vault), 300 * ONE_AUSD); // NAV 1,300, under the 1,350 floor, no execute

        vm.expectEmit(address(vault));
        emit IAgentVault.PolicyBreach(IAgentVault.BreachReason.DailyLossCap, 1_300 * ONE_AUSD, 1_500 * ONE_AUSD);
        vm.prank(attacker);
        assertTrue(vault.checkLoss());
        assertTrue(vault.frozen());
    }

    function test_M1_noFreezeInsideTheCap() public {
        (, AgentVault vault) = _openDay();
        venue.setExposure(address(vault), 360 * ONE_AUSD); // NAV 1,360, above the floor
        assertFalse(vault.checkLoss());
        assertFalse(vault.frozen());
    }

    function test_M1_anOvernightLossCountsBeforeTheNextExecuteOpensANewDay() public {
        (, AgentVault vault) = _openDay();
        vm.warp(block.timestamp + 1 days);
        venue.setExposure(address(vault), 200 * ONE_AUSD); // lost overnight
        assertTrue(vault.checkLoss(), "yesterday's baseline still applies");
        assertTrue(vault.frozen());
    }

    function test_M1_refusedWhileAVenueCannotBePriced() public {
        (, AgentVault vault) = _openDay();
        venue.setExposure(address(vault), 0);
        venue.setUnreliable(address(vault), true); // the 0 is a failed read, not a loss
        vm.expectRevert(IAgentVault.ExposureUnreliable.selector);
        vault.checkLoss();
        assertFalse(vault.frozen());
    }

    function test_M1_noOpBeforeTheFirstTradeAndWhenAlreadyFrozen() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, 1_000 * ONE_AUSD);
        assertFalse(vault.checkLoss(), "no day opened yet");

        vm.prank(guardian);
        vault.freeze();
        assertFalse(vault.checkLoss(), "already frozen");
    }

    // ------------------------------------------------------------------ M2: a venue that can't be read

    function test_M2_aRevertingVenueCountsAsZeroAndWithdrawalsStillWork() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, 1_000 * ONE_AUSD);
        venue.setExposure(address(vault), 500 * ONE_AUSD);
        vm.mockCallRevert(address(venue), abi.encodeCall(IVenueAdapter.exposure, (address(vault))), "upgraded");

        assertEq(vault.nav(), 1_000 * ONE_AUSD, "the venue leg reads 0, nav() doesn't revert");
        assertFalse(vault.venuesReliable());
        vm.prank(alice);
        vault.withdraw(500 * ONE_AUSD, alice, alice);
        assertEq(ausd.balanceOf(alice), 500 * ONE_AUSD);
    }

    function test_M2_aMalformedReplyCountsAsZero() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, 1_000 * ONE_AUSD);
        // One byte back instead of a uint256: abi.decode would revert inside nav().
        vm.mockCall(address(venue), abi.encodeCall(IVenueAdapter.exposure, (address(vault))), hex"01");

        assertEq(vault.nav(), 1_000 * ONE_AUSD);
        assertFalse(vault.venuesReliable());
        assertEq(vault.maxDeposit(bob), 0, "deposits pause");
        assertEq(vault.maxWithdraw(alice), 1_000 * ONE_AUSD, "withdrawals don't");
    }

    // ------------------------------------------------------------------ M3: a fee recipient that can't be paid

    /// @dev Alice deposits 1,000, the agent makes 200: 20 of fee pending above the high-water mark.
    function _inProfit() internal returns (uint256 agentId, AgentVault vault) {
        (agentId, vault) = _enter();
        _deposit(vault, alice, 1_000 * ONE_AUSD);
        _trade(vault, 0, int256(200 * ONE_AUSD));
        assertEq(vault.pendingFee(), 20 * ONE_AUSD);
    }

    function test_M3_aRecipientThatCannotBeFoundLeavesTheFeePending() public {
        (uint256 agentId, AgentVault vault) = _inProfit();
        uint256 hwm = vault.highWaterMark();
        vm.mockCallRevert(address(identity), abi.encodeCall(IIdentityRegistry.ownerOf, (agentId)), "burned");

        vm.prank(alice);
        vault.withdraw(100 * ONE_AUSD, alice, alice);
        assertEq(ausd.balanceOf(alice), 100 * ONE_AUSD);
        // Still owed. It's recomputed on the shares left, so it shrinks with each withdrawal while
        // unpaid (20 to 18.47 here); the difference stays with the remaining backers.
        assertGt(vault.pendingFee(), 18 * ONE_AUSD, "still owed");
        assertEq(vault.highWaterMark(), hwm, "not raised");
        assertEq(ausd.balanceOf(builder), 0);
    }

    function test_M3_aRecipientThatCannotReceiveLeavesTheFeePending() public {
        (, AgentVault vault) = _inProfit();
        // Any transfer to the builder reverts, as for a blocklisted address.
        vm.mockCallRevert(address(ausd), abi.encodeWithSelector(IERC20.transfer.selector, builder), "blocked");

        vm.prank(alice);
        vault.withdraw(100 * ONE_AUSD, alice, alice);
        assertEq(ausd.balanceOf(alice), 100 * ONE_AUSD);
        uint256 owed = vault.pendingFee();
        assertGt(owed, 18 * ONE_AUSD);
        assertEq(ausd.balanceOf(builder), 0);

        // Once the recipient can receive again, crystallise() on the flat vault pays what's owed.
        vm.clearMockedCalls();
        assertEq(vault.crystallise(), owed);
        assertEq(ausd.balanceOf(builder), owed);
        assertEq(vault.pendingFee(), 0);
    }

    function test_M3_aPendingFeeStaysOutOfWhatBackersCanWithdraw() public {
        (uint256 agentId, AgentVault vault) = _inProfit();
        vm.mockCallRevert(address(identity), abi.encodeCall(IIdentityRegistry.ownerOf, (agentId)), "burned");
        // 1,200 held, 20 owed: alice owns 1,180 (less a wei of rounding) and can take all of it.
        uint256 max = vault.maxWithdraw(alice);
        assertApproxEqAbs(max, 1_180 * ONE_AUSD, 1);
        vm.prank(alice);
        vault.withdraw(max, alice, alice);
        assertGe(ausd.balanceOf(address(vault)), 20 * ONE_AUSD, "the fee is still in the vault");
    }
}
