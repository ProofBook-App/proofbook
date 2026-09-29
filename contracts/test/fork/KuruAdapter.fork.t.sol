// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentRegistry} from "../../src/AgentRegistry.sol";
import {AgentVault} from "../../src/AgentVault.sol";
import {KuruAdapter} from "../../src/adapters/KuruAdapter.sol";
import {VaultBoundAdapter} from "../../src/adapters/VaultBoundAdapter.sol";
import {IAgentVault} from "../../src/interfaces/IAgentVault.sol";
import {RiskEnvelope} from "../../src/interfaces/IAgentRegistry.sol";
import {IKuruOrderBook} from "../../src/interfaces/external/IKuruOrderBook.sol";
import {IPerplExchange} from "../../src/interfaces/external/IPerplExchange.sol";
import {MockIdentityRegistry} from "../mocks/MockIdentityRegistry.sol";

interface IKuruMarginAccount {
    function deposit(address user, address token, uint256 amount) external payable;
}

interface IKuruLimit {
    function addBuyOrder(uint32 price, uint96 size, bool postOnly) external;
}

/// @notice KuruAdapter against the live Kuru MON-USDC book, real USDC and Perpl's MON oracle on a
/// Monad mainnet fork. Local simulation only: nothing is broadcast.
/// Run: forge test --match-path 'test/fork/*' (uses $MONAD_RPC_URL, else the public RPC).
contract KuruAdapterForkTest is Test {
    IKuruOrderBook constant MON_USDC = IKuruOrderBook(0x065C9d28E428A0db40191a54d33d5b7c71a9C394);
    IKuruOrderBook constant MON_AUSD = IKuruOrderBook(0x131A2e70A5b31a517A74b8c567149bc294470Da9);
    IKuruMarginAccount constant MARGIN = IKuruMarginAccount(0x2A68ba1833cDf93fa9Da1EEbd7F46242aD8E90c5);
    IPerplExchange constant PERPL = IPerplExchange(0x34B6552d57a35a1D042CcAe1951BD1C370112a6F);
    IERC20 constant USDC = IERC20(0x754704Bc059F8C67012fEd69BC8A327a5aafb603);
    IERC20 constant AUSD = IERC20(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a);
    uint256 constant MON_PERP = 10;

    uint8 constant BUY = 0; // KuruAdapter action ids
    uint8 constant SELL = 1;
    uint256 constant MAX_TRADE = 300e6;

    address builder = makeAddr("builder");
    address sessionKey = makeAddr("sessionKey");
    address guardian = makeAddr("guardian");
    address alice = makeAddr("alice");
    address attacker = makeAddr("attacker");

    AgentVault vault;
    KuruAdapter adapter;

    function setUp() public {
        vm.createSelectFork(vm.envOr("MONAD_RPC_URL", string("https://rpc.monad.xyz")));

        MockIdentityRegistry identity = new MockIdentityRegistry();
        IERC20[] memory assets = new IERC20[](1);
        assets[0] = USDC;
        AgentRegistry registry = new AgentRegistry(identity, guardian, assets);

        vm.startPrank(builder);
        adapter = new KuruAdapter(MON_USDC, USDC, PERPL, MON_PERP);
        address[] memory venues = new address[](1);
        venues[0] = address(adapter);
        uint256 agentId = identity.register();
        vault = AgentVault(
            payable(registry.enter(
                    agentId,
                    RiskEnvelope({
                        maxTradeNotional: MAX_TRADE,
                        dailyLossCapBps: 1_000,
                        depositCapPerBacker: 10_000e6,
                        venues: venues
                    }),
                    sessionKey,
                    USDC
                ))
        );
        adapter.bind(address(vault));
        vm.stopPrank();

        deal(address(USDC), alice, 1_000e6);
        vm.startPrank(alice);
        USDC.approve(address(vault), type(uint256).max);
        vault.deposit(1_000e6, alice);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ helpers

    function _buy(uint256 quoteAmount) internal {
        vm.prank(sessionKey);
        vault.execute(address(adapter), abi.encode(BUY, abi.encode(quoteAmount, uint256(0))));
    }

    function _sell(uint256 baseAmount) internal {
        vm.prank(sessionKey);
        vault.execute(address(adapter), abi.encode(SELL, abi.encode(baseAmount, uint256(0))));
    }

    /// Held MON rounded down to Kuru's size precision (1e10 per MON, so 1e8 wei steps).
    function _sellable() internal view returns (uint256) {
        return address(adapter).balance / 1e8 * 1e8;
    }

    function _ref() internal view returns (uint256) {
        IPerplExchange.PerpetualInfo memory p = PERPL.getPerpetualInfo(MON_PERP);
        return p.oraclePNS * 1e18 / 10 ** p.priceDecimals;
    }

    /// Replace Perpl's MON oracle with `oraclePNS` (6 dp) at the current time.
    function _mockReference(uint256 oraclePNS, uint256 timestamp) internal {
        IPerplExchange.PerpetualInfo memory p = PERPL.getPerpetualInfo(MON_PERP);
        p.oraclePNS = oraclePNS;
        p.oracleTimestampSec = timestamp;
        p.markPNS = oraclePNS;
        p.markTimestamp = timestamp;
        vm.mockCall(address(PERPL), abi.encodeCall(IPerplExchange.getPerpetualInfo, (MON_PERP)), abi.encode(p));
    }

    // ------------------------------------------------------------------ setup & access

    function test_constructor_rejectsWrongQuote() public {
        vm.expectRevert(abi.encodeWithSelector(KuruAdapter.UnsupportedMarket.selector, address(MON_USDC)));
        new KuruAdapter(MON_USDC, AUSD, PERPL, MON_PERP);
        // MON-AUSD is a supported shape (native base, AUSD quote), just illiquid today.
        new KuruAdapter(MON_AUSD, AUSD, PERPL, MON_PERP);
    }

    function test_onlyVaultCanExecute() public {
        bytes memory data = abi.encode(BUY, abi.encode(uint256(1e6), uint256(0)));
        vm.prank(sessionKey);
        vm.expectRevert(abi.encodeWithSelector(VaultBoundAdapter.NotVault.selector, sessionKey));
        adapter.execute(data);
    }

    function test_actionIdsMatchAdapter() public view {
        assertEq(adapter.BUY(), BUY);
        assertEq(adapter.SELL(), SELL);
    }

    // ------------------------------------------------------------------ round trip

    function test_roundTrip_buySellRedeem() public {
        uint256 nav0 = vault.nav();
        _buy(250e6);
        uint256 mon = address(adapter).balance;
        assertGt(mon, 0, "MON held by adapter");
        assertEq(USDC.balanceOf(address(vault)), 750e6);
        assertEq(USDC.balanceOf(address(adapter)), 0);
        assertEq(USDC.allowance(address(vault), address(adapter)), 0, "no standing vault approval");
        assertEq(USDC.allowance(address(adapter), address(MON_USDC)), 0, "no standing market approval");
        assertEq(adapter.exposure(address(vault)), mon * adapter.markPrice() / 1e30);
        assertApproxEqRel(vault.nav(), nav0, 0.01e18, "NAV within spread + band");

        _sell(_sellable());
        assertLt(address(adapter).balance, 1e8, "only sub-precision dust left");
        assertApproxEqRel(USDC.balanceOf(address(vault)), nav0, 0.01e18);

        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 out = vault.redeem(shares, alice, alice);
        assertApproxEqRel(out, 1_000e6, 0.01e18);
    }

    // ------------------------------------------------------------------ notional (invariant 2)

    function test_buyAboveCapReverts() public {
        bytes memory data = abi.encode(BUY, abi.encode(MAX_TRADE + 1, uint256(0)));
        vm.prank(sessionKey);
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.TradeTooLarge.selector, MAX_TRADE + 1, MAX_TRADE));
        vault.execute(address(adapter), data);
    }

    function test_sellNotionalUsesHigherOfBidAndReference() public view {
        (uint256 bid,) = MON_USDC.bestBidAsk();
        uint256 price = bid > _ref() ? bid : _ref();
        bytes memory data = abi.encode(SELL, abi.encode(uint256(1_000 ether), uint256(0)));
        assertApproxEqAbs(adapter.quoteNotional(data), 1_000 * price / 1e12, 1);
    }

    // ------------------------------------------------------------------ manipulation

    /// A best bid far above the market must not raise NAV. A real bid above the ask would cross
    /// and fill (Kuru takes it as a buy), so the book's view is mocked to isolate the clamp.
    function test_spoofedHighBidDoesNotRaiseNav() public {
        _buy(250e6);
        uint256 navBefore = vault.nav();
        (, uint256 ask) = MON_USDC.bestBidAsk();
        vm.mockCall(
            address(MON_USDC), abi.encodeCall(IKuruOrderBook.bestBidAsk, ()), abi.encode(uint256(1e18), ask + 1e18)
        ); // bid $1.00, ~37x market

        assertEq(adapter.markPrice(), _ref(), "mark capped at reference");
        assertLe(vault.nav(), navBefore * 10_100 / 10_000, "NAV not inflated");
    }

    /// Placing a limit bid far above the market fills against the asks instead of resting,
    /// so the top of book cannot be spoofed without buying the whole ask side.
    function test_highLimitBidCrossesInsteadOfResting() public {
        deal(address(USDC), attacker, 1_000e6);
        vm.startPrank(attacker);
        USDC.approve(address(MARGIN), type(uint256).max);
        MARGIN.deposit(attacker, address(USDC), 1_000e6);
        IKuruLimit(address(MON_USDC)).addBuyOrder(100_000_000, 2e12, false); // 200 MON at $1.00
        vm.stopPrank();
        (uint256 bid,) = MON_USDC.bestBidAsk();
        assertLt(bid, _ref() * 11 / 10, "top bid stays near market");
    }

    /// Dumping the book (manipulated mid/bid) moves NAV by at most the band, so it cannot trip
    /// the 10% daily-loss freeze on its own (spec: test freezing under a manipulated mid).
    function test_dumpedBookMovesNavAtMostBand() public {
        _buy(MAX_TRADE);
        _buy(MAX_TRADE);
        _buy(MAX_TRADE); // ~90% of the vault in MON
        uint256 navBefore = vault.nav();

        vm.deal(attacker, 50_000_000 ether);
        vm.prank(attacker);
        MON_USDC.placeAndExecuteMarketSell{value: 20_000_000 ether}(uint96(20_000_000 * 1e10), 0, false, false);
        (uint256 bid,) = MON_USDC.bestBidAsk();
        assertTrue(bid == type(uint256).max || bid < _ref() * 90 / 100, "bid side emptied or crashed >10%");

        uint256 navAfter = vault.nav();
        assertGe(navAfter * 10_000, navBefore * (10_000 - 310), "NAV drop bounded by band");
        _buy(1e6); // next execute observes the NAV (bids are gone, so a sell could not fill)
        assertFalse(vault.frozen(), "manipulated bid alone does not freeze");
    }

    /// A real price drop (reference moves) is a real loss and freezes the vault in the same tx.
    function test_referenceDropPastCapFreezes() public {
        _buy(MAX_TRADE);
        _buy(MAX_TRADE);
        _buy(MAX_TRADE);
        IPerplExchange.PerpetualInfo memory p = PERPL.getPerpetualInfo(MON_PERP);
        _mockReference(p.oraclePNS * 80 / 100, block.timestamp); // MON -20%: ~18% vault loss

        vm.expectEmit(address(vault));
        emit IAgentVault.Frozen(address(vault));
        _sell(1 ether);
        assertTrue(vault.frozen());
    }

    // ------------------------------------------------------------------ price band

    /// If the market is >3% above the reference, a buy overpays and reverts.
    function test_buyOutsideBandReverts() public {
        IPerplExchange.PerpetualInfo memory p = PERPL.getPerpetualInfo(MON_PERP);
        _mockReference(p.oraclePNS * 90 / 100, block.timestamp);
        bytes memory data = abi.encode(BUY, abi.encode(uint256(100e6), uint256(0)));
        vm.prank(sessionKey);
        vm.expectPartialRevert(KuruAdapter.PriceOutsideBand.selector);
        vault.execute(address(adapter), data);
    }

    /// If the market is >3% below the reference, a sell dumps and reverts.
    function test_sellOutsideBandReverts() public {
        _buy(100e6);
        IPerplExchange.PerpetualInfo memory p = PERPL.getPerpetualInfo(MON_PERP);
        _mockReference(p.oraclePNS * 110 / 100, block.timestamp);
        bytes memory data = abi.encode(SELL, abi.encode(_sellable(), uint256(0)));
        vm.prank(sessionKey);
        vm.expectPartialRevert(KuruAdapter.PriceOutsideBand.selector);
        vault.execute(address(adapter), data);
    }

    /// No fresh reference: trades revert, NAV still reads (MON at 0) and idle stays withdrawable.
    function test_staleReference_tradesRevertNavReads() public {
        _buy(100e6);
        IPerplExchange.PerpetualInfo memory p = PERPL.getPerpetualInfo(MON_PERP);
        _mockReference(p.oraclePNS, block.timestamp - 1 hours);

        assertEq(adapter.markPrice(), 0);
        assertEq(vault.nav(), 900e6, "MON counted at 0");
        bytes memory data = abi.encode(SELL, abi.encode(_sellable(), uint256(0)));
        vm.prank(sessionKey);
        vm.expectRevert(KuruAdapter.NoReferencePrice.selector);
        vault.execute(address(adapter), data);

        uint256 max = vault.maxWithdraw(alice);
        assertEq(max, 900e6);
        vm.prank(alice);
        vault.withdraw(max, alice, alice);
    }

    // ------------------------------------------------------------------ frozen-vault exit

    function test_unwind_onlyWhenFrozen_paysBackersOut() public {
        _buy(250e6);
        uint256 amount = _sellable();

        vm.prank(attacker);
        vm.expectRevert(VaultBoundAdapter.VaultNotFrozen.selector);
        adapter.unwind(amount);

        vm.prank(guardian);
        vault.freeze();
        vm.prank(attacker);
        adapter.unwind(amount);
        assertEq(USDC.balanceOf(attacker), 0);
        assertApproxEqRel(USDC.balanceOf(address(vault)), 1_000e6, 0.01e18);

        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(shares, alice, alice);
        assertApproxEqRel(USDC.balanceOf(alice), 1_000e6, 0.01e18, "frozen vault exits in full");
    }
}
