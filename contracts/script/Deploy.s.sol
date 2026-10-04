// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AdapterFactory} from "../src/AdapterFactory.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {IIdentityRegistry} from "../src/interfaces/IIdentityRegistry.sol";
import {IKuruOrderBook} from "../src/interfaces/external/IKuruOrderBook.sol";
import {IPerplExchange} from "../src/interfaces/external/IPerplExchange.sol";
import {Chains} from "./Chains.sol";

/// @notice Deploys the AdapterFactory (this chain's canonical Perpl and Kuru addresses) and an
/// AgentRegistry that accepts only its adapters, with the chain's vault assets allowlisted (AUSD,
/// plus USDC on mainnet). Three transactions: factory, registry, factory.setRegistry.
///
/// Env: GUARDIAN_ADDRESS (can freeze any vault).
/// Dry run:  forge script script/Deploy.s.sol --rpc-url monad_testnet --sender <deployer>
/// Broadcast (human approval for mainnet): add --broadcast --private-key $DEPLOYER_PK --slow
contract Deploy is Script {
    function run() external returns (AgentRegistry) {
        return deploy(vm.envAddress("GUARDIAN_ADDRESS"));
    }

    function deploy(address guardian) public returns (AgentRegistry registry) {
        return deploy(guardian, Chains.get(block.chainid));
    }

    /// @dev `c` is Chains.get for the real venues, or a testnet sim config (script/SimStack.s.sol).
    function deploy(address guardian, Chains.Config memory c) public returns (AgentRegistry registry) {
        IERC20[] memory assets = new IERC20[](c.usdc == address(0) ? 1 : 2);
        assets[0] = IERC20(c.ausd);
        if (c.usdc != address(0)) assets[1] = IERC20(c.usdc);

        vm.startBroadcast();
        AdapterFactory factory = new AdapterFactory(
            IPerplExchange(c.perplExchange),
            IERC20(c.ausd),
            IKuruOrderBook(c.kuruMonUsdc),
            IERC20(c.usdc),
            IPerplExchange(c.perplExchange),
            c.perplMonPerpId,
            c.kuruMaxHeld
        );
        registry = new AgentRegistry(IIdentityRegistry(c.identity), guardian, assets, factory);
        factory.setRegistry(address(registry));
        vm.stopBroadcast();

        console2.log("chain", block.chainid);
        console2.log("AdapterFactory", address(factory));
        console2.log("AgentRegistry", address(registry));
        console2.log("guardian", guardian);
    }
}
