import { ImageResponse } from "workers-og";
import type { Route } from "./+types/og.agent";
import { AgentCard, cardFonts, type CardData } from "../og/agent-card";
import { assetSymbol, chainName } from "../lib/chains";
import { formatBps, formatSigned, formatUnits } from "../lib/format";
import { readAgent } from "../lib/snapshot.server";

// GET /og/agent/:id.png: the agent's preview card for X, Discord and Telegram, from the D1 snapshot.
// Rendering costs CPU, so each card is kept in the Worker cache for five minutes.
const MAX_AGE = 300;

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const id = /^(\d{1,78})\.png$/.exec(params.file)?.[1];
  if (!id) return new Response("Not found", { status: 404 });

  // Workers' default cache; the DOM lib's CacheStorage type (also in scope) doesn't know it.
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(request);
  if (hit) return hit;

  const env = context.cloudflare.env;
  const snapshot = await readAgent(env, id, 0);
  if (!snapshot) return new Response("Not found", { status: 404 });
  const a = snapshot.agent;
  const symbol = assetSymbol(snapshot.chainId, a.asset);

  const data: CardData = {
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

  const image = new ImageResponse(<AgentCard d={data} />, { width: 1200, height: 630, fonts: cardFonts() });
  const res = new Response(image.body, {
    headers: { "content-type": "image/png", "cache-control": `public, max-age=${MAX_AGE}` },
  });
  context.cloudflare.ctx.waitUntil(cache.put(request, res.clone()));
  return res;
}
