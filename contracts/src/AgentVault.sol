// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IAgentVault} from "./interfaces/IAgentVault.sol";

/// @notice Skeleton. Implemented after the spec §6 invariant tests exist (tests first).
contract AgentVault is ERC4626, IAgentVault {
    error NotImplemented();

    constructor(IERC20 asset_, string memory name_, string memory symbol_) ERC20(name_, symbol_) ERC4626(asset_) {}

    /// @dev AUSD has 6 decimals: offset shares by 1e6 against first-depositor inflation.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    /// @dev Kuru MON-AUSD settles in native MON.
    receive() external payable {}

    function execute(address, bytes calldata) external pure {
        revert NotImplemented();
    }

    function rotateSessionKey(address) external pure {
        revert NotImplemented();
    }

    function freeze() external pure {
        revert NotImplemented();
    }

    function unfreeze() external pure {
        revert NotImplemented();
    }

    function agentId() external pure returns (uint256) {
        revert NotImplemented();
    }

    function sessionKey() external pure returns (address) {
        revert NotImplemented();
    }

    function guardian() external pure returns (address) {
        revert NotImplemented();
    }

    function frozen() external pure returns (bool) {
        revert NotImplemented();
    }

    function nav() external pure returns (uint256) {
        revert NotImplemented();
    }

    function dayStart() external pure returns (uint256) {
        revert NotImplemented();
    }

    function dayStartNav() external pure returns (uint256) {
        revert NotImplemented();
    }

    function highWaterMark() external pure returns (uint256) {
        revert NotImplemented();
    }

    function isVenueAllowed(address) external pure returns (bool) {
        revert NotImplemented();
    }
}
