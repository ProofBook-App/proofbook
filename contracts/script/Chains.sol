// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Per-chain external addresses. Every address here was checked with `cast code` on its
/// chain (2026-09-29). Sources: docs/reference/{monad,erc-8004,perpl,kuru}.md.
library Chains {
    struct Config {
        address identity; // ERC-8004 IdentityRegistry
        address ausd;
        address usdc; // 0 where unused
        address perplExchange;
        uint256 perplMonPerpId;
        address kuruMonUsdc; // 0 where Kuru v1 is not deployed
    }

    uint256 internal constant MAINNET = 143;
    uint256 internal constant TESTNET = 10143;

    function get(uint256 chainId) internal pure returns (Config memory c) {
        if (chainId == MAINNET) {
            c.identity = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;
            c.ausd = 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a;
            c.usdc = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
            c.perplExchange = 0x34B6552d57a35a1D042CcAe1951BD1C370112a6F;
            c.perplMonPerpId = 10;
            c.kuruMonUsdc = 0x065C9d28E428A0db40191a54d33d5b7c71a9C394;
        } else if (chainId == TESTNET) {
            c.identity = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
            c.ausd = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC; // Perpl testnet collateral
            c.perplExchange = 0x1964C32f0bE608E7D29302AFF5E61268E72080cc;
            c.perplMonPerpId = 64;
            // Kuru testnet runs v2 (AccountCore), which KuruAdapter does not target.
        } else {
            revert("Chains: unsupported chain");
        }
    }

    /// @notice TESTNET SIMULATION venues and tokens (src/sim/), deployed by script/SimStack.s.sol on
    /// 2026-09-29 and checked with `cast code` on 10143.
    /// Same shape as the real config: the production adapters and scripts run unchanged against it,
    /// and mainnet uses get(143) instead. Tokens are valueless SimTokens; prices come from real Perpl testnet.
    function testnetSim() internal pure returns (Config memory c) {
        c.identity = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
        c.ausd = 0x6EB7ffECEeC1E4601edF488d6bf731ec6e674b43; // simAUSD
        c.usdc = 0xea363EE500E4683becCffb696E8F6Bb23Edde2E4; // simUSDC
        c.perplExchange = 0xD7A49a32c77609305DA87411F7Ac34DC7c047683; // SimPerplExchange
        c.perplMonPerpId = 64;
        c.kuruMonUsdc = 0x4c49895eB85f5F20303B55AAa47474e031fe8318; // SimKuruOrderBook
    }
}
