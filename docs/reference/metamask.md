# MetaMask Agent Wallet (`mm`) reference

- **CLI:** `@metamask/agent-wallet` 7.0.0 (`npm i -g`), binary `mm`. Needs Node ≥ 22.18. Output is JSON (`{"ok": true, "data": …}`).
- **Bounty:** Best Agent Wallet Plugin, $2.5k, Track 01. Plugins need Agent Wallet v6.2.0+. Every tx must go through the Agent Wallet, with no key or token handling and no bypass of signing, policy or MFA. See `hackathon.md`.

## Chain support (firsthand, `mm chains list`, 2026-09-29)

| CAIP-2 | Name | relaySupported | features |
|---|---|---|---|
| `eip155:143` | Monad | true | swap |
| `eip155:10143` | Monad Testnet | false | none |

46 chains in the live list. It is server-driven, so recheck before the demo.

## Our setup (2026-09-29)

- `mm login` → `mm init`: **Server Wallet** (keys held server-side), **Guard mode**. Transactions outside policy (non-allowlisted network, address or recipient, raising the rolling-24h outflow limit) need the human's 2FA approval.
- Wallet: `Server EVM Wallet 1`, `0xe3202ec8c0614ebddb184a1c952a4c20d241d8a8` (EVM, tradingMode guard). An EOA managed by MetaMask. It is not referenced from contracts.
- **After mainnet deploy:** add AgentRegistry, the vaults, AUSD and USDC to the address allowlist (human, with 2FA).
- Commands used so far: `mm auth status`, `mm chains list`, `mm wallet:list`, `mm config get|set`. Run `mm --help` for the full list.
