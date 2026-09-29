// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./Base.t.sol";

/// @notice Sanity checks on the test doubles, so invariant failures point at the vault, not the mocks.
contract MocksTest is BaseTest {
    function test_ausdHasSixDecimals() public view {
        assertEq(ausd.decimals(), 6);
    }

    function test_identityRegisterMintsToCaller() public {
        vm.prank(builder);
        uint256 id = identity.register();
        assertEq(identity.ownerOf(id), builder);
        assertTrue(identity.isAuthorizedOrOwner(builder, id));
        assertFalse(identity.isAuthorizedOrOwner(attacker, id));
    }

    function test_adapterScriptsGainsAndLosses() public {
        venue.execute(abi.encode(uint256(100), int256(50)));
        assertEq(venue.exposure(address(this)), 50);
        venue.execute(abi.encode(uint256(100), int256(-80)));
        assertEq(venue.exposure(address(this)), 0);
        assertEq(venue.quoteNotional(abi.encode(uint256(123), int256(0))), 123);
    }
}
