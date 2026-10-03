// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Risk envelope a builder commits to when entering an agent (spec §5).
/// Amounts are AUSD with 6 decimals. dailyLossCapBps is in basis points of dayStartNav.
struct RiskEnvelope {
    uint256 maxTradeNotional;
    uint16 dailyLossCapBps;
    uint256 depositCapPerBacker;
    address[] venues;
}

interface IAgentRegistry {
    event AssetAllowed(address indexed asset);
    event AgentRegistered(uint256 indexed agentId, address indexed owner, RiskEnvelope envelope);
    event VaultLinked(uint256 indexed agentId, address indexed vault, address indexed asset, address sessionKey);

    error NotAgentOwner(uint256 agentId, address caller);
    error AlreadyEntered(uint256 agentId);
    error InvalidEnvelope();
    error AssetNotAllowed(address asset);
    /// @notice A venue that the registry's AdapterFactory didn't deploy.
    error UnknownAdapter(address venue);

    /// @notice Enter an ERC-8004 agent into Proofbook and deploy its vault on `asset`.
    /// Caller must be IdentityRegistry.ownerOf(agentId); an approved operator is refused.
    /// `asset` must be registry-allowlisted: AUSD (default, Perpl) or USDC (Kuru MON-USDC).
    function enter(uint256 agentId, RiskEnvelope calldata envelope, address sessionKey, IERC20 asset)
        external
        returns (address vault);

    function isAllowedAsset(IERC20 asset) external view returns (bool);

    function envelopeOf(uint256 agentId) external view returns (RiskEnvelope memory);

    /// @notice Live IdentityRegistry.ownerOf(agentId). Receives the performance fee.
    function ownerOf(uint256 agentId) external view returns (address);

    function vaultOf(uint256 agentId) external view returns (address);
}
