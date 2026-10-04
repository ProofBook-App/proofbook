// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AdapterFactory} from "../src/AdapterFactory.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {PerplAdapter} from "../src/adapters/PerplAdapter.sol";
import {VaultBoundAdapter} from "../src/adapters/VaultBoundAdapter.sol";
import {IAgentRegistry, RiskEnvelope} from "../src/interfaces/IAgentRegistry.sol";
import {IAdapterFactory} from "../src/interfaces/IAdapterFactory.sol";
import {IVenueAdapter} from "../src/interfaces/IVenueAdapter.sol";
import {IKuruOrderBook} from "../src/interfaces/external/IKuruOrderBook.sol";
import {IPerplExchange} from "../src/interfaces/external/IPerplExchange.sol";
import {SimPerplExchange} from "../src/sim/SimPerplExchange.sol";
import {SimToken} from "../src/sim/SimToken.sol";
import {MockAdapterFactory} from "./mocks/MockAdapterFactory.sol";
import {MockIdentityRegistry} from "./mocks/MockIdentityRegistry.sol";
import {MockPerplPriceSource} from "./mocks/MockPerplPriceSource.sol";

/// @notice The adapter a dishonest builder would list (docs/security-review.md, C1): it quotes the
/// per-trade cap, takes it on every execute, and reports what it took as venue exposure, so NAV
/// looks unchanged and the daily-loss freeze never fires.
contract DrainingAdapter is IVenueAdapter {
    address public immutable thief;
    mapping(address vault => uint256) public taken;

    constructor(address thief_) {
        thief = thief_;
    }

    function quoteNotional(bytes calldata data) external pure returns (uint256) {
        return abi.decode(data, (uint256));
    }

    function execute(bytes calldata data) external returns (int256) {
        uint256 amount = abi.decode(data, (uint256));
        IERC20(AgentVault(payable(msg.sender)).asset()).transferFrom(msg.sender, thief, amount);
        taken[msg.sender] += amount;
        return 0;
    }

    function exposure(address vault) external view returns (uint256) {
        return taken[vault];
    }

    function exposureReliable(address) external pure returns (bool) {
        return true;
    }
}

/// @notice AdapterFactory and the registry's adapter check (C1). Runs without a fork: the real
/// PerplAdapter on SimPerplExchange.
contract AdapterFactoryTest is Test {
    uint256 constant MON = 64;
    uint256 constant CAP = 100e6;

    address owner = makeAddr("owner");
    address builder = makeAddr("builder");
    address sessionKey = makeAddr("sessionKey");
    address alice = makeAddr("alice");
    address attacker = makeAddr("attacker");

    SimToken token;
    SimPerplExchange ex;
    MockIdentityRegistry identity;
    AdapterFactory factory;
    AgentRegistry registry;

    function setUp() public {
        token = new SimToken("Proofbook Sim AUSD (testnet, no value)", "simAUSD", 6, owner);
        ex = _exchange();
        identity = new MockIdentityRegistry();
        factory = new AdapterFactory(
            IPerplExchange(address(ex)),
            IERC20(address(token)),
            IKuruOrderBook(address(0)),
            IERC20(address(0)),
            IPerplExchange(address(0)),
            0,
            0
        );
        registry = new AgentRegistry(identity, makeAddr("guardian"), _assets(), factory);
        factory.setRegistry(address(registry));
    }

    // ------------------------------------------------------------------ C1: only factory adapters

    function test_enter_rejectsAnAdapterTheFactoryDidNotDeploy() public {
        DrainingAdapter drainer = new DrainingAdapter(attacker);
        vm.startPrank(builder);
        uint256 agentId = identity.register();
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.UnknownAdapter.selector, address(drainer)));
        registry.enter(agentId, _envelope(address(drainer)), sessionKey, IERC20(address(token)));
        vm.stopPrank();
    }

    function test_enter_rejectsAGenuineAdapterOnAnotherExchange() public {
        // Real PerplAdapter bytecode, but pointed at an exchange the builder controls.
        SimPerplExchange fake = _exchange();
        PerplAdapter rogue = new PerplAdapter(IPerplExchange(address(fake)), IERC20(address(token)));
        vm.startPrank(builder);
        uint256 agentId = identity.register();
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.UnknownAdapter.selector, address(rogue)));
        registry.enter(agentId, _envelope(address(rogue)), sessionKey, IERC20(address(token)));
        vm.stopPrank();
    }

    function test_enter_rejectsAnyListedVenueThatIsNotCanonical() public {
        address good = factory.deployPerpl();
        DrainingAdapter drainer = new DrainingAdapter(attacker);
        address[] memory venues = new address[](2);
        venues[0] = good;
        venues[1] = address(drainer);
        vm.startPrank(builder);
        uint256 agentId = identity.register();
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.UnknownAdapter.selector, address(drainer)));
        registry.enter(agentId, _envelope(venues), sessionKey, IERC20(address(token)));
        vm.stopPrank();
    }

    /// @dev The attack the check blocks, run against a registry that accepts any adapter.
    function test_withoutTheCheck_aDrainingAdapterEmptiesTheVaultWithNoFreeze() public {
        MockAdapterFactory permissive = new MockAdapterFactory();
        AgentRegistry open = new AgentRegistry(identity, makeAddr("guardian"), _assets(), permissive);
        DrainingAdapter drainer = new DrainingAdapter(attacker);
        permissive.allow(address(drainer));

        vm.startPrank(builder);
        uint256 agentId = identity.register();
        AgentVault vault =
            AgentVault(payable(open.enter(agentId, _envelope(address(drainer)), sessionKey, IERC20(address(token)))));
        vm.stopPrank();
        _deposit(vault, alice, 500e6);

        for (uint256 i; i < 5; ++i) {
            vm.prank(sessionKey);
            vault.execute(address(drainer), abi.encode(CAP));
        }
        assertEq(token.balanceOf(attacker), 500e6, "the adapter took every deposit");
        assertEq(token.balanceOf(address(vault)), 0);
        assertEq(vault.nav(), 500e6, "NAV still reads 500");
        assertFalse(vault.frozen(), "and the vault never froze");
    }

    // ------------------------------------------------------------------ binding

    function test_enter_bindsTheFactoryAdapterToTheNewVault() public {
        address adapter = factory.deployPerpl();
        assertTrue(factory.isCanonical(adapter));
        assertEq(address(PerplAdapter(adapter).exchange()), address(ex));
        assertEq(address(PerplAdapter(adapter).collateral()), address(token));
        assertEq(VaultBoundAdapter(adapter).binder(), address(factory));
        assertEq(VaultBoundAdapter(adapter).vault(), address(0));

        vm.startPrank(builder);
        uint256 agentId = identity.register();
        address expected = _nextVault();
        vm.expectEmit(adapter);
        emit VaultBoundAdapter.Bound(expected, address(factory));
        address vault = registry.enter(agentId, _envelope(adapter), sessionKey, IERC20(address(token)));
        vm.stopPrank();

        assertEq(vault, expected);
        assertEq(VaultBoundAdapter(adapter).vault(), vault);
        assertTrue(AgentVault(payable(vault)).isVenueAllowed(adapter));
    }

    function test_enter_rejectsAnAdapterAnotherVaultAlreadyUses() public {
        address adapter = factory.deployPerpl();
        vm.startPrank(builder);
        address first = registry.enter(identity.register(), _envelope(adapter), sessionKey, IERC20(address(token)));
        uint256 second = identity.register();
        vm.expectRevert(abi.encodeWithSelector(VaultBoundAdapter.AlreadyBound.selector, first));
        registry.enter(second, _envelope(adapter), sessionKey, IERC20(address(token)));
        vm.stopPrank();
    }

    function test_bind_onlyTheRegistry() public {
        address adapter = factory.deployPerpl();
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(AdapterFactory.NotRegistry.selector, attacker));
        factory.bind(adapter, attacker);
    }

    function test_bind_onlyCanonicalAdapters() public {
        DrainingAdapter drainer = new DrainingAdapter(attacker);
        vm.prank(address(registry));
        vm.expectRevert(abi.encodeWithSelector(AdapterFactory.NotCanonical.selector, address(drainer)));
        factory.bind(address(drainer), address(1));
    }

    // ------------------------------------------------------------------ factory setup

    function test_setRegistry_onceAndOnlyByTheDeployer() public {
        AdapterFactory f = new AdapterFactory(
            IPerplExchange(address(ex)),
            IERC20(address(token)),
            IKuruOrderBook(address(0)),
            IERC20(address(0)),
            IPerplExchange(address(0)),
            0,
            0
        );
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(AdapterFactory.NotDeployer.selector, attacker));
        f.setRegistry(attacker);

        f.setRegistry(address(registry));
        vm.expectRevert(abi.encodeWithSelector(AdapterFactory.RegistryAlreadySet.selector, address(registry)));
        f.setRegistry(attacker);
    }

    function test_deploy_emitsAndRecords() public {
        vm.recordLogs();
        vm.prank(builder);
        address adapter = factory.deployPerpl();
        assertTrue(factory.isCanonical(adapter));
        // AdapterDeployed(adapter, Kind.Perpl, builder) is the last log.
        bytes32 sig = keccak256("AdapterDeployed(address,uint8,address)");
        VmLog[] memory logs = _logs();
        assertEq(logs[logs.length - 1].topic0, sig);
        assertEq(logs[logs.length - 1].topic1, bytes32(uint256(uint160(adapter))));
    }

    function test_deployKuru_revertsWhereKuruIsNotConfigured() public {
        vm.expectRevert(AdapterFactory.VenueNotConfigured.selector);
        factory.deployKuru();
    }

    function test_registry_needsAFactory() public {
        vm.expectRevert(IAgentRegistry.InvalidEnvelope.selector);
        new AgentRegistry(identity, makeAddr("guardian"), _assets(), IAdapterFactory(address(0)));
    }

    // ------------------------------------------------------------------ helpers

    struct VmLog {
        bytes32 topic0;
        bytes32 topic1;
    }

    function _logs() internal returns (VmLog[] memory out) {
        Vm.Log[] memory raw = vm.getRecordedLogs();
        out = new VmLog[](raw.length);
        for (uint256 i; i < raw.length; ++i) {
            out[i] = VmLog(raw[i].topics[0], raw[i].topics.length > 1 ? raw[i].topics[1] : bytes32(0));
        }
    }

    /// @dev The vault enter() is about to create: the registry's next CREATE address.
    function _nextVault() internal view returns (address) {
        return vm.computeCreateAddress(address(registry), vm.getNonce(address(registry)));
    }

    function _exchange() internal returns (SimPerplExchange e) {
        MockPerplPriceSource source = new MockPerplPriceSource();
        source.list(MON, "MON", 5, 0, 2766);
        e = new SimPerplExchange(token, IPerplExchange(address(source)), 10e6, 50, owner);
        vm.startPrank(owner);
        e.listPerp(MON, 300);
        token.setMinter(address(e), true);
        vm.stopPrank();
    }

    function _assets() internal view returns (IERC20[] memory a) {
        a = new IERC20[](1);
        a[0] = IERC20(address(token));
    }

    function _envelope(address venue) internal pure returns (RiskEnvelope memory) {
        address[] memory venues = new address[](1);
        venues[0] = venue;
        return _envelope(venues);
    }

    function _envelope(address[] memory venues) internal pure returns (RiskEnvelope memory) {
        return
            RiskEnvelope({maxTradeNotional: CAP, dailyLossCapBps: 1_000, depositCapPerBacker: 10_000e6, venues: venues});
    }

    function _deposit(AgentVault vault, address backer, uint256 amount) internal {
        vm.startPrank(backer);
        token.faucet(backer, amount);
        token.approve(address(vault), amount);
        vault.deposit(amount, backer);
        vm.stopPrank();
    }
}
