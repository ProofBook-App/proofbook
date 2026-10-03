# Proofbook

A public exchange where AI trading agents are the assets. Builders register an agent (ERC-8004 identity + risk envelope), backers deposit AUSD into a per-agent ERC-4626 vault, and the agent trades that vault on Kuru and Perpl through a session key, under policy enforced onchain.

Monad Metropolis hackathon entry · Monad mainnet (chain 143) · https://proofbook.app

> **Status: in development. The vault is unaudited.** Deposit only what you can lose.

## Why Monad

An agent's record is only worth reading if every trade is onchain, and that needs cheap, fast blocks. On Monad a block is 300 ms and finality is 600 ms (docs.monad.xyz, network information). House agent #1 decides every 5 minutes and pays about 0.06 testnet MON a trade, so a full record costs less than the trades it records.

The venues are already here. Perpl is an onchain perpetuals exchange and Kuru an onchain order book, both on Monad, so the vault can trade through an adapter contract instead of an exchange API key. AUSD, the vault asset, is native to Monad. The canonical ERC-8004 IdentityRegistry is deployed on Monad mainnet (`0x8004A169…a432`), so an agent's identity is the same one any ERC-8004 app reads.

## Architecture

```
 builder: proofbook CLI / mm plugin          backer: Mera passkey in the browser (web/)
            |  enter, fund, freeze                     |  approve, deposit, withdraw (signing session)
            v                                          v
 ERC-8004 IdentityRegistry <-- AgentRegistry --> AgentVault (one per agent, ERC-4626, AUSD)
                                                       |  execute(adapter, data): limits checked onchain
 house agents: proofbook-agents Worker                 v
   Kimi K2.6 decides -> validator -> Privy signs  PerplAdapter / KuruAdapter --> Perpl / Kuru
            |                                          |
            v                                          v  events
       D1 decision log                        Envio HyperIndex -> GraphQL -> web Worker cron -> D1 snapshot
            \______________________________________________________________/
                                     web/ pages and /api/* read D1
```

| Package | What it is |
|---|---|
| `contracts/` | Foundry. AgentRegistry, AgentVault, PerplAdapter, KuruAdapter; invariant suite for spec §6 |
| `indexer/` | Envio HyperIndex over the registry, vaults, adapters and Perpl fills; deployed to Envio Cloud |
| `web/` | React Router v7 on Cloudflare Workers with D1. Server-rendered public pages, a client-only backer flow (Mera), `/api/*`, OG images |
| `agents/` | The `proofbook-agents` Worker: house agents on a 5-minute cron, Kimi K2.6 via Workers AI, an off-chain validator, Privy server-wallet signing |
| `cli/` | The `proofbook` CLI: `agent create|fund|run|freeze|status` |
| `plugin/` | `mm-plugin-proofbook`, the MetaMask Agent Wallet plugin, and `skills/proofbook/SKILL.md` |

The spec ([spec.md §4](spec.md)) has the original design.

## Setup

Requires Foundry ≥ 1.8, Node ≥ 22.18 (see `.nvmrc`), pnpm 10, Docker (indexer).

```bash
git clone --recurse-submodules https://github.com/ProofBook-App/proofbook
cp .env.example .env
cd contracts && forge build && forge test -vvv
```

## Mainnet deployments

| Contract | Address | Deploy tx |
|---|---|---|
| AgentRegistry | _not deployed_ | |

## Testnet deployments (10143)

Deployed 2026-09-29. All source-verified on MonadVision (Sourcify). Explorer: https://testnet.monadvision.com

| Contract | Address | Deploy tx |
|---|---|---|
| AgentRegistry (guardian `0x3faE…9F51`, assets: testnet AUSD) | `0x25D4934840Ce6fFE1a1b0bbb7814aDB5623a8ABC` | `0x2a5a5513f48d4d4114c852acf2cae7f3b4a6cbaf9d48eaf6a9d1bb5803f50329` |
| House agent #1: ERC-8004 identity #1951 | IdentityRegistry `0x8004A818BFB912233c491871b3d84c89A494BD9e` | `0xe4d1718528eed37013f1a045e6e6d1a0d7a30e83f10290bcd03a2230b62fdae5` |
| House agent #1: PerplAdapter | `0x583B6bCFcAec599E6Fc09e27db581d6abe7baB09` | `0x831795948fd67f31baa2eb8c990822b5215c17671a1840d859cf1f2364a5b722` |
| House agent #1: AgentVault "Proofbook Agent #1951" (AUSD, $100 max trade, $500/backer, 10% daily loss) | `0x98e2af31848B95d751e3BFD5bAB9E5EAB9122B53` | `enter` `0x44f6b948cae40080d172149dac15c242b384b8cf3fb2441a0aa882342cff9f25` |
| House agent #1: adapter bound to vault | | `bind` `0x3e04ace2009957449d600de04a0032c6b77356306f2f434ef1fdf8b5ebf23933` |

Session key (house agent #1): the Privy server wallet `0x552874909A030344fC5eBB4E29A935E2bEe8B082` since 2026-10-03 (`rotateSessionKey` tx `0xba832e0a1bcc648d85d070f03effd54d0bc0eb0a262fadc9144c1148fffaaeac`, block 67803146), funded with 0.3 test MON for gas (tx `0xe7c8c6471808de06356e1fa62a3bb39672d49995660e907f8cd96fe9ef96eea1`). Before that, `0xB41aEdF1B50eFFA4862B6D568ebBA5b72F9D2Bf2`, which signed the trades below. First autonomous trade, decided by Kimi K2.6 and signed through Privy: close of the 1,828-lot MON long ("30-minute change is -73 bps, below the -50 bps threshold"), tx `0x0afe114db82e1bacc671ebd1f1d609fcbc8d947abec855ab9066a1fadbdb2749`, block 67830730, 590,385 gas. Perpl testnet Exchange `0x1964C32f0bE608E7D29302AFF5E61268E72080cc`.

**First real Perpl trade (2026-09-30).** After Agora refilled its testnet faucet (`requestFunds`, 10,000 AUSD: `0x7164ee723e593acdcc62bc1f7a0d099c17ef7619fc23e9e16ab8695dcbd6e8f7`), `script/SimDemo.s.sol` ran against house agent #1 on the real Perpl testnet Exchange:

| Step | Tx |
|---|---|
| Backer approves 400 AUSD | `0x16ac25d08e3ef51277380693886db7cceab3e9ffa144c9af912c661898758587` |
| Backer deposits 400 AUSD | `0x3f5ab6eaf44f17394eb93942f1ad36f5d9d633a29adfc92d771659ba6a18429e` |
| Session key: 100 AUSD margin to Perpl (the adapter opens Perpl account #740) | `0x59c5b35521647675ebe8565f7181b3e74a75def81b315848c171dcf9cfd6ea92` |
| Session key: MON long, 1,828 lots (~$50) at 0.02736, 1x, IOC | `0x0c6a327be18e5a25c47c0ea61aaa460548375124632abef2e1a905aab6e00fdc` |

Afterwards Perpl holds a 1,828-lot long for account #740 with 50.09 AUSD of margin, and vault NAV is 399.87 AUSD.

### Indexer (testnet)

Envio HyperIndex on Envio Cloud (`indexer/`, deployed from the `envio` branch). GraphQL endpoint: https://indexer.dev.hyperindex.xyz/71e3cf1/v1/graphql. It serves agents, vaults (NAV, share price, drawdown, PnL, backers), trades, policy events, and Perpl positions and fills for our accounts, all from events.

### Leaderboard API (web Worker)

https://proofbook.app/leaderboard and every agent profile (`/agent/:id`, e.g. https://proofbook.app/agent/1951) are rendered from this snapshot. A cron in the web Worker copies the indexer into D1 every minute (`web/app/lib/snapshot.server.ts`, tables in `web/migrations/0003_snapshot.sql`). Pages and the JSON API read that snapshot, so they keep working when Envio is down.

- `GET /agents/<slug>.json`: the ERC-8004 registration file a house agent's agentURI points at (registration-v1: name, description, image, services, registrations), built from the snapshot. House agent #1 registered `https://proofbook.app/agents/house-1.json`.
- `GET /api/leaderboard`: every agent vault, ranked by share-price return. House agents carry `"house": true`.
- `GET /api/agent/:id`: one agent by ERC-8004 id, with its open Perpl positions, share-price history, and the latest trades, flows and policy events (read live from the indexer).

Amounts are decimal strings of base units (AUSD: 6 decimals; share prices: 1e18 = 1.0). When the indexer is redeployed, update `ENVIO_GRAPHQL_URL` in `web/wrangler.jsonc`.

### Backing an agent (deposit and withdraw)

The "Back this agent" panel on every `/agent/:id` page runs in the browser only (`web/app/lib/backer.client.ts`, `web/app/components/back-panel.client.tsx`).

- **Flow:** the panel shows the position. Deposit, withdraw and the nav's "Back this agent" open a modal (a native `<dialog>`: a bottom sheet on phones, a centred card from `sm` up). The modal picks up wherever the backer is:
  1. no account: create one or log in;
  2. locked: unlock;
  3. empty on testnet: test funds, requested automatically;
  4. the amount;
  5. a receipt with the explorer link.

  A new backer on testnet takes three taps, "Back this agent", "Create an account" and "Deposit", plus typing the amount. Opening the modal never starts a passkey prompt on its own.

- **Installable app:** `/manifest.webmanifest` and a service worker (`web/public/sw.js`) that caches only the app shell (`/assets/*`, icons, manifest). Pages, route data, `/api`, `/og` and RPC calls always go to the network, so NAV and PnL are never stale; offline you get a plain "You're offline" page. Chrome and Android get an "Install app" button; iOS Safari gets a one-time "Add to Home Screen" hint.
- **Portfolio:** `/portfolio` is the backer's home. It shows the total, the amount backing agents, profit and the wallet's AUSD, then a row per agent: live value, net amount put in, profit, share of the vault, and the agent's open Perpl positions. Its Deposit and Withdraw buttons open the same modal on the agent's page, and your own deposits and withdrawals are listed next to your agents' trades. Balances are read from the chain every 15 s, and cost basis and history come from `/api/backer/:address`. Phones get a bottom tab bar (Leaderboard, Portfolio, Builders).
- **Account:** a [Mera](https://mera.category.xyz) passkey. The key is derived from the passkey's PRF output (BIP-39 entropy, path `m/44'/60'/0'/0/0`). Only the credential id and the address are stored on the device, so a cleared browser or a new device gets the same account back from the passkey. No seed phrase, extension or custody server.
- **Session:** one passkey prompt creates or unlocks the account and starts a 15-minute signing session. Inside it, approve, deposit and withdraw sign with no prompts. The session lasts for the tab, so the portfolio and every agent page share one unlock; a reload or leaving the site ends it. Our page code limits it to the agent vaults on the board: `approve` of a vault's own asset to that vault (exact amount, never unlimited), `deposit` to self, `withdraw`/`redeem` of own shares to self, and the testnet AUSD faucet, all with zero native value. Every call is simulated before it is signed. These limits live in page JavaScript: they stop the app signing the wrong thing, not a script already running on the page. The vault's onchain rules (deposit cap, withdrawals always open when idle) apply regardless.
- **Test funds (testnet only):** `POST /api/drip` sends a new account 0.5 test MON for gas and asks Agora's faucet for 10,000 test AUSD (`web/app/lib/drip.server.ts`). MON and AUSD are limited separately to one each per account per day, plus five requests per IP. Agora's faucet allows one claim a minute across everyone, so when it's busy the drip sends AUSD from its own stock instead. The per-minute cron keeps that stock at 30,000 AUSD. The drip is off unless the `DRIP_PK` secret is set, and it refuses on any chain but 10143.
- **Check it:** `cd web && FLOW_TEST_KEY_FILE=<file holding a throwaway testnet key with ~0.3 MON> npx tsx scripts/flow-test.ts` runs faucet, approve, deposit, withdraw and redeem through the same session code against house agent #1's vault, and checks that out-of-scope calls are refused. First run 2026-09-30: approve, deposit 25 AUSD, withdraw 5 (`0x4b2a844e94fa623fa0520a37f9f3087e670363e964e5d1addaf7c9f02ccb996b`), redeem the rest (`0x364cefb00ce12ed7779f4e5c339cb2aad32e4760b99100af816ef26a9082c575`). Five transactions cost about 0.15 test MON.

### CLI (`cli/`)

`proofbook agent create|fund|run|freeze|status` (plus `chains` and a testnet `faucet`) enters, backs, trades and freezes agents from a terminal. It is TypeScript on viem, with `node:util` `parseArgs` for flags. Results print as JSON on stdout and progress goes to stderr.

```bash
pnpm install && pnpm --filter proofbook build
node cli/dist/cli.js agent status 1951                          # read-only
PROOFBOOK_PK_FILE=<throwaway key file> node cli/dist/cli.js faucet --signer env              # 10,000 test AUSD
PROOFBOOK_PK_FILE=... node cli/dist/cli.js agent create --signer env --uri <agentURI> --max-trade 100 --daily-loss-bps 1000 --deposit-cap 200
PROOFBOOK_PK_FILE=... node cli/dist/cli.js agent fund <id> 5 --signer env
node cli/dist/cli.js agent run <id>                              # dry run: decide, check, simulate, log
PROOFBOOK_PK_FILE=... node cli/dist/cli.js agent run <id> --live --signer env [--once | --interval 60] [--action deposit|long|close]
PROOFBOOK_PK_FILE=... node cli/dist/cli.js agent freeze <id> --signer env
```

- **Networks:** testnet (10143) by default. Mainnet (143) only with `--network mainnet`, and it refuses until a mainnet registry exists.
- **Signers:** `--signer mm` (the default) sends every transaction through `mm wallet send-transaction`, so the CLI holds no key. `--signer env` reads `PROOFBOOK_PK` or `PROOFBOOK_PK_FILE`, for local development only.
- **Every transaction** is simulated with `eth_call` first (reverts are decoded and nothing is sent), then sent with an explicit gas limit of estimate + 5%. `fund` approves exactly the deposit. Decimals are read from the token.
- **`create`** follows `script/HouseAgent.s.sol`: register the ERC-8004 identity, deploy a `PerplAdapter` (creation bytecode embedded from the Foundry build by `pnpm --filter proofbook artifacts`), `enter` with the risk envelope, `bind`. `--agent-id` and `--adapter` resume a partial run.
- **`run`** is a plain momentum agent on Perpl's MON mark (1x, long-only). With no Perpl account it moves margin in first. It opens a long when the mark rises past `--threshold-bps` since the last step and closes it when the mark falls by as much; otherwise it holds. Before signing it checks the vault isn't frozen, the signer is the session key, the adapter's own `quoteNotional` fits `maxTradeNotional`, and an `eth_call` of `vault.execute` succeeds. Every step (observation, decision, reason, checks, tx hash) is appended to `proofbook-run-<id>.jsonl`. It is a dry run unless `--live`, and it stops when the vault is frozen. No LLM yet.
- **Tests:** `pnpm --filter proofbook test` checks the encoding offline (adapter payloads, order fields, the 3% price band, network selection).

**Verified on testnet, 2026-10-02**, with the `env` signer and a throwaway key (funded with 1 MON from the deployer: `0x3aa9ffc02e3e7d978478d7289feaefcf8450aacab881dafe464877e5c38cacde`):

| Command | Tx |
|---|---|
| `faucet`: 10,000 test AUSD | `0x0a7bee52eba90d9ed912fbd2ddc3e605a78e2881408f853798d3c67708917ee6` |
| `agent fund 1951 5`: approve exactly 5 AUSD | `0x79a964ffd5093de64e8217eb2b52fe62472b99e562fc8446d9cc883fb7e25022` |
| `agent fund 1951 5`: deposit into house agent #1's vault | `0x2868261e97e3c2858ad7b6ee129d9ed2e6c707d6cbdc8842807b8f8abac4b357` |
| `agent create`: register ERC-8004 identity #1976 | `0x57e1361de28229ec958fb2c41a74e46d55933b767bb40c5bde32423db592e8cf` |
| `agent create`: deploy PerplAdapter `0x0ba52D06F70DbB75624c9E7986E03E3e5a27dd91` | `0x0764abaf254ccea387825dc477d739140fead86f67e6fbdf0097f687801b368d` |
| `agent create`: `enter`, vault `0xD43cF67435a753F37BE3aCfD8Ed866A5a1D92508` ($100 max trade, 10% daily loss, $200 per backer) | `0x38aac92c509c2798a81c88b0f80d49fc474b8889ea96f17cbc8af9f6a3cfa707` |
| `agent create`: `bind` | `0x567c3be230d521cb590186fcb52fc130d8db50ff40bed67f45740a08c474ea98` |
| `agent fund 1976 150`: approve, deposit | `0xed502a92772421d294f51f884e82a4dd45e8477d529e253561bb55beea2bc3fe`, `0x5ca78380e8dea2b83ad30cfdd98524f7b1601347b669c3539681fc7a8074434f` |
| `agent run 1976 --live --once`: no Perpl account, so 100 AUSD margin in (opens Perpl account #751) | `0x313177e750659790d74167e878a28b67231a32d6e5f7e1262c0bfec5272276ac` |
| `agent run 1976 --live --action long --size 10`: 297-lot MON long (notional 10.03 AUSD) | `0x13d29e41c3f75489f3150c992107922c8b1ea8a98fa6504f80516ed1ce86cd38` |
| `agent run 1976 --live --action close`: close the long | `0x288f0985dba10fcb04bc25450011eed1d277800e1ed5998af9373d4ad12b8829` |
| `agent freeze 1976` (owner) | `0xe3feab7eea608f46dd7c6d16e096a0bd23d2289ec80c4b12fb36cc00b0b7dc7e` |

Agent #1976 is a CLI test agent, not a house agent; its vault is frozen with NAV 149.98 AUSD (50 idle, 99.98 as free Perpl margin, which anyone can `recall` to the frozen vault). A `run` against it now stops with "vault is frozen". A dry `run --action long --size 500` against #1951 is rejected before signing (notional 502.5 over the 100 cap). Creating an agent cost about 0.51 test MON, almost all of it the adapter and vault deployments.

**`--signer mm` on testnet does not work with mm 7.0.0.** MetaMask's hosted RPC answers `Invalid chainId` for 10143: first in gas-fee estimation, and when the CLI supplies the fees itself, in mm's block tracker, which then polls forever past `--wallet-timeout`. No request reaches the wallet (none pending, the wallet's testnet nonce is still 0). The CLI now stops mm as soon as it logs that error and says nothing was signed. Monad mainnet is supported by mm, so the mm path is for mainnet once the registry is deployed there.

### House agents (`agents/`)

The house agents run in the Cloudflare Worker `proofbook-agents`, on a cron every 5 minutes, on testnet. Each one is labelled as a house agent and trades a small size with a fixed, public strategy. House agent #1 (#1951) is momentum on Perpl's MON mark at 1x: 25 AUSD positions, a 1% move over 30 minutes to open, and 0.5% against to close.

Each run:
- reads the vault and Perpl state from the chain;
- asks **Kimi K2.6** (`@cf/moonshotai/kimi-k2.6` through the Workers AI binding) to call one tool: `hold`, `open_long`, `open_short` or `close`, with a size and a one-sentence public reason;
- checks that answer off-chain (`agents/src/validate.ts`): known action, not frozen, size within `maxTradeNotional` and the agent's own limit, the 3% price band, and daily-loss headroom;
- checks the adapter's `quoteNotional`, then simulates `vault.execute` from the session key;
- in live mode only, signs through a **Privy server wallet**, whose policy allows only `execute` on that vault and adapter, on 10143, with value 0;
- broadcasts with an explicit gas limit of estimate + 5%.

Every run writes a row to D1 `agent_decisions`: prompt, response, action, size, validity, reason, tx hash and error. That table is the track record.

- **Status (2026-10-02):** built and dry-run verified locally against house agent #1. Kimi produced real decisions: a `hold` with no history, then a `close` of the 1,828-lot long once history was there. The close was validated, quoted at 61.238 AUSD and simulated OK from session key `0xB41a…2Bf2`. Nothing was signed.
- **Live is pending human setup:** create the Privy policy and wallet, rotate the session key, fund the wallet, then `MODE=live` and deploy. Steps are in [agents/README.md](agents/README.md#going-live-human-steps-testnet).
- **Tests:** `pnpm --filter @proofbook/agents test` covers the validator, encoding parity with the CLI, the Privy RFC 8785 payload and DER signature, and momentum.

### MetaMask Agent Wallet plugin (`plugin/`)

`mm-plugin-proofbook` adds `mm proofbook agent create|fund|run|freeze|status` to the `mm` CLI through the Agent Wallet's plugin system (beta, mm 6.2.0+). Each command extends `PluginCommand` from `@metamask/agent-wallet/plugin` and signs with `ctx.walletExecutor`, the executor behind `mm wallet send-transaction`, so MetaMask's policy, Guard mode and 2FA apply and the plugin never sees a key, the session token or the SRP. The write commands declare `wallet-submit` in `package.json#mm` and get the executor only after the user approves the consent screen. `skills/proofbook/SKILL.md` tells an AI agent how to install it and drive it: confirmation rules, 2FA, the testnet limits, errors. See [plugin/README.md](plugin/README.md) for install steps, known gaps and a 5-minute demo script.

Known gaps: the Agent Wallet only sends transactions with a `to` address, so `create` cannot deploy the per-vault PerplAdapter through it (it stops before sending anything); an adapter factory in the contracts would close that. And the plugin has not been installed into a live `mm` yet, because that needs the wallet owner to turn on the plugin beta and accept the consent screen. `pnpm --filter mm-plugin-proofbook check` runs the same manifest, id, version and base-class checks mm runs at install.

### Testnet simulation stack (10143, retired 2026-09-30)

> **Not used any more.** Testnet runs on the real Perpl testnet through registry `0x25D4…8ABC` and house agent #1 (above). Kuru is not tested on testnet (Kuru v1 has no testnet market); it is covered by the mainnet-fork suite. The sim contracts stay in `src/sim/` because the CI tests use them. The sim Kuru book's 9 MON was withdrawn back to the deployer (`0x172c3829574e382832f10e48518aa15a9d56b7486bcfb1b3f800f12c09018537`). The history below is kept for the record.

Kuru v1 has no testnet market (and Agora's testnet AUSD faucet was empty until 2026-09-30), so testnet also runs a **simulation stack**. The registry, vaults and adapters are the unchanged production contracts. Only the venues and tokens are stand-ins (`contracts/src/sim/`, testnet only):

- **`SimPerplExchange`** speaks the Perpl Exchange ABI and trades at live prices read from the real Perpl testnet Exchange.
- **`SimKuruOrderBook`** speaks the Kuru v1 OrderBook ABI and is centred on the Perpl MON mark.
- **simAUSD / simUSDC** are valueless 6-dp tokens with a public `faucet(to, amount)` (up to 10,000 per call).

`test/fork/SimParity.fork.t.sol` runs identical calls against the real venues and the sims: same revert data, netting, flips, leverage caps and margin model. Moving to mainnet swaps `Chains.testnetSim()` for `Chains.get(143)`. What the sims leave out is listed in each contract's NatSpec: resting orders, funding, liquidations, book depth.

Deployed 2026-09-29 by `script/SimStack.s.sol`. All are Sourcify-verified.

| Contract | Address | Deploy tx |
|---|---|---|
| simAUSD "Proofbook Sim AUSD (testnet, no value)" | `0x6EB7ffECEeC1E4601edF488d6bf731ec6e674b43` | `0xc91e6818cbcefc6745b2b0f77aab569d51690241567ab2f6b562e7facfc024eb` |
| simUSDC "Proofbook Sim USDC (testnet, no value)" | `0xea363EE500E4683becCffb696E8F6Bb23Edde2E4` | `0x29d2dc3b9d6a3ada8397481f02240d85988ed610d81e92b2f73a3a9ee2d89fcc` |
| SimPerplExchange (BTC 16, ETH 32, SOL 48, MON 64 listed) | `0xD7A49a32c77609305DA87411F7Ac34DC7c047683` | `0xab317213df0107d57af737dc1c5262325bd6458baa2f090021a5fab7d2f1d54e` |
| SimKuruOrderBook (MON / simUSDC) | `0x4c49895eB85f5F20303B55AAa47474e031fe8318` | `0xd7cec2d54f8fb23d09233feaea9afde446b7568bbb6c648458108e620ef7cbb8` |
| AgentRegistry (guardian `0x3faE…9F51`, assets: simAUSD, simUSDC) | `0x73d7271D01DdE92d2dEc1Ac3046459cbD3303B35` | `0x2d7a315f3bee7facaca2c8473e5d238b2dd2d2c9dae654377c2d8730be34a090` |
| Sim house agent (Perpl): identity #1953 | IdentityRegistry `0x8004A818…9BD9e` | `0x36615fca0b05aa6c3afb1f32ae319025443e193b802dd007de17fa4d2a8054d7` |
| Sim house agent (Perpl): PerplAdapter | `0x76E5FFD510e4c093fbb5C8090Cdc56E82362df53` | `0x0186191d71e60446ed4bc0980468b8ea7a334dc2cdda9b92834a82ff9c7bc606` |
| Sim house agent (Perpl): AgentVault "Proofbook Agent #1953" (simAUSD) | `0x4DcFDF391b30d709886656C9Cc2645BC0F0Cde77` | `enter` `0x4319cacd92809e8a65ddca88a439cdc953c2ccede42d42d10ae58622e3504d43`, `bind` `0x7d19c205fa52fe8a4f9629f2c83a98c40bba5f35e3b476691305b9cc2383b9ce` |
| Sim house agent (Kuru): identity #1954 | IdentityRegistry `0x8004A818…9BD9e` | `0x37be817757b653d42605e1ff70f38520d94f0ca879f8c6aff844c7bf9eb82bf8` |
| Sim house agent (Kuru): KuruAdapter | `0x3AF66e9371B229e80147D760C9d013f4305fa6db` | `0xd67962961abab2d4fe914a18b2d39ec43014184c0d063e3ded923ecba38eb95c` |
| Sim house agent (Kuru): AgentVault "Proofbook Agent #1954" (simUSDC) | `0x7FC58CeC0b0a89b44322375Bf0FE8a42e27B5bcA` | `enter` `0xbf9e146840bccd04bf8ca6387a264d8c378574598935e044d6cfdafba09f75a7`, `bind` `0x510f64c5e878c8580f3f9045b05b606d3da7f77b2fac4912ac3763c987026144` |

Both sim vaults use $100 max trade, $500 per backer and a 10% daily loss cap. The session key is `0xB41a…2Bf2`, the same as house agent #1.

**First sim activity** (`script/SimDemo.s.sol`): a 400 simAUSD deposit (`0x1b0615e44e4852f27ddb07364d9a262895a38c87d8a8cd939e2d840cf644ba39`), a 100 simAUSD margin move (`0x968a3567d62ce6a5f04334fc0c3036476a718dae83aca2c098c57c79ab077403`), and a 1,835-MON long (`0x59c2a419f1354b09740e5266ecb01f612ee3dcd50d2756c9c8d16a0e35c37c7e`).

The Kuru sim book was funded with 4 testnet MON (`0x48a0a2a666c65fdee5c27c6c20275392e8a69dd961c9509b10b29749dd0dd87f`), which is its ask-side inventory. That covers buys of about $0.10 at $0.027 per MON. Send it more MON for bigger buys; sells never need inventory.

**First Kuru sim round trip**, through vault #1954, KuruAdapter and SimKuruOrderBook. The book held 9 MON at this point.

- A 50 simUSDC deposit (`0xb737e71916727533c785dbb63b692c5661d91d21b0e6ddf24d7a169a50a00764`).
- A 0.20 simUSDC buy for 7.3508 MON (`0xfd173290b1dd304e0239145cccbc85100c36b05f498da3161dedf85c1ca643e2`).
- A sell of all 7.3508 MON (`0xa685b70bd44a467c409405f81007448376a12072479c4354b4eab1eca550103a`).
- Final NAV is 49.999735: the round trip cost 0.000265 in spread.

## Deploying

```bash
cd contracts
# 1. registry (GUARDIAN_ADDRESS in env). Drop --broadcast for a dry run.
forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast --private-key $DEPLOYER_PK --slow
# 2. a house agent: REGISTRY, SESSION_KEY, VENUE=perpl|kuru, AGENT_URI (+ MAX_TRADE, DAILY_LOSS_BPS, DEPOSIT_CAP)
forge script script/HouseAgent.s.sol --rpc-url monad_testnet --broadcast --private-key $DEPLOYER_PK --slow
```

`script/Chains.sol` holds the per-chain addresses. Kuru v1 is mainnet-only, so `VENUE=kuru` works on 143 only, or on testnet with `SIM=true`. `test/fork/Deploy.fork.t.sol` runs every script on testnet and mainnet forks.

Testnet sim stack (testnet only):

```bash
# venues, tokens, registry and both sim house agents (GUARDIAN_ADDRESS, SESSION_KEY in env)
forge script script/SimStack.s.sol --rpc-url monad_testnet --broadcast --private-key $DEPLOYER_PK --slow
# another house agent on the sim venues
SIM=true forge script script/HouseAgent.s.sol --rpc-url monad_testnet --broadcast --private-key $DEPLOYER_PK --slow
# seed a deposit and a MON long on a sim Perpl vault (VAULT, BACKER_PK, SESSION_KEY_PK)
forge script script/SimDemo.s.sol --rpc-url monad_testnet --broadcast --slow
```

## Threat model

_Draft; full write-up on Day 7._

- **Unaudited.** AgentRegistry, AgentVault and PerplAdapter have not been audited.
- **Session-key compromise:** the key can only call allowlisted adapters, each call is capped at `maxTradeNotional`, and a loss past the daily cap freezes the vault in the same tx. Within those limits it can still trade badly.
- **Perpl (PerplAdapter):** Perpl's owner can upgrade the Exchange, freeze or block accounts, enable whitelisting and halt trading. Withdrawals are rate-limited exchange-wide. If the Exchange cannot be read, the vault counts the Perpl leg as 0 rather than reverting, so idle funds stay withdrawable. Positions are valued at Perpl's mark with no exit fee deducted. Order limits must be within 3% of Perpl's mark, which bounds the worst fill. The per-trade cap does not limit the sum of resting orders. When a vault is frozen, anyone can `recall` free margin to it, but open positions stay open until the agent owner unfreezes.
- **Kuru (KuruAdapter):** Kuru's order book can be moved within one transaction, so held MON is valued at the best bid clamped to 97–100% of Perpl's MON oracle price (Chainlink Data Streams). A spoofed high bid cannot inflate NAV; a dumped book moves it by at most 3%. Every fill must be within 3% of the oracle, which limits what a compromised session key can lose to a counterparty's off-market order. If the oracle is stale, Kuru trades stop and held MON counts as 0. When a vault is frozen, anyone can `unwind` held MON back to the vault under the same 3% band.
- **Guardian:** one address, fixed at registry deploy and copied into every vault. It can freeze any vault and nothing else. It can't unfreeze, move funds or change limits.
- **Agent owner (the ERC-8004 identity owner):** can freeze, unfreeze after a 24-hour cooldown, and rotate the session key. A stolen owner key can install a hostile session key, which is still bound by the vault's limits. Limits are fixed at entry and nobody can change them.
- **Performance fee:** 10% of profit above the high-water mark, paid to the identity's current owner, so transferring the identity transfers future fees. The fee crystallises on deposits and withdrawals at the NAV of that moment, which counts open Perpl positions at mark. A fee taken on a gain that later reverses is not refunded, though the high-water mark stops the same gain being charged twice. If the fee isn't idle in the vault it stays pending, and withdrawals already net it out.
- **Daily loss cap:** measured from NAV at the first trade after 00:00 UTC, not a rolling 24 hours (open question). Deposits and withdrawals move that baseline by their amount.
- **Backer sessions (web):** the passkey-derived key lives in page memory for 15 minutes. The session's scope (exact approvals, deposit and withdraw to self, the agent vaults on the board) is enforced in page JavaScript, so it stops the app signing the wrong thing, not a script already running on the page. The page sends a CSP limiting where it can connect. Nothing secret is stored on the device.
- **House agents:** the model only proposes. An off-chain validator, an `eth_call` simulation and a Privy policy (this vault, `execute`, the Perpl adapter, zero value) all run before anything is signed, and the vault checks the limits again. The Privy owner key (`PRIVY_AUTH_KEY`) can change that policy, so it is kept off the Worker's code path except for signing.
- **Off-chain data:** the leaderboard, agent pages and portfolio read the D1 snapshot and the indexer for display. Balances in the backer flow and every transaction go straight to the chain, so a wrong snapshot can mislead a reader but can't move funds.

## AI tooling disclosure

This project is built with Claude Code (Anthropic). The human writes the spec and the invariant tests; Claude generates implementation to make them pass. All AI-generated code is reviewed before merge.

AI in the product itself: house agents ask Kimi K2.6 (`@cf/moonshotai/kimi-k2.6`, Cloudflare Workers AI) for each decision. Every prompt, response and decision is logged in D1, and the public reason is shown on the agent page.

## Pre-existing code

None. Third-party dependencies: OpenZeppelin Contracts v5.7.0, forge-std. `IPerplExchange` and `IKuruOrderBook` re-declare the Perpl and Kuru ABI subsets the adapters call (written by us; neither project's own interface files are included).

## License

MIT
