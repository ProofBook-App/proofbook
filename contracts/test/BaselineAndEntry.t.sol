// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentVault} from "../src/AgentVault.sol";
import {IAgentRegistry} from "../src/interfaces/IAgentRegistry.sol";
import {BaseTest} from "./Base.t.sol";

/// @notice Security review L2 and L4 (docs/security-review.md).
contract BaselineAndEntryTest is BaseTest {
    // ------------------------------------------------------------------ L2: withdrawals scale the baseline

    /// @dev 1,000 idle when the day opens; the 10% cap puts the floor at 900.
    function _openDay() internal returns (AgentVault vault) {
        (, vault) = _enter();
        _deposit(vault, alice, 1_000 * ONE_AUSD);
        _trade(vault, 0, 0);
        assertEq(vault.dayStartNav(), 1_000 * ONE_AUSD);
    }

    function test_L2_aWithdrawalAfterAGainKeepsARealFloor() public {
        AgentVault vault = _openDay();
        _trade(vault, 0, int256(1_000 * ONE_AUSD)); // NAV 2,000; 100 of fee owed

        // The review's case. Subtracting would leave 1,000 - 100 (fee) - 999 = 0 and no floor at all.
        vm.prank(alice);
        vault.withdraw(999 * ONE_AUSD, alice, alice);
        // The fee keeps 1,900/2,000 of the baseline (950), the withdrawal 901/1,900 of that.
        assertEq(vault.nav(), 901 * ONE_AUSD);
        assertEq(vault.dayStartNav(), 450_500_000, "still up 100% on the day, as before the withdrawal");

        // So losing two thirds of what's left breaches the cap (floor 405.45) and freezes.
        _trade(vault, 0, -int256(600 * ONE_AUSD));
        assertTrue(vault.frozen());
    }

    function test_L2_aWithdrawalDuringALossKeepsTheLossInPercent() public {
        AgentVault vault = _openDay();
        _trade(vault, 0, -int256(50 * ONE_AUSD)); // NAV 950, down 5%

        vm.prank(alice);
        vault.withdraw(475 * ONE_AUSD, alice, alice);
        // Half the vault left, so half the baseline: still down 5%. Subtracting gave 525 (down 9.5%).
        assertEq(vault.dayStartNav(), 500 * ONE_AUSD);

        // Another 4% (NAV 455, floor 450) stays inside the cap.
        _trade(vault, 0, -int256(20 * ONE_AUSD));
        assertFalse(vault.frozen());
        // Past 10% in all (NAV 445) freezes.
        _trade(vault, 0, -int256(10 * ONE_AUSD));
        assertTrue(vault.frozen());
    }

    function test_L2_whileAVenueCannotBePricedAWithdrawalSubtracts() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, 1_000 * ONE_AUSD);
        venue.setExposure(address(vault), 500 * ONE_AUSD);
        _trade(vault, 0, 0);
        assertEq(vault.dayStartNav(), 1_500 * ONE_AUSD);

        // The venue leg reads 0. Scaling by the NAV that reads would cut the baseline to 750.
        venue.setExposure(address(vault), 0);
        venue.setUnreliable(address(vault), true);
        vm.prank(alice);
        vault.withdraw(500 * ONE_AUSD, alice, alice);
        assertEq(vault.dayStartNav(), 1_000 * ONE_AUSD);
    }

    function test_L2_noBaselineBeforeTheFirstTrade() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, 1_000 * ONE_AUSD);
        vm.prank(alice);
        vault.withdraw(400 * ONE_AUSD, alice, alice);
        assertEq(vault.dayStartNav(), 0);
    }

    // ------------------------------------------------------------------ L4: only the identity's owner enters

    function test_L4_anApprovedAddressCannotEnterSomeoneElsesIdentity() public {
        vm.startPrank(builder);
        uint256 agentId = identity.register();
        identity.approve(attacker, agentId);
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.NotAgentOwner.selector, agentId, attacker));
        vm.prank(attacker);
        registry.enter(agentId, _defaultEnvelope(), attacker, ausd);
    }

    function test_L4_anOperatorForAllCannotEnterEither() public {
        vm.startPrank(builder);
        uint256 agentId = identity.register();
        identity.setApprovalForAll(attacker, true);
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.NotAgentOwner.selector, agentId, attacker));
        vm.prank(attacker);
        registry.enter(agentId, _defaultEnvelope(), attacker, ausd);

        // The owner still can.
        vm.prank(builder);
        assertTrue(registry.enter(agentId, _defaultEnvelope(), sessionKey, ausd) != address(0));
    }

    function test_L4_afterATransferTheNewOwnerEntersAndTheOldOneCannot() public {
        vm.startPrank(builder);
        uint256 agentId = identity.register();
        identity.transferFrom(builder, bob, agentId);
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.NotAgentOwner.selector, agentId, builder));
        registry.enter(agentId, _defaultEnvelope(), sessionKey, ausd);
        vm.stopPrank();

        vm.prank(bob);
        assertEq(registry.enter(agentId, _defaultEnvelope(), sessionKey, ausd), registry.vaultOf(agentId));
    }
}
