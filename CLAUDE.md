# Proofbook

A public exchange where AI trading agents are the assets.
- Builders register an agent (ERC-8004 identity + risk envelope).
- Backers deposit AUSD into a per-agent ERC-4626 vault.
- The agent trades the vault on Kuru (spot) and Perpl (perps) through a session key, under policy enforced onchain.

This is our Monad Metropolis hackathon entry on Monad mainnet (chain 143).

Domain: `proofbook.app` (Cloudflare Registrar, served by the web Worker). GitHub: https://github.com/ProofBook-App/proofbook (org `ProofBook-App`). The local folder is still `paddock/`.

**Read `spec.md` at the start of every session**: scope, contract surface, bounty table (§7) and day plan (§8). It is the source of truth for *what* to build. `docs/reference/` is the source of truth for facts about external systems. If they conflict, flag it rather than silently picking one.

## Where things are

- `spec.md`: product spec, invariants, bounty table, day plan, risks
- `docs/open-questions.md`: unresolved decisions and unverified facts. Check it before building anything it mentions.
- `docs/reference/monad.md`: RPCs, explorers, verification, EVM differences, canonical addresses (AUSD, ERC-8004, Multicall3…)
- `docs/reference/kuru.md`, `docs/reference/perpl.md`: venue contracts, ABIs, known docs-vs-ABI mismatches
- `docs/reference/erc-8004.md`: IdentityRegistry interface and how Proofbook uses it
- `docs/reference/metamask.md`: Agent Wallet (`mm`) chain support and our Guard-mode server wallet
- `docs/reference/hackathon.md`: deadline, rules, judging weights, bounty list, submission form
- `.claude/rules/`: per-package rules that load automatically when working in `contracts/`, `indexer/`, `web/`, `agents|cli|plugin/`

Layout (pnpm workspace + Foundry): `contracts/` `agents/` `indexer/` `web/` `cli/` `plugin/`. Scaffolded so far: `contracts/` (OpenZeppelin v5.7.0 and forge-std as git submodules, so clone with `--recurse-submodules`).

## Commands

Update this section as each package is scaffolded.

```bash
cd contracts && forge build && forge test -vvv       # or: pnpm contracts:test
forge test --match-contract Invariant                  # spec §6 invariant suite
pnpm contracts:fork                                     # adapter fork tests (test/fork/*, $MONAD_RPC_URL or public RPC); excluded from CI
forge script script/Deploy.s.sol --rpc-url monad --broadcast --slow
cd indexer && pnpm envio codegen && pnpm dev           # needs Docker
cd web && pnpm dev
```

## Invariants (spec §6): never violate, tests first

1. Only the session key can call `execute`, and it can move funds only through an allowlisted adapter.
2. A single `execute` moves at most `maxTradeNotional`.
3. If `nav < dayStartNav * (1 - dailyLossCap)` after an execute, the vault freezes in the same tx.
4. When the vault is idle, backers can always withdraw their pro-rata share, whether or not it is frozen.
5. A deposit above `depositCapPerBacker` reverts.
6. The performance fee applies only to profit above the high-water mark.
7. Every state change emits an event, and the leaderboard can be derived from events alone.

The human writes the invariant tests. Claude generates the implementation to make them pass. Never weaken a test to get green.

## Monad gotchas (apply everywhere)

- **Gas is charged on the gas limit, not on gas used.** Set tight explicit limits and never send padded estimates.
- **Every EOA must keep 10 MON.** A tx that dips below that reverts and still pays gas. Fund deployer, session-key and house-agent wallets with headroom above 10 MON.
- **AUSD has 6 decimals**, not 18. Address: `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`.
- **Kuru MON markets trade native MON** (not WMON). The 200 MON `minSize` applies to limit orders only. **MON-AUSD has no liquidity; MON-USDC is the live market.** The vault asset (AUSD vs USDC) is open in `docs/open-questions.md`.
- **Contract size limit is 128 KB**, so don't split contracts for size.
- **No archive state on full nodes.** Use HyperSync for history.

## Toolchain

- **Foundry ≥ 1.8** with `network = "monad"`. 1.8.3 is installed and pinned in CI. Plain `foundryup` installs the stale `stable` tag (1.5.1), so use `foundryup --install v1.8.3`. solc is pinned to 0.8.36.
- **Node ≥ 22.18.** Envio v3 needs 22+, the MetaMask `mm` CLI needs 22.18, and 24 is recommended.
- **pnpm workspaces.**
- **Every new dependency** needs a one-line reason in the PR description.

## Working agreement

- There are three parallel worktrees: `contracts`, `indexer+api`, `web`. Emmanuel integrates and reviews.
- **Session end:** update the day-plan status in spec.md §8 and the README, and tick off anything resolved in `docs/open-questions.md`.
- **Stretch items** (SessionPool, Nansen, Mera) are touched only if the Day 5 checkpoint is on schedule.
- **Out of scope:** own matching engine, own perp, copy trading, token launch, mobile app, ML reputation.
- **House agents** stay dumb and honest, and every house agent is plainly labelled as one on the leaderboard. No strategy that could look rigged, no wash trading.
- **README must track:** every mainnet address and tx hash as soon as it exists, plus the AI-tooling disclosure and the pre-existing-code note (hackathon rules).

## Safety

- **Secrets:** never commit keys. `.env` is gitignored, and `.env.example` lists names only (`MONAD_RPC_URL`, `DEPLOYER_PK`, `SESSION_KEY_PK_*`, `PRIVY_APP_ID`, `QWEN_API_KEY`, `KIMI_API_KEY`, `ETHERSCAN_API_KEY`, …).
- **IMPORTANT: mainnet deploys, funding txs and house-agent runs move real money.** Ask the human before running them. Default to fork tests and testnet (10143).
- **Addresses:** never hard-code an address that hasn't been checked with `cast code` against chain 143.
- **Audit status:** the vault is unaudited. The README carries the threat model and says so plainly.
