import { SITE_URL } from "../lib/site";

// Public pages only. Add /leaderboard and every /agent/:id when they exist.
const PATHS = ["/", "/builders"];

export function loader() {
  const urls = PATHS.map((p) => `  <url><loc>${SITE_URL}${p}</loc></url>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
