// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IVenueAdapter} from "../../src/interfaces/IVenueAdapter.sol";
import {MockAUSD} from "./MockAUSD.sol";

/// @notice Test-controlled venue. `data` = abi.encode(uint256 notional, int256 pnl).
/// execute() realises `pnl` in the calling vault's own asset: a gain is minted to the vault,
/// a loss is burned from it. So PnL shows up in real balances, not only in bookkeeping.
/// setExposure() fakes value held at the venue (e.g. a position marked at a pushed Kuru mid).
contract MockAdapter is IVenueAdapter {
    mapping(address vault => uint256) public exposureOf;
    mapping(address vault => bool) public unreliable;

    function quoteNotional(bytes calldata data) external pure returns (uint256 notional) {
        (notional,) = abi.decode(data, (uint256, int256));
    }

    function execute(bytes calldata data) external returns (int256 pnl) {
        (, pnl) = abi.decode(data, (uint256, int256));
        MockAUSD token = MockAUSD(IERC4626(msg.sender).asset());
        if (pnl > 0) token.mint(msg.sender, uint256(pnl));
        else if (pnl < 0) token.burn(msg.sender, uint256(-pnl));
    }

    function exposure(address vault) external view returns (uint256) {
        return exposureOf[vault];
    }

    function setExposure(address vault, uint256 value) external {
        exposureOf[vault] = value;
    }

    function exposureReliable(address vault) external view returns (bool) {
        return !unreliable[vault];
    }

    /// @dev Fakes a stale price or failed read at the venue (deposits should pause).
    function setUnreliable(address vault, bool value) external {
        unreliable[vault] = value;
    }
}
