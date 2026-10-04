// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IKuruOrderBook} from "../../src/interfaces/external/IKuruOrderBook.sol";

interface IKuruMarginAccount {
    function deposit(address user, address token, uint256 amount) external payable;
}

interface IKuruLimit {
    function addBuyOrder(uint32 price, uint96 size, bool postOnly) external;
    function addSellOrder(uint32 price, uint96 size, bool postOnly) external;
}

/// @notice Depth for fork tests against the live Kuru MON-USDC book. The book is thin (on
/// 2026-10-04 a 200 USDC buy moved the price past the 3% band and $10 slipped 0.9%), so a test
/// that needs fills near the top of book rests a maker's bid and ask there first. Tests then use the
/// real Kuru contracts at today's price without depending on how much depth happens to be there.
abstract contract KuruSeed is Test {
    IKuruMarginAccount constant KURU_MARGIN = IKuruMarginAccount(0x2A68ba1833cDf93fa9Da1EEbd7F46242aD8E90c5);

    /// Rests `mon` MON on each side at the current best bid and ask, post-only, so the top of book
    /// doesn't move. Kuru prices are 1e8-scaled and sizes 1e10 per MON (MON-USDC market params).
    function _seedKuruBook(IKuruOrderBook book, IERC20 usdc, uint256 mon) internal {
        (uint256 bid, uint256 ask) = book.bestBidAsk();
        address maker = makeAddr("kuruMaker");
        vm.deal(maker, mon * 1 ether);
        deal(address(usdc), maker, mon * bid / 1e12 + 1e6);

        vm.startPrank(maker);
        usdc.approve(address(KURU_MARGIN), type(uint256).max);
        KURU_MARGIN.deposit{value: mon * 1 ether}(maker, address(0), mon * 1 ether);
        KURU_MARGIN.deposit(maker, address(usdc), usdc.balanceOf(maker));
        IKuruLimit(address(book)).addSellOrder(uint32(ask * 1e8 / 1e18), uint96(mon * 1e10), true);
        IKuruLimit(address(book)).addBuyOrder(uint32(bid * 1e8 / 1e18), uint96(mon * 1e10), true);
        vm.stopPrank();

        (uint256 bidAfter, uint256 askAfter) = book.bestBidAsk();
        assertEq(bidAfter, bid, "seed doesn't move the bid");
        assertEq(askAfter, ask, "seed doesn't move the ask");
    }
}
