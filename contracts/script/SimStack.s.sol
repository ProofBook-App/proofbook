// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {IPerplExchange} from "../src/interfaces/external/IPerplExchange.sol";
import {SimKuruOrderBook} from "../src/sim/SimKuruOrderBook.sol";
import {SimPerplExchange} from "../src/sim/SimPerplExchange.sol";
import {SimToken} from "../src/sim/SimToken.sol";
import {Chains} from "./Chains.sol";
import {Deploy} from "./Deploy.s.sol";
import {HouseAgent} from "./HouseAgent.s.sol";

/// @notice TESTNET ONLY. Deploys the simulated venues (src/sim/) and runs the production deploy scripts
/// against them: an AgentRegistry for simAUSD + simUSDC, one Perpl house agent and one Kuru house agent.
/// The adapters, vaults and registry are the production contracts; only the venues and tokens are sims.
///
/// Env: GUARDIAN_ADDRESS, SESSION_KEY. After it runs, paste the printed addresses into Chains.testnetSim().
/// Dry run:  forge script script/SimStack.s.sol --rpc-url monad_testnet --sender <deployer>
/// Broadcast: add --broadcast --private-key $DEPLOYER_PK --slow
contract SimStack is Script {
    /// @dev Mainnet values: 10 AUSD minimum account open. Spreads roughly match the real books
    /// (Kuru MON-USDC was 27578/27614 on 2026-09-29, about +/-0.065%).
    uint256 internal constant MIN_ACCOUNT_OPEN = 10e6;
    uint256 internal constant PERPL_SPREAD_PER_100K = 50;
    uint256 internal constant KURU_SPREAD_PER_100K = 65;

    struct Deployed {
        Chains.Config config;
        AgentRegistry registry;
        uint256 perplAgentId;
        address perplVault;
        address perplAdapter;
        uint256 kuruAgentId;
        address kuruVault;
        address kuruAdapter;
    }

    function run() external returns (Deployed memory) {
        return deploy(msg.sender, vm.envAddress("GUARDIAN_ADDRESS"), vm.envAddress("SESSION_KEY"));
    }

    /// @param owner The broadcaster: owns the sim tokens and venues (lists perps, sets minters).
    function deploy(address owner, address guardian, address sessionKey) public returns (Deployed memory out) {
        require(block.chainid == Chains.TESTNET, "SimStack: testnet only");
        Chains.Config memory c = deployVenues(owner);
        out.config = c;
        out.registry = new Deploy().deploy(guardian, c);

        HouseAgent house = new HouseAgent();
        HouseAgent.Params memory p = HouseAgent.Params({
            registry: out.registry,
            sessionKey: sessionKey,
            kuru: false,
            agentURI: "https://proofbook.app/agents/sim-house-perpl-1.json",
            maxTrade: 100e6,
            dailyLossBps: 1_000,
            depositCap: 500e6
        });
        (out.perplAgentId, out.perplVault, out.perplAdapter) = house.deploy(p, c);
        p.kuru = true;
        p.agentURI = "https://proofbook.app/agents/sim-house-kuru-1.json";
        (out.kuruAgentId, out.kuruVault, out.kuruAdapter) = house.deploy(p, c);

        console2.log("--- Chains.testnetSim()");
        console2.log("ausd (simAUSD)", c.ausd);
        console2.log("usdc (simUSDC)", c.usdc);
        console2.log("perplExchange (SimPerplExchange)", c.perplExchange);
        console2.log("kuruMonUsdc (SimKuruOrderBook)", c.kuruMonUsdc);
    }

    /// @notice Tokens and venues only. Prices come from the real Perpl testnet Exchange.
    function deployVenues(address owner) public returns (Chains.Config memory c) {
        Chains.Config memory real = Chains.get(Chains.TESTNET);
        vm.startBroadcast();
        SimToken ausd = new SimToken("Proofbook Sim AUSD (testnet, no value)", "simAUSD", 6, owner);
        SimToken usdc = new SimToken("Proofbook Sim USDC (testnet, no value)", "simUSDC", 6, owner);
        SimPerplExchange perpl = new SimPerplExchange(
            ausd, IPerplExchange(real.perplExchange), MIN_ACCOUNT_OPEN, PERPL_SPREAD_PER_100K, owner
        );
        // Max leverage probed on Perpl testnet 2026-09-29.
        perpl.listPerp(16, 1_500); // BTC
        perpl.listPerp(32, 1_200); // ETH
        perpl.listPerp(48, 1_000); // SOL
        perpl.listPerp(real.perplMonPerpId, 300); // MON
        SimKuruOrderBook kuru = new SimKuruOrderBook(
            usdc, IPerplExchange(address(perpl)), real.perplMonPerpId, KURU_SPREAD_PER_100K, owner
        );
        ausd.setMinter(address(perpl), true);
        usdc.setMinter(address(kuru), true);
        vm.stopBroadcast();

        c.identity = real.identity;
        c.ausd = address(ausd);
        c.usdc = address(usdc);
        c.perplExchange = address(perpl);
        c.perplMonPerpId = real.perplMonPerpId;
        c.kuruMonUsdc = address(kuru);
    }
}
