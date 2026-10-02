// The off-chain validator: Kimi's proposals are advisory and must pass these checks first.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CLOSE_LONG, OPEN_LONG, OPEN_SHORT } from "../src/perpl.ts";
import { checkOrder, checkProposal, checkQuote, dailyLossHeadroom, type VaultView } from "../src/validate.ts";

const AUSD = 1_000_000n;
const base: VaultView = {
  frozen: false,
  decimals: 6,
  maxTradeNotional: 100n * AUSD,
  nav: 665n * AUSD,
  dayStartNav: 650n * AUSD,
  dayRolled: false,
  dailyLossCapBps: 1000,
  position: { side: "flat", lot: 0n },
  mark: 2_700n, // 0.02700 at 5 price decimals
};
const limits = { maxSizeAusd: 50 };

test("a valid open passes with the size in base units", () => {
  const r = checkProposal({ action: "open_long", sizeAusd: 25, reason: "Mark up 1.2% in 30 minutes." }, base, limits);
  assert.deepEqual(r, { ok: true, value: { action: "open_long", reason: "Mark up 1.2% in 30 minutes.", sizeCNS: 25n * AUSD } });
});

test("hold is always allowed, even on a frozen vault", () => {
  assert.equal(checkProposal({ action: "hold", reason: "Flat market." }, { ...base, frozen: true }, limits).ok, true);
});

test("rejects a size over the vault's maxTradeNotional", () => {
  const r = checkProposal({ action: "open_long", sizeAusd: 100.000001, reason: "x" }, { ...base }, { maxSizeAusd: 1_000 });
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /above the vault's maxTradeNotional 100/);
});

test("rejects a size over the house agent's own limit", () => {
  const r = checkProposal({ action: "open_short", sizeAusd: 60, reason: "x" }, base, limits);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /above this house agent's 50 AUSD limit/);
});

test("rejects an order whose notional is over the cap", () => {
  const r = checkOrder({ orderType: OPEN_LONG, pricePNS: 2_750n, lotLNS: 4_000n, notional: 110n * AUSD }, base);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /notional 110 is above maxTradeNotional 100/);
});

test("rejects an adapter quote over the cap", () => {
  assert.equal(checkQuote(100n * AUSD, base).ok, true);
  assert.equal(checkQuote(100n * AUSD + 1n, base).ok, false);
});

test("rejects every trade on a frozen vault", () => {
  const frozen = { ...base, frozen: true, position: { side: "long" as const, lot: 900n } };
  for (const p of [
    { action: "open_long", sizeAusd: 10, reason: "x" },
    { action: "open_short", sizeAusd: 10, reason: "x" },
    { action: "close", reason: "x" },
  ]) {
    const r = checkProposal(p, frozen, limits);
    assert.equal(r.ok, false, p.action);
    assert.match((r as { error: string }).error, /frozen/);
  }
  assert.equal(checkOrder({ orderType: CLOSE_LONG, pricePNS: 2_650n, lotLNS: 900n, notional: 25n * AUSD }, frozen).ok, false);
});

test("rejects a limit price outside the 3% band around mark", () => {
  // Buy: at most mark × 1.03. Sell: at least mark × 0.97.
  assert.equal(checkOrder({ orderType: OPEN_LONG, pricePNS: 2_781n, lotLNS: 900n, notional: 25n * AUSD }, base).ok, true);
  const hi = checkOrder({ orderType: OPEN_LONG, pricePNS: 2_782n, lotLNS: 900n, notional: 25n * AUSD }, base);
  assert.equal(hi.ok, false);
  assert.match((hi as { error: string }).error, /outside the 3% band/);
  assert.equal(checkOrder({ orderType: OPEN_SHORT, pricePNS: 2_619n, lotLNS: 900n, notional: 25n * AUSD }, base).ok, true);
  assert.equal(checkOrder({ orderType: OPEN_SHORT, pricePNS: 2_618n, lotLNS: 900n, notional: 25n * AUSD }, base).ok, false);
  assert.equal(checkOrder({ orderType: CLOSE_LONG, pricePNS: 1n, lotLNS: 900n, notional: 25n * AUSD }, base).ok, false);
});

test("rejects unknown actions, including a missing tool call", () => {
  for (const action of ["buy", "open_long ", "OPEN_LONG", "withdraw", "none", ""]) {
    const r = checkProposal({ action, sizeAusd: 10, reason: "x" }, base, limits);
    assert.equal(r.ok, false, action);
    assert.match((r as { error: string }).error, /unknown action/);
  }
  assert.equal(checkOrder({ orderType: 4, pricePNS: 2_700n, lotLNS: 1n, notional: 0n }, base).ok, false); // Cancel
});

test("rejects bad sizes and missing reasons", () => {
  for (const sizeAusd of [0, -5, NaN, Infinity, "ten", undefined]) {
    assert.equal(checkProposal({ action: "open_long", sizeAusd, reason: "x" }, base, limits).ok, false, String(sizeAusd));
  }
  assert.equal(checkProposal({ action: "hold", reason: "  " }, base, limits).ok, false);
});

test("one position at a time: no open while holding, no close while flat", () => {
  const long = { ...base, position: { side: "long" as const, lot: 900n } };
  assert.equal(checkProposal({ action: "open_short", sizeAusd: 10, reason: "x" }, long, limits).ok, false);
  assert.equal(checkProposal({ action: "close", reason: "x" }, long, limits).ok, true);
  assert.equal(checkProposal({ action: "close", reason: "x" }, base, limits).ok, false);
});

test("daily-loss headroom: opens need room above the freeze line, closes don't", () => {
  // dayStartNav 650, cap 10% → floor 585. NAV 585.5 leaves 0.5 AUSD: less than the worst entry (3% band + fees = 0.875) of a 25 AUSD open.
  const tight = { ...base, nav: 585_500_000n };
  assert.equal(dailyLossHeadroom(tight), 500_000n);
  const open = checkOrder({ orderType: OPEN_LONG, pricePNS: 2_750n, lotLNS: 900n, notional: 25n * AUSD }, tight);
  assert.equal(open.ok, false);
  assert.match((open as { error: string }).error, /daily-loss headroom/);
  assert.equal(checkOrder({ orderType: CLOSE_LONG, pricePNS: 2_650n, lotLNS: 900n, notional: 25n * AUSD }, tight).ok, true);
  // A new UTC day resets the baseline to the current NAV, so the same vault has 10% of room again.
  assert.equal(dailyLossHeadroom({ ...tight, dayRolled: true }), 585_500_000n - (585_500_000n * 9_000n + 9_999n) / 10_000n);
  assert.equal(checkOrder({ orderType: OPEN_LONG, pricePNS: 2_750n, lotLNS: 900n, notional: 25n * AUSD }, { ...tight, dayRolled: true }).ok, true);
});
