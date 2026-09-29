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

## Testnet deployments (10143)

Deployed 2026-09-29. All source-verified on MonadVision (Sourcify). Explorer: https://testnet.monadvision.com

| Contract | Address | Deploy tx |
|---|---|---|
| AgentRegistry (guardian `0x3faE…9F51`, assets: testnet AUSD) | `0x25D4934840Ce6fFE1a1b0bbb7814aDB5623a8ABC` | `0x2a5a5513f48d4d4114c852acf2cae7f3b4a6cbaf9d48eaf6a9d1bb5803f50329` |
| House agent #1: ERC-8004 identity #1951 | IdentityRegistry `0x8004A818BFB912233c491871b3d84c89A494BD9e` | `0xe4d1718528eed37013f1a045e6e6d1a0d7a30e83f10290bcd03a2230b62fdae5` |
| House agent #1: PerplAdapter | `0x583B6bCFcAec599E6Fc09e27db581d6abe7baB09` | `0x831795948fd67f31baa2eb8c990822b5215c17671a1840d859cf1f2364a5b722` |
| House agent #1: AgentVault "Proofbook Agent #1951" (AUSD, $100 max trade, $500/backer, 10% daily loss) | `0x98e2af31848B95d751e3BFD5bAB9E5EAB9122B53` | `enter` `0x44f6b948cae40080d172149dac15c242b384b8cf3fb2441a0aa882342cff9f25` |
| House agent #1: adapter bound to vault | | `bind` `0x3e04ace2009957449d600de04a0032c6b77356306f2f434ef1fdf8b5ebf23933` |

Session key (house agent #1): `0xB41aEdF1B50eFFA4862B6D568ebBA5b72F9D2Bf2`. Perpl testnet Exchange `0x1964C32f0bE608E7D29302AFF5E61268E72080cc`.

## Deploying

```bash
cd contracts
# 1. registry (GUARDIAN_ADDRESS in env). Drop --broadcast for a dry run.
forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast --private-key $DEPLOYER_PK --slow
# 2. a house agent: REGISTRY, SESSION_KEY, VENUE=perpl|kuru, AGENT_URI (+ MAX_TRADE, DAILY_LOSS_BPS, DEPOSIT_CAP)
forge script script/HouseAgent.s.sol --rpc-url monad_testnet --broadcast --private-key $DEPLOYER_PK --slow
```

`script/Chains.sol` holds the per-chain addresses. Kuru v1 is mainnet-only, so `VENUE=kuru` works on 143 only. `test/fork/Deploy.fork.t.sol` runs both scripts on testnet and mainnet forks.

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
