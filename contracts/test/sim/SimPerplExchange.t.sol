// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentRegistry} from "../../src/AgentRegistry.sol";
import {AgentVault} from "../../src/AgentVault.sol";
import {PerplAdapter} from "../../src/adapters/PerplAdapter.sol";
import {RiskEnvelope} from "../../src/interfaces/IAgentRegistry.sol";
import {IPerplExchange} from "../../src/interfaces/external/IPerplExchange.sol";
import {SimPerplExchange} from "../../src/sim/SimPerplExchange.sol";
import {SimToken} from "../../src/sim/SimToken.sol";
import {MockIdentityRegistry} from "../mocks/MockIdentityRegistry.sol";
import {MockPerplPriceSource} from "../mocks/MockPerplPriceSource.sol";

/// @notice SimPerplExchange on its own (no fork, runs in CI), plus the production PerplAdapter and
/// AgentVault trading it. Fork parity with the real Exchange is in test/fork/SimParity.fork.t.sol.
contract SimPerplExchangeTest is Test {
    uint256 constant MON = 64; // testnet id, price dp 5, lot dp 0
    uint256 constant BTC = 16; // price dp 1, lot dp 5
    uint8 constant OPEN_LONG = 0;
    uint8 constant OPEN_SHORT = 1;
    uint8 constant CLOSE_LONG = 2;
    uint8 constant CLOSE_SHORT = 3;
    uint8 constant CANCEL = 4;
    uint8 constant DEPOSIT = 0; // PerplAdapter action ids
    uint8 constant WITHDRAW = 1;
    uint8 constant ORDER = 2;

    address owner = makeAddr("owner");
    address trader = makeAddr("trader");
    address nobody = makeAddr("nobody");

    SimToken token;
    MockPerplPriceSource source;
    SimPerplExchange ex;

    function setUp() public {
        token = new SimToken("Proofbook Sim AUSD (testnet, no value)", "simAUSD", 6, owner);
        source = new MockPerplPriceSource();
        source.list(MON, "MON", 5, 0, 2766);
        source.list(BTC, "BTC", 1, 5, 835_312);
        ex = _exchange(50);
        vm.startPrank(trader);
        token.faucet(trader, 10_000e6);
        token.approve(address(ex), type(uint256).max);
        vm.stopPrank();
    }

    function _exchange(uint256 spread) internal returns (SimPerplExchange e) {
        e = new SimPerplExchange(token, IPerplExchange(address(source)), 10e6, spread, owner);
        vm.startPrank(owner);
        e.listPerp(MON, 300);
        e.listPerp(BTC, 1_500);
        token.setMinter(address(e), true);
        vm.stopPrank();
    }

    function _order(uint8 t, uint256 price, uint256 lot, uint256 lev)
        internal
        view
        returns (IPerplExchange.OrderDesc memory d)
    {
        d.perpId = MON;
        d.orderType = t;
        d.pricePNS = price;
        d.lotLNS = lot;
        d.expiryBlock = block.number + 100;
        d.immediateOrCancel = true;
        d.leverageHdths = lev;
        d.maxNegPnlCollatBPS = 300;
    }

    function _exec(SimPerplExchange e, IPerplExchange.OrderDesc memory d) internal returns (uint256) {
        vm.prank(trader);
        return e.execOrder(d).orderId;
    }

    function _pos(SimPerplExchange e) internal view returns (IPerplExchange.PositionInfo memory p) {
        (p,,) = e.getPosition(MON, e.getAccountByAddr(trader).accountId);
    }

    function _bal(SimPerplExchange e) internal view returns (uint256) {
        return e.getAccountByAddr(trader).balanceCNS;
    }

    function _open(SimPerplExchange e, uint256 amount) internal {
        vm.startPrank(trader);
        token.approve(address(e), type(uint256).max);
        e.createAccount(amount);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ exact numbers from the real Exchange

    /// Replays the Perpl testnet fork probe of 2026-09-29 (MON mark 2766, IOC buys filled at 2779).
    /// A 469-per-100K spread puts the sim's fill on 2779 too, and every number matches the real Exchange.
    function test_reproducesTestnetProbe() public {
        SimPerplExchange e = _exchange(469);
        _open(e, 1_000e6);

        _exec(e, _order(OPEN_LONG, 2800, 1_000, 100));
        IPerplExchange.PositionInfo memory p = _pos(e);
        assertEq(p.pricePNS, 2779);
        assertEq(p.depositCNS, 27_920_000, "real: 27920000");
        assertEq(p.pnlCNS, -130_000, "real: -130000");
        assertEq(_bal(e), 972_070_412, "real: 972070412 (fee 9588)");

        _exec(e, _order(OPEN_LONG, 2800, 1_000, 200));
        p = _pos(e);
        assertEq(p.lotLNS, 2_000);
        assertEq(p.depositCNS, 28_050_000, "real: 28050000");
        assertEq(_bal(e), 971_930_824, "real: 971930824");
    }

    /// Real: 1000 MON at 50x on testnet held 9403334 margin (MON max leverage 3x, mark 2765, fill 2779).
    function test_leverageClampedToPerpMax() public {
        source.setMark(MON, 2765);
        SimPerplExchange e = _exchange(506);
        _open(e, 1_000e6);
        _exec(e, _order(OPEN_LONG, 2800, 1_000, 5_000));
        assertEq(_pos(e).depositCNS, 9_403_334, "real: 9403334");
    }

    // ------------------------------------------------------------------ accounts (real error selectors)

    function test_accountErrors() public {
        vm.expectRevert(abi.encodeWithSelector(SimPerplExchange.AccountDoesNotExist.selector, nobody));
        ex.getAccountByAddr(nobody);

        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(SimPerplExchange.InsufficentAmountToOpenAccount.selector, trader, 1e6));
        ex.createAccount(1e6);

        _open(ex, 1_000e6);
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(SimPerplExchange.AccountExists.selector, trader, 1));
        ex.createAccount(1_000e6);

        vm.prank(nobody);
        vm.expectRevert(abi.encodeWithSelector(SimPerplExchange.AccountDoesNotExist.selector, nobody));
        ex.depositCollateral(1e6);

        vm.prank(trader);
        vm.expectRevert(
            abi.encodeWithSelector(SimPerplExchange.AmountExceedsAvailableBalance.selector, 1_001e6, 1_000e6, 1_000e6)
        );
        ex.withdrawCollateral(1_001e6);

        // Same selectors as the real Exchange (decoded from testnet reverts with `cast 4byte`).
        assertEq(SimPerplExchange.AccountDoesNotExist.selector, bytes4(0x03a0e277));
        assertEq(SimPerplExchange.AccountExists.selector, bytes4(0x646095e8));
        assertEq(SimPerplExchange.InsufficentAmountToOpenAccount.selector, bytes4(0xcfe73bb0));
        assertEq(SimPerplExchange.AmountExceedsAvailableBalance.selector, bytes4(0xb853e584));
        assertEq(SimPerplExchange.CloseOrderPositionMismatch.selector, bytes4(0x189a4ff8));
        assertEq(SimPerplExchange.CloseOrderExceedsPosition.selector, bytes4(0x604559a5));
    }

    function test_depositWithdraw() public {
        _open(ex, 100e6);
        vm.startPrank(trader);
        ex.depositCollateral(50e6);
        ex.withdrawCollateral(120e6);
        vm.stopPrank();
        assertEq(_bal(ex), 30e6);
        assertEq(token.balanceOf(trader), 10_000e6 - 30e6);
        (,,, uint256 dec, address collat,) = ex.getExchangeInfo();
        assertEq(dec, 6);
        assertEq(collat, address(token));
        assertEq(ex.getMinAccountOpenCNS(), 10e6);
    }

    // ------------------------------------------------------------------ positions

    function test_netAndFlip_likeRealExchange() public {
        _open(ex, 1_000e6);
        _exec(ex, _order(OPEN_LONG, 3000, 2_000, 100));
        uint256 dep = _pos(ex).depositCNS;

        // An open against the position reduces it, releasing margin pro rata.
        _exec(ex, _order(OPEN_SHORT, 2000, 500, 100));
        IPerplExchange.PositionInfo memory p = _pos(ex);
        assertEq(p.positionType, 0);
        assertEq(p.lotLNS, 1_500);
        assertEq(p.depositCNS, dep - dep * 500 / 2_000);

        // Bigger than the position: closes it and opens the remainder the other way.
        _exec(ex, _order(OPEN_SHORT, 2000, 2_000, 100));
        p = _pos(ex);
        assertEq(p.positionType, 1);
        assertEq(p.lotLNS, 500);

        _exec(ex, _order(OPEN_LONG, 3000, 500, 100));
        assertEq(_pos(ex).lotLNS, 0);
        assertEq(_pos(ex).depositCNS, 0);
    }

    function test_closeIsReduceOnly() public {
        _open(ex, 1_000e6);
        _exec(ex, _order(OPEN_LONG, 3000, 800, 100));
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(SimPerplExchange.CloseOrderPositionMismatch.selector, 0, 3));
        ex.execOrder(_order(CLOSE_SHORT, 3000, 100, 100));
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(SimPerplExchange.CloseOrderExceedsPosition.selector, 800, 1_000_000));
        ex.execOrder(_order(CLOSE_LONG, 2000, 1_000_000, 100));
    }

    function test_roundTripAtFlatMark_costsSpreadAndFees() public {
        _open(ex, 1_000e6);
        _exec(ex, _order(OPEN_LONG, 3000, 10_000, 100));
        _exec(ex, _order(CLOSE_LONG, 2000, 10_000, 100));
        uint256 mark = 2766;
        uint256 buy = mark * 100_050 / 100_000 + 1; // ceil
        uint256 sell = mark * 99_950 / 100_000;
        uint256 feeBuy = (10_000 * buy * 10 * 345 + 1e6 - 1) / 1e6;
        uint256 feeSell = (10_000 * sell * 10 * 345 + 1e6 - 1) / 1e6;
        assertEq(_bal(ex), 1_000e6 - (buy - sell) * 10_000 * 10 - feeBuy - feeSell);
    }

    function test_profitIsPaidByMinting() public {
        _open(ex, 100e6);
        _exec(ex, _order(OPEN_LONG, 3000, 3_000, 100)); // ~$83
        source.setMark(MON, 5532); // price doubles
        _exec(ex, _order(CLOSE_LONG, 1, 3_000, 100)); // a sell fills at the bid whatever its limit
        uint256 bal = _bal(ex);
        assertGt(bal, 180e6);
        assertGt(bal, token.balanceOf(address(ex)));
        vm.prank(trader);
        ex.withdrawCollateral(bal);
        assertEq(_bal(ex), 0);
    }

    function test_nonCrossingIoc_fillsNothing() public {
        _open(ex, 1_000e6);
        assertEq(_exec(ex, _order(OPEN_LONG, 2000, 1_000, 100)), 0);
        assertEq(_pos(ex).lotLNS, 0);
        assertEq(_bal(ex), 1_000e6);
    }

    function test_unsupportedOrdersRevert() public {
        _open(ex, 1_000e6);
        IPerplExchange.OrderDesc memory d = _order(CANCEL, 0, 0, 100);
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(SimPerplExchange.NotSimulated.selector, CANCEL));
        ex.execOrder(d);

        d = _order(OPEN_LONG, 2000, 1_000, 100);
        d.immediateOrCancel = false; // would rest on the book
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(SimPerplExchange.NotSimulated.selector, OPEN_LONG));
        ex.execOrder(d);

        d = _order(OPEN_LONG, 3000, 1_000, 100);
        d.maxNegPnlCollatBPS = 0; // real Exchange: TakerOrderSettlementFailed(..., 14)
        vm.prank(trader);
        vm.expectRevert();
        ex.execOrder(d);

        d.perpId = 999;
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(SimPerplExchange.PerpNotListed.selector, 999));
        ex.execOrder(d);
    }

    function test_bookViews() public view {
        IPerplExchange.PerpetualInfo memory p = ex.getPerpetualInfo(MON);
        assertEq(p.priceDecimals, 5);
        assertEq(p.markPNS, 2766);
        assertLt(p.basePricePNS + p.maxBidPriceONS, p.markPNS);
        assertGt(p.basePricePNS + p.minAskPriceONS, p.markPNS);
    }

    // ------------------------------------------------------------------ production adapter + vault

    function test_perplAdapterAndVault_profitAndLoss() public {
        address sessionKey = makeAddr("sessionKey");
        address alice = makeAddr("alice");
        MockIdentityRegistry identity = new MockIdentityRegistry();
        IERC20[] memory assets = new IERC20[](1);
        assets[0] = IERC20(address(token));
        AgentRegistry registry = new AgentRegistry(identity, makeAddr("guardian"), assets);

        PerplAdapter adapter = new PerplAdapter(IPerplExchange(address(ex)), IERC20(address(token)));
        address[] memory venues = new address[](1);
        venues[0] = address(adapter);
        AgentVault vault = AgentVault(
            payable(registry.enter(
                    identity.register(),
                    RiskEnvelope({
                        maxTradeNotional: 300e6, dailyLossCapBps: 500, depositCapPerBacker: 10_000e6, venues: venues
                    }),
                    sessionKey,
                    IERC20(address(token))
                ))
        );
        adapter.bind(address(vault));

        vm.startPrank(alice);
        token.faucet(alice, 1_000e6);
        token.approve(address(vault), type(uint256).max);
        vault.deposit(1_000e6, alice);
        vm.stopPrank();

        vm.startPrank(sessionKey);
        vault.execute(address(adapter), abi.encode(DEPOSIT, abi.encode(uint256(200e6))));
        assertEq(vault.nav(), 1_000e6);
        // ~$249 long at 3x (the adapter's band: limit within 3% of mark).
        vault.execute(address(adapter), abi.encode(ORDER, abi.encode(_order(OPEN_LONG, 2790, 9_000, 300))));
        assertApproxEqRel(vault.nav(), 1_000e6, 0.001e18);

        source.setMark(MON, 3042); // +10%: 1000 - fee + (3042 - 2768) x 9000 lots x 10
        assertApproxEqAbs(vault.nav(), 1_024.574e6, 0.001e6);
        vault.execute(address(adapter), abi.encode(ORDER, abi.encode(_order(CLOSE_LONG, 3000, 9_000, 300))));
        uint256 free = ex.getAccountByAddr(address(adapter)).balanceCNS;
        vault.execute(address(adapter), abi.encode(WITHDRAW, abi.encode(free)));
        vm.stopPrank();
        assertEq(adapter.exposure(address(vault)), 0);
        assertEq(vault.nav(), token.balanceOf(address(vault)));
        assertGt(vault.nav(), 1_020e6);

        // Now lose: 3x long, mark -20% breaches the 5% daily loss cap on the next execute.
        vm.warp(block.timestamp + 1 days);
        source.setMark(MON, 3000);
        vm.startPrank(sessionKey);
        vault.execute(address(adapter), abi.encode(DEPOSIT, abi.encode(uint256(250e6))));
        vault.execute(address(adapter), abi.encode(ORDER, abi.encode(_order(OPEN_LONG, 3050, 9_800, 300))));
        source.setMark(MON, 2400);
        vault.execute(address(adapter), abi.encode(WITHDRAW, abi.encode(uint256(1e6))));
        vm.stopPrank();
        assertTrue(vault.frozen());

        // Frozen: anyone can recall free margin so backers can withdraw it.
        uint256 freeNow = ex.getAccountByAddr(address(adapter)).balanceCNS;
        adapter.recall(freeNow);
        assertEq(ex.getAccountByAddr(address(adapter)).balanceCNS, 0);
    }
}
