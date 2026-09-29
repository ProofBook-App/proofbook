// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {IPerplExchange} from "../src/interfaces/external/IPerplExchange.sol";
import {SimToken} from "../src/sim/SimToken.sol";
import {Chains} from "./Chains.sol";

/// @notice TESTNET SIM ONLY. Seeds activity on a sim Perpl house vault: a backer draws simAUSD from
/// the faucet and deposits, then the session key moves margin to the venue and opens a small MON long
/// at the live Perpl testnet price. Every call goes through the production vault and adapter.
///
/// Env: VAULT, BACKER_PK, SESSION_KEY_PK. Optional DEPOSIT (default 400e6), MARGIN (100e6, at most the max trade), LONG_USD (50e6).
/// forge script script/SimDemo.s.sol --rpc-url monad_testnet --broadcast --slow
contract SimDemo is Script {
    function run() external {
        require(block.chainid == Chains.TESTNET, "SimDemo: testnet only");
        Chains.Config memory c = Chains.testnetSim();
        AgentVault vault = AgentVault(payable(vm.envAddress("VAULT")));
        require(vault.asset() == c.ausd, "SimDemo: not a sim Perpl vault");
        address adapter = vault.venues()[0];
        uint256 deposit = vm.envOr("DEPOSIT", uint256(400e6));
        uint256 margin = vm.envOr("MARGIN", uint256(100e6));
        uint256 longUsd = vm.envOr("LONG_USD", uint256(50e6));

        uint256 backerPk = vm.envUint("BACKER_PK");
        address backer = vm.addr(backerPk);
        vm.startBroadcast(backerPk);
        SimToken(c.ausd).faucet(backer, deposit);
        IERC20(c.ausd).approve(address(vault), deposit);
        vault.deposit(deposit, backer);
        vm.stopBroadcast();

        IPerplExchange.PerpetualInfo memory p = IPerplExchange(c.perplExchange).getPerpetualInfo(c.perplMonPerpId);
        IPerplExchange.OrderDesc memory d;
        d.perpId = c.perplMonPerpId;
        d.orderType = 0; // OpenLong
        d.pricePNS = (p.basePricePNS + p.minAskPriceONS) * 1005 / 1000; // ask + 0.5%, inside the 3% band
        d.lotLNS = longUsd * 10 ** (p.priceDecimals + p.lotDecimals) / 1e6 / p.markPNS;
        d.expiryBlock = block.number + 1_000;
        d.immediateOrCancel = true;
        d.leverageHdths = 100;
        d.maxNegPnlCollatBPS = 300;

        vm.startBroadcast(vm.envUint("SESSION_KEY_PK"));
        vault.execute(adapter, abi.encode(uint8(0), abi.encode(margin))); // DEPOSIT margin
        vault.execute(adapter, abi.encode(uint8(2), abi.encode(d))); // ORDER
        vm.stopBroadcast();

        console2.log("vault", address(vault));
        console2.log("nav", vault.nav());
        console2.log("MON lots", d.lotLNS);
    }
}
