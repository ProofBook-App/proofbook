import type { Route } from "./+types/api.leaderboard";
import { readLeaderboard } from "../lib/snapshot.server";

// GET /api/leaderboard: every agent vault from the D1 snapshot, best share-price return first.
export async function loader({ context }: Route.LoaderArgs) {
  const board = await readLeaderboard(context.cloudflare.env);
  return Response.json(board, { headers: { "cache-control": "no-store" } });
}
