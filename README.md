# Proofbook

A public exchange where AI trading agents are the assets. Builders register an agent (ERC-8004 identity + risk envelope), backers deposit AUSD into a per-agent ERC-4626 vault, and the agent trades that vault on Kuru and Perpl through a session key, under policy enforced onchain.

Monad Metropolis hackathon entry · Monad mainnet (chain 143) · https://proofbook.app

> **Status: in development. The vault is unaudited.** Deposit only what you can lose.

## Why Monad

_TODO_

## Architecture

See [spec.md §4](spec.md). Packages: `contracts/` (Foundry), `agents/`, `indexer/` (Envio HyperIndex), `web/` (React Router v7 on Cloudflare Workers), `cli/`, `plugin/`.

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

## Threat model

_Draft; full write-up on Day 7._

- **Unaudited.** AgentRegistry, AgentVault and PerplAdapter have not been audited.
- **Session-key compromise:** the key can only call allowlisted adapters, each call is capped at `maxTradeNotional`, and a loss past the daily cap freezes the vault in the same tx. Within those limits it can still trade badly.
- **Perpl (PerplAdapter):** Perpl's owner can upgrade the Exchange, freeze or block accounts, enable whitelisting and halt trading. Withdrawals are rate-limited exchange-wide. If the Exchange cannot be read, the vault counts the Perpl leg as 0 rather than reverting, so idle funds stay withdrawable. Positions are valued at Perpl's mark with no exit fee deducted. Order limits must be within 3% of Perpl's mark, which bounds the worst fill. The per-trade cap does not limit the sum of resting orders. When a vault is frozen, anyone can `recall` free margin to it, but open positions stay open until the agent owner unfreezes.
- **Kuru (KuruAdapter):** Kuru's order book can be moved within one transaction, so held MON is valued at the best bid clamped to 97–100% of Perpl's MON oracle price (Chainlink Data Streams). A spoofed high bid cannot inflate NAV; a dumped book moves it by at most 3%. Every fill must be within 3% of the oracle, which limits what a compromised session key can lose to a counterparty's off-market order. If the oracle is stale, Kuru trades stop and held MON counts as 0. When a vault is frozen, anyone can `unwind` held MON back to the vault under the same 3% band.
- _TODO: guardian powers, fee edge cases._

## AI tooling disclosure

This project is built with Claude Code (Anthropic). The human writes the spec and the invariant tests; Claude generates implementation to make them pass. All AI-generated code is reviewed before merge.

## Pre-existing code

None. Third-party dependencies: OpenZeppelin Contracts v5.7.0, forge-std. `IPerplExchange` and `IKuruOrderBook` re-declare the Perpl and Kuru ABI subsets the adapters call (written by us; neither project's own interface files are included).

## License

MIT
