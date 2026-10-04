// PerplAdapter payloads and limit prices. Same encoding as the CLI (cli/src/proofbook.ts and
// cli/src/abi.ts); test/encode.test.ts checks the two byte for byte, so a change in one shows up.
// The CLI isn't imported because its entry also pulls in node:child_process (the mm signer).
import { encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiParameters, type Address, type Hex } from "viem";

/** PerplAdapter actions (contracts/src/adapters/PerplAdapter.sol). */
export const DEPOSIT = 0;
export const WITHDRAW = 1;
export const ORDER = 2;
/** Perpl order types (docs/reference/perpl.md). */
export const OPEN_LONG = 0;
export const OPEN_SHORT = 1;
export const CLOSE_LONG = 2;
export const CLOSE_SHORT = 3;

/** PerplAdapter.BAND_BPS: limits more than 3% from mark revert with PriceOutsideBand. */
export const BAND_BPS = 300n;

/** PerplAdapter `execute` payload: abi.encode(uint8 action, bytes payload). */
export const adapterCallParams = parseAbiParameters("uint8 action, bytes payload");

/** IPerplExchange.OrderDesc, in field order. */
export const orderDescParams = parseAbiParameters(
  "(uint256 orderDescId, uint256 perpId, uint8 orderType, uint256 orderId, uint256 pricePNS, uint256 lotLNS, uint256 expiryBlock, bool postOnly, bool fillOrKill, bool immediateOrCancel, uint256 maxMatches, uint256 leverageHdths, uint256 lastExecutionBlock, uint256 amountCNS, uint256 maxNegPnlCollatBPS)",
);

export const executeAbi = parseAbi(["function execute(address venue, bytes data)"]);

/** Adapter calldata for a margin deposit (the first one opens the Perpl account). */
export function marginData(amount: bigint): Hex {
  return encodeAbiParameters(adapterCallParams, [DEPOSIT, encodeAbiParameters([{ type: "uint256" }], [amount])]);
}

/** Adapter calldata that moves free Perpl margin back to the vault (quoted at 0 notional). */
export function withdrawData(amount: bigint): Hex {
  return encodeAbiParameters(adapterCallParams, [WITHDRAW, encodeAbiParameters([{ type: "uint256" }], [amount])]);
}

/** Adapter calldata for an IOC Perpl order at 1x. */
export function orderData(o: { perpId: bigint; orderType: number; pricePNS: bigint; lotLNS: bigint; expiryBlock: bigint }): Hex {
  const desc = {
    orderDescId: 0n,
    perpId: o.perpId,
    orderType: o.orderType,
    orderId: 0n,
    pricePNS: o.pricePNS,
    lotLNS: o.lotLNS,
    expiryBlock: o.expiryBlock,
    postOnly: false,
    fillOrKill: false,
    immediateOrCancel: true,
    maxMatches: 0n,
    leverageHdths: 100n, // 1x
    lastExecutionBlock: 0n,
    amountCNS: 0n, // the adapter forces 0
    maxNegPnlCollatBPS: 300n, // 0 onchain refuses every taker fill (docs/reference/perpl.md)
  };
  return encodeAbiParameters(adapterCallParams, [ORDER, encodeAbiParameters(orderDescParams, [desc])]);
}

/** The vault call the session key signs: AgentVault.execute(adapter, data). */
export function executeCalldata(adapter: Address, data: Hex): Hex {
  return encodeFunctionData({ abi: executeAbi, functionName: "execute", args: [adapter, data] });
}

/** Buy limit (open long, close short): best ask + 0.5%, capped at mark + 2.5%. */
export function buyPrice(m: { mark: bigint; ask: bigint }) {
  const cap = (m.mark * (10_000n + BAND_BPS - 50n)) / 10_000n;
  const want = m.ask > 0n ? (m.ask * 1005n) / 1000n : cap;
  return want < cap ? want : cap;
}

/** Sell limit (open short, close long): best bid - 0.5%, floored at mark - 2.5%. */
export function sellPrice(m: { mark: bigint; bid: bigint }) {
  const floor = (m.mark * (10_000n - BAND_BPS + 50n) + 9_999n) / 10_000n;
  const want = m.bid > 0n ? (m.bid * 995n) / 1000n : floor;
  return want > floor ? want : floor;
}

/** Lots that `sizeCNS` of collateral buys at `mark` (same rounding as the CLI: down). */
export function lotsFor(sizeCNS: bigint, m: { mark: bigint; priceDecimals: bigint; lotDecimals: bigint }, assetDecimals: number) {
  if (m.mark === 0n) return 0n;
  const scale = 10n ** (m.priceDecimals + m.lotDecimals);
  return (sizeCNS * scale) / (m.mark * 10n ** BigInt(assetDecimals));
}

/** Collateral value of `lot` at `price`: lot × price × 10^dec / 10^(pd + ld), rounded up like the adapter. */
export function notionalOf(lot: bigint, price: bigint, m: { priceDecimals: bigint; lotDecimals: bigint }, assetDecimals: number) {
  const den = 10n ** (m.priceDecimals + m.lotDecimals);
  const num = lot * price * 10n ** BigInt(assetDecimals);
  return (num + den - 1n) / den;
}
