// The subsets of each contract the CLI calls, with the custom errors it may need to decode.
// Sources: contracts/src (AgentRegistry, AgentVault, PerplAdapter, VaultBoundAdapter),
// docs/reference/erc-8004.md and docs/reference/perpl.md.
import { parseAbi, parseAbiParameters } from "viem";

const envelope = "(uint256 maxTradeNotional, uint16 dailyLossCapBps, uint256 depositCapPerBacker, address[] venues)";

export const registryAbi = parseAbi([
  `function enter(uint256 agentId, ${envelope} envelope, address sessionKey, address asset) returns (address vault)`,
  `function envelopeOf(uint256 agentId) view returns (${envelope})`,
  "function vaultOf(uint256 agentId) view returns (address)",
  "function ownerOf(uint256 agentId) view returns (address)",
  "function isAllowedAsset(address asset) view returns (bool)",
  "function guardian() view returns (address)",
  // Registries from the C1 fix on (docs/security-review.md); older ones don't have it.
  "function adapters() view returns (address)",
  "event VaultLinked(uint256 indexed agentId, address indexed vault, address indexed asset, address sessionKey)",
  "error NotAgentOwner(uint256 agentId, address caller)",
  "error AlreadyEntered(uint256 agentId)",
  "error InvalidEnvelope()",
  "error AssetNotAllowed(address asset)",
  "error UnknownAdapter(address venue)",
]);

/** AdapterFactory: the only source of adapters a vault may list. The registry binds them in enter(). */
export const factoryAbi = parseAbi([
  "function deployPerpl() returns (address adapter)",
  "function isCanonical(address adapter) view returns (bool)",
  "event AdapterDeployed(address indexed adapter, uint8 kind, address indexed by)",
  "error VenueNotConfigured()",
]);

export const identityAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function tokenURI(uint256 agentId) view returns (string)",
  "function ownerOf(uint256 agentId) view returns (address)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);

export const vaultAbi = parseAbi([
  "function asset() view returns (address)",
  "function agentId() view returns (uint256)",
  "function sessionKey() view returns (address)",
  "function guardian() view returns (address)",
  "function frozen() view returns (bool)",
  "function frozenAt() view returns (uint256)",
  "function nav() view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function dayStartNav() view returns (uint256)",
  "function highWaterMark() view returns (uint256)",
  "function maxTradeNotional() view returns (uint256)",
  "function dailyLossCapBps() view returns (uint16)",
  "function depositCapPerBacker() view returns (uint256)",
  "function venues() view returns (address[])",
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function maxDeposit(address receiver) view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256 shares)",
  "function execute(address venue, bytes data)",
  "function freeze()",
  "event Executed(address indexed venue, uint256 notional, int256 venueDelta, uint256 navBefore, uint256 navAfter)",
  "event Frozen(address indexed by)",
  "error NotSessionKey(address caller)",
  "error NotOwnerOrGuardian(address caller)",
  "error VenueNotAllowed(address venue)",
  "error TradeTooLarge(uint256 notional, uint256 maxTradeNotional)",
  "error VaultFrozen()",
  "error DepositCapExceeded(address backer, uint256 attempted, uint256 cap)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
]);

export const perplAdapterAbi = parseAbi([
  "constructor(address exchange, address collateral)",
  "function bind(address vault)",
  "function vault() view returns (address)",
  "function binder() view returns (address)",
  "function accountId() view returns (uint256)",
  "function exposure(address vault) view returns (uint256)",
  "function perps() view returns (uint256[])",
  "function quoteNotional(bytes data) view returns (uint256)",
  "error NotVault(address caller)",
  "error NotBinder(address caller)",
  "error AlreadyBound(address vault)",
  "error BadVault(address vault)",
  "error UnknownAction(uint8 action)",
  "error OrderTypeNotAllowed(uint8 orderType)",
  "error PriceOutsideBand(uint256 limitPNS, uint256 markPNS)",
  "error TooManyPerps(uint256 perpId)",
  // Perpl Exchange errors bubble up through the adapter (docs/reference/perpl.md).
  "error AccountDoesNotExist(address account)",
  "error InsufficentAmountToOpenAccount(address account, uint256 amount)",
  "error AmountExceedsAvailableBalance(uint256 amount, uint256 balance, uint256 available)",
  "error CloseOrderPositionMismatch(uint8 positionType, uint8 orderType)",
  "error CloseOrderExceedsPosition(uint256 positionLot, uint256 orderLot)",
]);

export const perplExchangeAbi = parseAbi([
  "function getMinAccountOpenCNS() view returns (uint256)",
  "struct PositionInfo { uint256 accountId; uint256 nextNodeId; uint256 prevNodeId; uint8 positionType; uint256 depositCNS; uint256 pricePNS; uint256 lotLNS; uint256 entryBlock; int256 pnlCNS; int256 deltaPnlCNS; int256 premiumPnlCNS; }",
  "function getPosition(uint256 perpId, uint256 accountId) view returns (PositionInfo positionInfo, uint256 markPricePNS, bool markPriceValid)",
  "struct PerpetualInfo { string name; string symbol; uint256 priceDecimals; uint256 lotDecimals; bytes32 linkFeedId; uint256 priceTolPer100K; uint256 marginTol; uint256 marginTolDecimals; uint256 refPriceMaxAgeSec; uint256 positionBalanceCNS; uint256 insuranceBalanceCNS; uint256 markPNS; uint256 markTimestamp; uint256 lastPNS; uint256 lastTimestamp; uint256 oraclePNS; uint256 oracleTimestampSec; uint256 longOpenInterestLNS; uint256 shortOpenInterestLNS; uint256 fundingStartBlock; int16 fundingRatePct100k; uint256 absFundingClampPctPer100K; uint8 status; uint256 basePricePNS; uint256 maxBidPriceONS; uint256 minBidPriceONS; uint256 maxAskPriceONS; uint256 minAskPriceONS; uint256 numOrders; bool ignOracle; }",
  "function getPerpetualInfo(uint256 perpId) view returns (PerpetualInfo perpetualInfo)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export const faucetAbi = parseAbi([
  "function requestFunds(address recipient)",
  "error MaxFrequencyExceeded()",
  "error InsufficientFunds()",
]);

/** PerplAdapter `execute` payload: abi.encode(uint8 action, bytes payload). */
export const adapterCallParams = parseAbiParameters("uint8 action, bytes payload");

/** IPerplExchange.OrderDesc, in field order. */
export const orderDescParams = parseAbiParameters(
  "(uint256 orderDescId, uint256 perpId, uint8 orderType, uint256 orderId, uint256 pricePNS, uint256 lotLNS, uint256 expiryBlock, bool postOnly, bool fillOrKill, bool immediateOrCancel, uint256 maxMatches, uint256 leverageHdths, uint256 lastExecutionBlock, uint256 amountCNS, uint256 maxNegPnlCollatBPS)",
);
