// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentRegistry} from "../../src/AgentRegistry.sol";
import {AgentVault} from "../../src/AgentVault.sol";
import {PerplAdapter} from "../../src/adapters/PerplAdapter.sol";
import {IPerplExchange} from "../../src/interfaces/external/IPerplExchange.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {HouseAgent} from "../../script/HouseAgent.s.sol";
import {Chains} from "../../script/Chains.sol";
import {SimStack} from "../../script/SimStack.s.sol";
import {KuruAdapter} from "../../src/adapters/KuruAdapter.sol";
import {SimToken} from "../../src/sim/SimToken.sol";

/// @notice Runs the deploy scripts on testnet and mainnet forks (nothing is broadcast), then
/// trades the testnet house vault on Perpl testnet.
contract DeployForkTest is Test {
    address guardian = makeAddr("guardian");
    address sessionKey = makeAddr("sessionKey");
    address alice = makeAddr("alice");

    function _house(AgentRegistry registry, bool kuru) internal returns (AgentVault vault, address adapter) {
        (uint256 agentId, address v, address a) = new HouseAgent()
            .deploy(
                HouseAgent.Params({
                    registry: registry,
                    sessionKey: sessionKey,
                    kuru: kuru,
                    agentURI: "https://proofbook.app/agents/house-1.json",
                    maxTrade: 100e6,
                    dailyLossBps: 1_000,
                    depositCap: 500e6
                })
            );
        vault = AgentVault(payable(v));
        adapter = a;
        assertEq(registry.vaultOf(agentId), v);
        assertEq(vault.sessionKey(), sessionKey);
        assertEq(vault.guardian(), guardian);
        assertTrue(vault.isVenueAllowed(a));
        assertEq(PerplAdapter(a).vault(), v, "adapter bound");
        assertEq(vault.maxTradeNotional(), 100e6);
        assertEq(vault.depositCapPerBacker(), 500e6);
    }

    function test_mainnet_deployPerplAndKuruHouseAgents() public {
        vm.createSelectFork(vm.envOr("MONAD_RPC_URL", string("https://rpc.monad.xyz")));
        Chains.Config memory c = Chains.get(block.chainid);
        AgentRegistry registry = new Deploy().deploy(guardian);
        assertTrue(registry.isAllowedAsset(IERC20(c.ausd)));
        assertTrue(registry.isAllowedAsset(IERC20(c.usdc)));
        (AgentVault vault,) = _house(registry, false);
        assertEq(vault.asset(), c.ausd);
        (AgentVault kv,) = _house(registry, true);
        assertEq(kv.asset(), c.usdc);
    }

    function test_testnet_deployAndTradePerpl() public {
        vm.createSelectFork("https://testnet-rpc.monad.xyz");
        Chains.Config memory c = Chains.get(block.chainid);
        AgentRegistry registry = new Deploy().deploy(guardian);
        assertTrue(registry.isAllowedAsset(IERC20(c.ausd)));
        (AgentVault vault, address adapter) = _house(registry, false);
        assertEq(vault.asset(), c.ausd);

        HouseAgent kuruScript = new HouseAgent();
        HouseAgent.Params memory kp;
        kp.kuru = true;
        vm.expectRevert(bytes("HouseAgent: Kuru v1 not on this chain"));
        kuruScript.deploy(kp);

        // Backer deposits; the agent opens a Perpl account and trades. Testnet minimum open is 100 AUSD.
        _dealAUSD(IERC20(c.ausd), alice, 500e6);
        vm.startPrank(alice);
        IERC20(c.ausd).approve(address(vault), type(uint256).max);
        vault.deposit(500e6, alice);
        vm.stopPrank();

        vm.prank(sessionKey);
        vault.execute(adapter, abi.encode(uint8(0), abi.encode(uint256(100e6))));
        assertEq(vault.nav(), 500e6, "margin move is NAV-neutral");

        IPerplExchange ex = IPerplExchange(c.perplExchange);
        uint256[2] memory perps = [c.perplMonPerpId, uint256(256)]; // bank1 and bank2 of the bitmap
        uint256 opened;
        for (uint256 i; i < 2; ++i) {
            IPerplExchange.PerpetualInfo memory p = ex.getPerpetualInfo(perps[i]);
            uint256 ask = p.basePricePNS + p.minAskPriceONS;
            if (p.minAskPriceONS == 0 || ask > p.markPNS * 102 / 100) continue; // no usable ask on testnet
            uint256 lot = 20e6 * 10 ** (p.priceDecimals + p.lotDecimals) / 1e6 / ask; // ~$20
            if (lot == 0) continue;
            IPerplExchange.OrderDesc memory d;
            d.perpId = perps[i];
            d.pricePNS = ask + ask / 200;
            d.lotLNS = lot;
            d.expiryBlock = block.number + 1_000;
            d.immediateOrCancel = true;
            d.leverageHdths = 100;
            d.maxNegPnlCollatBPS = 300;
            vm.prank(sessionKey);
            try vault.execute(adapter, abi.encode(uint8(2), abi.encode(d))) {
                opened++;
            } catch {}
        }
        emit log_named_uint("testnet positions opened", opened);
        // Exposure must equal free margin + every position's margin and PnL. Perp 256 sits in
        // bank2 of Perpl's bitmap and perp 64 at bank1 bit 253, so this also guards against
        // valuing positions off the bitmap.
        IPerplExchange.AccountInfo memory ai = ex.getAccountByAddr(adapter);
        uint256 expected = ai.balanceCNS;
        for (uint256 i; i < 2; ++i) {
            (IPerplExchange.PositionInfo memory pos,,) = ex.getPosition(perps[i], ai.accountId);
            expected = uint256(int256(expected) + int256(pos.depositCNS) + pos.pnlCNS);
        }
        assertEq(PerplAdapter(adapter).exposure(address(vault)), expected, "every position counted");
        assertApproxEqRel(vault.nav(), 500e6, 0.01e18, "positions valued near cost");
        assertFalse(vault.frozen());
    }

    /// The testnet sim stack: production registry, vaults and adapters on sim venues with live Perpl prices.
    function test_testnet_simStack_deployAndTrade() public {
        vm.createSelectFork("https://testnet-rpc.monad.xyz");
        // Scripts broadcast from forge's default sender, which therefore owns the sim venues.
        SimStack.Deployed memory out = new SimStack().deploy(DEFAULT_SENDER, guardian, sessionKey);
        Chains.Config memory c = out.config;
        assertTrue(out.registry.isAllowedAsset(IERC20(c.ausd)));
        assertTrue(out.registry.isAllowedAsset(IERC20(c.usdc)));
        AgentVault pv = AgentVault(payable(out.perplVault));
        AgentVault kv = AgentVault(payable(out.kuruVault));
        assertEq(out.registry.vaultOf(out.perplAgentId), out.perplVault);
        assertEq(pv.asset(), c.ausd);
        assertEq(kv.asset(), c.usdc);
        assertEq(pv.sessionKey(), sessionKey);
        address pa = out.perplAdapter;
        address ka = out.kuruAdapter;
        assertEq(PerplAdapter(pa).vault(), out.perplVault);

        // Perpl: backer deposits simAUSD, agent opens a MON long at live testnet prices.
        vm.startPrank(alice);
        SimToken(c.ausd).faucet(alice, 500e6);
        IERC20(c.ausd).approve(address(pv), type(uint256).max);
        pv.deposit(500e6, alice);
        vm.stopPrank();
        vm.startPrank(sessionKey);
        pv.execute(pa, abi.encode(uint8(0), abi.encode(uint256(100e6))));
        IPerplExchange.PerpetualInfo memory p = IPerplExchange(c.perplExchange).getPerpetualInfo(c.perplMonPerpId);
        IPerplExchange.OrderDesc memory d;
        d.perpId = c.perplMonPerpId;
        d.pricePNS = (p.basePricePNS + p.minAskPriceONS) * 1005 / 1000;
        d.lotLNS = 20e6 * 10 ** (p.priceDecimals + p.lotDecimals) / 1e6 / p.markPNS; // ~$20
        d.expiryBlock = block.number + 100;
        d.immediateOrCancel = true;
        d.leverageHdths = 100;
        d.maxNegPnlCollatBPS = 300;
        pv.execute(pa, abi.encode(uint8(2), abi.encode(d)));
        vm.stopPrank();
        assertGt(PerplAdapter(pa).exposure(address(pv)), 99e6);
        assertApproxEqRel(pv.nav(), 500e6, 0.002e18);

        // Kuru: the book needs MON inventory for buys.
        vm.deal(c.kuruMonUsdc, 10_000 ether);
        vm.startPrank(alice);
        SimToken(c.usdc).faucet(alice, 500e6);
        IERC20(c.usdc).approve(address(kv), type(uint256).max);
        kv.deposit(500e6, alice);
        vm.stopPrank();
        vm.prank(sessionKey);
        kv.execute(ka, abi.encode(uint8(0), abi.encode(uint256(20e6), uint256(0))));
        assertGt(ka.balance, 0);
        assertApproxEqRel(kv.nav(), 500e6, 0.003e18);
        vm.prank(sessionKey);
        kv.execute(ka, abi.encode(uint8(1), abi.encode(ka.balance / 1e8 * 1e8, uint256(0))));
        assertApproxEqRel(IERC20(c.usdc).balanceOf(address(kv)), 500e6, 0.003e18);
        assertEq(address(KuruAdapter(payable(ka)).market()), c.kuruMonUsdc);
    }

    /// AUSD packs {uint8 flags; uint248 balance} in one slot, so forge `deal` can't be used.
    function _dealAUSD(IERC20 token, address to, uint256 amount) internal {
        vm.record();
        token.balanceOf(to);
        (bytes32[] memory reads,) = vm.accesses(address(token));
        bytes32 slot = reads[reads.length - 1];
        uint256 cur = uint256(vm.load(address(token), slot));
        vm.store(address(token), slot, bytes32((amount << 8) | (cur & 0xff)));
        assertEq(token.balanceOf(to), amount, "deal layout");
    }
}
