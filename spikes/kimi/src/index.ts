// Day 0 spike: can Kimi K2.6 on Workers AI drive a house agent through tool calls?
// Run: wrangler dev (AI binding is always remote), then curl localhost:8787.

interface Env { AI: Ai }

const MODEL = "@cf/moonshotai/kimi-k2.6";

// The house agent's whole action space: read state, then either trade within limits or hold.
const tools = [
  {
    type: "function",
    function: {
      name: "get_market",
      description: "Mark price, 1h change and funding for a Perpl perp.",
      parameters: { type: "object", properties: { symbol: { type: "string", enum: ["MON", "BTC", "ETH", "SOL"] } }, required: ["symbol"] },
    },
  },
  {
    type: "function",
    function: {
      name: "place_order",
      description: "Open or close a Perpl position through the vault. Notional must be <= maxTradeNotional.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", enum: ["MON", "BTC", "ETH", "SOL"] },
          side: { type: "string", enum: ["open_long", "open_short", "close_long", "close_short"] },
          notionalUsd: { type: "number" },
          reason: { type: "string", description: "One sentence, shown publicly on the leaderboard." },
        },
        required: ["symbol", "side", "notionalUsd", "reason"],
      },
    },
  },
  {
    type: "function",
    function: { name: "hold", description: "Do nothing this round.", parameters: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] } },
  },
];

// Canned tool results so the spike is deterministic.
const fake: Record<string, (a: any) => unknown> = {
  get_market: (a) => ({ symbol: a.symbol, mark: a.symbol === "MON" ? 0.02698 : 60000, change1hPct: a.symbol === "MON" ? 2.4 : -0.3, fundingPct8h: 0.01 }),
  place_order: (a) => ({ ok: a.notionalUsd <= 50, txHash: "0xspike", error: a.notionalUsd > 50 ? "TradeTooLarge" : undefined }),
  hold: () => ({ ok: true }),
};

export default {
  async fetch(_req: Request, env: Env): Promise<Response> {
    const messages: any[] = [
      {
        role: "system",
        content:
          "You are Proofbook House Agent #1, a plainly labelled house agent. Strategy (fixed, public): trend-follow MON only. " +
          "If MON 1h change > +2% open_long, < -2% open_short, else hold. maxTradeNotional is $50. Never exceed it. " +
          "Always call get_market first, then exactly one of place_order or hold.",
      },
      { role: "user", content: "Run one round." },
    ];
    const trace: unknown[] = [];
    const t0 = Date.now();
    for (let step = 0; step < 5; step++) {
      const out: any = await env.AI.run(MODEL as any, { messages, tools, max_tokens: 1024 } as any);
      const msg = out.choices?.[0]?.message ?? { role: "assistant", content: out.response, tool_calls: out.tool_calls };
      const calls = msg.tool_calls ?? [];
      trace.push({ step, ms: Date.now() - t0, content: msg.content, calls, usage: out.usage });
      if (!calls.length) break;
      messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: calls });
      for (const c of calls) {
        const name = c.function?.name ?? c.name;
        const raw = c.function?.arguments ?? c.arguments;
        const args = typeof raw === "string" ? JSON.parse(raw) : raw;
        messages.push({ role: "tool", tool_call_id: c.id, name, content: JSON.stringify(fake[name]?.(args) ?? { error: "unknown tool" }) });
      }
      if (calls.some((c: any) => (c.function?.name ?? c.name) !== "get_market")) break;
    }
    return Response.json({ model: MODEL, totalMs: Date.now() - t0, trace }, { headers: { "content-type": "application/json" } });
  },
};
