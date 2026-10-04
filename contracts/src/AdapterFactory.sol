// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PerplAdapter} from "./adapters/PerplAdapter.sol";
import {KuruAdapter} from "./adapters/KuruAdapter.sol";
import {VaultBoundAdapter} from "./adapters/VaultBoundAdapter.sol";
import {IAdapterFactory} from "./interfaces/IAdapterFactory.sol";
import {IKuruOrderBook} from "./interfaces/external/IKuruOrderBook.sol";
import {IPerplExchange} from "./interfaces/external/IPerplExchange.sol";

/// @title AdapterFactory
/// @notice Deploys venue adapters with this chain's canonical venue addresses, and is their only
/// binder. AgentRegistry accepts only adapters this factory deployed, and binds them itself in
/// enter(). A vault trusts its adapters' quotes, executes and reported exposure, so a builder must
/// not be able to list an adapter of their own (docs/security-review.md, C1). UNAUDITED.
///
/// The venue addresses are immutable. A venue that changes address (a new Kuru market, a Perpl
/// redeploy) needs a new factory and a new registry.
contract AdapterFactory is IAdapterFactory {
    enum Kind {
        Perpl,
        Kuru
    }

    address public immutable deployer;
    IPerplExchange public immutable perplExchange;
    IERC20 public immutable perplCollateral;
    /// @dev Zero where Kuru isn't deployed (testnet): deployKuru() then reverts.
    IKuruOrderBook public immutable kuruMarket;
    IERC20 public immutable kuruQuote;
    IPerplExchange public immutable kuruReference;
    uint256 public immutable kuruReferencePerpId;
    /// @dev KuruAdapter.maxHeld: held MON cap in quote units, below the book's bid depth within the band.
    uint256 public immutable kuruMaxHeld;

    address public registry;
    mapping(address adapter => bool) public isCanonical;

    event RegistrySet(address indexed registry);
    event AdapterDeployed(address indexed adapter, Kind kind, address indexed by);

    error NotDeployer(address caller);
    error NotRegistry(address caller);
    error RegistryAlreadySet(address registry);
    error VenueNotConfigured();
    error NotCanonical(address adapter);

    constructor(
        IPerplExchange perplExchange_,
        IERC20 perplCollateral_,
        IKuruOrderBook kuruMarket_,
        IERC20 kuruQuote_,
        IPerplExchange kuruReference_,
        uint256 kuruReferencePerpId_,
        uint256 kuruMaxHeld_
    ) {
        deployer = msg.sender;
        perplExchange = perplExchange_;
        perplCollateral = perplCollateral_;
        kuruMarket = kuruMarket_;
        kuruQuote = kuruQuote_;
        kuruReference = kuruReference_;
        kuruReferencePerpId = kuruReferencePerpId_;
        kuruMaxHeld = kuruMaxHeld_;
    }

    /// @notice One-time link to the registry, which is deployed after this factory (it takes the
    /// factory in its constructor).
    function setRegistry(address registry_) external {
        if (msg.sender != deployer) revert NotDeployer(msg.sender);
        if (registry != address(0)) revert RegistryAlreadySet(registry);
        registry = registry_;
        emit RegistrySet(registry_);
    }

    /// @notice A fresh PerplAdapter on the canonical Exchange. Anyone may deploy one; it is unbound
    /// until a registry enter() lists it.
    function deployPerpl() external returns (address adapter) {
        if (address(perplExchange) == address(0)) revert VenueNotConfigured();
        adapter = address(new PerplAdapter(perplExchange, perplCollateral));
        _record(adapter, Kind.Perpl);
    }

    /// @notice A fresh KuruAdapter on the canonical market, valued against the canonical reference.
    function deployKuru() external returns (address adapter) {
        if (address(kuruMarket) == address(0)) revert VenueNotConfigured();
        adapter = address(new KuruAdapter(kuruMarket, kuruQuote, kuruReference, kuruReferencePerpId, kuruMaxHeld));
        _record(adapter, Kind.Kuru);
    }

    /// @inheritdoc IAdapterFactory
    function bind(address adapter, address vault) external {
        if (msg.sender != registry) revert NotRegistry(msg.sender);
        if (!isCanonical[adapter]) revert NotCanonical(adapter);
        VaultBoundAdapter(adapter).bind(vault);
    }

    function _record(address adapter, Kind kind) internal {
        isCanonical[adapter] = true;
        emit AdapterDeployed(adapter, kind, msg.sender);
    }
}
