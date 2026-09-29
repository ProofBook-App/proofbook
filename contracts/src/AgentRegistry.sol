// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAgentRegistry, RiskEnvelope} from "./interfaces/IAgentRegistry.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";

/// @notice Skeleton. Implemented after the spec §6 invariant tests exist (tests first).
contract AgentRegistry is IAgentRegistry {
    error NotImplemented();

    IIdentityRegistry public immutable identity;
    mapping(IERC20 asset => bool) public isAllowedAsset;
    address public immutable guardian;

    constructor(IIdentityRegistry identity_, address guardian_, IERC20[] memory assets_) {
        identity = identity_;
        guardian = guardian_;
        for (uint256 i; i < assets_.length; ++i) {
            isAllowedAsset[assets_[i]] = true;
            emit AssetAllowed(address(assets_[i]));
        }
    }

    function enter(uint256, RiskEnvelope calldata, address, IERC20) external pure returns (address) {
        revert NotImplemented();
    }

    function envelopeOf(uint256) external pure returns (RiskEnvelope memory) {
        revert NotImplemented();
    }

    function ownerOf(uint256 agentId) external view returns (address) {
        return identity.ownerOf(agentId);
    }

    function vaultOf(uint256) external pure returns (address) {
        revert NotImplemented();
    }
}
