// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The subset of the Perpl Exchange (mainnet proxy 0x34B6552d57a35a1D042CcAe1951BD1C370112a6F)
/// that PerplAdapter uses. Struct layouts must match the deployed ABI exactly because they are
/// ABI-decoded from return data; they were checked on a mainnet fork on 2026-09-29.
/// See docs/reference/perpl.md.
interface IPerplExchange {
    struct PositionBitMap {
        uint256 bank1;
        uint256 bank2;
        uint256 bank3;
        uint256 bank4;
    }

    /// @dev balanceCNS includes lockedBalanceCNS (collateral reserved by resting orders).
    /// Position margin is not in balanceCNS; it is PositionInfo.depositCNS.
    /// Bit `i` of bank `b` is set when the account holds a position in perp `b * 256 + i`.
    struct AccountInfo {
        uint256 accountId;
        uint256 balanceCNS;
        uint256 lockedBalanceCNS;
        uint8 frozen;
        address accountAddr;
        PositionBitMap positions;
    }

    struct OrderDesc {
        uint256 orderDescId;
        uint256 perpId;
        uint8 orderType; // 0 OpenLong, 1 OpenShort, 2 CloseLong, 3 CloseShort, 4 Cancel, 5 IncreaseCollateral, 6 Change
        uint256 orderId;
        uint256 pricePNS;
        uint256 lotLNS;
        uint256 expiryBlock;
        bool postOnly;
        bool fillOrKill;
        bool immediateOrCancel;
        uint256 maxMatches;
        uint256 leverageHdths; // 100 = 1x
        uint256 lastExecutionBlock;
        uint256 amountCNS;
        uint256 maxNegPnlCollatBPS; // 0 onchain refuses any negative-PnL fill; 300 is the API default
    }

    struct OrderSignature {
        uint256 perpId;
        uint256 orderId;
    }

    struct PerpetualInfo {
        string name;
        string symbol;
        uint256 priceDecimals;
        uint256 lotDecimals;
        bytes32 linkFeedId;
        uint256 priceTolPer100K;
        uint256 marginTol;
        uint256 marginTolDecimals;
        uint256 refPriceMaxAgeSec;
        uint256 positionBalanceCNS;
        uint256 insuranceBalanceCNS;
        uint256 markPNS;
        uint256 markTimestamp;
        uint256 lastPNS;
        uint256 lastTimestamp;
        uint256 oraclePNS;
        uint256 oracleTimestampSec;
        uint256 longOpenInterestLNS;
        uint256 shortOpenInterestLNS;
        uint256 fundingStartBlock;
        int16 fundingRatePct100k;
        uint256 absFundingClampPctPer100K;
        uint8 status;
        uint256 basePricePNS;
        uint256 maxBidPriceONS;
        uint256 minBidPriceONS;
        uint256 maxAskPriceONS;
        uint256 minAskPriceONS;
        uint256 numOrders;
        bool ignOracle;
    }

    /// @dev pnlCNS is the position's PnL at mark in collateral units. On the fork it equalled
    /// deltaPnlCNS with premiumPnlCNS (funding) at zero; that it includes funding is unverified.
    struct PositionInfo {
        uint256 accountId;
        uint256 nextNodeId;
        uint256 prevNodeId;
        uint8 positionType; // 0 long, 1 short
        uint256 depositCNS;
        uint256 pricePNS;
        uint256 lotLNS;
        uint256 entryBlock;
        int256 pnlCNS;
        int256 deltaPnlCNS;
        int256 premiumPnlCNS;
    }

    /// @notice Opens an account for msg.sender, pulling `amountCNS` collateral by transferFrom.
    function createAccount(uint256 amountCNS) external returns (uint256 accountId);
    function depositCollateral(uint256 amountCNS) external;
    /// @notice Pays msg.sender. Rate-limited exchange-wide (getWithdrawAllowanceData).
    function withdrawCollateral(uint256 amountCNS) external;
    function execOrder(OrderDesc memory orderDesc) external returns (OrderSignature memory signature);

    function getAccountByAddr(address accountAddress) external view returns (AccountInfo memory accountInfo);
    function getPerpetualInfo(uint256 perpId) external view returns (PerpetualInfo memory perpetualInfo);
    function getPosition(uint256 perpId, uint256 accountId)
        external
        view
        returns (PositionInfo memory positionInfo, uint256 markPricePNS, bool markPriceValid);
    function getMinAccountOpenCNS() external view returns (uint256);
    function getExchangeInfo()
        external
        view
        returns (
            uint256 balanceCNS,
            uint256 protocolBalanceCNS,
            uint256 recycleBalanceCNS,
            uint256 collateralDecimals,
            address collateralToken,
            address verifierProxy
        );
}
