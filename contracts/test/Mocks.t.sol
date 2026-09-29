// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./Base.t.sol";
import {MockAdapter} from "./mocks/MockAdapter.sol";

/// @dev Stands in for a vault so the mock adapter can resolve `asset()` from msg.sender.
contract FakeVault {
    address public asset;

    constructor(address asset_) {
        asset = asset_;
    }

    function run(MockAdapter adapter, uint256 notional, int256 pnl) external returns (int256) {
        return adapter.execute(abi.encode(notional, pnl));
    }
}

/// @notice Sanity checks on the test doubles, so invariant failures point at the vault, not the mocks.
contract MocksTest is BaseTest {
    function test_ausdHasSixDecimals() public view {
        assertEq(ausd.decimals(), 6);
        assertEq(usdc.decimals(), 6);
    }

    function test_identityRegisterMintsToCaller() public {
        vm.prank(builder);
        uint256 id = identity.register();
        assertEq(identity.ownerOf(id), builder);
        assertTrue(identity.isAuthorizedOrOwner(builder, id));
        assertFalse(identity.isAuthorizedOrOwner(attacker, id));
    }

    function test_adapterRealisesPnlInVaultAsset() public {
        FakeVault fake = new FakeVault(address(ausd));
        ausd.mint(address(fake), 1_000);
        fake.run(venue, 100, 50);
        assertEq(ausd.balanceOf(address(fake)), 1_050);
        fake.run(venue, 100, -80);
        assertEq(ausd.balanceOf(address(fake)), 970);
        assertEq(venue.quoteNotional(abi.encode(uint256(123), int256(0))), 123);
    }

    function test_adapterExposureIsSettable() public {
        venue.setExposure(address(this), 42);
        assertEq(venue.exposure(address(this)), 42);
    }
}
