// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The subset of a Kuru v1 OrderBook market that KuruAdapter uses. Signatures follow the
/// SDK ABI and a mainnet fork test, not docs.kuru.io (minAmountOut is uint256). The
/// getMarketParams return order was decoded against the live MON-USDC market on 2026-09-29.
/// See docs/reference/kuru.md.
interface IKuruOrderBook {
    /// @notice Market buy spending `quoteSize` (quote amount in pricePrecision units). With
    /// isMargin = false, quote is pulled from msg.sender by transferFrom and base is sent to it.
    /// @return Base received (base token decimals; wei for native MON).
    function placeAndExecuteMarketBuy(uint96 quoteSize, uint256 minAmountOut, bool isMargin, bool isFillOrKill)
        external
        payable
        returns (uint256);

    /// @notice Market sell of `size` base (sizePrecision units). Native base is paid as msg.value.
    /// @return Quote received (quote token decimals).
    function placeAndExecuteMarketSell(uint96 size, uint256 minAmountOut, bool isMargin, bool isFillOrKill)
        external
        payable
        returns (uint256);

    /// @notice Best bid and ask, quote per base scaled to 1e18. No bid = type(uint256).max, no ask = 0.
    function bestBidAsk() external view returns (uint256 bestBid, uint256 bestAsk);

    function getMarketParams()
        external
        view
        returns (
            uint32 pricePrecision,
            uint96 sizePrecision,
            address baseAsset,
            uint256 baseAssetDecimals,
            address quoteAsset,
            uint256 quoteAssetDecimals,
            uint32 tickSize,
            uint96 minSize,
            uint96 maxSize,
            uint256 takerFeeBps,
            uint256 makerFeeBps
        );
}
