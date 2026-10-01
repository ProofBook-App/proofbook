// Builds dist/commands/** with the shared proofbook core (cli/src) bundled in, so the published
// plugin installs with viem as its only dependency. @metamask/agent-wallet stays external: mm links
// the running CLI in as the plugin's peer, and `PluginCommand` must be that same instance.
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
  );

rmSync(join(root, "dist"), { recursive: true, force: true });
await build({
  entryPoints: [...walk(join(root, "src/commands")), join(root, "src/index.ts")],
  outdir: join(root, "dist"),
  outbase: join(root, "src"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  alias: { proofbook: join(root, "../cli/src/index.ts") },
  external: ["@metamask/agent-wallet", "@metamask/agent-wallet/*", "viem", "viem/*"],
  logLevel: "info",
});
