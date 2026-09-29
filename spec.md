# Proofbook — Product Spec & Build Brief

Monad Metropolis hackathon entry. **Track 01 (Onchain Finance & Trading)**, decided 2026-09-29 because bounties are track-locked (see §7). Backer auth is **Mera** passkeys (Agora and Mera bounties). House-agent session keys live in **Privy** server wallets with policies (Privy bounty). Vault asset is per vault, **AUSD by default** (Perpl), with USDC for Kuru MON-USDC agents.
Build window for us: Oct 5 → Oct 13, 2026 (deadline 11:59 PM ET Oct 13 = 4:59 AM Lagos Oct 14). Submit Oct 12.

This file is written to be dropped into the repo as `CLAUDE.md`. Everything under "Non-negotiables" and "Invariants" is law; everything under "Stretch" is only touched when the day plan is ahead.

---

## 1. One-liner

A public exchange where AI trading agents are the assets. Builders enter agents, backers fund them, everyone watches them trade live on Monad with an auditable track record from block one.

Pitch line: "Every trading bot asks you to trust it. Proofbook makes agents prove it, live, with real money, under rules they cannot break."

## 2. Users and what each gets

- **Agent builder**: registers an agent (ERC-8004 identity), declares a risk envelope, trades a vault through a session key, earns a performance fee on backer profits.
- **Backer**: browses agents like a fund marketplace, reads an onchain-verified track record, deposits AUSD into an agent's vault, withdraws any time. The agent can never withdraw, only trade within policy.
- **Spectator**: watches the live leaderboard. (Stretch: bets on session outcomes.) Spectators are the funnel to backers.

## 3. Scope

### Ships (v1)
1. **AgentRegistry** — ERC-8004 identity registration (use the canonical Monad deployment if one exists; otherwise deploy the reference registries), agent metadata URI, owner, declared risk envelope.
2. **AgentVault** — one per agent. ERC-4626-style vault on AUSD. Holds backer deposits. Agent trades the vault's funds directly via an authorised session key. Enforces policy onchain. Deposit cap per backer during hackathon (hard-coded, visible).
3. **Policy engine (in-vault)** — per-trade notional cap, daily loss cap (rolling 24h, mark-to-market), venue allowlist, kill switch (owner + protocol guardian), auto-freeze on any breach.
4. **Venue adapters** — `KuruAdapter` (onchain CLOB, spot). `PerplAdapter` (perps) if the integration path is confirmed on Day 0 (see Risks).
5. **Indexer** — Envio HyperIndex over registry, vaults, fills, policy events. Produces per-agent: realised PnL, max drawdown, policy adherence, open exposure, backer count, TVL.
6. **Web app** — leaderboard, agent profile (track record, policy status, live positions), deposit/withdraw with Mera passkeys and signing sessions, "enter your agent" page.
7. **Risk dashboard** — per-agent exposure, drawdown vs envelope, breach history. This is the Perpl "analytics/risk tool" bounty artefact.
8. **House agents** — 3 to 5 simple, honest strategies (momentum, mean reversion, random-walk control) running on Qwen/Kimi credits for the reasoning layer, trading tiny size on mainnet from Day 2 so the board is alive.
9. **CLI + MetaMask Agent Wallet plugin** — `proofbook agent create|fund|run|freeze`. Plugin wraps the CLI so any external agent can enter in under ten minutes.
10. **Submission artefacts** — README with MIT licence, AI-tooling disclosure, architecture, contract addresses, tx hashes, per-bounty checklist; 3-minute video.

### Stretch (only if on schedule by end of Day 5)
- **SessionPool** — parimutuel "which agent finishes today's session up the most" pool, settled from indexed PnL. This is the Track 3 hook. One contract, ~150 lines.
- Nansen labels on counterparties/leaderboard ($5k bounty) if their API is a single afternoon.

### Explicitly out
Own matching engine, own perp, strategy tooling for builders, mobile app, ML-based reputation, mirroring/copy-trading engine, token launch.

## 4. Architecture

```
[Builder CLI / MetaMask plugin]      [Web app: React Router v7 on CF Workers]
          |                                   |
          v                                   v
   session key (EOA) --------> AgentVault (per agent) <---- Backers (Mera passkey)
                                   | policy check
                                   v
                          KuruAdapter / PerplAdapter
                                   |
                                   v
                           Kuru CLOB / Perpl (Monad mainnet, chain 143)
                                   |
                                   v
                    Envio HyperIndex -> GraphQL -> Workers API (D1 cache) -> UI
```

- Contracts: Foundry, Solidity ^0.8.24. OpenZeppelin ERC-4626, AccessControl, ReentrancyGuard.
- Agents: TypeScript, viem. Each house agent is a small loop: fetch book/market data → ask model for an action within the envelope → sign and submit via session key → log.
- Indexer: Envio HyperIndex (TypeScript handlers), deployed to Envio Cloud.
- App: React Router v7 (framework mode, Vite) + Tailwind CSS v4 on Cloudflare Workers, with D1 for cached leaderboard snapshots. Public pages (landing, leaderboard, agent profile) are server-rendered with per-agent OG images so crawlers and link previews work; wallet/deposit UI is client-only. Mera passkeys for backer accounts; Privy server wallets (with policies) hold house-agent session keys. Alchemy RPC as a secondary RPC.
- Models: Qwen 3.8 Max and Kimi via their credit programmes for house-agent reasoning.

## 5. Contracts

### AgentRegistry
- `enter(agentId, riskEnvelope, sessionKey) -> vault`: the builder first registers with the canonical ERC-8004 IdentityRegistry, and `enter` checks `isAuthorizedOrOwner(msg.sender, agentId)`, then deploys and links the vault (once per agent). See `docs/reference/erc-8004.md`.
- `envelopeOf(agentId)`, `ownerOf(agentId)` (live IdentityRegistry owner), `vaultOf(agentId)`
- Events: `AgentRegistered`, `VaultLinked`

### AgentVault (ERC-4626 on AUSD)
State: `agentId`, `sessionKey`, `policy {maxTradeNotional, dailyLossCap, venueAllowlist, depositCapPerBacker, frozen}`, `dayStart`, `dayStartNav`, `guardian`.

- `deposit/withdraw/redeem` (ERC-4626) — capped per backer; withdraw always allowed unless mid-trade reentrancy.
- `execute(venue, calldata)` — `onlySessionKey`, `notFrozen`; calls adapter; before/after NAV check. Venue and notional breaches revert. A daily-loss breach keeps the trade and freezes in the same tx (a revert would undo the freeze; invariant 3).
- `rotateSessionKey`, `freeze` (owner or guardian), `unfreeze` (owner, after cooldown).
- `performanceFee` — high-water-mark, taken on withdrawal, paid to agent owner. Keep simple: 10% of profit above HWM.
- Events: `Executed(venue, notionalIn, notionalOut, navBefore, navAfter)`, `PolicyBreach(reason)`, `Frozen`, `Unfrozen`, `FeeTaken`.

### Adapters
- `IVenueAdapter { function execute(bytes calldata) external returns (int256 navDelta); function exposure(address vault) external view returns (uint256); }`
- `KuruAdapter`: place/cancel limit and market orders on Kuru CLOB from the vault's balance.
- `PerplAdapter`: only if Perpl supports contract-owned margin accounts (Day 0 spike). Otherwise Perpl participation is read-only via the risk dashboard.

### SessionPool (stretch)
- `openSession(agentIds[], endsAt)`, `bet(sessionId, agentId)` in AUSD, `settle(sessionId)` from an indexer-signed result (single signer for hackathon, documented as such), pro-rata payout minus 2% to protocol.

## 6. Invariants (write tests for these first)

1. Only the session key can call `execute`; the session key can never move funds out of the vault except through an allowlisted adapter.
2. A single `execute` can never move more than `maxTradeNotional`.
3. If `nav < dayStartNav * (1 - dailyLossCap)` after any execute, the vault freezes in the same transaction.
4. Backers can always withdraw their pro-rata share when the vault is idle (no open adapter position that blocks it), frozen or not.
5. Deposits above `depositCapPerBacker` revert.
6. Performance fee is only ever taken on profit above the high-water mark.
7. Every state change emits an event the indexer consumes; the leaderboard is derivable from events alone.

## 7. Bounty checklist

Bounty scoring is 40% adherence to the published brief. Read every brief on hackathon.monad.xyz/tracks after registering and paste the exact requirements under each item below before Day 1. Tick only when the README section for that bounty exists.

> **Bounties are track-locked.** Confirmed firsthand on the portal 2026-09-29: "Each one names its track, and the ones marked All tracks pair with any." Card text below is read firsthand from hackathon.monad.xyz/tracks/<slug>. The full briefs are in `docs/reference/hackathon.md`.

| Bounty | Prize | Card track | Our artefact | Judged on / deliverables | Done |
|---|---|---|---|---|---|
| **Agora — Best Mobile Trading App** | **$10,000** | 01 | Installable PWA: Mera passkey login, AUSD balance, trades through Perpl | Eligibility: a mobile app that authenticates via **Mera**, holds and shows **AUSD**, and trades through **Perpl**. Judged on implementation quality, UX, and creative use of the three together. Demo: passkey login → fund or view AUSD → at least one Perpl trade. | ☐ |
| **Perpl — Best use of API** | $5,000 (2 × $2,500) | **All** | House agents trading via PerplAdapter, plus the leaderboard | "Production-ready trading bot or automation system on Perpl". Judged on reliable execution, risk management, ability to be profitable, and **real onchain activity**. The suggested ideas include "leaderboards, PvP/tournament apps". | ☐ |
| Kuru — Consumer Trading App | $5,000 | 01 | Vault + KuruAdapter (MON-USDC) + UI | Judged on integration strength, a clear target user, **evidence of user demand**, a credible acquisition/retention plan, and a plan to continue. Form asks: target users, evidence of demand, retention plan. | ☐ |
| MetaMask — Agent Wallet Plugin | $2,500 | 01 | `mm` plugin: session key via Agent Wallet | Must be installable via Agent Wallet (v6.2.0+), with **every tx through the Agent Wallet** (no key handling, no bypass of signing/policy/MFA). Ship `skills/<name>/SKILL.md`, a README, and a demo of ≤5 min. | ☐ |
| Mera — Best Mera-Powered UX | $2,500 | All | Same Mera login as the Agora bounty | Mera is the *entire* account layer. Judged on time-to-first-tx, session design (prompt-free signing sessions), and the **stateless test**: identity rebuilds from the passkey on a fresh device mid-demo. | ☐ |
| Privy | $5,000 | All | House-agent session keys in Privy server wallets with policies (server-side, not the backer flow) | Beyond login. The demo must show Privy-powered features, with a bonus for several of them. | ☐ |
| Envio | $1,000 | All | HyperIndex leaderboard indexer | Depth (derived/aggregated entities), live correct data, originality, craft. Deliverables: public `config.yaml`, `schema.graphql` and handlers, a consumer, and a short demo. | ☐ |
| Kimi | $3,000 credits (10 teams) | All | House-agent reasoning via Kimi K2.6 on Cloudflare Workers AI | Kimi drives a core feature. **Needs a published article or blog post** on how Kimi was used. | ☐ |
| Alchemy | $1,000 credits | All | Secondary RPC or another Alchemy tool | Meaningful integration of at least one Alchemy service. | ☐ |
| Monad — Best Community Team | $5,000 | All | — | The team must represent an onboarded community picked in the profile. We have none, so this is **not eligible** unless we join one. | ☐ |
| Perpl — Analytics/Risk | $3,000 (3 × $1,000) | 01 | — | A full protocol-plus-wallet analytics product (see hackathon.md). **Skipped**: out of scope, and s0urledd/plumb is strong. | — |
| Qwen 3.8 Max | $5,000 credits | 04 | — | Locked to Track 04. Not available with Track 01. | — |
| Nansen (stretch) | $5,000 | All | Labels on leaderboard | "Goes beyond exposing raw data." | ☐ |

**Track 01 deliverables** (from the track page, beyond Rules §4): logo (≤3 MB), a public repo **accessible by metropolis@hackathon.monad.xyz**, a technical demo of ≤3 min, a **pitch video of ≤2 min**, a live product link with judge access instructions and test credentials, and an optional ≤30 s ad.
**Track 01 judging:** technical execution 20%, design & craft 20%, originality 15%, **founder & market readiness 25%** (name a specific first user), traction & path forward 20%.

## 8. Day plan (Oct 5 → Oct 13)

**Day 0 (this week, before Oct 5)**
- Register on hackathon.monad.xyz; pick a community if entering as a team; read all bounty briefs into §7.
- Mainnet wallet funded with MON + AUSD. Kuru and Perpl API/SDK access. Envio, Privy, Mera, Alchemy, Kimi accounts.
- Spike: can a contract own a Perpl margin account / sign Perpl orders? Decide PerplAdapter vs read-only.
- Repo scaffold: Foundry + pnpm monorepo (`contracts/`, `agents/`, `indexer/`, `web/`, `cli/`, `plugin/`), this file as `CLAUDE.md`, CI running tests.

**Day 1 (Oct 5)** — Contracts: Registry, Vault, policy, session keys. Invariant tests (§6) green. Local fork.
**Day 2** — KuruAdapter (+ PerplAdapter if confirmed). Deploy to mainnet. First house agent trading $20–50 at tiny size. Addresses + tx hashes into README immediately.
**Day 3** — Envio indexer + GraphQL. Workers API + D1 snapshot. Two more house agents.
**Day 4** — Web app: leaderboard, agent profile, deposit/withdraw with Mera, "enter your agent" page.
**Day 5** — Risk dashboard. CLI. MetaMask plugin. Checkpoint: on schedule → stretch tomorrow; behind → cut to core.
**Day 6** — SessionPool (stretch) or buffer/polish.
**Day 7** — README (licence, AI disclosure, architecture, addresses, hashes, §7 filled), security pass on the vault, open-source clean-up.
**Day 8 (Oct 12)** — Storyboard + record 3-minute video. Submit. Confirm submission is editable until deadline.
**Day 9 (Oct 13)** — Buffer only. Fix anything a judge could trip on. Do not add features.

## 9. Submission non-negotiables (from Rules v2.0)

- Deployed on Monad mainnet (chain 143); contract addresses + tx hashes; a paragraph on why Monad.
- Public GitHub repo, OSI licence (MIT), README with setup, architecture, stack.
- Commit history inside the window; any pre-existing code identified.
- AI coding tools disclosed in README.
- Demo video ≤ 3 minutes, public link, shows real mainnet operation.
- One project, one track. Bounties stack on top.
- No wash trading or manipulation; house agents must be plainly labelled as house agents on the leaderboard.

## 10. Risks and the pre-decided answer

- **Perpl can't be driven from a contract** → PerplAdapter dropped; Perpl bounties pursued via risk dashboard + read-only API integration.
- **Kuru SDK friction** → fall back to direct contract calls against Kuru's onchain CLOB; it is fully onchain by design.
- **Behind at Day 5 checkpoint** → cut SessionPool, Nansen, Mera. Switch entry to Track 4 if the story is more "agent infra" than "culture" by then.
- **Vault security** → deposit caps, guardian freeze, and a written threat model in README. Say what is not audited.
- **Time** → evenings + both weekends; recruit one person for frontend + video by Day 2 at the latest.

## 11. Claude Code working agreement

- Three worktrees in parallel: `contracts`, `indexer+api`, `web`. Emmanuel integrates and reviews.
- Tests and invariants are written by the human first; implementation is generated to make them pass.
- Every session starts by reading this file and the bounty table. Every session ends by updating the day plan status and the README.
- No new dependency without a one-line reason in the PR description.
- House agents stay dumb and honest. No strategy that could look rigged.
