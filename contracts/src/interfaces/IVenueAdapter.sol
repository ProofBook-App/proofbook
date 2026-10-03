// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice A trading venue the vault may route through (spec §5 Adapters).
/// Only adapters on a vault's allowlist can be reached from AgentVault.execute.
interface IVenueAdapter {
    /// @notice Run one venue action for the calling vault.
    /// @return navDelta Signed change in vault NAV the adapter attributes to this action (AUSD, 6 dp).
    function execute(bytes calldata data) external returns (int256 navDelta);

    /// @notice Notional (AUSD, 6 dp) that `data` would put at risk. The vault checks it against
    /// maxTradeNotional before calling execute (invariant 2). Not in the spec §5 interface.
    function quoteNotional(bytes calldata data) external view returns (uint256);

    /// @notice Value the vault holds at this venue (margin balances, resting orders, positions
    /// at a conservative mark), in AUSD with 6 dp. Summed into the vault's NAV.
    function exposure(address vault) external view returns (uint256);

    /// @notice False when exposure() is only a floor: a venue read failed or a price is stale, so
    /// value the vault holds here is missing from NAV. The vault takes no deposits while any venue
    /// is unreliable, so nobody can buy shares at the understated price (security review H1).
    /// Withdrawals are unaffected (invariant 4).
    function exposureReliable(address vault) external view returns (bool);
}
