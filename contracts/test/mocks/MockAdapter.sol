// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVenueAdapter} from "../../src/interfaces/IVenueAdapter.sol";

/// @notice Test-controlled venue. `data` = abi.encode(uint256 notional, int256 navDelta).
/// execute() moves the caller's exposure by navDelta, so tests can script gains and losses.
/// setExposure() fakes a manipulated mark (e.g. a pushed Kuru mid).
contract MockAdapter is IVenueAdapter {
    mapping(address vault => uint256) public exposureOf;

    function encode(uint256 notional, int256 navDelta) external pure returns (bytes memory) {
        return abi.encode(notional, navDelta);
    }

    function quoteNotional(bytes calldata data) external pure returns (uint256 notional) {
        (notional,) = abi.decode(data, (uint256, int256));
    }

    function execute(bytes calldata data) external returns (int256 navDelta) {
        (, navDelta) = abi.decode(data, (uint256, int256));
        uint256 current = exposureOf[msg.sender];
        if (navDelta >= 0) {
            exposureOf[msg.sender] = current + uint256(navDelta);
        } else {
            uint256 loss = uint256(-navDelta);
            exposureOf[msg.sender] = loss > current ? 0 : current - loss;
        }
    }

    function exposure(address vault) external view returns (uint256) {
        return exposureOf[vault];
    }

    function setExposure(address vault, uint256 value) external {
        exposureOf[vault] = value;
    }
}
