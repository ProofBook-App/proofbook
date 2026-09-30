import type { Route } from "./+types/api.drip";
import { drip } from "../lib/drip.server";
import { readAgent } from "../lib/snapshot.server";

// POST /api/drip {address, agentId}: testnet MON for gas plus AUSD from Agora's faucet, for a new
// backer account (app/lib/drip.server.ts). 404 anywhere but testnet or when the drip is off.
export async function action({ request, context }: Route.ActionArgs) {
  const headers = { "cache-control": "no-store" };
  if (request.method !== "POST") return Response.json({ error: "POST only" }, { status: 405, headers });
  const env = context.cloudflare.env;
  let body: { address?: unknown; agentId?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON: {address, agentId}" }, { status: 400, headers });
  }
  // The AUSD comes from the vault's own asset, so the drip can't be pointed at another token.
  const agent = typeof body.agentId === "string" && /^\d{1,78}$/.test(body.agentId) ? await readAgent(env, body.agentId, 0) : null;
  if (!agent) return Response.json({ error: "Unknown agent" }, { status: 400, headers });
  const result = await drip(env, body.address, request.headers.get("cf-connecting-ip"), agent.agent.asset);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status, headers });
  return Response.json(result, { headers });
}
