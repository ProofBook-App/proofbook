# Product


## Platform

web

## Users

- **Backers (primary, first to convert).** People with AUSD or USDC on Monad who would put money behind an AI trading agent if they could see how it trades and what stops it from blowing up. They arrive skeptical of "AI trading bot" pitches.
- **Builders (secondary).** People who already run a trading bot or AI agent and want backers, a public track record and a performance fee. They get a short section on the landing page and their own builders page.
- **Spectators and judges.** Monad crypto X, Monad Metropolis hackathon judges (scoring design, originality and market readiness in minutes), and AI-agent developers who know LLMs better than DeFi. Spectators are the funnel to backers.

## Product Purpose

Proofbook is a public exchange where AI trading agents are the assets. A builder registers an agent (ERC-8004 identity plus declared limits). Backers deposit into that agent's own vault. The agent trades the vault on Kuru (spot) and Perpl (perps) on Monad mainnet through a session key, and the vault contract enforces its limits. Success at launch means waitlist sign-ups from would-be backers and builders; later it means deposits into agents with a real record.

## Positioning

The agent's limits live in the vault contract, not in a promise. The session key can only call `execute` through allowlisted venue adapters and can never withdraw. A trade over the per-trade cap reverts. A trade that pushes the vault below its daily loss floor freezes the vault in that same transaction. Every trade, freeze and fee is an onchain event from block one, so the leaderboard is derived from events alone.

## Operating Context

- Launch state: **waitlist**. Mainnet contracts are not deployed yet; testnet and a testnet simulation stack are live. The landing page's main action is joining the waitlist (and following on X once the handle exists).
- Backer accounts use Mera passkeys: no seed phrase, no extension. Deposits in AUSD (6 decimals) by default, USDC for Kuru MON-USDC agents.
- Installable PWA on React Router 7 / Cloudflare Workers at https://proofbook.app. Public pages render on the server for link previews.

## Capabilities and Constraints

- Limits per vault: max trade notional, daily loss cap (rolling, mark-to-market), venue allowlist, deposit cap per backer, guardian and owner freeze, unfreeze by owner after a cooldown.
- Backers can withdraw their pro-rata share whenever the vault is idle, frozen or not.
- Performance fee: 10% of profit above the high-water mark, taken on withdrawal, paid to the builder.
- Builder tooling (planned, not shipped): `proofbook` CLI (`agent create|fund|run|freeze`) and a MetaMask Agent Wallet plugin.
- Undecided: mainnet deposit cap, X handle, waitlist storage.

## Brand Commitments

- Name spelled "Proofbook" everywhere.
- Copy follows `docs/brand/voice.md`: plain, exact, a little dry; numbers and mechanisms over adjectives; no hype words, no rhetorical-question openers, no em dashes in product copy.
- House agents are always labelled as house agents. The vault is unaudited and the site says so plainly.

## Evidence on Hand

- Contracts: AgentRegistry, AgentVault, KuruAdapter, PerplAdapter; 30 invariant tests green, mainnet-fork tests for both adapters (`contracts/`).
- Testnet deployments and a first simulated trade (400 simAUSD deposit, ~$50 MON long), addresses in `README.md`.
- **Absent, never fabricate:** users, waitlist counts, returns, TVL, testimonials, partner logos, audit.

## Product Principles

1. Show the mechanism, not a promise. Every claim points at a contract behaviour.
2. Say the risk before the upside.
3. Honesty is visible: house agents labelled, illustrative data labelled.
4. Backers first; builders are the supply that makes the board worth watching.

## Accessibility & Inclusion

Mobile-first (375 px), tap targets ≥ 44 px, visible keyboard focus, reduced motion respected.
