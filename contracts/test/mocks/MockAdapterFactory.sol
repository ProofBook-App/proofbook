// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAdapterFactory} from "../../src/interfaces/IAdapterFactory.sol";

/// @notice Test factory: marks any address canonical on request, and binding is a no-op. Lets the
/// invariant suite keep using MockAdapter venues. AdapterFactory.t.sol tests the real factory.
contract MockAdapterFactory is IAdapterFactory {
    mapping(address adapter => bool) public isCanonical;

    function allow(address adapter) external {
        isCanonical[adapter] = true;
    }

    function bind(address, address) external {}
}
