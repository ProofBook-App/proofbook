// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "../Base.t.sol";
import {AgentVault} from "../../src/AgentVault.sol";
import {IAgentVault} from "../../src/interfaces/IAgentVault.sol";

/// @notice Spec §6 invariants. HUMAN-WRITTEN: fill in each test, then delete its vm.skip.
/// Claude implements AgentRegistry/AgentVault until these pass, and never edits them to get green.
/// Run: forge test --match-contract Invariant -vvv
///
/// Helpers from BaseTest: _enter(), _enter(env), _defaultEnvelope(), _deposit(vault, who, amt),
/// _trade(vault, notional, navDelta). Actors: builder, sessionKey, guardian, alice, bob, attacker.
/// venue is allowlisted, unlistedVenue is not. venue.setExposure(vault, x) fakes a mark move.
/// For stateful fuzzing, add a handler contract and invariant_* functions alongside these.
contract PolicyInvariantTest is BaseTest {
    /// Inv 1: only the session key can call execute, and funds leave only via an allowlisted adapter.
    /// Ideas: attacker/builder/guardian calling execute revert with NotSessionKey;
    /// sessionKey calling unlistedVenue reverts with VenueNotAllowed; fuzz the caller.
    function test_Inv1_onlySessionKeyViaAllowlistedAdapter() public {
        vm.skip(true);
    }

    /// Inv 2: a single execute moves at most maxTradeNotional.
    /// Ideas: notional == max passes; max + 1 reverts with TradeTooLarge; fuzz notional.
    function test_Inv2_tradeNotionalCapped() public {
        vm.skip(true);
    }

    /// Inv 3: if nav < dayStartNav * (1 - dailyLossCap) after an execute, the vault freezes in the same tx.
    /// Ideas: loss just under the cap stays unfrozen; loss past it -> frozen() true, PolicyBreach + Frozen
    /// emitted, next execute reverts VaultFrozen. Also under a manipulated mark (venue.setExposure).
    function test_Inv3_dailyLossFreezesSameTx() public {
        vm.skip(true);
    }

    /// Inv 4: when idle, backers can always withdraw their pro-rata share, frozen or not.
    /// Ideas: alice + bob deposit, trade, freeze; both redeem full shares and get their pro-rata assets.
    function test_Inv4_idleWithdrawAlwaysWorks() public {
        vm.skip(true);
    }

    /// Inv 5: a deposit above depositCapPerBacker reverts.
    /// Ideas: deposit cap passes; cap + 1 reverts DepositCapExceeded; two deposits summing past the cap;
    /// mint() path too; maxDeposit(backer) reflects the remaining cap.
    function test_Inv5_depositCapPerBacker() public {
        vm.skip(true);
    }

    /// Inv 6: the performance fee applies only to profit above the high-water mark.
    /// Ideas: profit -> withdraw -> FeeTaken is 10% of profit to registry.ownerOf(agentId);
    /// loss then recovery back to HWM -> no fee; transfer the ERC-8004 NFT and check the fee follows.
    function test_Inv6_feeOnlyAboveHighWaterMark() public {
        vm.skip(true);
    }

    /// Inv 7: every state change emits an event; the leaderboard is derivable from events alone.
    /// Ideas: vm.recordLogs() around enter/deposit/execute/freeze/unfreeze/rotate/withdraw, assert
    /// each emitted its event; rebuild NAV/PnL from Executed logs and compare with vault.nav().
    function test_Inv7_everyStateChangeEmits() public {
        vm.skip(true);
    }
}
