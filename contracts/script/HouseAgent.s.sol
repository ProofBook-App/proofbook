// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AdapterFactory} from "../src/AdapterFactory.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {RiskEnvelope} from "../src/interfaces/IAgentRegistry.sol";
import {Chains} from "./Chains.sol";

interface IIdentityRegister {
    function register(string calldata agentURI) external returns (uint256 agentId);
}

/// @notice Enters one house agent: register an ERC-8004 identity (minted to the broadcaster),
/// deploy its venue adapter through the registry's AdapterFactory, enter it into Proofbook (the
/// registry binds the adapter to the new vault).
///
/// Env:
///   REGISTRY           AgentRegistry address
///   SESSION_KEY        address that will trade the vault (Privy server wallet for house agents)
///   VENUE              "perpl" (AUSD vault) or "kuru" (USDC vault, mainnet only)
///   AGENT_URI          ERC-8004 agentURI, e.g. https://proofbook.app/agents/house-1.json
///   MAX_TRADE          optional, asset units (6 dp). Default 100e6
///   DAILY_LOSS_BPS     optional. Default 1000 (10%)
///   DEPOSIT_CAP        optional, per backer (6 dp). Default 500e6
///   SIM                optional, true = testnet sim venues and tokens (Chains.testnetSim)
contract HouseAgent is Script {
    struct Params {
        AgentRegistry registry;
        address sessionKey;
        bool kuru;
        string agentURI;
        uint256 maxTrade;
        uint16 dailyLossBps;
        uint256 depositCap;
    }

    function run() external returns (uint256, address, address) {
        Chains.Config memory c = vm.envOr("SIM", false) ? Chains.testnetSim() : Chains.get(block.chainid);
        return deploy(
            Params({
                registry: AgentRegistry(vm.envAddress("REGISTRY")),
                sessionKey: vm.envAddress("SESSION_KEY"),
                kuru: keccak256(bytes(vm.envString("VENUE"))) == keccak256("kuru"),
                agentURI: vm.envString("AGENT_URI"),
                maxTrade: vm.envOr("MAX_TRADE", uint256(100e6)),
                dailyLossBps: uint16(vm.envOr("DAILY_LOSS_BPS", uint256(1_000))),
                depositCap: vm.envOr("DEPOSIT_CAP", uint256(500e6))
            }),
            c
        );
    }

    function deploy(Params memory p) public returns (uint256, address, address) {
        return deploy(p, Chains.get(block.chainid));
    }

    /// @dev `c` is Chains.get for the real venues, or a testnet sim config (script/SimStack.s.sol).
    function deploy(Params memory p, Chains.Config memory c)
        public
        returns (uint256 agentId, address vault, address adapter)
    {
        require(!p.kuru || c.kuruMonUsdc != address(0), "HouseAgent: Kuru v1 not on this chain");

        address[] memory venues = new address[](1);
        IERC20 asset = p.kuru ? IERC20(c.usdc) : IERC20(c.ausd);
        RiskEnvelope memory env = RiskEnvelope({
            maxTradeNotional: p.maxTrade,
            dailyLossCapBps: p.dailyLossBps,
            depositCapPerBacker: p.depositCap,
            venues: venues
        });

        vm.startBroadcast();
        agentId = IIdentityRegister(c.identity).register(p.agentURI);
        AdapterFactory factory = AdapterFactory(address(p.registry.adapters()));
        adapter = p.kuru ? factory.deployKuru() : factory.deployPerpl();
        venues[0] = adapter;
        vault = p.registry.enter(agentId, env, p.sessionKey, asset);
        vm.stopBroadcast();

        console2.log("agentId", agentId);
        console2.log("vault", vault);
        console2.log(p.kuru ? "KuruAdapter" : "PerplAdapter", adapter);
        console2.log("sessionKey", p.sessionKey);
    }
}
