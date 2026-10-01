// Offline checks of what the CLI encodes. Run `pnpm build` first (tests import dist/).
import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeAbiParameters, parseAbiParameters } from "viem";
import { NETWORKS, Proofbook, resolveNetwork } from "../dist/index.js";

test("testnet is the default; mainnet only by name", () => {
  assert.equal(resolveNetwork(undefined).chainId, 10143);
  assert.equal(resolveNetwork("testnet").chainId, 10143);
  assert.equal(resolveNetwork("mainnet").chainId, 143);
  assert.throws(() => resolveNetwork("143"));
  assert.throws(() => resolveNetwork("Mainnet"));
});

test("mainnet has no registry until one is deployed", () => {
  assert.equal(NETWORKS.mainnet.registry, undefined);
  assert.throws(() => new Proofbook(resolveNetwork("mainnet")), /not deployed on mainnet/);
});

test("margin deposit is abi.encode(uint8 0, abi.encode(uint256))", () => {
  const [action, payload] = decodeAbiParameters(parseAbiParameters("uint8, bytes"), Proofbook.marginData(100_000_000n));
  assert.equal(action, 0);
  assert.deepEqual(decodeAbiParameters(parseAbiParameters("uint256"), payload), [100_000_000n]);
});

test("orders are IOC, 1x, maxNegPnlCollatBPS 300, amountCNS 0", () => {
  const data = Proofbook.orderData({ perpId: 64n, orderType: 0, pricePNS: 3386n, lotLNS: 297n, expiryBlock: 1000n });
  const [action, payload] = decodeAbiParameters(parseAbiParameters("uint8, bytes"), data);
  assert.equal(action, 2);
  const [d] = decodeAbiParameters(
    parseAbiParameters(
      "(uint256 orderDescId, uint256 perpId, uint8 orderType, uint256 orderId, uint256 pricePNS, uint256 lotLNS, uint256 expiryBlock, bool postOnly, bool fillOrKill, bool immediateOrCancel, uint256 maxMatches, uint256 leverageHdths, uint256 lastExecutionBlock, uint256 amountCNS, uint256 maxNegPnlCollatBPS)",
    ),
    payload,
  );
  assert.equal(d.perpId, 64n);
  assert.equal(d.lotLNS, 297n);
  assert.equal(d.immediateOrCancel, true);
  assert.equal(d.leverageHdths, 100n);
  assert.equal(d.amountCNS, 0n);
  assert.equal(d.maxNegPnlCollatBPS, 300n);
});

test("limit prices stay inside the adapter's 3% band around mark", () => {
  const mark = 10_000n;
  // A thin book: the ask is 10% above mark, the bid 10% below. Limits clamp to mark ± 2.5%.
  assert.equal(Proofbook.longPrice({ mark, ask: 11_000n }), 10_250n);
  assert.equal(Proofbook.closePrice({ mark, bid: 9_000n }), 9_750n);
  // A tight book: ask/bid ± 0.5%.
  assert.equal(Proofbook.longPrice({ mark, ask: 10_010n }), 10_060n);
  assert.equal(Proofbook.closePrice({ mark, bid: 9_990n }), 9_940n);
  // An empty side falls back to the band edge.
  assert.equal(Proofbook.longPrice({ mark, ask: 0n }), 10_250n);
  assert.equal(Proofbook.closePrice({ mark, bid: 0n }), 9_750n);
});
