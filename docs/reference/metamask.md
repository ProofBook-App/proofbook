# MetaMask Agent Wallet (`mm`) reference

- **CLI:** `@metamask/agent-wallet` 7.0.0 (`npm i -g`), binary `mm`. Needs Node ≥ 22.18. Output is JSON (`{"ok": true, "data": …}`).
- **Bounty:** Best Agent Wallet Plugin, $2.5k, Track 01. Plugins need Agent Wallet v6.2.0+. Every tx must go through the Agent Wallet, with no key or token handling and no bypass of signing, policy or MFA. See `hackathon.md`.

## Chain support (firsthand, `mm chains list`, 2026-09-29)

| CAIP-2 | Name | relaySupported | features |
|---|---|---|---|
| `eip155:143` | Monad | true | swap |
| `eip155:10143` | Monad Testnet | false | none |

46 chains in the live list. It is server-driven, so recheck before the demo.

**Monad testnet does not sign (firsthand, 2026-10-02, mm 7.0.0).** `mm wallet send-transaction --chain-id 10143` fails in gas-fee estimation with `Non-200 status code: '400'`, `{ error: 'Invalid chainId' }` from MetaMask's API. With `maxFeePerGas`/`maxPriorityFeePerGas` in the payload it gets past that, but its `PollingBlockTracker` hits the same `Invalid chainId` and polls forever, ignoring `--wallet-timeout`. `mm wallet requests list` stays empty and the wallet's testnet nonce stays 0, so nothing reaches the wallet. Also: the payload requires `to` (`MISSING_TO`), so mm cannot send a contract creation.

## Plugins (firsthand, 2026-10-02)

- The plugin system arrived in 6.2.0 (CHANGELOG "Plugin system"; beta, off by default: `mm config set experimentalPlugins true`). A plugin is an npm package with oclif commands that extend `PluginCommand` from `@metamask/agent-wallet/plugin`, plus a `package.json#mm` manifest (`schemaVersion: 1`, `minCliVersion`, per-command `capabilities` from `wallet-read`, `wallet-submit`, `network-manage`, `dataAccess`, `targetChains`). It must ship `oclif.manifest.json` and may not declare oclif hooks or plugins.
- `mm plugins install <pkg>` shows a consent screen; local sources (`file:`, paths, git) also need `experimentalAllowUnverifiedInstalls`. Approvals live in `~/.metamask/config.json`.
- `wallet-submit` gives `ctx.walletExecutor(io, commandId)`, which `mm wallet send-transaction` itself uses: `exec({ kind: "transaction", chainId, transaction: { to, data, value, gas, … }, intent: { action: "custom", summary } }, { signal })` returns `{ hash, status, failureDescription, pendingJob }`. Plugins never get the session token or the SRP.
- Sources: the installed package (`dist/plugin-sdk/index.d.ts`, `dist/runtime/plugins/*.d.ts`, CHANGELOG), github.com/MetaMask/agent-skills `skills/metamask-agent-wallet/references/plugins.md`, and the reference template github.com/hieu-w/agent-wallet-plugin-template (linked from the CHANGELOG). Ours is `plugin/`.

## Our setup (2026-09-29)

- `mm login` → `mm init`: **Server Wallet** (keys held server-side), **Guard mode**. Transactions outside policy (non-allowlisted network, address or recipient, raising the rolling-24h outflow limit) need the human's 2FA approval.
- Wallet: `Server EVM Wallet 1`, `0xe3202ec8c0614ebddb184a1c952a4c20d241d8a8` (EVM, tradingMode guard). An EOA managed by MetaMask. It is not referenced from contracts.
- **After mainnet deploy:** add AgentRegistry, the vaults, AUSD and USDC to the address allowlist (human, with 2FA).
- Commands used so far: `mm auth status`, `mm chains list`, `mm wallet:list`, `mm config get|set`. Run `mm --help` for the full list.
