// The off-chain validator. Kimi's output is advisory: every proposal passes through these pure
// checks before anything is quoted, simulated or signed. The vault enforces the same envelope
// again onchain (invariants 1–3), so this is the first of two gates, not the only one.
import { parseUnits } from "viem";
import { BAND_BPS, CLOSE_LONG, CLOSE_SHORT, OPEN_LONG, OPEN_SHORT } from "./perpl.ts";

export const ACTIONS = ["hold", "open_long", "open_short", "close"] as const;
export type Action = (typeof ACTIONS)[number];

/** What the model proposed (tool name + arguments), before any check. */
export type Proposal = { action: string; sizeAusd?: unknown; reason?: unknown };

export type Side = "flat" | "long" | "short";

/** The vault and market state the checks need, read from chain this run. */
export type VaultView = {
  frozen: boolean;
  /** Vault asset decimals (AUSD: 6). */
  decimals: number;
  maxTradeNotional: bigint;
  nav: bigint;
  dayStartNav: bigint;
  /** True when the next execute opens a new UTC day, so dayStartNav resets to the current NAV. */
  dayRolled: boolean;
  dailyLossCapBps: number;
  position: { side: Side; lot: bigint };
  mark: bigint;
};

/** The house strategy's own size limits, inside the vault's envelope. */
export type Limits = { maxSizeAusd: number };

export type Verdict<T> = { ok: true; value: T } | { ok: false; error: string };

export type Checked =
  | { action: "hold"; reason: string }
  | { action: "open_long" | "open_short"; reason: string; sizeCNS: bigint }
  | { action: "close"; reason: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Worst-case loss an open can lock in on entry: the 3% band plus a margin for fees. */
const ENTRY_RISK_BPS = BAND_BPS + 50n;

/** Stage 1: the proposal itself, against the vault state and the strategy limits. */
export function checkProposal(p: Proposal, v: VaultView, limits: Limits): Verdict<Checked> {
  if (!(ACTIONS as readonly string[]).includes(p.action)) return fail(`unknown action "${p.action}"`);
  const action = p.action as Action;
  const reason = typeof p.reason === "string" ? p.reason.trim().slice(0, 280) : "";
  if (!reason) return fail("no reason given");
  if (action === "hold") return { ok: true, value: { action, reason } };
  if (v.frozen) return fail("vault is frozen");

  if (action === "close") {
    if (v.position.side === "flat" || v.position.lot === 0n) return fail("close proposed but there is no position");
    return { ok: true, value: { action, reason } };
  }

  // open_long / open_short
  if (v.position.side !== "flat") return fail(`${action} proposed while already ${v.position.side}: one position at a time`);
  const size = typeof p.sizeAusd === "number" ? p.sizeAusd : typeof p.sizeAusd === "string" ? Number(p.sizeAusd) : NaN;
  if (!Number.isFinite(size) || size <= 0) return fail(`size ${String(p.sizeAusd)} is not a positive number`);
  let sizeCNS: bigint;
  try {
    sizeCNS = parseUnits(size.toFixed(v.decimals), v.decimals);
  } catch {
    return fail(`size ${size} cannot be read as an amount`);
  }
  if (sizeCNS > v.maxTradeNotional) {
    return fail(`size ${size} is above the vault's maxTradeNotional ${fmt(v.maxTradeNotional, v.decimals)}`);
  }
  if (size > limits.maxSizeAusd) return fail(`size ${size} is above this house agent's ${limits.maxSizeAusd} AUSD limit`);
  return { ok: true, value: { action, reason, sizeCNS } };
}

/** The order built from a checked proposal. `notional` values it at max(limit, mark), like the adapter. */
export type Order = { orderType: number; pricePNS: bigint; lotLNS: bigint; notional: bigint };

/** Stage 2: the built order: price inside the 3% band, size inside the cap, daily-loss headroom left. */
export function checkOrder(o: Order, v: VaultView): Verdict<Order> {
  if (v.frozen) return fail("vault is frozen");
  if (o.lotLNS <= 0n) return fail("order is for zero lots");
  if (v.mark <= 0n) return fail("no mark price");
  const isBuy = o.orderType === OPEN_LONG || o.orderType === CLOSE_SHORT;
  if (![OPEN_LONG, OPEN_SHORT, CLOSE_LONG, CLOSE_SHORT].includes(o.orderType)) return fail(`order type ${o.orderType} not allowed`);
  if (isBuy ? o.pricePNS * 10_000n > v.mark * (10_000n + BAND_BPS) : o.pricePNS * 10_000n < v.mark * (10_000n - BAND_BPS)) {
    return fail(`limit ${o.pricePNS} is outside the 3% band around mark ${v.mark}`);
  }
  if (o.pricePNS <= 0n) return fail("limit price must be above 0");
  if (o.notional > v.maxTradeNotional) {
    return fail(`notional ${fmt(o.notional, v.decimals)} is above maxTradeNotional ${fmt(v.maxTradeNotional, v.decimals)}`);
  }
  const opens = o.orderType === OPEN_LONG || o.orderType === OPEN_SHORT;
  if (opens) {
    const headroom = dailyLossHeadroom(v);
    const risk = (o.notional * ENTRY_RISK_BPS) / 10_000n;
    if (headroom <= risk) {
      return fail(`daily-loss headroom ${fmt(headroom < 0n ? 0n : headroom, v.decimals)} is too small for a ${fmt(o.notional, v.decimals)} open`);
    }
  }
  return { ok: true, value: o };
}

/** Stage 3: the adapter's own quote (what the vault will count) against the cap. */
export function checkQuote(quoted: bigint, v: Pick<VaultView, "maxTradeNotional" | "decimals">): Verdict<bigint> {
  if (quoted > v.maxTradeNotional) {
    return fail(`adapter quote ${fmt(quoted, v.decimals)} is above maxTradeNotional ${fmt(v.maxTradeNotional, v.decimals)}`);
  }
  return { ok: true, value: quoted };
}

/** NAV above the freeze line (dayStartNav × (1 − cap), rounded up like the vault). Negative once breached. */
export function dailyLossHeadroom(v: Pick<VaultView, "nav" | "dayStartNav" | "dayRolled" | "dailyLossCapBps">) {
  const start = v.dayRolled ? v.nav : v.dayStartNav;
  const floor = (start * BigInt(10_000 - v.dailyLossCapBps) + 9_999n) / 10_000n;
  return v.nav - floor;
}

export function fmt(x: bigint, decimals: number) {
  const neg = x < 0n;
  const a = neg ? -x : x;
  const s = a.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}
