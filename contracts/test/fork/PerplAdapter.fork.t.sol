// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AdapterFactory} from "../../src/AdapterFactory.sol";
import {AgentRegistry} from "../../src/AgentRegistry.sol";
import {AgentVault} from "../../src/AgentVault.sol";
import {PerplAdapter} from "../../src/adapters/PerplAdapter.sol";
import {VaultBoundAdapter} from "../../src/adapters/VaultBoundAdapter.sol";
import {IAgentVault} from "../../src/interfaces/IAgentVault.sol";
import {RiskEnvelope} from "../../src/interfaces/IAgentRegistry.sol";
import {IKuruOrderBook} from "../../src/interfaces/external/IKuruOrderBook.sol";
import {IPerplExchange} from "../../src/interfaces/external/IPerplExchange.sol";
import {MockIdentityRegistry} from "../mocks/MockIdentityRegistry.sol";

/// @notice PerplAdapter against the live Perpl Exchange and real AUSD on a Monad mainnet fork.
/// Local simulation only: nothing is broadcast. Forks the latest block (no archive state).
/// Run: forge test --match-path 'test/fork/*' (uses $MONAD_RPC_URL, else the public RPC).
contract PerplAdapterForkTest is Test {
    IPerplExchange constant EX = IPerplExchange(0x34B6552d57a35a1D042CcAe1951BD1C370112a6F);
    IERC20 constant AUSD = IERC20(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a);

    uint256 constant BTC = 1; // price dp 1, lot dp 5
    uint256 constant MON = 10; // price dp 6, lot dp 0
    uint8 constant OPEN_LONG = 0;
    uint8 constant OPEN_SHORT = 1;
    uint8 constant CLOSE_LONG = 2;
    uint8 constant CLOSE_SHORT = 3;
    uint8 constant CANCEL = 4;
    uint8 constant DEPOSIT = 0; // PerplAdapter action ids
    uint8 constant WITHDRAW = 1;
    uint8 constant ORDER = 2;

    uint256 constant MAX_TRADE = 300e6;

    address builder = makeAddr("builder");
    address sessionKey = makeAddr("sessionKey");
    address guardian = makeAddr("guardian");
    address alice = makeAddr("alice");
    address attacker = makeAddr("attacker");

    AgentRegistry registry;
    AdapterFactory factory;
    AgentVault vault;
    PerplAdapter adapter;

    function setUp() public {
        vm.createSelectFork(vm.envOr("MONAD_RPC_URL", string("https://rpc.monad.xyz")));

        MockIdentityRegistry identity = new MockIdentityRegistry();
        IERC20[] memory assets = new IERC20[](1);
        assets[0] = AUSD;
        factory = new AdapterFactory(EX, AUSD, IKuruOrderBook(address(0)), IERC20(address(0)), EX, 10);
        registry = new AgentRegistry(identity, guardian, assets, factory);
        factory.setRegistry(address(registry));

        vm.startPrank(builder);
        adapter = PerplAdapter(factory.deployPerpl());
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
                    AUSD
                ))
        );
        vm.stopPrank();

        _dealAUSD(alice, 1_000e6);
        vm.startPrank(alice);
        AUSD.approve(address(vault), type(uint256).max);
        vault.deposit(1_000e6, alice);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ helpers

    /// AUSD packs {uint8 flags; uint248 balance} in one slot, so forge `deal` can't be used.
    function _dealAUSD(address to, uint256 amount) internal {
        vm.record();
        AUSD.balanceOf(to);
        (bytes32[] memory reads,) = vm.accesses(address(AUSD));
        bytes32 slot = reads[reads.length - 1];
        uint256 cur = uint256(vm.load(address(AUSD), slot));
        vm.store(address(AUSD), slot, bytes32((amount << 8) | (cur & 0xff)));
        assertEq(AUSD.balanceOf(to), amount, "deal layout");
    }

    function _order(uint256 perpId, uint8 t, uint256 orderId, uint256 pricePNS, uint256 lotLNS, bool postOnly, bool ioc)
        internal
        view
        returns (bytes memory)
    {
        IPerplExchange.OrderDesc memory d = IPerplExchange.OrderDesc({
            orderDescId: 0,
            perpId: perpId,
            orderType: t,
            orderId: orderId,
            pricePNS: pricePNS,
            lotLNS: lotLNS,
            expiryBlock: block.number + 1_000,
            postOnly: postOnly,
            fillOrKill: false,
            immediateOrCancel: ioc,
            maxMatches: 0,
            leverageHdths: 100,
            lastExecutionBlock: 0,
            amountCNS: 0,
            maxNegPnlCollatBPS: 300
        });
        return abi.encode(ORDER, abi.encode(d));
    }

    function _margin(uint8 action, uint256 amount) internal pure returns (bytes memory) {
        return abi.encode(action, abi.encode(amount));
    }

    function _exec(bytes memory data) internal {
        vm.prank(sessionKey);
        vault.execute(address(adapter), data);
    }

    function _book(uint256 perpId) internal view returns (uint256 bid, uint256 ask) {
        IPerplExchange.PerpetualInfo memory p = EX.getPerpetualInfo(perpId);
        bid = p.basePricePNS + p.maxBidPriceONS;
        ask = p.basePricePNS + p.minAskPriceONS;
    }

    // ------------------------------------------------------------------ binding & access

    function test_bind_isOneShotAndBinderOnly() public {
        // The factory is the binder of its adapters, and enter() already bound this one.
        assertEq(adapter.binder(), address(factory));
        assertEq(adapter.vault(), address(vault));
        vm.prank(address(factory));
        vm.expectRevert(abi.encodeWithSelector(VaultBoundAdapter.AlreadyBound.selector, address(vault)));
        adapter.bind(address(vault));
        vm.prank(builder);
        vm.expectRevert(abi.encodeWithSelector(VaultBoundAdapter.NotBinder.selector, builder));
        adapter.bind(address(vault));

        vm.prank(attacker);
        PerplAdapter other = new PerplAdapter(EX, AUSD);
        vm.prank(builder);
        vm.expectRevert(abi.encodeWithSelector(VaultBoundAdapter.NotBinder.selector, builder));
        other.bind(address(vault));

        // A vault that does not list the adapter cannot be bound.
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(VaultBoundAdapter.BadVault.selector, address(vault)));
        other.bind(address(vault));
    }

    function test_constructor_rejectsWrongCollateral() public {
        IERC20 usdc = IERC20(0x754704Bc059F8C67012fEd69BC8A327a5aafb603);
        vm.expectRevert(abi.encodeWithSelector(PerplAdapter.CollateralMismatch.selector, address(AUSD), address(usdc)));
        new PerplAdapter(EX, usdc);
    }

    function test_onlyVaultCanExecute() public {
        vm.prank(sessionKey);
        vm.expectRevert(abi.encodeWithSelector(VaultBoundAdapter.NotVault.selector, sessionKey));
        adapter.execute(_margin(DEPOSIT, 50e6));
    }

    function test_onlySessionKeyReachesAdapterThroughVault() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.NotSessionKey.selector, attacker));
        vault.execute(address(adapter), _margin(DEPOSIT, 50e6));
    }

    function test_exposureIsZeroForOtherVaults() public {
        _exec(_margin(DEPOSIT, 100e6));
        assertEq(adapter.exposure(address(vault)), 100e6);
        assertEq(adapter.exposure(attacker), 0);
    }

    // ------------------------------------------------------------------ notional (invariant 2)

    function test_actionIdsMatchAdapter() public view {
        assertEq(adapter.DEPOSIT(), DEPOSIT);
        assertEq(adapter.WITHDRAW(), WITHDRAW);
        assertEq(adapter.ORDER(), ORDER);
    }

    function test_quoteNotional_marginAndCancel() public view {
        assertEq(adapter.quoteNotional(_margin(DEPOSIT, 123e6)), 123e6);
        assertEq(adapter.quoteNotional(_margin(WITHDRAW, 123e6)), 0);
        assertEq(adapter.quoteNotional(_order(BTC, CANCEL, 7, 0, 0, false, false)), 0);
    }

    function test_quoteNotional_btcLotTimesPrice() public view {
        IPerplExchange.PerpetualInfo memory p = EX.getPerpetualInfo(BTC);
        uint256 price = p.markPNS * 102 / 100; // limit above mark (inside the band): limit is used
        // 100 lots = 0.001 BTC; price has 1 dp. notional (6 dp) = 100 * price * 1e6 / 1e6.
        assertEq(adapter.quoteNotional(_order(BTC, OPEN_LONG, 0, price, 100, false, true)), 100 * price);
    }

    /// Perpl fills a short at the book price whatever its limit, so the size is valued at the mark.
    function test_quoteNotional_shortBelowMarkCountsAtMark() public view {
        IPerplExchange.PerpetualInfo memory p = EX.getPerpetualInfo(MON);
        uint256 q = adapter.quoteNotional(_order(MON, OPEN_SHORT, 0, p.markPNS * 98 / 100, 1_000, false, true));
        assertEq(q, 1_000 * p.markPNS); // MON price 6 dp, lot 0 dp
    }

    function test_oversizedShortReverts() public {
        _exec(_margin(DEPOSIT, 200e6));
        IPerplExchange.PerpetualInfo memory p = EX.getPerpetualInfo(MON);
        uint256 lot = MAX_TRADE / p.markPNS + 1; // just over the cap at mark
        bytes memory data = _order(MON, OPEN_SHORT, 0, p.markPNS * 98 / 100, lot, false, true);
        uint256 q = adapter.quoteNotional(data);
        assertGt(q, MAX_TRADE);
        vm.prank(sessionKey);
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.TradeTooLarge.selector, q, MAX_TRADE));
        vault.execute(address(adapter), data);
    }

    /// Exposure values each perp the adapter has traded, capped at MAX_PERPS. execOrder is mocked
    /// so the test needs no liquidity on nine markets; the band and notional checks still run live.
    function test_tracksTradedPerpsUpToMax() public {
        _exec(_margin(DEPOSIT, 100e6));
        vm.mockCall(
            address(EX),
            abi.encodeWithSelector(IPerplExchange.execOrder.selector),
            abi.encode(IPerplExchange.OrderSignature(0, 0))
        );
        uint256[9] memory ids = [uint256(1), 10, 20, 31, 40, 50, 60, 70, 80];
        for (uint256 i; i < 8; ++i) {
            uint256 mark = EX.getPerpetualInfo(ids[i]).markPNS;
            _exec(_order(ids[i], OPEN_LONG, 0, mark, 1, true, false));
        }
        assertEq(adapter.perps().length, 8);
        assertTrue(adapter.isTrackedPerp(70));
        assertFalse(adapter.isTrackedPerp(80));

        uint256 m = EX.getPerpetualInfo(90).markPNS;
        bytes memory data = _order(90, OPEN_LONG, 0, m, 1, true, false);
        vm.prank(sessionKey);
        vm.expectRevert(abi.encodeWithSelector(PerplAdapter.TooManyPerps.selector, uint256(90)));
        vault.execute(address(adapter), data);

        _exec(_order(1, OPEN_LONG, 0, EX.getPerpetualInfo(1).markPNS, 1, true, false)); // tracked perp still fine
    }

    // ------------------------------------------------------------------ price band

    /// Buys (OpenLong, CloseShort) may not bid more than 3% over mark; sells (OpenShort, CloseLong)
    /// may not offer more than 3% under it. Cancels are unaffected.
    function test_priceBand_offMarketLimitsRevert() public {
        uint256 mark = EX.getPerpetualInfo(MON).markPNS;
        uint256 hi = mark * 104 / 100;
        uint256 lo = mark * 96 / 100;
        uint8[2] memory buys = [OPEN_LONG, CLOSE_SHORT];
        uint8[2] memory sells = [OPEN_SHORT, CLOSE_LONG];
        for (uint256 i; i < 2; ++i) {
            vm.expectRevert(abi.encodeWithSelector(PerplAdapter.PriceOutsideBand.selector, hi, mark));
            adapter.quoteNotional(_order(MON, buys[i], 0, hi, 100, false, true));
            vm.expectRevert(abi.encodeWithSelector(PerplAdapter.PriceOutsideBand.selector, lo, mark));
            adapter.quoteNotional(_order(MON, sells[i], 0, lo, 100, false, true));
            vm.expectRevert(abi.encodeWithSelector(PerplAdapter.PriceOutsideBand.selector, 1, mark));
            adapter.quoteNotional(_order(MON, sells[i], 0, 1, 100, false, true)); // "market" sell
        }
        // Inside the band on the protective side is fine.
        adapter.quoteNotional(_order(MON, OPEN_LONG, 0, mark * 102 / 100, 100, false, true));
        adapter.quoteNotional(_order(MON, OPEN_SHORT, 0, mark * 98 / 100, 100, false, true));
    }

    function test_priceBand_blocksExecuteThroughVault() public {
        _exec(_margin(DEPOSIT, 100e6));
        uint256 mark = EX.getPerpetualInfo(BTC).markPNS;
        bytes memory data = _order(BTC, OPEN_LONG, 0, mark * 2, 10, false, true);
        vm.prank(sessionKey);
        vm.expectRevert(abi.encodeWithSelector(PerplAdapter.PriceOutsideBand.selector, mark * 2, mark));
        vault.execute(address(adapter), data);
    }

    function test_depositAboveCapReverts() public {
        vm.prank(sessionKey);
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.TradeTooLarge.selector, MAX_TRADE + 1, MAX_TRADE));
        vault.execute(address(adapter), _margin(DEPOSIT, MAX_TRADE + 1));
    }

    function test_disallowedOrderTypesRevert() public {
        _exec(_margin(DEPOSIT, 100e6));
        for (uint8 t = 5; t <= 6; ++t) {
            bytes memory data = _order(BTC, t, 0, 1, 1, false, false);
            vm.expectRevert(abi.encodeWithSelector(PerplAdapter.OrderTypeNotAllowed.selector, t));
            adapter.quoteNotional(data);
        }
        vm.expectRevert(abi.encodeWithSelector(PerplAdapter.UnknownAction.selector, uint8(9)));
        adapter.quoteNotional(_margin(9, 1));
    }

    // ------------------------------------------------------------------ full round trip

    function test_roundTrip_marginLongShortCloseWithdrawRedeem() public {
        uint256 nav0 = vault.nav();
        assertEq(nav0, 1_000e6);

        // Margin in: NAV unchanged, value moves from idle to the venue.
        _exec(_margin(DEPOSIT, 250e6));
        assertEq(vault.nav(), nav0, "margin move is NAV-neutral");
        assertEq(AUSD.balanceOf(address(vault)), 750e6);
        assertEq(adapter.exposure(address(vault)), 250e6);
        assertEq(adapter.accountId(), EX.getAccountByAddr(address(adapter)).accountId);

        // Resting post-only bid: locks collateral, NAV still unchanged.
        (uint256 bid, uint256 ask) = _book(BTC);
        vm.recordLogs();
        _exec(_order(BTC, OPEN_LONG, 0, bid - 1_000, 10, true, false));
        uint256 restingId = _lastOrderId();
        assertGt(restingId, 0, "resting order");
        assertGt(EX.getAccountByAddr(address(adapter)).lockedBalanceCNS, 0, "collateral locked");
        assertEq(vault.nav(), nav0, "resting order is NAV-neutral");
        _exec(_order(BTC, CANCEL, restingId, 0, 0, false, false));
        assertEq(EX.getAccountByAddr(address(adapter)).lockedBalanceCNS, 0, "unlocked");

        // Taker long BTC and taker short MON: two positions, both counted in NAV.
        _exec(_order(BTC, OPEN_LONG, 0, ask + ask / 200, 100, false, true));
        (uint256 monBid,) = _book(MON);
        _exec(_order(MON, OPEN_SHORT, 0, monBid - monBid / 200, 1_000, false, true));
        IPerplExchange.AccountInfo memory a = EX.getAccountByAddr(address(adapter));
        uint256[] memory tracked = adapter.perps();
        assertEq(tracked.length, 2, "two perps tracked");
        assertEq(tracked[0], BTC);
        assertEq(tracked[1], MON);
        uint256 expected = AUSD.balanceOf(address(vault)) + a.balanceCNS + _posValue(BTC) + _posValue(MON);
        assertEq(vault.nav(), expected, "NAV = idle + free margin + positions at mark");
        assertApproxEqRel(vault.nav(), nav0, 0.01e18, "only fees and spread lost");
        assertFalse(vault.frozen());

        // Close both, pull all margin back, backer exits in full.
        vm.roll(block.number + 1);
        (bid, ask) = _book(BTC);
        _exec(_order(BTC, CLOSE_LONG, 0, bid - bid / 200, 100, false, true));
        (, uint256 monAsk) = _book(MON);
        _exec(_order(MON, CLOSE_SHORT, 0, monAsk + monAsk / 200, 1_000, false, true));
        a = EX.getAccountByAddr(address(adapter));
        assertEq(_posValue(BTC) + _posValue(MON), 0, "flat");
        _exec(_margin(WITHDRAW, a.balanceCNS));
        assertEq(adapter.exposure(address(vault)), 0);
        assertEq(vault.nav(), AUSD.balanceOf(address(vault)));

        uint256 shares = vault.balanceOf(alice);
        assertEq(vault.maxRedeem(alice), shares, "full exit available");
        vm.prank(alice);
        uint256 out = vault.redeem(shares, alice, alice);
        assertApproxEqRel(out, 1_000e6, 0.01e18);
        assertEq(AUSD.allowance(address(vault), address(adapter)), 0, "no standing approval");
    }

    // ------------------------------------------------------------------ failure modes

    /// Invariant 3 through a real venue: a mark-to-market loss past the cap freezes the vault in the
    /// execute that observes it. Perpl's view is mocked to simulate the price move.
    function test_markLossPastCapFreezesVault() public {
        _exec(_margin(DEPOSIT, 250e6));
        (, uint256 ask) = _book(BTC);
        _exec(_order(BTC, OPEN_LONG, 0, ask + ask / 200, 100, false, true));

        uint256 accountId = adapter.accountId();
        (IPerplExchange.PositionInfo memory pos, uint256 mark, bool ok) = EX.getPosition(BTC, accountId);
        pos.pnlCNS = -int256(pos.depositCNS); // position wiped out at mark
        vm.mockCall(
            address(EX), abi.encodeCall(IPerplExchange.getPosition, (BTC, accountId)), abi.encode(pos, mark, ok)
        );
        // Losing the ~42 AUSD position margin alone is under the 10% cap, so also zero the free margin.
        IPerplExchange.AccountInfo memory a = EX.getAccountByAddr(address(adapter));
        a.balanceCNS = 0;
        vm.mockCall(address(EX), abi.encodeCall(IPerplExchange.getAccountByAddr, (address(adapter))), abi.encode(a));

        vm.expectEmit(address(vault));
        emit IAgentVault.Frozen(address(vault));
        _exec(_margin(DEPOSIT, 10e6)); // the next execute observes the loss
        assertTrue(vault.frozen());
    }

    /// If Perpl cannot be read, NAV counts the Perpl leg as 0 instead of reverting, so the idle
    /// part of the vault stays withdrawable (invariant 4).
    function test_exchangeUnreadable_navStillReadsAndIdleWithdraws() public {
        _exec(_margin(DEPOSIT, 250e6));
        vm.mockCallRevert(
            address(EX), abi.encodeCall(IPerplExchange.getAccountByAddr, (address(adapter))), bytes("halted")
        );
        assertEq(adapter.exposure(address(vault)), 0);
        assertEq(vault.nav(), 750e6);
        uint256 max = vault.maxWithdraw(alice);
        assertEq(max, 750e6);
        vm.prank(alice);
        vault.withdraw(max, alice, alice);
        assertEq(AUSD.balanceOf(alice), 750e6);
    }

    function test_recall_onlyWhenFrozen_returnsFreeMarginToVault() public {
        _exec(_margin(DEPOSIT, 250e6));

        vm.prank(attacker);
        vm.expectRevert(VaultBoundAdapter.VaultNotFrozen.selector);
        adapter.recall(250e6);

        vm.prank(guardian);
        vault.freeze();
        uint256 navBefore = vault.nav();
        vm.prank(attacker);
        adapter.recall(250e6);
        assertEq(vault.nav(), navBefore, "recall is NAV-neutral");
        assertEq(AUSD.balanceOf(address(vault)), 1_000e6);
        assertEq(AUSD.balanceOf(attacker), 0);

        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(shares, alice, alice);
        assertEq(AUSD.balanceOf(alice), 1_000e6, "frozen vault still pays out in full");
    }

    // ------------------------------------------------------------------ internals

    function _posValue(uint256 perpId) internal view returns (uint256) {
        (IPerplExchange.PositionInfo memory pos,,) = EX.getPosition(perpId, adapter.accountId());
        int256 v = int256(pos.depositCNS) + pos.pnlCNS;
        return v > 0 ? uint256(v) : 0;
    }

    function _lastOrderId() internal returns (uint256 orderId) {
        bytes32 sig = PerplAdapter.OrderSent.selector;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = logs.length; i > 0; --i) {
            if (logs[i - 1].emitter == address(adapter) && logs[i - 1].topics[0] == sig) {
                (, orderId,,,,) = abi.decode(logs[i - 1].data, (uint8, uint256, uint256, uint256, uint256, uint256));
                return orderId;
            }
        }
    }
}
