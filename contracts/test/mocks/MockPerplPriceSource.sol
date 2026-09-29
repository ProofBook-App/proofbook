// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPerplExchange} from "../../src/interfaces/external/IPerplExchange.sol";

/// @notice Stands in for the real Perpl Exchange as the sims' price source in local tests. Only
/// getPerpetualInfo is implemented; mark and oracle move together and are always fresh.
contract MockPerplPriceSource {
    mapping(uint256 => IPerplExchange.PerpetualInfo) internal _info;

    function list(uint256 perpId, string calldata symbol, uint256 priceDecimals, uint256 lotDecimals, uint256 markPNS)
        external
    {
        IPerplExchange.PerpetualInfo storage p = _info[perpId];
        p.name = string.concat(symbol, " Perp");
        p.symbol = symbol;
        p.priceDecimals = priceDecimals;
        p.lotDecimals = lotDecimals;
        p.refPriceMaxAgeSec = 60;
        p.status = 4;
        setMark(perpId, markPNS);
    }

    function setMark(uint256 perpId, uint256 markPNS) public {
        IPerplExchange.PerpetualInfo storage p = _info[perpId];
        p.markPNS = markPNS;
        p.oraclePNS = markPNS;
        p.markTimestamp = block.timestamp;
        p.oracleTimestampSec = block.timestamp;
    }

    function getPerpetualInfo(uint256 perpId) external view returns (IPerplExchange.PerpetualInfo memory) {
        return _info[perpId];
    }
}
