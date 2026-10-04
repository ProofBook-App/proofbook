// Momentum from stored marks, the published rule, and reading Kimi's tool call.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { HouseAgent } from "../src/config.ts";
import { loadConfig } from "../src/config.ts";
import { draw, momentum, parseToolCall, ruleDecision, windDownStep } from "../src/strategy.ts";

const agent: HouseAgent = {
  agentId: "1951",
  label: "House agent #1 (momentum)",
  strategy: "momentum",
  vault: "0x98e2af31848B95d751e3BFD5bAB9E5EAB9122B53",
  adapter: "0x583B6bCFcAec599E6Fc09e27db581d6abe7baB09",
  perpId: 64n,
  sizeAusd: 25,
  maxSizeAusd: 50,
  thresholdBps: 100,
  lookbackMinutes: 30,
};

const T = 1_790_900_000;
const samples = (marks: bigint[]) => marks.map((mark, i) => ({ at: T - (marks.length - i) * 300, mark }));

test("no history: no lookback change, and the rule holds", () => {
  const m = momentum({ at: T, mark: 2_700n }, [], 30);
  assert.equal(m.changeBps, undefined);
  assert.equal(m.samples, 1);
  assert.deepEqual(ruleDecision(m, "flat", agent), { action: "hold" });
});

test("needs half the lookback before it signals", () => {
  // Two samples, 10 minutes back: under 15 minutes of a 30-minute lookback.
  const m = momentum({ at: T, mark: 2_800n }, samples([2_700n, 2_700n]), 30);
  assert.equal(m.changeBps, undefined);
  assert.equal(m.lastStepBps, 370);
});

test("compares with the oldest sample inside the lookback", () => {
  // Seven samples 5 minutes apart: the oldest (35 min) is outside 30 + slack, so 2,700 at 30 min is the reference.
  const hist = samples([2_600n, 2_700n, 2_710n, 2_720n, 2_730n, 2_740n, 2_750n]);
  const m = momentum({ at: T, mark: 2_727n }, hist, 30);
  assert.equal(m.spanMinutes, 30);
  assert.equal(m.changeBps, 100);
  assert.deepEqual(ruleDecision(m, "flat", agent), { action: "open_long", sizeAusd: 25 });
  assert.deepEqual(ruleDecision(m, "short", agent), { action: "close" });
  assert.deepEqual(ruleDecision(m, "long", agent), { action: "hold" });
});

test("down moves short when flat and close a long at half the threshold", () => {
  const down = momentum({ at: T, mark: 2_673n }, samples([2_700n, 2_700n, 2_700n, 2_700n, 2_700n, 2_700n]), 30);
  assert.equal(down.changeBps, -100);
  assert.deepEqual(ruleDecision(down, "flat", agent), { action: "open_short", sizeAusd: 25 });
  const dip = momentum({ at: T, mark: 2_686n }, samples([2_700n, 2_700n, 2_700n, 2_700n]), 30);
  assert.equal(dip.changeBps, -51);
  assert.deepEqual(ruleDecision(dip, "long", agent), { action: "close" });
  assert.deepEqual(ruleDecision(dip, "flat", agent), { action: "hold" });
});

test("reads an OpenAI-shaped tool call (arguments as a JSON string)", () => {
  const out = {
    choices: [
      {
        message: {
          tool_calls: [{ id: "functions.open_long:0", function: { name: "open_long", arguments: '{"size_ausd": 25, "reason": "Up 1.1%."}' } }],
        },
      },
    ],
  };
  assert.deepEqual(parseToolCall(out), { action: "open_long", sizeAusd: 25, reason: "Up 1.1%." });
});

test("no tool call becomes 'none', which the validator rejects", () => {
  assert.equal(parseToolCall({ choices: [{ message: { content: "I would hold." } }] }).action, "none");
  assert.equal(parseToolCall({ response: "hold" }).action, "none");
  assert.equal(parseToolCall({ tool_calls: [{ name: "hold", arguments: { reason: "Flat." } }] }).action, "hold");
});

test("mean reversion bets against the move and closes on half of it back", () => {
  const mr = { ...agent, strategy: "mean-reversion" as const };
  const m = (changeBps: number) => ({ changeBps, samples: 7 });
  assert.deepEqual(ruleDecision(m(120), "flat", mr), { action: "open_short", sizeAusd: mr.sizeAusd });
  assert.deepEqual(ruleDecision(m(-120), "flat", mr), { action: "open_long", sizeAusd: mr.sizeAusd });
  assert.deepEqual(ruleDecision(m(60), "long", mr), { action: "close" });
  assert.deepEqual(ruleDecision(m(-60), "short", mr), { action: "close" });
  assert.deepEqual(ruleDecision(m(-60), "long", mr), { action: "hold" });
  assert.deepEqual(ruleDecision(m(40), "flat", mr), { action: "hold" });
});

test("the random control acts on roll 0 only, and its coin can be recomputed", () => {
  const rnd = { ...agent, strategy: "random" as const };
  const m = { samples: 1 };
  const a = draw("1990", 1_791_000_000);
  assert.deepEqual(a, draw("1990", 1_791_000_000 + 120)); // same 5-minute slot, same coin
  assert.equal(a.slot, Math.floor(1_791_000_000 / 300));
  assert.ok(a.roll >= 0 && a.roll < 6 && (a.coin === 0 || a.coin === 1));
  assert.deepEqual(ruleDecision(m, "flat", rnd, { slot: 1, roll: 3, coin: 0 }), { action: "hold" });
  assert.deepEqual(ruleDecision(m, "flat", rnd, { slot: 1, roll: 0, coin: 0 }), { action: "open_long", sizeAusd: rnd.sizeAusd });
  assert.deepEqual(ruleDecision(m, "flat", rnd, { slot: 1, roll: 0, coin: 1 }), { action: "open_short", sizeAusd: rnd.sizeAusd });
  assert.deepEqual(ruleDecision(m, "short", rnd, { slot: 1, roll: 0, coin: 0 }), { action: "close" });
  // About one run in six acts.
  let acts = 0;
  for (let i = 0; i < 6000; i++) if (draw("1990", i * 300).roll === 0) acts++;
  assert.ok(acts > 850 && acts < 1150, `acts ${acts}`);
});

// ---- wind-down: close-only, then margin back to the vault
const winding: HouseAgent = { ...agent, windDown: true };

test("wind-down never opens, even on a signal the strategy would trade", () => {
  const up = momentum({ at: T, mark: 2_727n }, samples([2_700n, 2_700n, 2_700n, 2_700n, 2_700n, 2_700n]), 30);
  assert.deepEqual(ruleDecision(up, "flat", agent), { action: "open_long", sizeAusd: 25 });
  const step = windDownStep(up, "flat", winding, 0n, 6);
  assert.equal(step.action, "hold");
  assert.match(step.reason, /nothing more to do/);
});

test("wind-down holds an open long until the close rule fires, then closes it", () => {
  const up = momentum({ at: T, mark: 2_727n }, samples([2_700n, 2_700n, 2_700n, 2_700n, 2_700n, 2_700n]), 30);
  const hold = windDownStep(up, "long", winding, 80_000_000n, 6);
  assert.equal(hold.action, "hold");
  assert.equal(hold.reason, "Winding down, so no new trades. The long stays open until MON falls 0.5% over 30 minutes, the strategy's close rule (it's 1% now).");

  const dip = momentum({ at: T, mark: 2_686n }, samples([2_700n, 2_700n, 2_700n, 2_700n]), 30);
  const close = windDownStep(dip, "long", winding, 80_000_000n, 6);
  assert.equal(close.action, "close");
  assert.equal(close.reason, "Winding down, and MON moved -0.51% over 30 minutes, the strategy's close rule, so the long closes.");
});

test("wind-down without enough history keeps the position and says why", () => {
  const m = momentum({ at: T, mark: 2_700n }, [], 30);
  const step = windDownStep(m, "short", winding, 0n, 6);
  assert.equal(step.action, "hold");
  assert.match(step.reason, /The short stays open until MON rises 0\.5% .*not enough price history/);
});

test("wind-down recalls all free margin once flat, then has nothing left to do", () => {
  const m = momentum({ at: T, mark: 2_700n }, [], 30);
  const recall = windDownStep(m, "flat", winding, 80_123_456n, 6);
  assert.deepEqual(recall, {
    action: "withdraw_margin",
    amount: 80_123_456n,
    reason: "Winding down with no position open, so 80.123456 AUSD of free margin goes back to the vault.",
  });
  assert.equal(windDownStep(m, "flat", winding, 0n, 6).action, "hold");
});

test("wind-down on mean reversion waits for its own close direction", () => {
  const mr: HouseAgent = { ...winding, strategy: "mean-reversion" };
  const m = momentum({ at: T, mark: 2_700n }, [], 30);
  assert.match(windDownStep(m, "long", mr, 0n, 6).reason, /MON rises 0\.5%/);
});

test("the windDown flag is read only when it is literally true", () => {
  const raw = { agentId: "1951", label: "x", vault: agent.vault, adapter: agent.adapter, perpId: "64", sizeAusd: 25, maxSizeAusd: 50, thresholdBps: 100, lookbackMinutes: 30 };
  const env = (agents: unknown[]) => ({ MODE: "dry-run", CHAIN_ID: "10143", HOUSE_AGENTS: agents, RPC_URL: "x", EXPLORER: "x", MODEL: "m" }) as unknown as Env;
  const [on, off, str] = loadConfig(env([{ ...raw, windDown: true }, raw, { ...raw, windDown: "true" }])).agents;
  assert.equal(on!.windDown, true);
  assert.equal(off!.windDown, false);
  assert.equal(str!.windDown, false);
});
