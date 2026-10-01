import { getAddress, isAddress } from "viem";
import type { Route } from "./+types/api.backer";
import { readBacker } from "../lib/snapshot.server";

// GET /api/backer/:address: the portfolio behind /portfolio. Every agent on the board, this account's
// deposits and withdrawals from the indexer, and the open positions and latest trades of the vaults
// it backs. Balances and share values are read from the chain by the page, so they're always live.
export async function loader({ params, context }: Route.LoaderArgs) {
  const headers = { "cache-control": "no-store" };
  if (!isAddress(params.address)) return Response.json({ error: "not an address" }, { status: 400, headers });
  const backer = await readBacker(context.cloudflare.env, getAddress(params.address));
  return Response.json(backer, { headers });
}
