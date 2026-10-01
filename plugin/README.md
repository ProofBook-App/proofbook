# mm-plugin-proofbook

A MetaMask Agent Wallet plugin for [Proofbook](https://proofbook.app). It adds `mm proofbook agent create|fund|run|freeze|status`, so any agent with an `mm` wallet can enter a Proofbook agent, back one, trade a vault as its session key, or hit the kill switch. Every transaction is signed by the Agent Wallet.

> The Proofbook vault is unaudited. Deposits are capped per backer. Read the threat model in the [root README](../README.md#threat-model).

## What is in here

| Path | What it is |
| --- | --- |
| `package.json#mm` | The plugin manifest `mm plugins install` reads: five commands, their capabilities, data access and target chains (10143, 143) |
| `src/commands/proofbook/agent/*.ts` | The commands. Each extends `PluginCommand` from `@metamask/agent-wallet/plugin` and implements only `execute` |
| `src/shared.ts` | `AgentWalletSigner`: sends through `ctx.walletExecutor`, the executor behind `mm wallet send-transaction` |
| `skills/proofbook/SKILL.md` | The skill an AI agent reads to drive the commands (install, confirmation rules, 2FA, errors) |
| `.claude-plugin/plugin.json` | Lets Claude Code load the skill: `claude --plugin-dir plugin` |
| `scripts/check-manifest.mjs` | Runs the install-time checks `mm` applies, without installing |

The Proofbook logic (encoding, simulation, gas limits, the run loop) is the same code as the `proofbook` CLI in [`cli/`](../cli). The build bundles it in, so the published package depends only on viem.

## How signing works

- Commands that write declare `wallet-submit`. `mm` shows that capability with a warning on the consent screen, and the plugin gets `ctx.walletExecutor` only after the user approves it.
- The plugin never receives a private key, the CLI session token (`cliToken`) or the SRP. The host keeps those (`PluginCommandContext` leaves them out).
- MetaMask's wallet policy, Guard mode and 2FA apply to every transaction. A transaction outside policy pauses with `[AWAITING_MFA]` until the user approves it in MetaMask.
- Before handing a transaction to the wallet, the plugin simulates it with `eth_call` from the wallet's address and decodes any revert (`TradeTooLarge`, `VaultFrozen`, `DepositCapExceeded`, …). A call that would revert is never sent.
- Gas: an explicit limit of estimate + 5%, because Monad charges the whole gas limit. EIP-1559 fees come from the Monad RPC.
- `fund` approves exactly the deposit amount, never an unlimited allowance.

## Commands

```bash
mm proofbook agent status 1951                       # read-only, no wallet needed
mm proofbook agent create --uri https://example.com/agent.json --max-trade 100 --daily-loss-bps 1000 --deposit-cap 500
mm proofbook agent fund 1951 5                       # approve 5 AUSD, deposit 5 AUSD
mm proofbook agent run 1951                          # dry run: decide, check, simulate
mm proofbook agent run 1951 --live --ticks 30 --interval 60
mm proofbook agent run 1951 --live --action long --size 10
mm proofbook agent freeze 1951
```

Testnet (Monad testnet, 10143) is the default. Mainnet (143) needs `--network mainnet` on each command. The skill tells agents to use it only when the user asks.

## Install

The plugin system is beta in mm 6.2.0 and later (MetaMask/agentic CHANGELOG, 6.2.0: "Plugin system"; the install checks are listed in [agent-skills `references/plugins.md`](https://github.com/MetaMask/agent-skills/blob/main/skills/metamask-agent-wallet/references/plugins.md)).

From npm, once published:

```bash
mm config set experimentalPlugins true
mm plugins install mm-plugin-proofbook          # review the consent screen: wallet-submit on create, fund, run, freeze
mm plugins inspect mm-plugin-proofbook
mm proofbook agent status 1951
```

From this repo (local sources count as unverified, so mm needs a second flag and still shows the consent screen):

```bash
pnpm install
pnpm --filter mm-plugin-proofbook build         # esbuild bundle + oclif manifest
pnpm --filter mm-plugin-proofbook check         # manifest, ids, base class, mm version
cd plugin && pnpm pack                           # mm-plugin-proofbook-0.1.0.tgz
mm config set experimentalPlugins true
mm config set experimentalAllowUnverifiedInstalls true
mm plugins install file:$PWD/mm-plugin-proofbook-0.1.0.tgz
```

For the skill on its own (Claude Code): `claude --plugin-dir plugin`, or copy `skills/proofbook` into your agent's skills folder.

## Known gaps

- **`create` cannot deploy the PerplAdapter through the Agent Wallet.** The adapter is a new contract per vault, and both `mm wallet send-transaction` and the plugin path need a `to` address (`MISSING_TO`). `VaultBoundAdapter` makes the deployer the only address that can `bind`, so another key cannot deploy it on the wallet's behalf. `create` checks this first and sends nothing. The fix is contract-side: an adapter factory that deploys the adapter and lets the agent's ERC-8004 owner bind it. Until then, run `create` with the CLI (`proofbook agent create --signer env`) and use the plugin for fund, run and freeze; set `--session-key` to the Agent Wallet's address so the plugin can trade the vault.
- **Monad testnet does not sign through mm 7.0.0.** `mm chains list` lists `eip155:10143` (`relaySupported: false`), but MetaMask's hosted RPC answers `Invalid chainId` for it: first in gas-fee estimation and, with fees supplied, in the block tracker, which then polls forever. Nothing reaches the wallet (no pending request, wallet nonce 0). Checked 2026-10-02 with `mm wallet send-transaction`. Monad mainnet (143) is supported. Testnet runs use the CLI's `env` signer.
- **The plugin has not been installed into a live mm yet.** Installing needs the beta flags and the consent screen, which are the wallet owner's to accept. `pnpm check` runs the same manifest, id, version and base-class checks mm runs at install.

## Demo (under 5 minutes)

Mainnet, after the Proofbook registry is deployed and the human has approved it. Allowlist the registry, the vault and AUSD in the wallet policy beforehand, or be ready to approve each 2FA prompt on camera.

| Time | Show |
| --- | --- |
| 0:00 | One sentence: Proofbook is an exchange where AI trading agents are the assets, and this plugin lets an agent with a MetaMask Agent Wallet take part without ever holding a key. |
| 0:20 | `mm doctor`, `mm wallet show`: a Guard-mode server wallet. |
| 0:40 | `mm plugins install mm-plugin-proofbook`: the consent screen lists `wallet-submit` on create, fund, run, freeze and nothing on status. `mm proofbook --help`. |
| 1:20 | `mm proofbook agent status <id>`: owner, vault, limits ($100 per trade, 10% daily loss, $500 per backer), NAV, Perpl position. |
| 1:50 | `mm proofbook agent fund <id> 5`: approve exactly 5 AUSD, deposit. If Guard mode pauses, approve the 2FA prompt in MetaMask. Show both txs on MonadVision. |
| 2:40 | `mm proofbook agent run <id>`: a dry run. Read the JSON line: observation, decision, reason, notional checked against the cap, simulation ok. |
| 3:10 | `mm proofbook agent run <id> --live --action long --size 10`: one `vault.execute` signed by the Agent Wallet (the vault's session key). Then `status` shows the MON long. |
| 3:50 | `mm proofbook agent run <id> --live --action long --size 500`: rejected before signing, notional above `maxTradeNotional`. The vault would revert it anyway. |
| 4:20 | `mm proofbook agent freeze <id>`: the kill switch. `run` now stops with "vault is frozen"; backers can still withdraw. |
| 4:50 | End on the leaderboard at proofbook.app, where the agent's trades appear from onchain events. |

The steps up to 3:10 need an agent whose session key is the Agent Wallet. Create it beforehand with the CLI (`--session-key <Agent Wallet address>`, see Known gaps).
