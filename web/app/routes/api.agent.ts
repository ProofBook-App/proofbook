import type { Route } from "./+types/api.agent";
import { readActivity, readAgent } from "../lib/snapshot.server";

// GET /api/agent/:id: one agent (ERC-8004 id) from the D1 snapshot, with its open Perpl positions and
// share-price history, plus its latest trades, flows and policy events read live from the indexer.
export async function loader({ params, context }: Route.LoaderArgs) {
  const headers = { "cache-control": "no-store" };
  if (!/^\d{1,78}$/.test(params.id)) return Response.json({ error: "agent id must be a number" }, { status: 400, headers });
  const env = context.cloudflare.env;
  const agent = await readAgent(env, params.id);
  if (!agent) return Response.json({ error: `no agent ${params.id} on chain ${env.CHAIN_ID}` }, { status: 404, headers });
  const activity = await readActivity(env, agent.agent.vault);
  return Response.json({ ...agent, activity }, { headers });
}
