// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentRegistry} from "../../src/AgentRegistry.sol";
import {AgentVault} from "../../src/AgentVault.sol";
import {KuruAdapter} from "../../src/adapters/KuruAdapter.sol";
import {RiskEnvelope} from "../../src/interfaces/IAgentRegistry.sol";
import {IKuruOrderBook} from "../../src/interfaces/external/IKuruOrderBook.sol";
import {IPerplExchange} from "../../src/interfaces/external/IPerplExchange.sol";
import {SimKuruOrderBook} from "../../src/sim/SimKuruOrderBook.sol";
import {SimToken} from "../../src/sim/SimToken.sol";
import {MockIdentityRegistry} from "../mocks/MockIdentityRegistry.sol";
import {MockPerplPriceSource} from "../mocks/MockPerplPriceSource.sol";

/// @notice SimKuruOrderBook on its own (no fork, runs in CI), plus the production KuruAdapter and
/// AgentVault trading it. Fork parity with the real MON-USDC market is in test/fork/SimParity.fork.t.sol.
contract SimKuruOrderBookTest is Test {
    uint256 constant MON = 10; // mainnet MON perp: price dp 6
    uint8 constant BUY = 0; // KuruAdapter action ids
    uint8 constant SELL = 1;

    address owner = makeAddr("owner");
    address trader = makeAddr("trader");

    SimToken usdc;
    MockPerplPriceSource source;
    SimKuruOrderBook book;

    function setUp() public {
        usdc = new SimToken("Proofbook Sim USDC (testnet, no value)", "simUSDC", 6, owner);
        source = new MockPerplPriceSource();
        source.list(MON, "MON", 6, 0, 27_596); // $0.027596
        book = new SimKuruOrderBook(usdc, IPerplExchange(address(source)), MON, 65, owner);
        vm.prank(owner);
        usdc.setMinter(address(book), true);
        vm.deal(address(book), 100_000 ether);
        usdc.faucet(trader, 1_000e6);
        vm.deal(trader, 10_000 ether);
        vm.prank(trader);
        usdc.approve(address(book), type(uint256).max);
    }

    function test_marketParams_matchRealMonUsdc() public view {
        (
            uint32 pp,
            uint96 sp,
            address base,
            uint256 bd,
            address q,
            uint256 qd,
            uint32 tick,
            uint96 minS,
            uint96 maxS,
            uint256 tf,
            uint256 mf
        ) = book.getMarketParams();
        // Real MON-USDC 0x065C…C394 on 2026-09-29.
        assertEq(pp, 1e8);
        assertEq(sp, 1e10);
        assertEq(base, address(0));
        assertEq(bd, 18);
        assertEq(q, address(usdc));
        assertEq(qd, 6);
        assertEq(tick, 100);
        assertEq(minS, 2e12);
        assertEq(maxS, 2e18);
        assertEq(tf, 0);
        assertEq(mf, 0);
    }

    function test_bestBidAsk_aroundMark_onTickGrid() public {
        (uint256 bid, uint256 ask) = book.bestBidAsk();
        assertEq(bid, 0.027578e18); // floor(0.027596 x 0.99935) to 1e-6
        assertEq(ask, 0.027614e18); // ceil (0.027596 x 1.00065)
        vm.deal(address(book), 0);
        (, ask) = book.bestBidAsk();
        assertEq(ask, 0, "no inventory, no ask");
        source.setMark(MON, 0);
        (bid, ask) = book.bestBidAsk();
        assertEq(bid, type(uint256).max, "no price, empty book");
        assertEq(ask, 0);
    }

    function test_buyAndSell_likeRealMarket() public {
        uint256 monBefore = trader.balance;
        vm.prank(trader);
        uint256 out = book.placeAndExecuteMarketBuy(10e8, 0, false, true); // $10
        assertEq(out, trader.balance - monBefore);
        assertEq(out % 1e8, 0, "rounded to size precision");
        assertEq(usdc.balanceOf(trader), 990e6, "spends exactly the quote size");
        assertEq(out, uint256(10e6) * 1e30 / 0.027614e18 / 1e8 * 1e8, "floor at the ask");

        vm.prank(trader);
        uint256 got = book.placeAndExecuteMarketSell{value: 100 ether}(100e10, 0, false, true);
        assertEq(got, 2_757_800, "100 MON at 0.027578");
        assertEq(usdc.balanceOf(trader), 990e6 + 2_757_800);
    }

    function test_errors_matchRealSelectors() public {
        vm.startPrank(trader);
        vm.expectRevert(SimKuruOrderBook.SlippageExceeded.selector);
        book.placeAndExecuteMarketBuy(10e8, type(uint256).max, false, true);
        vm.expectRevert(SimKuruOrderBook.NativeAssetInsufficient.selector);
        book.placeAndExecuteMarketSell{value: 99 ether}(100e10, 0, false, true);
        vm.expectRevert(SimKuruOrderBook.NativeAssetSurplus.selector);
        book.placeAndExecuteMarketSell{value: 101 ether}(100e10, 0, false, true);
        vm.expectRevert(SimKuruOrderBook.InsufficientBalance.selector);
        book.placeAndExecuteMarketBuy(10e8, 0, true, true);
        vm.expectRevert(SimKuruOrderBook.NativeAssetNotRequired.selector);
        book.placeAndExecuteMarketBuy{value: 1 ether}(10e8, 0, false, true);
        vm.deal(address(book), 10 ether);
        vm.expectRevert(SimKuruOrderBook.InsufficientLiquidity.selector);
        book.placeAndExecuteMarketBuy(10e8, 0, false, true); // FOK wants ~362 MON, book holds 10
        vm.stopPrank();

        // Decoded from mainnet reverts with `cast 4byte`.
        assertEq(SimKuruOrderBook.SlippageExceeded.selector, bytes4(0x8199f5f3));
        assertEq(SimKuruOrderBook.NativeAssetInsufficient.selector, bytes4(0xfd993161));
        assertEq(SimKuruOrderBook.NativeAssetSurplus.selector, bytes4(0x48223ccc));
        assertEq(SimKuruOrderBook.InsufficientBalance.selector, bytes4(0xf4d678b8));
        assertEq(SimKuruOrderBook.NativeAssetNotRequired.selector, bytes4(0xead59376));
        assertEq(SimKuruOrderBook.InsufficientLiquidity.selector, bytes4(0xbb55fd27));
    }

    function test_iocBuy_partialWhenInventoryShort() public {
        vm.deal(address(book), 1_000 ether);
        vm.prank(trader);
        uint256 out = book.placeAndExecuteMarketBuy(100e8, 0, false, false); // $100 wants ~3.6k MON
        assertEq(out, 1_000 ether);
        assertApproxEqAbs(usdc.balanceOf(trader), 1_000e6 - 27.614e6, 1);
    }

    function test_kuruAdapterAndVault_roundTrip() public {
        address sessionKey = makeAddr("sessionKey");
        address alice = makeAddr("alice");
        MockIdentityRegistry identity = new MockIdentityRegistry();
        IERC20[] memory assets = new IERC20[](1);
        assets[0] = IERC20(address(usdc));
        AgentRegistry registry = new AgentRegistry(identity, makeAddr("guardian"), assets);
        // The Kuru adapter's reference is the Perpl MON perp; here the mock source stands in for it.
        KuruAdapter adapter = new KuruAdapter(book, IERC20(address(usdc)), IPerplExchange(address(source)), MON);
        address[] memory venues = new address[](1);
        venues[0] = address(adapter);
        AgentVault vault = AgentVault(
            payable(registry.enter(
                    identity.register(),
                    RiskEnvelope({
                        maxTradeNotional: 300e6, dailyLossCapBps: 1_000, depositCapPerBacker: 10_000e6, venues: venues
                    }),
                    sessionKey,
                    IERC20(address(usdc))
                ))
        );
        adapter.bind(address(vault));

        vm.startPrank(alice);
        usdc.faucet(alice, 1_000e6);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(1_000e6, alice);
        vm.stopPrank();

        vm.prank(sessionKey);
        vault.execute(address(adapter), abi.encode(BUY, abi.encode(uint256(200e6), uint256(0))));
        assertGt(address(adapter).balance, 7_000 ether);
        assertApproxEqRel(vault.nav(), 1_000e6, 0.002e18, "valued at the bid, within the spread");

        source.setMark(MON, 30_356); // +10%
        assertApproxEqRel(vault.nav(), 1_020e6, 0.003e18);
        uint256 held = address(adapter).balance / 1e8 * 1e8;
        vm.prank(sessionKey);
        vault.execute(address(adapter), abi.encode(SELL, abi.encode(held, uint256(0))));
        assertEq(adapter.exposure(address(vault)), 0);
        assertGt(usdc.balanceOf(address(vault)), 1_018e6);
    }
}
