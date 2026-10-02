// The house agents encode PerplAdapter payloads with their own copy of the CLI's logic (the CLI's
// entry pulls in node-only code). These tests pin the two together: same inputs, same bytes.
// Needs the CLI built: `pnpm test` runs `pnpm --filter proofbook build` first.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Proofbook } from "proofbook";
import { buyPrice, CLOSE_LONG, executeCalldata, lotsFor, marginData, notionalOf, OPEN_LONG, orderData, sellPrice } from "../src/perpl.ts";

test("margin deposit calldata matches the CLI", () => {
  for (const amount of [0n, 1n, 100_000_000n, 2n ** 200n]) {
    assert.equal(marginData(amount), Proofbook.marginData(amount));
  }
});

test("order calldata matches the CLI", () => {
  const cases = [
    { perpId: 64n, orderType: OPEN_LONG, pricePNS: 3386n, lotLNS: 297n, expiryBlock: 1000n },
    { perpId: 64n, orderType: CLOSE_LONG, pricePNS: 2722n, lotLNS: 1828n, expiryBlock: 51_234_567n },
    { perpId: 10n, orderType: 1, pricePNS: 27_000_000n, lotLNS: 1n, expiryBlock: 2n ** 64n },
    { perpId: 64n, orderType: 3, pricePNS: 1n, lotLNS: 0n, expiryBlock: 0n },
  ];
  for (const c of cases) assert.equal(orderData(c), Proofbook.orderData(c));
});

test("limit prices match the CLI (buy = longPrice, sell = closePrice)", () => {
  for (const mark of [1n, 2_700n, 10_000n, 27_123_456n]) {
    for (const off of [0n, 1n, mark / 1000n, mark / 10n]) {
      const book = { mark, ask: mark + off, bid: mark - off > 0n ? mark - off : 0n };
      assert.equal(buyPrice(book), Proofbook.longPrice(book));
      assert.equal(sellPrice(book), Proofbook.closePrice(book));
    }
    assert.equal(buyPrice({ mark, ask: 0n }), Proofbook.longPrice({ mark, ask: 0n }));
    assert.equal(sellPrice({ mark, bid: 0n }), Proofbook.closePrice({ mark, bid: 0n }));
  }
});

test("lot sizing matches the CLI's run loop", () => {
  // cli/src/run.ts: lot = sizeCNS × 10^(pd+ld) / (mark × 10^dec)
  const m = { mark: 3_367n, priceDecimals: 5n, lotDecimals: 0n };
  const cli = (sizeCNS: bigint) => (sizeCNS * 10n ** (m.priceDecimals + m.lotDecimals)) / (m.mark * 10n ** 6n);
  for (const size of [1n, 10_000_000n, 25_000_000n, 99_999_999n]) assert.equal(lotsFor(size, m, 6), cli(size));
  // The CLI's verified testnet trade: 10 AUSD at mark ~0.03367 → 297 lots, notional ~10.03.
  assert.equal(lotsFor(10_000_000n, m, 6), 297n);
  assert.equal(notionalOf(297n, 3_377n, m, 6), 10_029_690n);
});

test("vault.execute calldata matches the spike's hand encoder", () => {
  // spikes/privy/spike.mjs encodeExecute: selector 0x1cff79cd, venue, offset 0x40, length, padded bytes.
  const pad32 = (h: string) => h.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  const spike = (venue: string, inner: string) => {
    const d = inner.replace(/^0x/, "");
    const len = d.length / 2;
    return "0x1cff79cd" + pad32(venue) + pad32("0x40") + pad32("0x" + len.toString(16)) + d.padEnd(Math.ceil(len / 32) * 64, "0");
  };
  const adapter = "0x583B6bCFcAec599E6Fc09e27db581d6abe7baB09";
  const data = orderData({ perpId: 64n, orderType: OPEN_LONG, pricePNS: 2_750n, lotLNS: 925n, expiryBlock: 1_000n });
  assert.equal(executeCalldata(adapter, data), spike(adapter, data));
  assert.equal(executeCalldata(adapter, "0xdeadbeef"), spike(adapter, "0xdeadbeef"));
});
