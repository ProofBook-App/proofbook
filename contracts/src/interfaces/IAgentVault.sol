// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Per-agent ERC-4626 vault on AUSD (spec §5). Deposit/withdraw/redeem come from ERC-4626.
interface IAgentVault {
    enum BreachReason {
        DailyLossCap
    }

    /// @dev Every state change emits (invariant 7). Adding an event here means updating
    /// indexer/schema.graphql in the same PR.
    event Executed(address indexed venue, uint256 notionalIn, uint256 notionalOut, uint256 navBefore, uint256 navAfter);
    event PolicyBreach(BreachReason reason, uint256 nav, uint256 dayStartNav);
    event Frozen(address indexed by);
    event Unfrozen(address indexed by);
    event FeeTaken(address indexed to, uint256 assets, uint256 highWaterMark);
    event SessionKeyRotated(address indexed previous, address indexed next);
    event DayRolled(uint256 dayStart, uint256 dayStartNav);

    error NotSessionKey(address caller);
    error NotOwnerOrGuardian(address caller);
    error VenueNotAllowed(address venue);
    error TradeTooLarge(uint256 notional, uint256 maxTradeNotional);
    error VaultFrozen();
    error DepositCapExceeded(address backer, uint256 attempted, uint256 cap);
    error UnfreezeCooldown(uint256 readyAt);

    /// @notice Session-key-only. Routes one action through an allowlisted adapter.
    /// Venue and notional breaches revert. A daily-loss breach does NOT revert: the trade
    /// stands and the vault freezes in the same tx (invariant 3).
    function execute(address venue, bytes calldata data) external;

    function rotateSessionKey(address next) external;
    function freeze() external;
    function unfreeze() external;

    function agentId() external view returns (uint256);
    function sessionKey() external view returns (address);
    function guardian() external view returns (address);
    function frozen() external view returns (bool);
    function nav() external view returns (uint256);
    function dayStart() external view returns (uint256);
    function dayStartNav() external view returns (uint256);
    function highWaterMark() external view returns (uint256);
    function isVenueAllowed(address venue) external view returns (bool);
}
