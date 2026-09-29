// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IAgentVault} from "../interfaces/IAgentVault.sol";

/// @title VaultBoundAdapter
/// @notice Shared one-vault binding for venue adapters. Each adapter instance serves exactly one
/// AgentVault and holds that vault's venue position.
///
/// Lifecycle: deploy (the deployer becomes the binder) -> AgentRegistry.enter with the adapter in
/// the envelope's venues -> bind(vault). A wrong or missing bind only disables the venue for the
/// vault: nothing can reach the adapter's funding path except the bound vault.
abstract contract VaultBoundAdapter {
    /// @notice Token the bound vault must hold (the vault asset).
    IERC20 public immutable settlementToken;
    address public immutable binder;
    address public vault;

    event Bound(address indexed vault, address indexed binder);

    error NotVault(address caller);
    error NotBinder(address caller);
    error AlreadyBound(address vault);
    error BadVault(address vault);
    error VaultNotFrozen();

    constructor(IERC20 settlementToken_) {
        settlementToken = settlementToken_;
        binder = msg.sender;
    }

    /// @notice One-time link to the vault that lists this adapter. The vault must hold the
    /// settlement token and already allow this adapter as a venue.
    function bind(address vault_) external {
        if (msg.sender != binder) revert NotBinder(msg.sender);
        if (vault != address(0)) revert AlreadyBound(vault);
        if (IERC4626(vault_).asset() != address(settlementToken) || !IAgentVault(vault_).isVenueAllowed(address(this)))
        {
            revert BadVault(vault_);
        }
        vault = vault_;
        emit Bound(vault_, msg.sender);
    }

    /// @dev Returns the bound vault; reverts unless it is the caller.
    function _onlyVault() internal view returns (address v) {
        v = vault;
        if (msg.sender != v) revert NotVault(msg.sender);
    }

    /// @dev Returns the bound vault; reverts unless it is frozen.
    function _onlyFrozenVault() internal view returns (address v) {
        v = vault;
        if (v == address(0) || !IAgentVault(v).frozen()) revert VaultNotFrozen();
    }
}
