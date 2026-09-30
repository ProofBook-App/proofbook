import { ImageResponse } from "workers-og";
import type { Route } from "./+types/og.agent";
import { AgentCard, cardFonts, type CardData } from "../og/agent-card";
import { assetSymbol, chainName } from "../lib/chains";
import { formatBps, formatSigned, formatUnits } from "../lib/format";
import { readAgent } from "../lib/snapshot.server";

// GET /og/agent/:id.png: the agent's preview card for X, Discord and Telegram, from the D1 snapshot.
// Rendering costs CPU, so each card is kept in the Worker cache for five minutes. If rendering
// fails, it redirects to the site-wide /og.png so a shared link still gets a preview.
const MAX_AGE = 300;

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const id = /^(\d{1,78})\.png$/.exec(params.file)?.[1];
  if (!id) return new Response("Not found", { status: 404 });

  // Workers' default cache; the DOM lib's CacheStorage type (also in scope) doesn't know it.
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(request);
  if (hit) return hit;

  const env = context.cloudflare.env;
  let png: ArrayBuffer;
  try {
    const snapshot = await readAgent(env, id, 0);
    if (!snapshot) return new Response("Not found", { status: 404 });
    // Read the whole PNG here: ImageResponse renders into its body stream, so a failure would
    // otherwise surface after a 200 as a broken image.
    const image = new ImageResponse(<AgentCard d={cardData(snapshot)} />, {
      width: 1200,
      height: 630,
      fonts: cardFonts(),
    });
    png = await image.arrayBuffer();
    if (png.byteLength === 0) throw new Error("empty render");
  } catch (err) {
    // Any failure (D1, fonts, WASM): send link previews the site-wide card instead of nothing.
    console.error("og card failed", id, err);
    return new Response(null, {
      status: 302,
      headers: { location: new URL("/og.png", request.url).toString(), "cache-control": "no-store" },
    });
  }

  const res = new Response(png, {
    headers: { "content-type": "image/png", "cache-control": `public, max-age=${MAX_AGE}` },
  });
  context.cloudflare.ctx.waitUntil(cache.put(request, res.clone()));
  return res;
}

function cardData(snapshot: NonNullable<Awaited<ReturnType<typeof readAgent>>>): CardData {
  const a = snapshot.agent;
  const symbol = assetSymbol(snapshot.chainId, a.asset);
  return {
    name: a.name,
    agentId: a.agentId,
    house: a.house,
    frozen: a.frozen,
    network: chainName(snapshot.chainId),
    returnText: formatBps(a.returnBps, true),
    returnSign: Math.sign(a.returnBps),
    stats: [
      { label: "PnL", value: `${formatSigned(a.pnl)} ${symbol}` },
      { label: "NAV", value: `${formatUnits(a.nav)} ${symbol}` },
      { label: "Max drawdown", value: formatBps(a.maxDrawdownBps) },
      { label: "Trades", value: String(a.tradeCount) },
    ],
    breaches: a.breachCount,
    block: snapshot.indexerBlock,
  };
}
