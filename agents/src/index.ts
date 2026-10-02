// proofbook-agents: Proofbook's house agents on Monad testnet (spec §3 item 8, Day 2).
// A cron every 5 minutes runs each house agent once (src/run.ts). MODE "dry-run" (the default)
// decides, validates and simulates but never signs; MODE "live" also signs through Privy.
// GET /decisions serves the latest log rows (no prompts, no secrets) for a quick look.
import { loadConfig } from "./config.ts";
import { recentDecisions } from "./db.ts";
import { runAgent } from "./run.ts";

async function runAll(env: Env) {
  const cfg = loadConfig(env);
  const out = [];
  // One agent at a time: public RPCs rate-limit, and house agents never coordinate anyway.
  for (const agent of cfg.agents) {
    try {
      out.push(await runAgent(env, cfg, agent));
    } catch (e) {
      console.error("house agent run failed", agent.agentId, e);
      out.push({ agent: agent.agentId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runAll(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/decisions") {
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 100);
      return Response.json(await recentDecisions(env.DB, Number(env.CHAIN_ID), limit));
    }
    if (url.pathname === "/") {
      const cfg = loadConfig(env);
      return Response.json({
        name: "proofbook-agents",
        chainId: cfg.chainId,
        mode: cfg.mode,
        model: cfg.model,
        agents: cfg.agents.map((a) => ({ agentId: a.agentId, label: a.label, vault: a.vault, house: true })),
      });
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
