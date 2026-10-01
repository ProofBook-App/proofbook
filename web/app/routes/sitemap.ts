import type { Route } from "./+types/sitemap";
import { SITE_URL } from "../lib/site";

// Public pages only: the static ones plus every agent profile in the D1 snapshot.
const PATHS = ["/", "/leaderboard", "/builders", "/enter"];

export async function loader({ context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  let agents: string[] = [];
  try {
    const rows = await env.DB.prepare(`SELECT agent_id FROM vaults WHERE chain_id = ?1 ORDER BY agent_id`)
      .bind(Number(env.CHAIN_ID))
      .all<{ agent_id: string }>();
    agents = rows.results.map((r) => `/agent/${r.agent_id}`);
  } catch {
    // No snapshot yet: the static pages are still worth listing.
  }
  const urls = [...PATHS, ...agents].map((p) => `  <url><loc>${SITE_URL}${p}</loc></url>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
