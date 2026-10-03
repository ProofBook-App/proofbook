// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {AgentVault} from "./AgentVault.sol";
import {IAdapterFactory} from "./interfaces/IAdapterFactory.sol";
import {IAgentRegistry, RiskEnvelope} from "./interfaces/IAgentRegistry.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";

/// @title AgentRegistry
/// @notice Enters ERC-8004 agents into Proofbook: stores each agent's risk envelope and deploys
/// its AgentVault. Builders register their identity with the canonical IdentityRegistry first
/// (register() mints to msg.sender), then call enter(). Every venue must be an adapter the
/// AdapterFactory deployed; enter() binds them to the new vault. UNAUDITED.
contract AgentRegistry is IAgentRegistry {
    uint256 internal constant BPS = 10_000;
    /// @dev NAV sums every venue's exposure, so the venue list stays short.
    uint256 public constant MAX_VENUES = 8;

    IIdentityRegistry public immutable identity;
    address public immutable guardian;
    /// @notice The only source of venue adapters a vault may list (docs/security-review.md, C1).
    IAdapterFactory public immutable adapters;

    mapping(IERC20 asset => bool) public isAllowedAsset;
    mapping(uint256 agentId => address) public vaultOf;
    mapping(uint256 agentId => RiskEnvelope) internal _envelopes;

    constructor(IIdentityRegistry identity_, address guardian_, IERC20[] memory assets_, IAdapterFactory adapters_) {
        if (address(identity_) == address(0) || guardian_ == address(0) || address(adapters_) == address(0)) {
            revert InvalidEnvelope();
        }
        identity = identity_;
        guardian = guardian_;
        adapters = adapters_;
        for (uint256 i; i < assets_.length; ++i) {
            isAllowedAsset[assets_[i]] = true;
            emit AssetAllowed(address(assets_[i]));
        }
    }

    /// @inheritdoc IAgentRegistry
    function enter(uint256 agentId, RiskEnvelope calldata envelope, address sessionKey, IERC20 asset)
        external
        returns (address vault)
    {
        if (!identity.isAuthorizedOrOwner(msg.sender, agentId)) revert NotAgentOwner(agentId, msg.sender);
        if (vaultOf[agentId] != address(0)) revert AlreadyEntered(agentId);
        if (!isAllowedAsset[asset]) revert AssetNotAllowed(address(asset));
        _validate(envelope);

        _envelopes[agentId] = envelope;
        string memory id = Strings.toString(agentId);
        vault = address(
            new AgentVault(
                asset,
                this,
                agentId,
                sessionKey,
                guardian,
                envelope,
                string.concat("Proofbook Agent #", id),
                string.concat("pbA", id)
            )
        );
        vaultOf[agentId] = vault;

        emit AgentRegistered(agentId, identity.ownerOf(agentId), envelope);
        emit VaultLinked(agentId, vault, address(asset), sessionKey);

        // After the events, so an indexer that registers adapters from AgentRegistered sees each
        // Bound. Each adapter binds once: one another vault already uses makes this revert.
        for (uint256 i; i < envelope.venues.length; ++i) {
            adapters.bind(envelope.venues[i], vault);
        }
    }

    function envelopeOf(uint256 agentId) external view returns (RiskEnvelope memory) {
        return _envelopes[agentId];
    }

    /// @notice Live ERC-8004 owner. Receives the performance fee and controls the vault.
    function ownerOf(uint256 agentId) external view returns (address) {
        return identity.ownerOf(agentId);
    }

    function _validate(RiskEnvelope calldata envelope) internal view {
        if (
            envelope.maxTradeNotional == 0 || envelope.depositCapPerBacker == 0 || envelope.dailyLossCapBps == 0
                || envelope.dailyLossCapBps > BPS || envelope.venues.length == 0 || envelope.venues.length > MAX_VENUES
        ) revert InvalidEnvelope();
        for (uint256 i; i < envelope.venues.length; ++i) {
            if (envelope.venues[i] == address(0)) revert InvalidEnvelope();
            if (!adapters.isCanonical(envelope.venues[i])) revert UnknownAdapter(envelope.venues[i]);
        }
    }
}
