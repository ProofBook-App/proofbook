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
git clone --recurse-submodules <repo>
cp .env.example .env
cd contracts && forge build && forge test -vvv
```

## Mainnet deployments

| Contract | Address | Deploy tx |
|---|---|---|
| AgentRegistry | _not deployed_ | |

## Threat model

_TODO: session-key compromise, adapter trust, NAV/mark manipulation, guardian powers, what is not audited._

## AI tooling disclosure

This project is built with Claude Code (Anthropic). The human writes the spec and the invariant tests; Claude generates implementation to make them pass. All AI-generated code is reviewed before merge.

## Pre-existing code

None. Third-party dependencies: OpenZeppelin Contracts v5.7.0, forge-std.

## License

MIT
