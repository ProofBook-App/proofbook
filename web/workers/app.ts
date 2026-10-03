import { createRequestHandler } from "react-router";
import { restockDrip } from "../app/lib/drip.server";
import { syncSnapshot } from "../app/lib/snapshot.server";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: { env: Env; ctx: ExecutionContext };
  }
}

// Pages only (HTML). connect-src is the origins the browser talks to: this Worker and the Monad RPCs
// the backer session signs through. React Router hydrates with inline scripts, so script-src keeps
// 'unsafe-inline'; frame-ancestors stops the passkey flow being framed by another site.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://rpc.monad.xyz https://testnet-rpc.monad.xyz",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

function withSecurityHeaders(res: Response) {
  if (!res.headers.get("content-type")?.includes("text/html")) return res;
  const out = new Response(res.body, res);
  out.headers.set("content-security-policy", CSP);
  out.headers.set("x-content-type-options", "nosniff");
  out.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  return out;
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    // www.proofbook.app is attached too; send it to the canonical apex.
    const url = new URL(request.url);
    if (url.hostname === "www.proofbook.app") {
      url.hostname = "proofbook.app";
      return Response.redirect(url.toString(), 301);
    }
    const res = await requestHandler(request, { cloudflare: { env, ctx } });
    // Vite's dev server injects its own inline modules and websocket; only production gets the CSP.
    return import.meta.env.PROD ? withSecurityHeaders(res) : res;
  },

  // Every minute: copy the Envio indexer into the D1 snapshot the leaderboard reads, and on testnet
  // keep the test-funds wallet stocked with AUSD for when Agora's faucet is busy.
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(syncSnapshot(env).then((r) => console.log("snapshot", JSON.stringify(r))));
    ctx.waitUntil(restockDrip(env).then((r) => r && console.log("drip stock", JSON.stringify(r)), (e) => console.error("drip restock", e)));
  },
} satisfies ExportedHandler<Env>;
