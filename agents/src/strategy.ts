// The house agent's strategy and the Kimi K2.6 call. The strategy is fixed and public: this text is
// what the model sees, and it is what the agent's profile can publish. Kimi reads a compact snapshot
// and picks one tool: hold, open_long, open_short or close, with a size and a one-sentence reason.
// Its choice is advisory; src/validate.ts checks it before anything is signed. The same rule is also
// computed in code (ruleDecision) and logged next to the model's answer, so anyone can see when the
// two disagree.
import type { HouseAgent } from "./config.ts";
import type { Observation } from "./chain.ts";
import { fmt, type Action, type Proposal, type Side } from "./validate.ts";

export type MarkSample = { at: number; mark: bigint };

export type Momentum = {
  /** Mark change over the lookback, in bps, or undefined without enough history. */
  changeBps?: number;
  /** Mark change since the previous sample (about 5 minutes), in bps. */
  lastStepBps?: number;
  /** Age of the reference sample, in minutes. */
  spanMinutes?: number;
  samples: number;
};

/** Momentum from stored marks: compare now with the oldest sample inside the lookback. */
export function momentum(now: MarkSample, history: MarkSample[], lookbackMinutes: number): Momentum {
  const prior = history.filter((s) => s.at < now.at && s.mark > 0n).sort((a, b) => a.at - b.at);
  const windowStart = now.at - lookbackMinutes * 60;
  const inWindow = prior.filter((s) => s.at >= windowStart - 150); // half a cron tick of slack
  const ref = inWindow[0];
  const last = prior[prior.length - 1];
  const bps = (from: bigint) => Number(((now.mark - from) * 10_000n) / from);
  const span = ref ? (now.at - ref.at) / 60 : undefined;
  return {
    // Needs at least half the lookback, so one noisy tick can't open a position.
    changeBps: ref && span !== undefined && span >= lookbackMinutes / 2 ? bps(ref.mark) : undefined,
    lastStepBps: last && now.at - last.at <= 15 * 60 ? bps(last.mark) : undefined,
    spanMinutes: span === undefined ? undefined : Math.round(span),
    samples: inWindow.length + 1,
  };
}

/**
 * The random-walk control's coin, recomputable by anyone: FNV-1a over "agentId:slot", where slot is
 * the 5-minute block-time slot. roll 0 (one run in six) means act; coin picks long (0) or short (1).
 */
export type Draw = { slot: number; roll: number; coin: number };

export function draw(agentId: string, at: number): Draw {
  const slot = Math.floor(at / 300);
  let h = 0x811c9dc5;
  for (const ch of `${agentId}:${slot}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return { slot, roll: h % 6, coin: (h >>> 8) % 2 };
}

/** The published rule, in code. The model is asked to apply exactly this. */
export function ruleDecision(m: Momentum, side: Side, agent: HouseAgent, coin?: Draw): { action: Action; sizeAusd?: number } {
  const open = (a: "open_long" | "open_short") => ({ action: a, sizeAusd: agent.sizeAusd }) as const;
  if (agent.strategy === "random") {
    if (!coin || coin.roll !== 0) return { action: "hold" };
    if (side === "flat") return open(coin.coin === 0 ? "open_long" : "open_short");
    return { action: "close" };
  }
  const t = agent.thresholdBps;
  if (m.changeBps === undefined) return { action: "hold" };
  // Momentum follows the move; mean reversion bets against it. Each closes on half the move back.
  const revert = agent.strategy === "mean-reversion";
  const up = revert ? "open_short" : "open_long";
  const down = revert ? "open_long" : "open_short";
  if (side === "flat") {
    if (m.changeBps >= t) return open(up);
    if (m.changeBps <= -t) return open(down);
    return { action: "hold" };
  }
  const longCloses = revert ? m.changeBps >= t / 2 : m.changeBps <= -t / 2;
  const shortCloses = revert ? m.changeBps <= -t / 2 : m.changeBps >= t / 2;
  if (side === "long" && longCloses) return { action: "close" };
  if (side === "short" && shortCloses) return { action: "close" };
  return { action: "hold" };
}

function rules(agent: HouseAgent): string[] {
  const t = agent.thresholdBps;
  const size = agent.sizeAusd;
  if (agent.strategy === "random") {
    return [
      `Strategy (random-walk control, public): you are the control the other house agents are measured against. Ignore the price.`,
      `- Use random.roll and random.coin from the snapshot (a hash of your agent id and the 5-minute slot, which anyone can recompute).`,
      `- If random.roll is not 0: hold.`,
      `- If random.roll is 0 and you are flat: open_long ${size} AUSD if random.coin is 0, open_short ${size} AUSD if it is 1.`,
      `- If random.roll is 0 and you hold a position: close.`,
      `- In the reason, say it was the coin, not a view on the market.`,
    ];
  }
  const [name, up, down, longClose, shortClose] =
    agent.strategy === "mean-reversion"
      ? ["mean reversion", "open_short", "open_long", `>= ${t / 2}`, `<= -${t / 2}`]
      : ["momentum", "open_long", "open_short", `<= -${t / 2}`, `>= ${t / 2}`];
  return [
    `Strategy (${name}, public):`,
    `- Use change_lookback_bps: the mark's change over the last ${agent.lookbackMinutes} minutes.`,
    `- If it is null, there is not enough price history: hold.`,
    `- Flat: if change_lookback_bps >= ${t}, ${up} ${size} AUSD. If <= -${t}, ${down} ${size} AUSD. Otherwise hold.`,
    `- Long: close if change_lookback_bps ${longClose}. Otherwise hold.`,
    `- Short: close if change_lookback_bps ${shortClose}. Otherwise hold.`,
  ];
}

export function systemPrompt(agent: HouseAgent): string {
  return [
    `You are ${agent.label}, a Proofbook house agent. House agents are run by the Proofbook team, plainly labelled, and trade small size with a fixed public strategy.`,
    `You trade one Perpl perpetual (MON) through your vault at 1x leverage. You hold at most one position.`,
    ...rules(agent),
    `- Never size above ${agent.maxSizeAusd} AUSD or the vault's max_trade_ausd. If the vault is frozen, hold.`,
    `Call exactly one tool. The reason is one plain sentence for backers, with the numbers you used, shown publicly next to the trade. Write it in everyday words ("MON fell 1.1% in the last 30 minutes"), percentages rather than basis points, and never a field name like change_lookback_bps.`,
  ].join("\n");
}

const reason = { type: "string", description: "One plain-English sentence for backers, shown publicly on the agent's profile. No field names." };
const size = { type: "number", description: "Position size in AUSD (collateral at 1x)." };

export const tools = [
  {
    type: "function",
    function: { name: "hold", description: "Do nothing this round.", parameters: { type: "object", properties: { reason }, required: ["reason"] } },
  },
  {
    type: "function",
    function: {
      name: "open_long",
      description: "Open a MON long of size_ausd at 1x. Only when flat.",
      parameters: { type: "object", properties: { size_ausd: size, reason }, required: ["size_ausd", "reason"] },
    },
  },
  {
    type: "function",
    function: {
      name: "open_short",
      description: "Open a MON short of size_ausd at 1x. Only when flat.",
      parameters: { type: "object", properties: { size_ausd: size, reason }, required: ["size_ausd", "reason"] },
    },
  },
  {
    type: "function",
    function: { name: "close", description: "Close the whole open position.", parameters: { type: "object", properties: { reason }, required: ["reason"] } },
  },
];

/** The compact snapshot the model reads. Prices in USD, amounts in AUSD, as decimal strings. */
export function context(obs: Observation, m: Momentum, headroom: bigint, coin?: Draw) {
  const d = obs.decimals;
  const pd = Number(obs.market.priceDecimals);
  const pos = obs.position;
  return {
    market: {
      perp: `${obs.market.symbol} perpetual on Perpl`,
      mark: fmt(obs.market.mark, pd),
      bid: fmt(obs.market.bid, pd),
      ask: fmt(obs.market.ask, pd),
      change_lookback_bps: m.changeBps ?? null,
      lookback_span_minutes: m.spanMinutes ?? null,
      change_last_5m_bps: m.lastStepBps ?? null,
      samples: m.samples,
    },
    ...(coin ? { random: { slot: coin.slot, roll: coin.roll, coin: coin.coin } } : {}),
    position:
      pos.side === "flat"
        ? { side: "flat" }
        : { side: pos.side, lots: pos.lot.toString(), entry: fmt(pos.entryPrice, pd), margin_ausd: fmt(pos.deposit, d), pnl_ausd: fmt(pos.pnl, d) },
    vault: {
      frozen: obs.frozen,
      nav_ausd: fmt(obs.nav, d),
      idle_ausd: fmt(obs.idle, d),
      free_perpl_margin_ausd: fmt(obs.freeMargin, d),
      max_trade_ausd: fmt(obs.maxTradeNotional, d),
      daily_loss_cap_pct: obs.dailyLossCapBps / 100,
      daily_loss_headroom_ausd: fmt(headroom < 0n ? 0n : headroom, d),
    },
  };
}

export type KimiResult = {
  proposal: Proposal;
  messages: unknown[];
  response: unknown;
  ms: number;
};

/** One Kimi K2.6 call through the Workers AI binding (the tool-call shape from spikes/kimi). */
export async function askKimi(ai: Ai, model: string, agent: HouseAgent, ctx: unknown): Promise<KimiResult> {
  const messages = [
    { role: "system", content: systemPrompt(agent) },
    { role: "user", content: `Snapshot:\n${JSON.stringify(ctx)}\nDecide this round.` },
  ];
  const t0 = Date.now();
  const out = (await ai.run(model as Parameters<Ai["run"]>[0], {
    messages,
    tools,
    max_tokens: 2048,
    temperature: 0.2,
  } as never)) as Record<string, unknown>;
  const ms = Date.now() - t0;
  return { proposal: parseToolCall(out), messages, response: out, ms };
}

/** First tool call in an OpenAI-shaped (or legacy Workers AI) response → a proposal. No call → "none". */
export function parseToolCall(out: Record<string, unknown>): Proposal {
  type Call = { name?: string; arguments?: unknown; function?: { name?: string; arguments?: unknown } };
  const choices = out.choices as { message?: { tool_calls?: Call[] } }[] | undefined;
  const calls: Call[] = choices?.[0]?.message?.tool_calls ?? (out.tool_calls as Call[] | undefined) ?? [];
  const c = calls[0];
  if (!c) return { action: "none", reason: "the model called no tool" };
  const name = c.function?.name ?? c.name ?? "none";
  const raw = c.function?.arguments ?? c.arguments ?? {};
  let args: Record<string, unknown> = {};
  try {
    args = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>;
  } catch {
    return { action: name, reason: undefined };
  }
  return { action: name, sizeAusd: args.size_ausd, reason: args.reason };
}

/** A wind-down agent's step: what it does this run, decided in code (no model call). */
export type WindDownStep = { action: "close" | "withdraw_margin" | "hold"; amount?: bigint; reason: string };

const pct = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;

/**
 * Close-only: never opens. An open position closes only when the strategy's own close rule fires
 * (the same rule it traded on, so the exit isn't a discretionary call). Once flat, free Perpl margin
 * goes back to the vault, where backers can withdraw it. Then it holds with nothing left to do.
 */
export function windDownStep(m: Momentum, side: Side, agent: HouseAgent, freeMargin: bigint, decimals: number, coin?: Draw): WindDownStep {
  if (side !== "flat") {
    const rule = ruleDecision(m, side, agent, coin);
    if (rule.action === "close") {
      const why = agent.strategy === "random" ? "the coin called a close" : `MON moved ${pct(m.changeBps!)} over ${agent.lookbackMinutes} minutes`;
      return { action: "close", reason: `Winding down, and ${why}, the strategy's close rule, so the ${side} closes.` };
    }
    let wait: string;
    if (agent.strategy === "random") wait = "the coin calls a close";
    else {
      const falls = (side === "long") === (agent.strategy === "momentum");
      wait = `MON ${falls ? "falls" : "rises"} ${pct(agent.thresholdBps / 2)} over ${agent.lookbackMinutes} minutes, the strategy's close rule`;
      wait += m.changeBps === undefined ? " (not enough price history yet)" : ` (it's ${pct(m.changeBps)} now)`;
    }
    return { action: "hold", reason: `Winding down, so no new trades. The ${side} stays open until ${wait}.` };
  }
  if (freeMargin > 0n) {
    return {
      action: "withdraw_margin",
      amount: freeMargin,
      reason: `Winding down with no position open, so ${fmt(freeMargin, decimals)} AUSD of free margin goes back to the vault.`,
    };
  }
  return { action: "hold", reason: "Wound down: no position open and no margin left at Perpl, so there is nothing more to do." };
}
