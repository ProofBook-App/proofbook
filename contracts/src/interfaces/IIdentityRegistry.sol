// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Subset of the canonical ERC-8004 IdentityRegistry that Proofbook reads.
/// Mainnet 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 (see docs/reference/erc-8004.md).
/// We never deploy our own: builders register there directly, then call AgentRegistry.enter.
interface IIdentityRegistry {
    function ownerOf(uint256 agentId) external view returns (address);
    function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool);
    function tokenURI(uint256 agentId) external view returns (string memory);
}
