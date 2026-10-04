// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentVault} from "../src/AgentVault.sol";
import {IAgentRegistry, RiskEnvelope} from "../src/interfaces/IAgentRegistry.sol";
import {IAgentVault} from "../src/interfaces/IAgentVault.sol";
import {BaseTest} from "./Base.t.sol";

/// @notice Security review L1, L6 and L7 (docs/security-review.md). L5 is in StaleAndFrozen.t.sol.
contract LowFindingsTest is BaseTest {
    uint256 constant CAP = 10_000 * ONE_AUSD; // _defaultEnvelope's depositCapPerBacker

    // ------------------------------------------------------------------ L1: transfers respect the cap

    function test_L1_aTransferCannotTakeTheReceiverPastTheCap() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, CAP);
        uint256 bobShares = _deposit(vault, bob, 1_000 * ONE_AUSD);

        vm.prank(bob);
        vm.expectPartialRevert(IAgentVault.DepositCapExceeded.selector);
        vault.transfer(alice, bobShares);

        // transferFrom too.
        vm.prank(bob);
        vault.approve(attacker, bobShares);
        vm.prank(attacker);
        vm.expectPartialRevert(IAgentVault.DepositCapExceeded.selector);
        vault.transferFrom(bob, alice, bobShares);
    }

    function test_L1_aTransferInsideTheCapWorks() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, 9_000 * ONE_AUSD);
        uint256 bobShares = _deposit(vault, bob, 1_000 * ONE_AUSD);

        vm.prank(bob);
        vault.transfer(alice, bobShares); // alice ends exactly at the cap
        assertApproxEqAbs(vault.convertToAssets(vault.balanceOf(alice)), CAP, 1);
    }

    function test_L1_transfersStillWorkWhileFrozenAndOutOfAPositionOverTheCap() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, CAP);
        _trade(vault, 0, int256(1_000 * ONE_AUSD)); // alice's position grows past the cap
        vm.prank(guardian);
        vault.freeze();

        uint256 half = vault.balanceOf(alice) / 2;
        vm.prank(alice);
        vault.transfer(bob, half); // the sender's size doesn't matter, only the receiver's
        assertEq(vault.balanceOf(bob), half);
    }

    // ------------------------------------------------------------------ L6: no native MON into the vault

    function test_L6_theVaultRefusesNativeMon() public {
        (, AgentVault vault) = _enter();
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertFalse(ok, "MON sent here would be stuck");
        assertEq(address(vault).balance, 0);
    }

    // ------------------------------------------------------------------ L7: envelope bounds

    function test_L7_aDailyLossCapAboveTheMaximumIsRejected() public {
        uint16 max = registry.MAX_DAILY_LOSS_BPS();
        RiskEnvelope memory env = _defaultEnvelope();

        env.dailyLossCapBps = 10_000; // the review's case: a floor of 0, never freezes
        _expectInvalid(env);
        env.dailyLossCapBps = max + 1;
        _expectInvalid(env);

        env.dailyLossCapBps = max;
        (, AgentVault vault) = _enter(env);
        assertEq(vault.dailyLossCapBps(), max);
    }

    function test_L7_aMaxTradeNotionalAboveTheMaximumIsRejected() public {
        uint256 max = registry.MAX_TRADE_UNITS() * ONE_AUSD; // AUSD has 6 dp
        RiskEnvelope memory env = _defaultEnvelope();

        env.maxTradeNotional = max + 1;
        _expectInvalid(env);

        env.maxTradeNotional = max;
        (, AgentVault vault) = _enter(env);
        assertEq(vault.maxTradeNotional(), max);
    }

    function _expectInvalid(RiskEnvelope memory env) internal {
        vm.startPrank(builder);
        uint256 agentId = identity.register();
        vm.expectRevert(IAgentRegistry.InvalidEnvelope.selector);
        registry.enter(agentId, env, sessionKey, ausd);
        vm.stopPrank();
    }
}
