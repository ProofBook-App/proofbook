# Proofbook indexer

Envio HyperIndex v3 over the AgentRegistry, every AgentVault it deploys and every venue adapter. The leaderboard numbers come from events only (spec §6, invariant 7).

## What it indexes

The registry is the only hard-coded address. Every other contract is registered from its events:

| Contract | Registered from | Events |
|---|---|---|
| AgentRegistry `0x25D4…8ABC` (testnet) | config | `AssetAllowed`, `AgentRegistered`, `VaultLinked` |
| AgentVault | `VaultLinked` | ERC-4626 `Deposit`/`Withdraw`, share `Transfer`, `Executed`, `PolicyBreach`, `Frozen`, `Unfrozen`, `FeeTaken`, `SessionKeyRotated`, `DayRolled` |
| VenueAdapter (Perpl and Kuru) | `AgentRegistered` `envelope.venues` | `Bound`, Perpl `MarginDeposited`/`MarginWithdrawn`/`Recalled`/`PerpTracked`/`OrderSent`, Kuru `Bought`/`Sold`/`Unwound` |

The `AgentRegistered` event doesn't say which kind of adapter a venue is. So `VenueAdapter` merges the events of both kinds, and `Adapter.kind` is set by the first event that only one kind emits.

## Entities

`Agent`, `Vault`, `Backer`, `Trade`, `Flow`, `PolicyEvent`, `NavPoint`, `Adapter`, `VenueAction`, `Asset`. See `schema.graphql`.

### Per-vault leaderboard fields

- **`nav`:** the last `Executed.navAfter`, moved by deposits, withdrawals and fees since. Price moves between trades show up at the next execute.
- **`sharePrice`:** WAD, so 1e18 = 1.0.
  - `peakSharePrice` is the highest share price so far.
  - `maxDrawdownBps` is the largest drop from that peak.
- **`pnl`:** `nav + withdrawn + feesPaid - deposited`.
- **Activity and policy:** `tradeCount`, `tradeVolume`, `breachCount`, `freezeCount`, `frozen`, and `backerCount` (holders with shares > 0).

### Not indexed yet

Perpl fills and positions happen inside the Perpl Exchange. `OrderSent` records the order, not the fill, so open Perpl exposure is still missing. Indexing the Exchange's events for our adapters' account ids is the next step (see `docs/reference/perpl.md`).

## Run

Node 24 and Docker are required.

```bash
pnpm install
pnpm codegen
pnpm dev
```

GraphQL is served by Hasura at http://localhost:8080, and the admin secret is `testing`.

```bash
pnpm test
```

`pnpm test` replays house agent #1's real testnet history: registration, the 400 AUSD deposit and the first Perpl long. It asserts values that were checked against the onchain events.

### After changing contract events

1. `cd contracts && forge build`
2. `pnpm abis`
3. `pnpm codegen`
4. Update `schema.graphql` and the handlers in the same PR.

## Data source

- **Testnet (10143) without a token:** the indexer syncs over the thirdweb public RPC (1,000-block `eth_getLogs`). `testnet-rpc.monad.xyz` caps log ranges at 100 blocks and rate-limits at 50 req/s, which stalls the first sync.
- **With HyperSync:** create a token at https://envio.dev/app/api-tokens, put `ENVIO_API_TOKEN=` in `indexer/.env`, and delete the chain's `rpc:` block in `config.yaml`.
- **Mainnet (143):** uses HyperSync (`https://143.hypersync.xyz`), and add the chain once the registry is deployed.
