// Chain reads for one house agent: vault envelope and NAV, idle balance, the Perpl account and
// position, and the MON perp's mark, bid and ask. Read-only; sending lives in src/run.ts.
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  fallback,
  defineChain,
  http,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import type { HouseAgent } from "./config.ts";
import type { Side } from "./validate.ts";

export const vaultAbi = parseAbi([
  "function asset() view returns (address)",
  "function sessionKey() view returns (address)",
  "function frozen() view returns (bool)",
  "function nav() view returns (uint256)",
  "function dayStartNav() view returns (uint256)",
  "function dayStart() view returns (uint256)",
  "function maxTradeNotional() view returns (uint256)",
  "function dailyLossCapBps() view returns (uint16)",
  "function venues() view returns (address[])",
  "function execute(address venue, bytes data)",
  "event Executed(address indexed venue, uint256 notional, int256 venueDelta, uint256 navBefore, uint256 navAfter)",
  "error NotSessionKey(address caller)",
  "error VenueNotAllowed(address venue)",
  "error TradeTooLarge(uint256 notional, uint256 maxTradeNotional)",
  "error VaultFrozen()",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
]);

export const adapterAbi = parseAbi([
  "function accountId() view returns (uint256)",
  "function vault() view returns (address)",
  "function quoteNotional(bytes data) view returns (uint256)",
  "error NotVault(address caller)",
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

export const exchangeAbi = parseAbi([
  "function getMinAccountOpenCNS() view returns (uint256)",
  "struct PositionBitMap { uint256 bank1; uint256 bank2; uint256 bank3; uint256 bank4; }",
  "struct AccountInfo { uint256 accountId; uint256 balanceCNS; uint256 lockedBalanceCNS; uint8 frozen; address accountAddr; PositionBitMap positions; }",
  "function getAccountByAddr(address accountAddress) view returns (AccountInfo accountInfo)",
  "struct PositionInfo { uint256 accountId; uint256 nextNodeId; uint256 prevNodeId; uint8 positionType; uint256 depositCNS; uint256 pricePNS; uint256 lotLNS; uint256 entryBlock; int256 pnlCNS; int256 deltaPnlCNS; int256 premiumPnlCNS; }",
  "function getPosition(uint256 perpId, uint256 accountId) view returns (PositionInfo positionInfo, uint256 markPricePNS, bool markPriceValid)",
  "struct PerpetualInfo { string name; string symbol; uint256 priceDecimals; uint256 lotDecimals; bytes32 linkFeedId; uint256 priceTolPer100K; uint256 marginTol; uint256 marginTolDecimals; uint256 refPriceMaxAgeSec; uint256 positionBalanceCNS; uint256 insuranceBalanceCNS; uint256 markPNS; uint256 markTimestamp; uint256 lastPNS; uint256 lastTimestamp; uint256 oraclePNS; uint256 oracleTimestampSec; uint256 longOpenInterestLNS; uint256 shortOpenInterestLNS; uint256 fundingStartBlock; int16 fundingRatePct100k; uint256 absFundingClampPctPer100K; uint8 status; uint256 basePricePNS; uint256 maxBidPriceONS; uint256 minBidPriceONS; uint256 maxAskPriceONS; uint256 minAskPriceONS; uint256 numOrders; bool ignOracle; }",
  "function getPerpetualInfo(uint256 perpId) view returns (PerpetualInfo perpetualInfo)",
]);

const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"]);

/** Perpl Exchange per chain (docs/reference/perpl.md; both checked with `cast code`). */
const PERPL_EXCHANGE: Record<number, Address> = {
  10143: "0x1964C32f0bE608E7D29302AFF5E61268E72080cc",
  143: "0x34B6552d57a35a1D042CcAe1951BD1C370112a6F",
};

/** RPCs in order of preference: Alchemy first when its secret is set, then the public RPC. */
export function clientFor(chainId: number, rpcs: string[]): PublicClient {
  const rpc = rpcs[0];
  const chain = defineChain({
    id: chainId,
    name: chainId === 143 ? "Monad" : "Monad testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
    contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  });
  // Public RPCs rate-limit, so reads fold into Multicall3 and retry; a failing RPC falls through to the next.
  const each = rpcs.map((url) => http(url, { retryCount: 2, retryDelay: 400 }));
  const transport = each.length > 1 ? fallback(each) : each[0];
  return createPublicClient({ chain, transport, batch: { multicall: true } }) as PublicClient;
}

export type Observation = Awaited<ReturnType<typeof observe>>;

export async function observe(client: PublicClient, chainId: number, agent: HouseAgent) {
  const exchange = PERPL_EXCHANGE[chainId];
  if (!exchange) throw new Error(`No Perpl Exchange known for chain ${chainId}`);
  const vault = { address: agent.vault, abi: vaultAbi } as const;
  const [asset, sessionKey, frozen, nav, dayStartNav, dayStart, maxTradeNotional, dailyLossCapBps, venues, block] = await Promise.all([
    client.readContract({ ...vault, functionName: "asset" }),
    client.readContract({ ...vault, functionName: "sessionKey" }),
    client.readContract({ ...vault, functionName: "frozen" }),
    client.readContract({ ...vault, functionName: "nav" }),
    client.readContract({ ...vault, functionName: "dayStartNav" }),
    client.readContract({ ...vault, functionName: "dayStart" }),
    client.readContract({ ...vault, functionName: "maxTradeNotional" }),
    client.readContract({ ...vault, functionName: "dailyLossCapBps" }),
    client.readContract({ ...vault, functionName: "venues" }),
    client.getBlock(),
  ]);
  if (!venues.some((v) => v.toLowerCase() === agent.adapter.toLowerCase())) {
    throw new Error(`Adapter ${agent.adapter} is not on vault ${agent.vault}'s venue list`);
  }
  const [decimals, idle, accountId, minOpen, perp] = await Promise.all([
    client.readContract({ address: asset, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [agent.vault] }),
    client.readContract({ address: agent.adapter, abi: adapterAbi, functionName: "accountId" }),
    client.readContract({ address: exchange, abi: exchangeAbi, functionName: "getMinAccountOpenCNS" }),
    client.readContract({ address: exchange, abi: exchangeAbi, functionName: "getPerpetualInfo", args: [agent.perpId] }),
  ]);

  let freeMargin = 0n;
  let position: { side: Side; lot: bigint; entryPrice: bigint; deposit: bigint; pnl: bigint } = {
    side: "flat",
    lot: 0n,
    entryPrice: 0n,
    deposit: 0n,
    pnl: 0n,
  };
  if (accountId !== 0n) {
    const [account, [p]] = await Promise.all([
      client.readContract({ address: exchange, abi: exchangeAbi, functionName: "getAccountByAddr", args: [agent.adapter] }),
      client.readContract({ address: exchange, abi: exchangeAbi, functionName: "getPosition", args: [agent.perpId, accountId] }),
    ]);
    freeMargin = account.balanceCNS - account.lockedBalanceCNS;
    if (p.lotLNS > 0n) {
      position = {
        side: p.positionType === 0 ? "long" : "short",
        lot: p.lotLNS,
        entryPrice: p.pricePNS,
        deposit: p.depositCNS,
        pnl: p.pnlCNS,
      };
    }
  }

  const bid = perp.maxBidPriceONS > 0n ? perp.basePricePNS + perp.maxBidPriceONS : 0n;
  const ask = perp.minAskPriceONS > 0n ? perp.basePricePNS + perp.minAskPriceONS : 0n;
  // The vault opens a new day (dayStartNav := NAV) on the first execute after a UTC midnight.
  const todayStart = (block.timestamp / 86_400n) * 86_400n;
  return {
    vault: agent.vault,
    adapter: agent.adapter,
    exchange,
    asset,
    decimals,
    sessionKey,
    frozen,
    nav,
    dayStartNav,
    dayRolled: dayStart < todayStart,
    maxTradeNotional,
    dailyLossCapBps,
    idle,
    accountId,
    minOpen,
    freeMargin,
    position,
    market: {
      symbol: perp.symbol,
      mark: perp.markPNS,
      bid,
      ask,
      priceDecimals: perp.priceDecimals,
      lotDecimals: perp.lotDecimals,
      markTimestamp: perp.markTimestamp,
    },
    block: block.number,
    blockTime: block.timestamp,
  };
}

export async function quoteNotional(client: PublicClient, adapter: Address, data: Hex) {
  return client.readContract({ address: adapter, abi: adapterAbi, functionName: "quoteNotional", args: [data] });
}

/** eth_call of vault.execute from `from`. Returns the decoded revert, or undefined if it would succeed. */
export async function simulateExecute(client: PublicClient, from: Address, vault: Address, adapter: Address, data: Hex) {
  try {
    await client.simulateContract({
      account: from,
      address: vault,
      abi: [...vaultAbi, ...adapterAbi],
      functionName: "execute",
      args: [adapter, data],
    });
    return undefined;
  } catch (e) {
    return revertReason(e);
  }
}

/** A failed send in one line. viem's message carries the request body (the signed tx); keep the node's reason. */
export function sendError(e: unknown): string {
  if (e instanceof BaseError) return e.details || e.shortMessage;
  return e instanceof Error ? e.message.split("\n")[0] : String(e);
}

export function revertReason(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const d = revert.data;
      if (d?.errorName) {
        const args = (d.args ?? []).map((a) => (typeof a === "bigint" ? a.toString() : String(a)));
        return `${d.errorName}(${args.join(", ")})`;
      }
      if (revert.reason) return revert.reason;
      if (revert.signature) return `unknown error ${revert.signature}`;
    }
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}
