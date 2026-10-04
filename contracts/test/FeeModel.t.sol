// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentVault} from "../src/AgentVault.sol";
import {IAgentVault} from "../src/interfaces/IAgentVault.sol";
import {BaseTest} from "./Base.t.sol";

/// @notice Security review L3 (docs/security-review.md): the fee can't be crystallised at a mark.
contract FeeModelTest is BaseTest {
    /// @dev Alice deposits 1,000, 500 of it goes to the venue, and the venue marks it at 700: a 200
    /// gain nobody has realised, 20 of fee owed. The mock adapter burns on a negative trade, so the
    /// move is set up directly (no execute, so no day opens and nothing freezes).
    function _atAMarkPeak() internal returns (AgentVault vault) {
        (, vault) = _enter();
        _deposit(vault, alice, 1_000 * ONE_AUSD);
        ausd.burn(address(vault), 500 * ONE_AUSD);
        venue.setExposure(address(vault), 700 * ONE_AUSD);
        assertFalse(vault.frozen());
        assertEq(vault.pendingFee(), 20 * ONE_AUSD);
    }

    function test_L3_aZeroWithdrawalAtAPeakPaysNothing() public {
        AgentVault vault = _atAMarkPeak();
        uint256 hwm = vault.highWaterMark();

        vm.prank(attacker);
        vault.withdraw(0, attacker, attacker);
        assertEq(ausd.balanceOf(builder), 0);
        assertEq(vault.highWaterMark(), hwm);

        venue.setExposure(address(vault), 500 * ONE_AUSD); // the mark falls back
        assertEq(vault.pendingFee(), 0, "nothing was charged on a gain that went away");
    }

    function test_L3_aOneWeiDepositAtAPeakPaysNothing() public {
        AgentVault vault = _atAMarkPeak();
        _deposit(vault, attacker, 1);
        assertEq(ausd.balanceOf(builder), 0);
        assertApproxEqAbs(vault.pendingFee(), 20 * ONE_AUSD, 1);

        venue.setExposure(address(vault), 500 * ONE_AUSD);
        assertEq(vault.pendingFee(), 0);
    }

    function test_L3_anExitPaysOnlyTheLeavingShares() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, 1_000 * ONE_AUSD);
        _deposit(vault, bob, 1_000 * ONE_AUSD);
        _trade(vault, 0, int256(400 * ONE_AUSD)); // 40 owed, half on each
        uint256 hwm = vault.highWaterMark();

        uint256 shares = vault.balanceOf(alice);
        vm.expectEmit(address(vault));
        emit IAgentVault.FeeTaken(builder, 20 * ONE_AUSD, hwm);
        vm.prank(alice);
        uint256 out = vault.redeem(shares, alice, alice);

        assertApproxEqAbs(out, 1_180 * ONE_AUSD, 1);
        assertEq(ausd.balanceOf(builder), 20 * ONE_AUSD);
        assertEq(vault.highWaterMark(), hwm, "the share price didn't move");
        assertApproxEqAbs(vault.pendingFee(), 20 * ONE_AUSD, 1, "bob's part is still owed");
    }

    function test_L3_anEntrantAboveTheMarkLeavesTheFeeOwedUnchanged() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, 1_000 * ONE_AUSD);
        _trade(vault, 0, int256(200 * ONE_AUSD)); // 20 owed
        uint256 hwm = vault.highWaterMark();

        ausd.mint(bob, 1_180 * ONE_AUSD);
        vm.startPrank(bob);
        ausd.approve(address(vault), 1_180 * ONE_AUSD);
        vm.expectEmit(false, false, false, false, address(vault));
        emit IAgentVault.HighWaterMarkSet(0);
        vault.deposit(1_180 * ONE_AUSD, bob);
        vm.stopPrank();

        assertGt(vault.highWaterMark(), hwm, "averaged up toward bob's entry price");
        assertApproxEqAbs(vault.pendingFee(), 20 * ONE_AUSD, 1, "alice still owes 20, bob owes nothing");
        assertApproxEqAbs(vault.convertToAssets(vault.balanceOf(bob)), 1_180 * ONE_AUSD, 1);
        assertEq(ausd.balanceOf(builder), 0);

        // The next 238 of profit (10% on 2,380) adds 23.8 of fee, on gains made after bob joined.
        _trade(vault, 0, int256(238 * ONE_AUSD));
        assertApproxEqAbs(vault.pendingFee(), 43_800_000, 2);
    }

    function test_L3_anEntrantBelowTheMarkLeavesItInPlace() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, 1_000 * ONE_AUSD);
        _trade(vault, 0, -int256(100 * ONE_AUSD));
        uint256 hwm = vault.highWaterMark();

        _deposit(vault, bob, 900 * ONE_AUSD);
        assertEq(vault.highWaterMark(), hwm, "alice keeps her loss carried forward");
        assertEq(vault.pendingFee(), 0);
    }

    function test_L3_theFirstDepositIntoAnEmptyVaultStartsTheMarkAtItsPrice() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, 1_000 * ONE_AUSD);
        _trade(vault, 0, int256(500 * ONE_AUSD));
        uint256 aliceShares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(aliceShares, alice, alice);
        assertEq(vault.totalSupply(), 0);
        // Rounding leaves 1 wei behind, so with the virtual-share offset bob's shares price at 2.0.
        // A mark kept from alice's run (1.45 before this fix) would charge him 27.5 the moment he joined.
        assertEq(vault.nav(), 1);

        uint256 shares = _deposit(vault, bob, 1_000 * ONE_AUSD);
        assertEq(shares, 5e14);
        assertEq(vault.highWaterMark(), 1_000 * ONE_AUSD * 1e18 / shares, "his entry price, 2.0");
        assertEq(vault.pendingFee(), 0, "bob owes from his own entry");
        assertEq(vault.convertToAssets(vault.balanceOf(bob)), 1_000 * ONE_AUSD);
        _trade(vault, 0, int256(100 * ONE_AUSD));
        assertApproxEqAbs(vault.pendingFee(), 10 * ONE_AUSD, 2);
    }

    function test_L3_crystalliseRefusedWhileTheVaultHoldsAPosition() public {
        AgentVault vault = _atAMarkPeak();
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.NotFlat.selector, 700 * ONE_AUSD, 1_200 * ONE_AUSD));
        vm.prank(attacker);
        vault.crystallise();
    }

    function test_L3_crystalliseOnAFlatVaultPaysTheWholeFeeAndRaisesTheMark() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, 1_000 * ONE_AUSD);
        _trade(vault, 0, int256(200 * ONE_AUSD)); // realised: cash back in the vault
        venue.setExposure(address(vault), 1 * ONE_AUSD); // dust, under 0.1% of NAV

        vm.prank(attacker);
        uint256 fee = vault.crystallise();
        assertApproxEqAbs(fee, 20_100_000, 1); // 10% of the 201 above the mark
        assertEq(ausd.balanceOf(builder), fee);
        assertEq(vault.pendingFee(), 0);
        assertEq(vault.highWaterMark(), vault.nav() * 1e18 / vault.totalSupply());
        assertEq(vault.crystallise(), 0, "nothing left to pay");
    }

    function test_L3_crystalliseRefusedWhileAVenueCannotBePriced() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, 1_000 * ONE_AUSD);
        _trade(vault, 0, int256(200 * ONE_AUSD));
        venue.setUnreliable(address(vault), true); // a failed read would look flat
        vm.expectRevert(IAgentVault.ExposureUnreliable.selector);
        vault.crystallise();
    }

    function test_L3_zeroExitsAndCrystalliseWorkOnAnEmptyVault() public {
        (, AgentVault vault) = _enter();
        vm.startPrank(alice);
        vault.withdraw(0, alice, alice);
        vault.redeem(0, alice, alice);
        vm.stopPrank();
        assertEq(vault.crystallise(), 0);
    }
}
