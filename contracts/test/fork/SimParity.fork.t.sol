// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IKuruOrderBook} from "../../src/interfaces/external/IKuruOrderBook.sol";
import {IPerplExchange} from "../../src/interfaces/external/IPerplExchange.sol";
import {SimKuruOrderBook} from "../../src/sim/SimKuruOrderBook.sol";
import {SimPerplExchange} from "../../src/sim/SimPerplExchange.sol";
import {SimToken} from "../../src/sim/SimToken.sol";
import {KuruSeed} from "./KuruSeed.sol";

/// @notice Runs the same calls against a real venue and its sim on a fork, and checks they behave the
/// same: same revert selectors and arguments, same position semantics, and the same margin model
/// (checked against the real Exchange's own numbers). Local simulation only: nothing is broadcast.
contract SimParityForkTest is KuruSeed {
    uint256 constant MON_TESTNET = 64;
    uint8 constant OPEN_LONG = 0;
    uint8 constant OPEN_SHORT = 1;
    uint8 constant CLOSE_LONG = 2;
    uint8 constant CLOSE_SHORT = 3;

    address trader = makeAddr("trader");
    address nobody = makeAddr("nobody");

    // ------------------------------------------------------------------ Perpl (testnet fork)

    function test_perpl_realAndSimBehaveAlike() public {
        vm.createSelectFork("https://testnet-rpc.monad.xyz");
        IPerplExchange real = IPerplExchange(0x1964C32f0bE608E7D29302AFF5E61268E72080cc);
        IERC20 ausd = IERC20(0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC);
        _dealAUSD(ausd, trader, 10_000e6);

        SimToken token = new SimToken("Proofbook Sim AUSD (testnet, no value)", "simAUSD", 6, address(this));
        SimPerplExchange sim = new SimPerplExchange(token, real, 100e6, 50, address(this));
        sim.listPerp(MON_TESTNET, 300);
        token.setMinter(address(sim), true);
        token.faucet(trader, 10_000e6);

        _perplScenario(real, ausd);
        _perplScenario(IPerplExchange(address(sim)), IERC20(address(token)));
    }

    function _perplScenario(IPerplExchange ex, IERC20 token) internal {
        _expectRevertData(
            address(ex),
            abi.encodeCall(IPerplExchange.getAccountByAddr, (nobody)),
            abi.encodeWithSelector(SimPerplExchange.AccountDoesNotExist.selector, nobody)
        );
        vm.startPrank(trader);
        token.approve(address(ex), type(uint256).max);
        _expectRevertData(
            address(ex),
            abi.encodeCall(IPerplExchange.createAccount, (1e6)),
            abi.encodeWithSelector(SimPerplExchange.InsufficentAmountToOpenAccount.selector, trader, 1e6)
        );
        uint256 id = ex.createAccount(1_000e6);
        _expectRevertData(
            address(ex),
            abi.encodeCall(IPerplExchange.createAccount, (1_000e6)),
            abi.encodeWithSelector(SimPerplExchange.AccountExists.selector, trader, id)
        );
        _expectRevertData(
            address(ex),
            abi.encodeCall(IPerplExchange.withdrawCollateral, (1_001e6)),
            abi.encodeWithSelector(SimPerplExchange.AmountExceedsAvailableBalance.selector, 1_001e6, 1_000e6, 1_000e6)
        );

        IPerplExchange.PerpetualInfo memory i = ex.getPerpetualInfo(MON_TESTNET);
        uint256 bid = i.basePricePNS + i.maxBidPriceONS;
        uint256 ask = i.basePricePNS + i.minAskPriceONS;
        uint256 buy = ask * 1005 / 1000;
        uint256 sell = bid * 995 / 1000;

        // Non-crossing IOC: no fill, orderId 0, no revert.
        assertEq(ex.execOrder(_order(OPEN_LONG, bid * 90 / 100, 1_000, 100)).orderId, 0, "noncross IOC");

        // First open: margin = ceil(entry notional / leverage) + loss at mark; fee comes out of balance.
        ex.execOrder(_order(OPEN_LONG, buy, 1_000, 100));
        _checkMargin(ex, id, 100);
        // Increase at 2x re-targets the whole position (deposit never shrinks).
        ex.execOrder(_order(OPEN_LONG, buy, 1_000, 200));
        IPerplExchange.PositionInfo memory p = _pos(ex, id);
        assertEq(p.lotLNS, 2_000);

        _expectRevertData(
            address(ex),
            abi.encodeCall(IPerplExchange.execOrder, (_order(CLOSE_SHORT, buy, 100, 100))),
            abi.encodeWithSelector(SimPerplExchange.CloseOrderPositionMismatch.selector, 0, CLOSE_SHORT)
        );
        _expectRevertData(
            address(ex),
            abi.encodeCall(IPerplExchange.execOrder, (_order(CLOSE_LONG, sell, 1_000_000, 100))),
            abi.encodeWithSelector(SimPerplExchange.CloseOrderExceedsPosition.selector, 2_000, 1_000_000)
        );

        // Opposite open nets against the position, releasing deposit pro rata.
        ex.execOrder(_order(OPEN_SHORT, sell, 500, 100));
        IPerplExchange.PositionInfo memory q = _pos(ex, id);
        assertEq(q.positionType, 0);
        assertEq(q.lotLNS, 1_500);
        assertApproxEqAbs(q.depositCNS, p.depositCNS - p.depositCNS * 500 / 2_000, 1, "pro rata");

        // Bigger than the position: flips.
        ex.execOrder(_order(OPEN_SHORT, sell, 2_000, 100));
        q = _pos(ex, id);
        assertEq(q.positionType, 1);
        assertEq(q.lotLNS, 500);
        _checkMargin(ex, id, 100);

        // Leverage above the perp's max is clamped (MON: 3x), not rejected.
        ex.execOrder(_order(OPEN_LONG, buy, 500, 100)); // flat
        assertEq(_pos(ex, id).lotLNS, 0);
        ex.execOrder(_order(OPEN_LONG, buy, 1_000, 5_000));
        _checkMargin(ex, id, 300);

        // maxNegPnlCollatBPS = 0 refuses a fill that is under water against mark.
        IPerplExchange.OrderDesc memory d = _order(OPEN_LONG, buy, 100, 100);
        d.maxNegPnlCollatBPS = 0;
        (bool ok,) = address(ex).call(abi.encodeCall(IPerplExchange.execOrder, (d)));
        assertFalse(ok, "maxNegPnlCollatBPS 0");
        vm.stopPrank();
    }

    /// depositCNS == ceil(lot x entry / leverage) + max(0, -pnl), the rule the real Exchange follows
    /// right after an open.
    function _checkMargin(IPerplExchange ex, uint256 id, uint256 lev) internal view {
        IPerplExchange.PositionInfo memory p = _pos(ex, id);
        IPerplExchange.PerpetualInfo memory i = ex.getPerpetualInfo(MON_TESTNET);
        uint256 unit = 10 ** (i.priceDecimals + i.lotDecimals);
        uint256 required = (p.lotLNS * p.pricePNS * 1e6 * 100 + unit * lev - 1) / (unit * lev);
        if (p.pnlCNS < 0) required += uint256(-p.pnlCNS);
        assertEq(p.depositCNS, required, "margin model");
    }

    function _pos(IPerplExchange ex, uint256 id) internal view returns (IPerplExchange.PositionInfo memory p) {
        (p,,) = ex.getPosition(MON_TESTNET, id);
    }

    function _order(uint8 t, uint256 price, uint256 lot, uint256 lev)
        internal
        view
        returns (IPerplExchange.OrderDesc memory d)
    {
        d.perpId = MON_TESTNET;
        d.orderType = t;
        d.pricePNS = price;
        d.lotLNS = lot;
        d.expiryBlock = block.number + 100;
        d.immediateOrCancel = true;
        d.leverageHdths = lev;
        d.maxNegPnlCollatBPS = 300;
    }

    // ------------------------------------------------------------------ Kuru (mainnet fork)

    function test_kuru_realAndSimBehaveAlike() public {
        vm.createSelectFork(vm.envOr("MONAD_MAINNET_RPC_URL", string("https://rpc.monad.xyz")));
        IKuruOrderBook real = IKuruOrderBook(0x065C9d28E428A0db40191a54d33d5b7c71a9C394);
        IERC20 usdc = IERC20(0x754704Bc059F8C67012fEd69BC8A327a5aafb603);
        IPerplExchange perpl = IPerplExchange(0x34B6552d57a35a1D042CcAe1951BD1C370112a6F);

        SimToken token = new SimToken("Proofbook Sim USDC (testnet, no value)", "simUSDC", 6, address(this));
        SimKuruOrderBook sim = new SimKuruOrderBook(token, perpl, 10, 65, address(this));
        token.setMinter(address(sim), true);
        vm.deal(address(sim), 100_000 ether);
        // Compare the sim with the real top of book, not with however thin the live book is today.
        _seedKuruBook(real, usdc, 10_000);

        // Same market params apart from the quote token.
        (bool okR, bytes memory r) = address(real).staticcall(abi.encodeCall(IKuruOrderBook.getMarketParams, ()));
        (bool okS, bytes memory s) = address(sim).staticcall(abi.encodeCall(IKuruOrderBook.getMarketParams, ()));
        assertTrue(okR && okS);
        assertEq(_zeroWord(r, 4), _zeroWord(s, 4), "market params");

        deal(address(usdc), trader, 1_000e6);
        token.faucet(trader, 1_000e6);
        vm.deal(trader, 10_000 ether);
        (uint256 rBase, uint256 rQuote) = _kuruScenario(real, usdc);
        (uint256 sBase, uint256 sQuote) = _kuruScenario(IKuruOrderBook(address(sim)), IERC20(address(token)));
        // The sim quotes a tight spread around Perpl's MON mark; the real book has its own spread
        // (1.4% wide on 2026-10-04). _kuruScenario checks each fills at its own top of book. Across
        // venues the bound that matters is KuruAdapter's 3% band around that same mark.
        assertApproxEqRel(sBase, rBase, 0.03e18, "MON for $10");
        assertApproxEqRel(sQuote, rQuote, 0.03e18, "USDC for 100 MON");
    }

    function _kuruScenario(IKuruOrderBook m, IERC20 quote) internal returns (uint256 baseOut, uint256 quoteOut) {
        vm.startPrank(trader);
        quote.approve(address(m), type(uint256).max);
        (uint256 bid, uint256 ask) = m.bestBidAsk();
        assertLt(bid, ask);
        assertEq(bid % 1e12, 0, "bid on tick grid");
        assertEq(ask % 1e12, 0, "ask on tick grid");

        uint256 q0 = quote.balanceOf(trader);
        baseOut = m.placeAndExecuteMarketBuy(10e8, 0, false, true);
        assertEq(q0 - quote.balanceOf(trader), 10e6, "spends exactly the quote size");
        assertEq(baseOut % 1e8, 0, "base rounded to size precision");
        assertApproxEqRel(baseOut, 10 * 1e36 / ask, 0.001e18, "$10 buys at the best ask");
        quoteOut = m.placeAndExecuteMarketSell{value: 100 ether}(100e10, 0, false, true);
        assertApproxEqRel(quoteOut, 100 * bid / 1e12, 0.001e18, "100 MON sells at the best bid");

        _expectRevertSel(
            address(m),
            0,
            abi.encodeCall(IKuruOrderBook.placeAndExecuteMarketBuy, (10e8, type(uint256).max, false, true)),
            SimKuruOrderBook.SlippageExceeded.selector
        );
        _expectRevertSel(
            address(m),
            99 ether,
            abi.encodeCall(IKuruOrderBook.placeAndExecuteMarketSell, (100e10, 0, false, true)),
            SimKuruOrderBook.NativeAssetInsufficient.selector
        );
        _expectRevertSel(
            address(m),
            101 ether,
            abi.encodeCall(IKuruOrderBook.placeAndExecuteMarketSell, (100e10, 0, false, true)),
            SimKuruOrderBook.NativeAssetSurplus.selector
        );
        _expectRevertSel(
            address(m),
            0,
            abi.encodeCall(IKuruOrderBook.placeAndExecuteMarketBuy, (10e8, 0, true, true)),
            SimKuruOrderBook.InsufficientBalance.selector
        );
        _expectRevertSel(
            address(m),
            1 ether,
            abi.encodeCall(IKuruOrderBook.placeAndExecuteMarketBuy, (10e8, 0, false, true)),
            SimKuruOrderBook.NativeAssetNotRequired.selector
        );
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ helpers

    function _expectRevertData(address target, bytes memory call, bytes memory expected) internal {
        (bool ok, bytes memory ret) = target.call(call);
        assertFalse(ok, "should revert");
        assertEq(ret, expected, "revert data");
    }

    function _expectRevertSel(address target, uint256 value, bytes memory call, bytes4 expected) internal {
        (bool ok, bytes memory ret) = target.call{value: value}(call);
        assertFalse(ok, "should revert");
        assertEq(bytes4(ret), expected, "revert selector");
    }

    /// Returns `data` with 32-byte word `index` zeroed (the quote token address).
    function _zeroWord(bytes memory data, uint256 index) internal pure returns (bytes memory) {
        for (uint256 k; k < 32; ++k) {
            data[index * 32 + k] = 0;
        }
        return data;
    }

    /// AUSD packs {uint8 flags; uint248 balance} in one slot, so forge `deal` can't be used.
    function _dealAUSD(IERC20 token, address to, uint256 amount) internal {
        vm.record();
        token.balanceOf(to);
        (bytes32[] memory reads,) = vm.accesses(address(token));
        bytes32 slot = reads[reads.length - 1];
        uint256 cur = uint256(vm.load(address(token), slot));
        vm.store(address(token), slot, bytes32((amount << 8) | (cur & 0xff)));
    }
}
