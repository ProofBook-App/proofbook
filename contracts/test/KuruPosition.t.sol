// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AdapterFactory} from "../src/AdapterFactory.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {KuruAdapter} from "../src/adapters/KuruAdapter.sol";
import {RiskEnvelope} from "../src/interfaces/IAgentRegistry.sol";
import {IKuruOrderBook} from "../src/interfaces/external/IKuruOrderBook.sol";
import {IPerplExchange} from "../src/interfaces/external/IPerplExchange.sol";
import {SimKuruOrderBook} from "../src/sim/SimKuruOrderBook.sol";
import {SimToken} from "../src/sim/SimToken.sol";
import {MockIdentityRegistry} from "./mocks/MockIdentityRegistry.sol";
import {MockPerplPriceSource} from "./mocks/MockPerplPriceSource.sol";

/// @notice M4 (docs/security-review.md): held MON is valued at the top of the Kuru book whatever its
/// size, which overstates a position the book can't absorb. KuruAdapter caps held MON (`maxHeld`,
/// quote units at the reference) so a BUY can't build one. Runs against SimKuruOrderBook, no fork.
contract KuruPositionTest is Test {
    uint256 constant MON = 10; // reference perp, price dp 6
    uint256 constant PRICE = 27_596; // $0.027596
    uint256 constant MAX_HELD = 500e6;
    uint8 constant BUY = 0;
    uint8 constant SELL = 1;

    address owner = makeAddr("owner");
    address sessionKey = makeAddr("sessionKey");
    address alice = makeAddr("alice");

    SimToken usdc;
    MockPerplPriceSource source;
    SimKuruOrderBook book;
    AdapterFactory factory;
    AgentRegistry registry;
    MockIdentityRegistry identity;
    AgentVault vault;
    KuruAdapter adapter;

    function setUp() public {
        usdc = new SimToken("Proofbook Sim USDC (testnet, no value)", "simUSDC", 6, owner);
        source = new MockPerplPriceSource();
        source.list(MON, "MON", 6, 0, PRICE);
        book = new SimKuruOrderBook(usdc, IPerplExchange(address(source)), MON, 65, owner);
        vm.prank(owner);
        usdc.setMinter(address(book), true);
        vm.deal(address(book), 1_000_000 ether);

        identity = new MockIdentityRegistry();
        IERC20[] memory assets = new IERC20[](1);
        assets[0] = IERC20(address(usdc));
        factory = new AdapterFactory(
            IPerplExchange(address(0)),
            IERC20(address(0)),
            book,
            IERC20(address(usdc)),
            IPerplExchange(address(source)),
            MON,
            MAX_HELD
        );
        registry = new AgentRegistry(identity, makeAddr("guardian"), assets, factory);
        factory.setRegistry(address(registry));

        adapter = KuruAdapter(payable(factory.deployKuru()));
        address[] memory venues = new address[](1);
        venues[0] = address(adapter);
        vault = AgentVault(
            payable(registry.enter(
                    identity.register(),
                    RiskEnvelope({
                        maxTradeNotional: 300e6, dailyLossCapBps: 1_000, depositCapPerBacker: 10_000e6, venues: venues
                    }),
                    sessionKey,
                    IERC20(address(usdc))
                ))
        );

        vm.startPrank(alice);
        usdc.faucet(alice, 2_000e6);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(2_000e6, alice);
        vm.stopPrank();
    }

    function _buy(uint256 quoteAmount) internal {
        vm.prank(sessionKey);
        vault.execute(address(adapter), abi.encode(BUY, abi.encode(quoteAmount, uint256(0))));
    }

    function _sell(uint256 baseAmount) internal {
        vm.prank(sessionKey);
        vault.execute(address(adapter), abi.encode(SELL, abi.encode(baseAmount, uint256(0))));
    }

    // ------------------------------------------------------------------ the cap

    function test_M4_theFactorySetsTheCap() public view {
        assertEq(factory.kuruMaxHeld(), MAX_HELD);
        assertEq(adapter.maxHeld(), MAX_HELD);
    }

    function test_M4_aBuyThatWouldPassTheCapReverts() public {
        _buy(300e6);
        _buy(150e6); // about 449.7 held at the reference (bought at the ask, 0.065% above)
        uint256 idle = usdc.balanceOf(address(vault));
        uint256 mon = address(adapter).balance;

        vm.prank(sessionKey);
        vm.expectPartialRevert(KuruAdapter.PositionTooLarge.selector);
        vault.execute(address(adapter), abi.encode(BUY, abi.encode(uint256(100e6), uint256(0))));
        assertEq(usdc.balanceOf(address(vault)), idle, "nothing spent");
        assertEq(address(adapter).balance, mon, "nothing bought");

        _buy(50e6); // to about 499.7: still under
        assertLe(_heldValueAt(PRICE), MAX_HELD);
    }

    function test_M4_sellingMakesRoomAgain() public {
        _buy(300e6);
        _buy(150e6);
        _sell(address(adapter).balance / 2 / 1e8 * 1e8);
        _buy(200e6); // about 425 held
        assertLe(_heldValueAt(PRICE), MAX_HELD);
    }

    /// A price rise can carry the position past the cap. That blocks more buying, not selling, and
    /// the position is still valued normally.
    function test_M4_aPriceRisePastTheCapBlocksBuysOnly() public {
        _buy(300e6);
        _buy(150e6);
        source.setMark(MON, PRICE * 120 / 100); // +20%: about 540 held
        assertGt(_heldValueAt(PRICE * 120 / 100), MAX_HELD);
        assertGt(vault.nav(), 2_080e6, "the gain counts");

        vm.prank(sessionKey);
        vm.expectPartialRevert(KuruAdapter.PositionTooLarge.selector);
        vault.execute(address(adapter), abi.encode(BUY, abi.encode(uint256(1e6), uint256(0))));

        _sell(address(adapter).balance / 2 / 1e8 * 1e8); // two sells: each is under maxTradeNotional
        _sell(address(adapter).balance / 1e8 * 1e8);
        assertLt(address(adapter).balance, 1e8, "sold out");
    }

    function test_M4_aZeroCapIsRejected() public {
        AdapterFactory f = new AdapterFactory(
            IPerplExchange(address(0)),
            IERC20(address(0)),
            book,
            IERC20(address(usdc)),
            IPerplExchange(address(source)),
            MON,
            0
        );
        vm.expectRevert(KuruAdapter.ZeroMaxHeld.selector);
        f.deployKuru();
    }

    /// Held MON at a 6-dp reference price, in USDC (6 dp).
    function _heldValueAt(uint256 pricePNS) internal view returns (uint256) {
        return address(adapter).balance * pricePNS / 1e18;
    }
}
