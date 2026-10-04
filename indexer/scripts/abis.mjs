// Regenerates abis/*.json (events only) from the Foundry build: `cd contracts && forge build` first.
// VenueAdapter merges every adapter's events, because the indexer can't tell from AgentRegistered
// which kind of adapter a venue address is. Event signatures don't collide.
import { readFileSync, writeFileSync } from "node:fs";

const out = new URL("../../contracts/out/", import.meta.url);
const events = (file, name) =>
  JSON.parse(readFileSync(new URL(`${file}/${name}.json`, out))).abi.filter((x) => x.type === "event");
const write = (name, abi) =>
  writeFileSync(new URL(`../abis/${name}.json`, import.meta.url), JSON.stringify(abi, null, 2) + "\n");

write("AgentRegistry", events("AgentRegistry.sol", "AgentRegistry"));
write("AgentVault", events("AgentVault.sol", "AgentVault"));
write("AdapterFactory", events("AdapterFactory.sol", "AdapterFactory"));
const seen = new Set();
write(
  "VenueAdapter",
  [...events("PerplAdapter.sol", "PerplAdapter"), ...events("KuruAdapter.sol", "KuruAdapter")].filter(
    (e) => !seen.has(e.name) && seen.add(e.name),
  ),
);
