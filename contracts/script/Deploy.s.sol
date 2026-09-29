// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {IIdentityRegistry} from "../src/interfaces/IIdentityRegistry.sol";
import {Chains} from "./Chains.sol";

/// @notice Deploys AgentRegistry with the chain's vault assets allowlisted (AUSD, plus USDC on mainnet).
///
/// Env: GUARDIAN_ADDRESS (can freeze any vault).
/// Dry run:  forge script script/Deploy.s.sol --rpc-url monad_testnet --sender <deployer>
/// Broadcast (human approval for mainnet): add --broadcast --private-key $DEPLOYER_PK --slow
contract Deploy is Script {
    function run() external returns (AgentRegistry) {
        return deploy(vm.envAddress("GUARDIAN_ADDRESS"));
    }

    function deploy(address guardian) public returns (AgentRegistry registry) {
        Chains.Config memory c = Chains.get(block.chainid);

        IERC20[] memory assets = new IERC20[](c.usdc == address(0) ? 1 : 2);
        assets[0] = IERC20(c.ausd);
        if (c.usdc != address(0)) assets[1] = IERC20(c.usdc);

        vm.startBroadcast();
        registry = new AgentRegistry(IIdentityRegistry(c.identity), guardian, assets);
        vm.stopBroadcast();

        console2.log("chain", block.chainid);
        console2.log("AgentRegistry", address(registry));
        console2.log("guardian", guardian);
    }
}
