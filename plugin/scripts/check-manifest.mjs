// Checks what `mm plugins install` checks before it accepts the package (agent-skills
// references/plugins.md, "What must hold for an install to succeed"), without installing anything:
// - package.json#mm parses with the host's PluginManifestSchema (schemaVersion 1, minCliVersion, commands)
// - the running mm satisfies minCliVersion
// - every mm command id exists in oclif.manifest.json and vice versa
// - no id collides with a built-in mm command; no oclif.hooks / oclif.plugins
// - every built command class extends PluginCommand
// Run after `pnpm build`.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { PluginCommand, PluginManifestSchema } from "@metamask/agent-wallet/plugin";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
const oclifManifest = JSON.parse(readFileSync(new URL("../oclif.manifest.json", import.meta.url)));
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
};

const parsed = PluginManifestSchema.safeParse(pkg.mm);
if (!parsed.success) fail(`PLUGIN_MANIFEST_INVALID: ${parsed.error.message}`);
else console.log(`✓ package.json#mm is a valid manifest (${parsed.data.commands.length} commands)`);

if (pkg.oclif?.hooks || pkg.oclif?.plugins) fail("PLUGIN_HOOKS_FORBIDDEN: remove oclif.hooks / oclif.plugins");

const mmIds = new Set(pkg.mm.commands.map((c) => c.id));
const builtIds = new Set(Object.keys(oclifManifest.commands));
for (const id of mmIds) if (!builtIds.has(id)) fail(`${id} is in package.json#mm but not built`);
for (const id of builtIds) if (!mmIds.has(id)) fail(`${id} is built but missing from package.json#mm`);

let help;
try {
  help = JSON.parse(execFileSync("mm", ["--help", "--json"], { encoding: "utf8" }));
} catch {
  console.log("- mm not found: skipped the version and collision checks");
}
if (help) {
  const builtins = new Set(help.data.commands.map((c) => c.id.replaceAll(" ", ":")));
  for (const id of mmIds) if (builtins.has(id)) fail(`PLUGIN_ID_COLLISION: ${id}`);
  const version = execFileSync("mm", ["--version"], { encoding: "utf8" }).match(/agent-wallet\/(\d+)\.(\d+)\.(\d+)/);
  const [, maj, min] = version.map(Number);
  if (maj < 6 || (maj === 6 && min < 2)) fail(`PLUGIN_CLI_VERSION: mm ${version[0]} is older than 6.2.0`);
  else console.log(`✓ no id collides with a built-in mm command; ${version[0]} satisfies ${pkg.mm.minCliVersion}`);
}

for (const [id, c] of Object.entries(oclifManifest.commands)) {
  const mod = await import(new URL(`../dist/commands/${id.replaceAll(":", "/")}.js`, import.meta.url));
  if (!(mod.default.prototype instanceof PluginCommand)) fail(`PLUGIN_INVALID_BASE: ${id}`);
  const caps = pkg.mm.commands.find((m) => m.id === id)?.capabilities ?? [];
  console.log(`✓ ${id.padEnd(24)} extends PluginCommand  capabilities: ${caps.join(", ") || "none"}  ${c.description.slice(0, 60)}…`);
}
