// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice What AgentRegistry needs from the adapter factory: which venue addresses are canonical
/// adapters it deployed, and a way to bind one to the vault that lists it.
interface IAdapterFactory {
    /// @notice True only for adapters this factory deployed, with this chain's canonical venues.
    function isCanonical(address adapter) external view returns (bool);

    /// @notice Binds `adapter` to `vault`. Callable only by the registry, inside enter().
    function bind(address adapter, address vault) external;
}
