// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AdapterFactory} from "../src/AdapterFactory.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {KuruAdapter} from "../src/adapters/KuruAdapter.sol";
import {PerplAdapter} from "../src/adapters/PerplAdapter.sol";
import {VaultBoundAdapter} from "../src/adapters/VaultBoundAdapter.sol";
import {RiskEnvelope} from "../src/interfaces/IAgentRegistry.sol";
import {IAgentVault} from "../src/interfaces/IAgentVault.sol";
import {IVenueAdapter} from "../src/interfaces/IVenueAdapter.sol";
import {IKuruOrderBook} from "../src/interfaces/external/IKuruOrderBook.sol";
import {IPerplExchange} from "../src/interfaces/external/IPerplExchange.sol";
import {SimKuruOrderBook} from "../src/sim/SimKuruOrderBook.sol";
import {SimPerplExchange} from "../src/sim/SimPerplExchange.sol";
import {SimToken} from "../src/sim/SimToken.sol";
import {BaseTest} from "./Base.t.sol";
import {MockIdentityRegistry} from "./mocks/MockIdentityRegistry.sol";
import {MockPerplPriceSource} from "./mocks/MockPerplPriceSource.sol";

/// @notice H1 (docs/security-review.md): while a venue's exposure is incomplete, NAV understates the
/// vault, so a deposit would buy shares cheap and exit at full price once the venue reads again.
/// Deposits pause while any venue is unreliable; withdrawals don't (invariant 4).
contract DepositPauseTest is BaseTest {
    function test_H1_depositsPauseWhileAVenueIsUnreliable() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, 1_000 * ONE_AUSD);
        venue.setUnreliable(address(vault), true);

        assertFalse(vault.venuesReliable());
        assertEq(vault.maxDeposit(bob), 0);
        assertEq(vault.maxMint(bob), 0);

        ausd.mint(bob, 100 * ONE_AUSD);
        vm.startPrank(bob);
        ausd.approve(address(vault), type(uint256).max);
        vm.expectRevert(IAgentVault.ExposureUnreliable.selector);
        vault.deposit(100 * ONE_AUSD, bob);
        vm.expectRevert(IAgentVault.ExposureUnreliable.selector);
        vault.mint(1e6, bob);
        vm.stopPrank();
    }

    function test_H1_withdrawalsStillWorkWhileUnreliable() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, 1_000 * ONE_AUSD);
        venue.setUnreliable(address(vault), true);

        vm.prank(alice);
        vault.withdraw(400 * ONE_AUSD, alice, alice);
        assertEq(ausd.balanceOf(alice), 400 * ONE_AUSD);
        assertEq(vault.maxWithdraw(alice), 600 * ONE_AUSD);
    }

    function test_H1_depositsResumeOnceTheVenueReadsAgain() public {
        (, AgentVault vault) = _enter();
        venue.setUnreliable(address(vault), true);
        venue.setUnreliable(address(vault), false);
        assertTrue(vault.venuesReliable());
        _deposit(vault, bob, 100 * ONE_AUSD);
        assertEq(vault.balanceOf(bob) > 0, true);
    }

    function test_H1_aVenueWhoseCheckRevertsCountsAsUnreliable() public {
        (, AgentVault vault) = _enter();
        vm.mockCallRevert(address(venue), abi.encodeCall(IVenueAdapter.exposureReliable, (address(vault))), "down");
        assertFalse(vault.venuesReliable());
        assertEq(vault.maxDeposit(bob), 0);
    }

    /// @dev The review's numbers: 5,000 idle + 5,000 at the venue; the venue goes stale and reads 0.
    function test_H1_theDiscountDepositIsRefused() public {
        (, AgentVault vault) = _enter();
        _deposit(vault, alice, 5_000 * ONE_AUSD);
        venue.setExposure(address(vault), 5_000 * ONE_AUSD);
        assertEq(vault.nav(), 10_000 * ONE_AUSD);

        venue.setExposure(address(vault), 0); // stale reference: the venue leg reads 0
        venue.setUnreliable(address(vault), true);
        assertEq(vault.nav(), 5_000 * ONE_AUSD);

        ausd.mint(attacker, 5_000 * ONE_AUSD);
        vm.startPrank(attacker);
        ausd.approve(address(vault), type(uint256).max);
        vm.expectRevert(IAgentVault.ExposureUnreliable.selector);
        vault.deposit(5_000 * ONE_AUSD, attacker);
        vm.stopPrank();
        assertEq(vault.balanceOf(attacker), 0);
    }
}

/// @notice The real adapters' exposureReliable (H1), and H2: a frozen vault's resting Perpl orders can
/// be cancelled by anyone, and no order may rest for long in the first place.
contract AdapterReliabilityTest is Test {
    uint256 constant PERPL_MON = 64; // price dp 5, lot dp 0
    uint256 constant KURU_MON = 10; // reference perp for Kuru: price dp 6
    uint8 constant DEPOSIT = 0;
    uint8 constant ORDER = 2;
    uint8 constant OPEN_LONG = 0;
    uint8 constant CANCEL = 4;

    address owner = makeAddr("owner");
    address guardian = makeAddr("guardian");
    address sessionKey = makeAddr("sessionKey");
    address alice = makeAddr("alice");
    address anyone = makeAddr("anyone");

    SimToken ausd;
    SimToken usdc;
    MockPerplPriceSource source;
    SimPerplExchange ex;
    SimKuruOrderBook book;
    MockIdentityRegistry identity;
    AdapterFactory factory;
    AgentRegistry registry;

    function setUp() public {
        ausd = new SimToken("Proofbook Sim AUSD (testnet, no value)", "simAUSD", 6, owner);
        usdc = new SimToken("Proofbook Sim USDC (testnet, no value)", "simUSDC", 6, owner);
        source = new MockPerplPriceSource();
        source.list(PERPL_MON, "MON", 5, 0, 2766);
        source.list(KURU_MON, "MON", 6, 0, 27_596);
        ex = new SimPerplExchange(ausd, IPerplExchange(address(source)), 10e6, 50, owner);
        book = new SimKuruOrderBook(usdc, IPerplExchange(address(source)), KURU_MON, 65, owner);
        vm.startPrank(owner);
        ex.listPerp(PERPL_MON, 300);
        ausd.setMinter(address(ex), true);
        usdc.setMinter(address(book), true);
        vm.stopPrank();

        identity = new MockIdentityRegistry();
        factory = new AdapterFactory(
            IPerplExchange(address(ex)),
            ausd,
            IKuruOrderBook(address(book)),
            usdc,
            IPerplExchange(address(source)),
            KURU_MON,
            10_000e6
        );
        IERC20[] memory assets = new IERC20[](2);
        assets[0] = ausd;
        assets[1] = usdc;
        registry = new AgentRegistry(identity, guardian, assets, factory);
        factory.setRegistry(address(registry));
    }

    // ------------------------------------------------------------------ H1, Perpl

    function test_H1_perplUnreadableAccountPausesDeposits() public {
        (AgentVault vault, PerplAdapter adapter) = _perplVault();
        assertTrue(adapter.exposureReliable(address(vault)));

        vm.mockCallRevert(address(ex), abi.encodeWithSelector(IPerplExchange.getAccountByAddr.selector), "upgraded");
        assertFalse(adapter.exposureReliable(address(vault)));
        assertEq(adapter.exposure(address(vault)), 0, "the Perpl leg reads 0");
        assertEq(vault.maxDeposit(alice), 0);

        // Idle funds still leave (invariant 4).
        vm.prank(alice);
        vault.withdraw(100e6, alice, alice);
    }

    function test_H1_perplWithNoAccountIsReliable() public {
        address adapter = factory.deployPerpl();
        address[] memory venues = new address[](1);
        venues[0] = adapter;
        AgentVault vault = _enter(venues, ausd);
        assertTrue(PerplAdapter(adapter).exposureReliable(address(vault)));
        assertTrue(vault.venuesReliable());
    }

    // ------------------------------------------------------------------ H1, Kuru

    function test_H1_kuruStaleReferenceWithMonHeldPausesDeposits() public {
        address adapter = factory.deployKuru();
        address[] memory venues = new address[](1);
        venues[0] = adapter;
        AgentVault vault = _enter(venues, usdc);

        assertTrue(KuruAdapter(payable(adapter)).exposureReliable(address(vault)), "no MON held");
        vm.deal(adapter, 1_000 ether);
        assertTrue(KuruAdapter(payable(adapter)).exposureReliable(address(vault)), "fresh reference");

        vm.warp(block.timestamp + KuruAdapter(payable(adapter)).MAX_REFERENCE_AGE() + 1);
        assertFalse(KuruAdapter(payable(adapter)).exposureReliable(address(vault)));
        assertEq(KuruAdapter(payable(adapter)).exposure(address(vault)), 0, "held MON reads 0");
        assertFalse(vault.venuesReliable());
        assertEq(vault.maxDeposit(alice), 0);

        source.setMark(KURU_MON, 27_596); // the reference refreshes
        assertTrue(vault.venuesReliable());
    }

    // ------------------------------------------------------------------ H2

    function test_H2_ordersMustExpireWithinTheCap() public {
        (AgentVault vault, PerplAdapter adapter) = _perplVault();
        uint256 cap = adapter.MAX_ORDER_BLOCKS();

        IPerplExchange.OrderDesc memory d = _order(OPEN_LONG, block.number + cap + 1);
        vm.prank(sessionKey);
        vm.expectRevert(
            abi.encodeWithSelector(PerplAdapter.OrderExpiryTooFar.selector, block.number + cap + 1, block.number + cap)
        );
        vault.execute(address(adapter), abi.encode(ORDER, abi.encode(d)));

        d.expiryBlock = 0; // no expiry at all
        vm.prank(sessionKey);
        vm.expectRevert(abi.encodeWithSelector(PerplAdapter.OrderExpiryTooFar.selector, 0, block.number + cap));
        vault.execute(address(adapter), abi.encode(ORDER, abi.encode(d)));

        d.expiryBlock = block.number + cap; // the longest allowed
        vm.prank(sessionKey);
        vault.execute(address(adapter), abi.encode(ORDER, abi.encode(d)));
    }

    /// @dev The session key may still cancel its own orders while the vault trades; a cancel has no expiry.
    function test_H2_cancelsAreNotSubjectToTheExpiryCap() public {
        (, PerplAdapter adapter) = _perplVault();
        IPerplExchange.OrderDesc memory d;
        d.perpId = PERPL_MON;
        d.orderType = CANCEL;
        d.orderId = 7;
        assertEq(adapter.quoteNotional(abi.encode(ORDER, abi.encode(d))), 0);
    }

    function test_H2_anyoneCanCancelARestingOrderOnceFrozen() public {
        (AgentVault vault, PerplAdapter adapter) = _perplVault();
        vm.prank(guardian);
        vault.freeze();

        IPerplExchange.OrderDesc memory d;
        d.perpId = PERPL_MON;
        d.orderType = CANCEL;
        d.orderId = 42;
        // The sim fills or drops every order, so stand in for a resting order the Exchange cancels.
        vm.mockCall(
            address(ex),
            abi.encodeCall(IPerplExchange.execOrder, (d)),
            abi.encode(IPerplExchange.OrderSignature({perpId: PERPL_MON, orderId: 42}))
        );
        vm.expectCall(address(ex), abi.encodeCall(IPerplExchange.execOrder, (d)));
        vm.expectEmit(address(adapter));
        emit PerplAdapter.OrderSent(address(vault), PERPL_MON, CANCEL, 42, 0, 0, 0, 0);
        vm.prank(anyone);
        adapter.cancel(PERPL_MON, 42);
    }

    function test_H2_cancelIsOnlyForAFrozenVault() public {
        (, PerplAdapter adapter) = _perplVault();
        vm.prank(anyone);
        vm.expectRevert(VaultBoundAdapter.VaultNotFrozen.selector);
        adapter.cancel(PERPL_MON, 42);
    }

    // ------------------------------------------------------------------ helpers

    /// @dev A Perpl vault with 1,000 deposited and a Perpl account holding 100 of margin.
    function _perplVault() internal returns (AgentVault vault, PerplAdapter adapter) {
        adapter = PerplAdapter(factory.deployPerpl());
        address[] memory venues = new address[](1);
        venues[0] = address(adapter);
        vault = _enter(venues, ausd);
        vm.startPrank(alice);
        ausd.faucet(alice, 1_000e6);
        ausd.approve(address(vault), type(uint256).max);
        vault.deposit(1_000e6, alice);
        vm.stopPrank();
        vm.prank(sessionKey);
        vault.execute(address(adapter), abi.encode(DEPOSIT, abi.encode(uint256(100e6))));
    }

    function _enter(address[] memory venues, IERC20 asset) internal returns (AgentVault) {
        return AgentVault(
            payable(registry.enter(
                    identity.register(),
                    RiskEnvelope({
                        maxTradeNotional: 300e6, dailyLossCapBps: 1_000, depositCapPerBacker: 10_000e6, venues: venues
                    }),
                    sessionKey,
                    asset
                ))
        );
    }

    function _order(uint8 t, uint256 expiryBlock) internal pure returns (IPerplExchange.OrderDesc memory d) {
        d.perpId = PERPL_MON;
        d.orderType = t;
        d.pricePNS = 2790;
        d.lotLNS = 1_000;
        d.expiryBlock = expiryBlock;
        d.immediateOrCancel = true;
        d.leverageHdths = 100;
        d.maxNegPnlCollatBPS = 300;
    }
}
