// Momentum from stored marks, the published rule, and reading Kimi's tool call.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { HouseAgent } from "../src/config.ts";
import { momentum, parseToolCall, ruleDecision } from "../src/strategy.ts";

const agent: HouseAgent = {
  agentId: "1951",
  label: "House agent #1 (momentum)",
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
