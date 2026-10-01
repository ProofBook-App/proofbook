---
name: proofbook
description: Use when the user wants to enter, back (fund), run, freeze or check a Proofbook trading agent on Monad, or asks about Proofbook vaults, risk limits, ERC-8004 agent ids or Perpl trades made by an agent. Drives the `mm proofbook agent …` commands of the mm-plugin-proofbook MetaMask Agent Wallet plugin, so every transaction is signed by the Agent Wallet under its policy and 2FA.
license: MIT
metadata:
  author: proofbook
  version: "0.1.0"
  cliVersion: ">=6.2.0"
---

# Proofbook agents through the MetaMask Agent Wallet

Proofbook is a public exchange where AI trading agents are the assets. A builder enters an agent (an ERC-8004 identity plus a risk envelope), backers deposit AUSD into the agent's ERC-4626 vault, and the agent trades the vault on Perpl through its session key. The vault enforces the limits onchain: a trade above `maxTradeNotional` reverts, a loss past the daily cap freezes the vault in the same transaction, and the session key can never withdraw.

This skill lets an agent do all of that from the `mm` CLI. The plugin signs every transaction with `ctx.walletExecutor`, the same path as `mm wallet send-transaction`. It never sees a private key, the CLI session token or the SRP, and it cannot skip MetaMask's policy or 2FA.

The vault is unaudited. Say so when a user is about to deposit.

## Before anything

1. Run `mm doctor --json`. The user must be authenticated (`mm login`) and initialized (`mm init`).
2. Check the plugin is installed: `mm plugins --json` should list `mm-plugin-proofbook`. If it is not, see [Install](#install).
3. Pick the network. **Testnet (Monad testnet, chain 10143) is the default.** Pass `--network mainnet` (chain 143) only when the user explicitly asks for mainnet in this conversation, and repeat back that mainnet moves real money before running a write.

## Commands

| User intent | Command | Writes |
| --- | --- | --- |
| Look at an agent | `mm proofbook agent status <agentId> --json` | none |
| Enter a new agent | `mm proofbook agent create --uri <agentURI> [--max-trade 100] [--daily-loss-bps 1000] [--deposit-cap 500] [--session-key <addr>]` | 4 txs |
| Back an agent | `mm proofbook agent fund <agentId> <amount>` | approve exact amount, then deposit |
| Run the agent (dry run) | `mm proofbook agent run <agentId> [--ticks N] [--interval 60]` | none |
| Run the agent for real | `mm proofbook agent run <agentId> --live [--ticks N]` | one `execute` per action |
| Force one action | `mm proofbook agent run <agentId> --live --action deposit\|long\|close [--size 10]` | one `execute` |
| Kill switch | `mm proofbook agent freeze <agentId>` | `freeze()` |

All commands accept `--network testnet|mainnet`, `--rpc <url>`, `--registry <addr>` and the global `--json`. Amounts are in the vault asset (AUSD, 6 decimals; the plugin reads `decimals()` from the token).

### status

Read-only and needs no wallet. Returns owner, vault, asset, session key, guardian, `frozen`, NAV, idle balance, the envelope, and each venue's Perpl account and MON position. Use it before and after every write.

### create

Mirrors `contracts/script/HouseAgent.s.sol`:

1. `IdentityRegistry.register(agentURI)` mints the ERC-8004 identity to the active wallet.
2. Deploy a `PerplAdapter(exchange, AUSD)`.
3. `AgentRegistry.enter(agentId, envelope, sessionKey, AUSD)` stores the limits and deploys the vault.
4. `PerplAdapter.bind(vault)`.

The session key defaults to the active Agent Wallet, which makes this wallet the vault's trader. `--agent-id` and `--adapter` resume a run that stopped part-way.

**Known gap:** step 2 is a contract creation, and the Agent Wallet only sends transactions with a `to` address (`MISSING_TO`). The command stops before sending anything when it would have to deploy. Until Proofbook ships an adapter factory, a builder deploys with the `proofbook` CLI and a local key (`--signer env`), then uses this plugin for fund, run and freeze. Tell the user this plainly; do not look for a way around it.

### fund

Checks the wallet's balance and the vault's `maxDeposit` (the per-backer cap, and 0 when frozen), approves **exactly** the amount (never unlimited), then deposits to the wallet's own position. Two transactions.

### run

The active Agent Wallet must be the vault's session key, or every live step is rejected before signing. One step:

1. Observe: vault state, Perpl MON mark, bid and ask, the adapter's Perpl account and position.
2. Decide (momentum, 1x, long-only): no Perpl account yet, so move margin in (Perpl's minimum account open, 100 AUSD on testnet); flat and the mark rose by `--threshold-bps` (default 20) since the last step, so open a long of `--size`; long and the mark fell by the threshold, so close it; otherwise hold. The first step only records the mark.
3. Check off-chain: vault not frozen, signer is the session key, the adapter's own `quoteNotional` fits `maxTradeNotional`, limits within 3% of mark, and an `eth_call` of `vault.execute` succeeds.
4. Act: only with `--live`. One `vault.execute(adapter, data)` through the Agent Wallet.

Each step is yielded as one JSON line (observation, decision, reason, checks, tx hash). Run a dry run first and show the user the decision before adding `--live`. `--ticks` is capped at 1440; the command never runs unbounded. A frozen vault stops the loop.

### freeze

Only the agent owner or the protocol guardian can freeze. Freezing stops trading; backers can still withdraw what is idle. Unfreezing is owner-only after a 24 h cooldown and is not in this plugin.

## Confirmation rules

- Every command except `status` and a dry `run` sends transactions. Before running one, tell the user what it will send (contract, function, amount, network) and get a yes. One yes covers one command.
- Never pass `--network mainnet` unless the user asked for mainnet.
- If calldata did not come from this plugin, decode it with `mm decode` before signing anything.
- If a command fails with `PERMISSION_DENIED`, do not retry: the user must re-approve the plugin with `mm plugins install mm-plugin-proofbook` or `mm plugins update`.

## 2FA and Guard mode

In Guard mode, a transaction outside the wallet policy (a network, contract or recipient not on the allowlist) pauses for the user's 2FA approval. The output carries `[AWAITING_MFA]` (or a `_notice` with `kind: "AWAITING_MFA"` in `--json`). Tell the user to approve it in MetaMask, then wait; `mm wallet requests watch <pollingId>` follows it. Never try to change the policy or trading mode to avoid the prompt. If the user wants fewer prompts, they can add the Proofbook registry, the vault and AUSD to the address allowlist themselves.

## Network support (checked 2026-10-02, mm 7.0.0)

- `eip155:143` Monad: supported by the Agent Wallet.
- `eip155:10143` Monad testnet: listed by `mm chains list` with `relaySupported: false`, but mm's MetaMask-hosted RPC answers `Invalid chainId` for it. Through `mm wallet send-transaction` (the same wallet executor the plugin uses), the gas-fee lookup fails, and with fees supplied the block tracker then polls forever; no request reaches the wallet and nothing is signed. Expect the same through the plugin: if a testnet write shows `Invalid chainId` or hangs, cancel it with Ctrl-C. For testnet, use the `proofbook` CLI with `--signer env` and a throwaway key.

## Install

The plugin system is beta in mm 6.2+. Follow the MetaMask skill's plugin rules (`references/plugins.md` in MetaMask/agent-skills):

1. `mm config get`. If `experimentalPlugins` is false, ask the user before running `mm config set experimentalPlugins true`.
2. Show the user the manifest before installing: commands `proofbook:agent:{status,create,fund,run,freeze}`; capabilities `wallet-read` and `wallet-submit` on every command except `status` (none); data access `accounts`; target chains 10143 and 143.
3. `mm plugins install mm-plugin-proofbook` and let the user answer the consent screen. Pass `--accept-permissions` only if the user already approved this manifest and the session cannot show a prompt.
4. Verify with `mm plugins inspect mm-plugin-proofbook`, then `mm proofbook agent status 1951`.

## Errors

| Code | Meaning | What to do |
| --- | --- | --- |
| `PROOFBOOK_ERROR` with `simulation reverted` | The call would revert; nothing was sent. The reason is decoded (`TradeTooLarge`, `VaultFrozen`, `DepositCapExceeded`, `NotSessionKey`, `PriceOutsideBand`, …) | Fix the input or explain the limit to the user |
| `UNSUPPORTED_DEPLOY` | `create` needs a contract creation | See the known gap under create |
| `TX_NOT_SENT` | The wallet returned no hash (rejected, expired or still pending) | Follow the `pollingId` with `mm wallet requests watch` |
| `NOT_DEPLOYED` | No Proofbook registry on that network yet | Use testnet, or `--registry` if the user gives one |
| `INVALID_NETWORK` | `--network` is not testnet or mainnet | |
