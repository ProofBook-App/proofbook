import { createRequestHandler } from "react-router";

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
} satisfies ExportedHandler<Env>;
