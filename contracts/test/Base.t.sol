// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {RiskEnvelope} from "../src/interfaces/IAgentRegistry.sol";
import {MockAUSD} from "./mocks/MockAUSD.sol";
import {MockIdentityRegistry} from "./mocks/MockIdentityRegistry.sol";
import {MockAdapter} from "./mocks/MockAdapter.sol";
import {MockAdapterFactory} from "./mocks/MockAdapterFactory.sol";

/// @notice Shared local setup: mock AUSD and mock USDC (both 6 dp, both allowlisted), mock ERC-8004 registry, one mock venue.
/// setUp must not touch unimplemented contract functions, so agents are entered per test via _enter().
abstract contract BaseTest is Test {
    uint256 internal constant ONE_AUSD = 1e6;

    MockAUSD internal ausd;
    MockAUSD internal usdc;
    MockIdentityRegistry internal identity;
    MockAdapter internal venue;
    MockAdapter internal unlistedVenue;
    AgentRegistry internal registry;
    MockAdapterFactory internal adapterFactory;

    address internal builder = makeAddr("builder");
    address internal sessionKey = makeAddr("sessionKey");
    address internal guardian = makeAddr("guardian");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal attacker = makeAddr("attacker");

    function setUp() public virtual {
        ausd = new MockAUSD();
        usdc = new MockAUSD();
        identity = new MockIdentityRegistry();
        venue = new MockAdapter();
        unlistedVenue = new MockAdapter();
        IERC20[] memory assets = new IERC20[](2);
        assets[0] = ausd;
        assets[1] = usdc;
        // The registry accepts only canonical adapters; the mock factory vouches for the mock venue.
        adapterFactory = new MockAdapterFactory();
        adapterFactory.allow(address(venue));
        registry = new AgentRegistry(identity, guardian, assets, adapterFactory);
    }

    /// @dev 1,000 AUSD max trade, 10% daily loss cap, 10,000 AUSD per backer, one allowlisted venue.
    function _defaultEnvelope() internal view returns (RiskEnvelope memory env) {
        address[] memory venues = new address[](1);
        venues[0] = address(venue);
        env = RiskEnvelope({
            maxTradeNotional: 1_000 * ONE_AUSD,
            dailyLossCapBps: 1_000,
            depositCapPerBacker: 10_000 * ONE_AUSD,
            venues: venues
        });
    }

    /// @dev Builder registers an ERC-8004 identity, then enters it into Proofbook on `asset`.
    function _enter(RiskEnvelope memory env, IERC20 asset) internal returns (uint256 agentId, AgentVault vault) {
        vm.startPrank(builder);
        agentId = identity.register();
        vault = AgentVault(payable(registry.enter(agentId, env, sessionKey, asset)));
        vm.stopPrank();
    }

    /// @dev Default vault asset is AUSD.
    function _enter(RiskEnvelope memory env) internal returns (uint256 agentId, AgentVault vault) {
        return _enter(env, ausd);
    }

    function _enter() internal returns (uint256 agentId, AgentVault vault) {
        return _enter(_defaultEnvelope());
    }

    function _deposit(AgentVault vault, address backer, uint256 assets) internal returns (uint256 shares) {
        MockAUSD token = MockAUSD(vault.asset());
        token.mint(backer, assets);
        vm.startPrank(backer);
        token.approve(address(vault), assets);
        shares = vault.deposit(assets, backer);
        vm.stopPrank();
    }

    function _trade(AgentVault vault, uint256 notional, int256 navDelta) internal {
        vm.prank(sessionKey);
        vault.execute(address(venue), abi.encode(notional, navDelta));
    }
}
