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
- **Activity and policy:** `tradeCount`, `tradeVolume`, `breachCount`, `freezeCount`, `frozen`, and `backerCount` (holders with shares > 0).

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

- **Testnet (10143) without a token:** the indexer syncs over the thirdweb public RPC (1,000-block `eth_getLogs`). `testnet-rpc.monad.xyz` caps log ranges at 100 blocks and rate-limits at 50 req/s, which stalls the first sync.
- **With HyperSync:** create a token at https://envio.dev/app/api-tokens, put `ENVIO_API_TOKEN=` in `indexer/.env`, and delete the chain's `rpc:` block in `config.yaml`.
- **Mainnet (143):** uses HyperSync (`https://143.hypersync.xyz`), and add the chain once the registry is deployed.
