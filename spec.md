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
7. **Agent risk panel** — per-agent exposure, drawdown vs envelope and breach history, on the agent profile. (Not entered for Perpl's analytics bounty: that brief asks for a full protocol-and-wallet analytics product.)
8. **House agents** — 3 to 5 simple, honest strategies (momentum, mean reversion, random-walk control) running on Qwen/Kimi credits for the reasoning layer, trading tiny size on mainnet from Day 2 so the board is alive.
9. **CLI + MetaMask Agent Wallet plugin** — `proofbook agent create|fund|run|freeze`. Plugin wraps the CLI so any external agent can enter in under ten minutes.
10. **Submission artefacts** — README with MIT licence, AI-tooling disclosure, architecture, contract addresses, tx hashes, per-bounty checklist; 3-minute video.

### Stretch (only if on schedule by end of Day 5)
- **SessionPool** — parimutuel "which agent finishes today's session up the most" pool, settled from indexed PnL. One contract, ~150 lines. (It was the Track 3 hook; with Track 01 it is optional flavour only.)
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
- Events: `Executed(venue, notional, venueDelta, navBefore, navAfter)`, `PolicyBreach(reason, nav, dayStartNav)`, `Frozen(by)`, `Unfrozen(by)`, `FeeTaken(to, assets, highWaterMark)`, `SessionKeyRotated`, `DayRolled(dayStart, dayStartNav)`, plus ERC-4626 `Deposit`/`Withdraw`. Registry: `AssetAllowed`, `AgentRegistered`, `VaultLinked(agentId, vault, asset, sessionKey)`.
- Adapters are called with CALL (never DELEGATECALL). The vault approves exactly the quoted notional per execute and clears it after, so each venue is a per-vault adapter instance that holds the venue account.

### Adapters
- `IVenueAdapter { function execute(bytes calldata) external returns (int256 navDelta); function exposure(address vault) external view returns (uint256); }`
- `KuruAdapter` (`contracts/src/adapters/KuruAdapter.sol`): one instance per USDC vault on Kuru MON-USDC, market orders only (fill-or-kill BUY/SELL). MON bought is held by the adapter; quote goes back to the vault after every trade. Held MON is valued at the Kuru best bid clamped to [97%, 100%] of Perpl's MON oracle (Chainlink Data Streams; mark as fallback, 5 min freshness), and every fill must be within 3% of that reference. No fresh reference → trades revert and MON counts as 0. `unwind` lets anyone sell held MON back to a frozen vault under the same band.
- Both adapters share `VaultBoundAdapter` (deploy → `enter` → `bind(vault)`).
- `PerplAdapter` (`contracts/src/adapters/PerplAdapter.sol`): one instance per vault, owns the Perpl account directly. Actions: DEPOSIT / WITHDRAW margin, ORDER (open, close, cancel only). Notional = lot × max(limit, mark); limits must be within 3% of mark. Exposure = free margin + each position's margin and PnL at mark (floored at 0); reads that fail count as 0 so NAV never reverts. `recall` lets anyone move free margin back to a frozen vault. See `docs/reference/perpl.md` for the ABI and gotchas.

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

## 8. Day plan (revised 2026-09-29; the build window opened Sep 1, so we start now instead of Oct 5)

Status: ✅ done · 🟡 in progress / waiting on the human · ⬜ not started

**Day 0 (now → Oct 4)**
- ✅ Registered on hackathon.monad.xyz. Team of one. Project "Proofbook" created, with **Track 01** and 9 bounties selected (Agora mobile trading, Perpl API, Kuru consumer, MetaMask plugin, Mera UX, Privy, Envio, Kimi, Alchemy). Repo URL and description are on the portal.
- ✅ Read all bounty cards and Rules v3.0 firsthand (§7, `docs/reference/hackathon.md`).
- ✅ Decisions: Track 01; Mera for backers and Privy server wallets for house agents; vault asset per vault, AUSD by default.
- ✅ Spikes: a contract can own a Perpl account (fork test). Kuru `minSize` applies only to limit orders, and MON-AUSD is dead while MON-USDC is live. `mm` 7.0.0 supports Monad (confirmed on the live chain list after `mm init`; Guard-mode server wallet set up).
- ✅ Repo scaffold: public repo https://github.com/ProofBook-App/proofbook, Foundry project, pnpm workspace root, CI, MIT licence. Domain `proofbook.app` bought.
- ✅ Toolchain: Foundry 1.8.3, Node 24, pnpm 10, Docker, `mm` 7.0.0.
- ✅ Invariant tests (§6): 30 tests, Claude-drafted, approved by the human on 2026-09-29. AgentRegistry + AgentVault implemented: **30/30 green** (also under the CI fuzz profile). The fuzz-bound fix in `testFuzz_Inv4` was approved and applied by the human's instruction.
- ✅ Spike: Kimi K2.6 tool calls on Workers AI (2026-09-29, `spikes/kimi/`, `docs/reference/kimi.md`): read-then-act round in ~6 s, ~104 neurons.
- ✅ Spike: Privy server wallet with policy signing on chain 143 (2026-09-29, `spikes/privy/`, `docs/reference/privy.md`): only `execute` on one vault, chain 143, value 0 signs; every other call gets `policy_violation`. Sign with Privy, broadcast via our RPC.
- 🟡 Spike: Mera SDK on Workers (2026-09-29, `spikes/mera/`, `docs/reference/mera.md`): `@category-labs/mera` 0.2.0 builds and runs in React Router 7.18 on Workers; derivation and session signing verified in Node. Waiting on the human's passkey test (script in `spikes/mera/README.md`).
- ⬜ Accounts and keys: Privy app, Mera, Envio, Alchemy, Cloudflare API token. Mainnet wallets funded with MON (10 MON reserve plus headroom), AUSD and a little USDC.
- ⬜ Post the first progress update on the portal (unlocks mentor support). Register an X handle.

**Day 1 (Oct 5)** — ✅ PerplAdapter (built early, 2026-09-29): per-vault, owns its Perpl account, `bind(vault)` after `enter`; 16/16 mainnet-fork tests green through a real AgentRegistry → AgentVault (`pnpm contracts:fork`). ✅ KuruAdapter (built early, 2026-09-29): MON-USDC market orders, oracle-clamped valuation and 3% fill band; 14/14 mainnet-fork tests green (spoofed bid, dumped book, real price drop → freeze, stale reference, frozen-vault unwind). ⬜ Deploy. ✅ Deploy scripts (`Deploy.s.sol`, `HouseAgent.s.sol`, per-chain `Chains.sol`), fork-tested on testnet and mainnet. The testnet run caught a real bug: Perpl's positions bitmap isn't keyed by perp ID, so PerplAdapter now tracks the perps it trades. ✅ Testnet deployed 2026-09-29: AgentRegistry `0x25D4…8ABC` + house agent #1 (identity #1951, PerplAdapter, AUSD vault), all Sourcify-verified. Addresses in README. ✅ First real-Perpl testnet trade 2026-09-30 (Agora refilled the faucet): 400 AUSD deposit, ~$50 MON long via house agent #1, Perpl account #740. ✅ Testnet sim stack deployed 2026-09-29 (`src/sim/`, `script/SimStack.s.sol`): SimPerplExchange and SimKuruOrderBook speak the real ABIs at live Perpl testnet prices, simAUSD/simUSDC faucet tokens, a new registry `0x73d7…3B35` and sim house agents #1953 (Perpl) and #1954 (Kuru) on the unchanged production vault and adapters. Fork parity tests against the real venues are green. First sim trade is live: 400 simAUSD deposit, ~$50 MON long. **Retired 2026-09-30:** testnet uses real Perpl via registry `0x25D4…8ABC`; Kuru is mainnet-fork-tested only. The indexer and web app target `0x25D4…8ABC` on testnet. ⬜ Mainnet **after human approval**. Addresses and tx hashes go into the README immediately.
**Day 2** — House agents: Kimi K2.6 via Workers AI, session keys in Privy server wallets with policy. First honest house agent trading $20–50 on Perpl. Plainly labelled.
**Day 3** — 🟡 Started early 2026-09-30: `indexer/` (Envio 3.12.1) indexes testnet registry `0x25D4…8ABC`, its vaults (from `VaultLinked`) and adapters (from `envelope.venues`). Agents, vaults, NAV/share price/drawdown/PnL, backers, trades, policy events and adapter actions all come from events. `pnpm test` replays house agent #1's real testnet history. ✅ HyperSync (2026-09-30): full testnet sync in ~40 s, ~106k events. ✅ Perpl Exchange fills and positions for our accounts (position, fill and mark events; taker fills matched through the same tx), ✅ Envio Cloud deploy 2026-09-30 (indexer `proofbook`, org `proofbook-app`, branch `envio`, free Development plan: at risk of the 100k-event soft limit, ask Envio for a hackathon credit), ✅ Workers API + D1 snapshot 2026-09-30 (live at https://proofbook.app/api/leaderboard): a per-minute cron in the web Worker copies the indexer into D1 (`vaults`, `positions`, `nav_points`, `snapshot_meta`); `/api/leaderboard` and `/api/agent/:id` read it. Two more house agents.
**Day 4** — 🟡 Started early 2026-09-29: `web/` scaffolded (React Router 7 on Workers, Tailwind 4). ✅ 2026-09-30: landing `/` and `/builders` live at https://proofbook.app (Worker `proofbook-web`, custom domain). Team copy, design after agora.finance (`web/DESIGN.md`), product record in `PRODUCT.md`, copy rules in `docs/brand/voice.md`, sourced figures in `docs/brand/research.md`. Waitlist (email, role, builder note) writes to production D1 `proofbook` (`web/migrations/` 0001–0002 applied). ✅ `/leaderboard` 2026-09-30: server-rendered from the D1 snapshot, table on desktop and cards on phones, house agents labelled, open Perpl PnL at mark shown beside NAV (not added to it). ✅ `/agent/:id` 2026-09-30: hero stats and rank, share-price step chart, limits with drawdown vs daily loss cap and breach/freeze counts, open Perpl positions in real prices (perp decimals from `docs/reference/perpl.md`), and a live activity timeline with explorer links. Sitemap lists every agent. ✅ Per-agent OG image `/og/agent/:id.png` 2026-09-30: rendered in the Worker from D1 (workers-og: satori + resvg WASM, ~950 KiB gzipped Worker), house-agent label and limits status on the card, cached 5 minutes. ✅ Deposit/withdraw 2026-09-30: "Back this agent" panel on `/agent/:id`, with Mera onboarding in one passkey ceremony that also starts a 15-minute signing session scoped to the vault (approve exact amount, deposit, withdraw, redeem, to self only). It shows AUSD, MON and position live from the chain, with testnet test funds from `/api/drip`. Session flow verified on testnet with a stand-in key (`web/scripts/flow-test.ts`); the passkey ceremony itself still needs the human test. Still to do for the PWA: manifest, service worker, install prompt, and "enter your agent". This covers the Agora demo path: passkey → AUSD → Perpl trade.
**Day 5** — CLI (`proofbook agent create|fund|run|freeze`) + MetaMask Agent Wallet plugin (`skills/<name>/SKILL.md`, every tx through the Agent Wallet). **Checkpoint:** on schedule → Day 6 polish and stretch; behind → cut Kuru UI and Nansen.
**Day 6** — Mera UX polish (time-to-first-tx, session expiry, stateless test), SEO/OG images, Kuru bounty evidence (named users, retention plan), Kimi blog post draft.
**Day 7** — README (licence, AI disclosure, architecture, addresses, hashes, threat model including Perpl admin powers), vault security pass, logo (≤3 MB).
**Day 8 (Oct 12)** — Record the 3-min technical demo + the **2-min pitch video** (+ optional 30 s ad). Publish the Kimi post. Fill every bounty's submission fields. Submit (editable until the deadline).
**Day 9 (Oct 13)** — Buffer only. Fix anything a judge could trip on. No new features. Deadline 2026-10-14T03:59Z.

**Throughout:** the marketer recruits real backers and builders. Track 01 scores founder & market readiness at 25% and traction at 20%, and Kuru scores evidence of user demand.

## 9. Submission non-negotiables (from Rules v2.0)

- Deployed on Monad mainnet (chain 143); contract addresses + tx hashes; a paragraph on why Monad.
- Public GitHub repo, OSI licence (MIT), README with setup, architecture, stack.
- Commit history inside the window; any pre-existing code identified.
- AI coding tools disclosed in README.
- Demo video ≤ 3 minutes, public link, shows real mainnet operation.
- One project, one track. Bounties stack on top.
- No wash trading or manipulation; house agents must be plainly labelled as house agents on the leaderboard.

## 10. Risks and the pre-decided answer

- **Perpl can't be driven from a contract**: resolved. The fork spike passed. Remaining risk: Perpl admin can freeze or whitelist accounts, and withdrawals are rate-limited. Document both in the threat model.
- **Kuru SDK friction** → fall back to direct contract calls against Kuru's onchain CLOB; it is fully onchain by design.
- **Behind at Day 5 checkpoint** → cut SessionPool, Nansen and the Kuru UI (keep KuruAdapter). Mera stays: the $10k Agora bounty depends on it.
- **Vault security** → deposit caps, guardian freeze, and a written threat model in README. Say what is not audited.
- **Time** → evenings + both weekends; recruit one person for frontend + video by Day 2 at the latest.

## 11. Claude Code working agreement

- Three worktrees in parallel: `contracts`, `indexer+api`, `web`. Emmanuel integrates and reviews.
- Tests and invariants are written by the human first; implementation is generated to make them pass.
- Every session starts by reading this file and the bounty table. Every session ends by updating the day plan status and the README.
- No new dependency without a one-line reason in the PR description.
- House agents stay dumb and honest. No strategy that could look rigged.
