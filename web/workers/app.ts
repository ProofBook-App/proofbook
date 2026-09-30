import { createRequestHandler } from "react-router";
import { restockDrip } from "../app/lib/drip.server";
import { syncSnapshot } from "../app/lib/snapshot.server";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: { env: Env; ctx: ExecutionContext };
  }
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
    return requestHandler(request, { cloudflare: { env, ctx } });
  },

  // Every minute: copy the Envio indexer into the D1 snapshot the leaderboard reads, and on testnet
  // keep the test-funds wallet stocked with AUSD for when Agora's faucet is busy.
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(syncSnapshot(env).then((r) => console.log("snapshot", JSON.stringify(r))));
    ctx.waitUntil(restockDrip(env).then((r) => r && console.log("drip stock", JSON.stringify(r)), (e) => console.error("drip restock", e)));
  },
} satisfies ExportedHandler<Env>;
