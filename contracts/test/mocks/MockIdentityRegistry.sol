// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IIdentityRegistry} from "../../src/interfaces/IIdentityRegistry.sol";

/// @notice Minimal ERC-8004 IdentityRegistry: register() mints to msg.sender, like the real one.
contract MockIdentityRegistry is ERC721, IIdentityRegistry {
    uint256 public nextId = 1;

    constructor() ERC721("AgentIdentity", "AGENT") {}

    function register() external returns (uint256 agentId) {
        agentId = nextId++;
        _mint(msg.sender, agentId);
    }

    function ownerOf(uint256 agentId) public view override(ERC721, IIdentityRegistry) returns (address) {
        return super.ownerOf(agentId);
    }

    function tokenURI(uint256 agentId) public view override(ERC721, IIdentityRegistry) returns (string memory) {
        return super.tokenURI(agentId);
    }

    function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool) {
        return _isAuthorized(_requireOwned(agentId), spender, agentId);
    }
}
