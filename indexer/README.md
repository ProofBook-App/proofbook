# Proofbook indexer

Envio HyperIndex v3 over the AgentRegistry, every AgentVault it deploys and every venue adapter. The leaderboard numbers come from events only (spec §6, invariant 7).

## What it indexes

The registry is the only hard-coded address. Every other contract is registered from its events:

| Contract | Registered from | Events |
|---|---|---|
| AgentRegistry `0x25D4…8ABC` (testnet) | config | `AssetAllowed`, `AgentRegistered`, `VaultLinked` |
| AgentVault | `VaultLinked` | ERC-4626 `Deposit`/`Withdraw`, share `Transfer`, `Executed`, `PolicyBreach`, `Frozen`, `Unfrozen`, `FeeTaken`, `SessionKeyRotated`, `DayRolled` |
| PerplExchange `0x1964…80cc` (testnet) | config | position, fill and mark events (below) |
| VenueAdapter (Perpl and Kuru) | `AgentRegistered` `envelope.venues` | `Bound`, Perpl `MarginDeposited`/`MarginWithdrawn`/`Recalled`/`PerpTracked`/`OrderSent`, Kuru `Bought`/`Sold`/`Unwound` |

The `AgentRegistered` event doesn't say which kind of adapter a venue is. So `VenueAdapter` merges the events of both kinds, and `Adapter.kind` is set by the first event that only one kind emits.

## Entities

`Agent`, `Vault`, `Backer`, `Trade`, `Flow`, `PolicyEvent`, `NavPoint`, `Adapter`, `VenueAction`, `Asset`, and for Perpl `Perp`, `PerplAccount`, `PerplPosition`, `PerplFill`, `PerplPositionChange`. See `schema.graphql`.

### Per-vault leaderboard fields

- **`nav`:** the last `Executed.navAfter`, moved by deposits, withdrawals and fees since. Price moves between trades show up at the next execute.
- **`sharePrice`:** WAD, so 1e18 = 1.0.
  - `peakSharePrice` is the highest share price so far.
  - `maxDrawdownBps` is the largest drop from that peak.
- **`pnl`:** `nav + withdrawn + feesPaid - deposited`.
- **Activity and policy:** `tradeCount`, `tradeVolume`, `executeCount`, `breachCount`, `freezeCount`, `frozen`, and `backerCount` (holders with shares > 0).
  - Every `execute` is a `Trade` row with a `kind`, taken from the adapter event just before `Executed` in the same tx: `Order`, `Cancel`, `MarginIn`, `MarginOut` (Perpl), `Buy`, `Sell` (Kuru), or `Unknown`.
  - `tradeCount` and `tradeVolume` count only `Order`, `Buy` and `Sell`. Moving margin and cancelling are executes, not trades. `executeCount` counts all of them.

### Perpl Exchange

The indexer reads the Exchange's position, fill and mark events (`MarkUpdated`, `TakerOrderFilledV2`, `MakerOrderFilledV2`, and the `Position*` events), and keeps only the accounts our PerplAdapters own (`PerplAccount`, created from `MarginDeposited`).

- **Why the whole stream:** the Exchange has no indexed fields, so every log of those types is fetched.
- **What's left out:** `OrderRequestV2` and the order-book events, which are about 90% of the Exchange's logs.
- **Taker fills:** `TakerOrderFilledV2` carries no account, so it is matched to the position event earlier in the same tx (`PerplTxAccount`).
- **`PerplPosition`:** side, lot, average entry, deposit, and realised PnL and funding. It also has notional and unrealised PnL at the last mark.
- **`PerplAccount`:** fees, fill count, volume and realised PnL.
- **`PerplFill`** and **`PerplPositionChange`** keep the history.
- **Perp decimals:** the scale comes from the first `OrderSent` on that perp. `Perp.scaleExp` is the power of ten of CNS per PNS × LNS, which is 1 for MON.

See `docs/reference/perpl.md` for the event facts and what is still unverified.

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

`pnpm test` replays house agent #1's real testnet history: registration, the 400 AUSD deposit, the first Perpl long (position, taker fill and fee), and unrealised PnL at the next MON mark. It asserts values that were checked against the onchain events.

### After changing contract events

1. `cd contracts && forge build`
2. `pnpm abis`
3. `pnpm codegen`
4. Update `schema.graphql` and the handlers in the same PR.

## Data source

- **HyperSync** on both chains. Put `ENVIO_API_TOKEN=` in `indexer/.env`, and create the token at https://envio.dev/app/api-tokens.
- **Public RPCs don't work as the sync source.** `testnet-rpc.monad.xyz` caps `eth_getLogs` at 100 blocks and 50 req/s. thirdweb allows 1,000-block ranges but rate-limits harder. Syncing testnet that way took hours.
- **Mainnet (143):** uses HyperSync (`https://143.hypersync.xyz`), and add the chain once the registry is deployed.

## Deploy (Envio Cloud)

Envio Cloud builds from the `envio` branch. Its settings are:
- Indexer Directory: `indexer`
- Config File: `config.yaml`
- Git Release Branch: `envio`

The indexer is `proofbook` in org `proofbook-app`, created with the `envio-cloud` CLI (`npx envio-cloud@1.0.0 login` signs in through the GitHub CLI). `ENVIO_API_TOKEN` is set as an Envio Cloud env var.

**Live endpoint (testnet, public, no key):** https://indexer.dev.hyperindex.xyz/775ad7b/v1/graphql, deployment `64e37a0`, first deployed 2026-09-30. It synced to the testnet head in about a minute (~113k events). Each new deployment gets a new URL, so update this line, the root README and `ENVIO_GRAPHQL_URL` in `web/wrangler.jsonc` when it changes.

```bash
npx envio-cloud@1.0.0 indexer get proofbook proofbook-app       # deployments and status
npx envio-cloud@1.0.0 indexer commits proofbook proofbook-app   # what Envio has seen on the branch
```

To deploy what's on main:

```bash
git push origin main:envio
```

- **Build:** Envio Cloud ignores `pnpm-lock.yaml` and resolves dependencies itself, so every version in `package.json` is pinned exactly.
- **Uploaded files:** only `indexer/` is uploaded. Anything the indexer needs (ABIs, handlers) must live inside it, and nothing may be in a folder named `generated`.
- **Plan (2026-09-30):**
  - We're on the free Development plan: 100k-event soft limit, 30-day lifespan.
  - Our Perpl Exchange volume passes the soft limit within a day, so the deployment is deleted about 10 days later.
  - We're asking Envio for a hackathon credit. Without one, upgrade or redeploy before judging (Oct 14–27).

