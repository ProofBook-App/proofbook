---
paths:
  - "indexer/**"
---

# Indexer rules (Envio HyperIndex v3)

- **Envio v3 (May 2026) changed the API, and most online examples are v2. Use v3 syntax:**
  - In `config.yaml`, use `chains:` (not `networks:`), `rpc:` (not `rpc_config:`), and `max_reorg_depth` (not `confirmed_block_threshold`).
  - Import from `"envio"`, not `"generated"`. The package is ESM (`"type": "module"`) and needs Node ≥ 22.
  - Handlers: `indexer.onEvent({ contract: "AgentVault", event: "Executed" }, async ({ event, context }) => { ... })`
  - Per-agent vaults are factory-deployed. Declare `AgentVault` with no address and register each vault from `VaultLinked`:
    `indexer.contractRegister({ contract: "AgentRegistry", event: "VaultLinked" }, ({ event, context }) => { context.chain.AgentVault.add(event.params.vault); })`
- **Codegen:** run `pnpm envio codegen` after every change to `config.yaml` or `schema.graphql`.
- **Local dev:** `pnpm dev` needs Docker (Postgres + Hasura; the local admin password is `testing`).
- **Data source:** Monad chain 143 uses HyperSync (`https://143.hypersync.xyz`). Don't make archive RPC calls, because Monad full nodes don't serve historical state.
- **Derivation rule:** leaderboard metrics must be derivable from events alone (invariant 7). Don't read contract state in handlers to fill gaps. Add the missing event instead.
- **Kuru and Perpl events to index:** see `docs/reference/kuru.md` and `docs/reference/perpl.md`.
