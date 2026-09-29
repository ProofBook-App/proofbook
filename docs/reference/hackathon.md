# Monad Metropolis: hackathon facts

Researched 2026-09-28. The bounty cards and the rules modal on https://hackathon.monad.xyz need a login, so anything marked "secondhand" must be checked there. The public page is https://monad.xyz/developers/hackathons/metropolis.

## Dates (verified from the platform JS)

| Event | Time |
|---|---|
| Official build window | Sep 1 → Oct 13, 2026 (ours: Oct 5 → 13) |
| Submission opens | 2026-10-02T03:59Z |
| **Deadline** | **2026-10-14T03:59Z** (Oct 13 11:59 PM ET, Oct 14 04:59 Lagos). Details lock after it. |
| Judging | Oct 14 – 27 |
| Winners | 2026-11-03 |

## Tracks and prizes

- **Prizes:** four tracks, each paying $10k to 1st, 2nd and 3rd. The Grand Champion gets $25k. The headline pool is "$250k+", which includes bounties.
- **Entry rule:** pick **one primary track**, then add any number of sponsor bounties.
- **Track 03, Social, Attention & Culture:** best fit is "teams who have grown a community, not only built one". Example ideas include markets on cultural outcomes.
- **Track 04, Trust, Identity & AI Infrastructure:** agent identity and reputation (ERC-8004), and passkey accounts (P256).
- **Bounties are track-locked** (secondhand, 2026-09-29, consistent across three public submissions). Each bounty card names a track. Only cards marked **All tracks** pair with any primary track.
  - **All tracks:** Privy, Envio, Nansen, Kimi, Mera "One Passkey, Many Keys", Monad Best Community Team.
  - **Track 01, Onchain Finance & Trading:** Kuru ×2, Perpl Analytics/Risk, MetaMask Agent Wallet. Perpl API is likely here too but unconfirmed.
  - **Track 04:** Qwen 3.8 Max. **Track 03:** Tencent Hunyuan.
  - **Unknown:** Alchemy, Mera "Best Mera-Powered UX", Dynamic, Chainlink CRE, Agora.

## Rules (secondhand summary; the firsthand read of v3.0 is in the next section)

- **Eligibility:**
  - Teams of 1–5.
  - One project per participant, one track per submission.
  - Entrants must be 18+. Prizes are paid in USDC, and KYC may be required.
- **Code and repo:**
  - An OSI licence and a public GitHub repo are mandatory.
  - The repo may need to be readable by `metropolis@hackathon.monad.xyz`.
  - The "substantial majority" of the work must be built in the window.
  - Prior code must be identified in the README.
  - Commits must fall inside the window.
- **Disclosure and demo:**
  - AI tools must be disclosed in the README.
  - The demo video has a hard 3-minute cap and must show the real product and its Monad interactions, not slides.
- **Monad integration:**
  - Provide contract addresses or tx hashes, from mainnet **or testnet**. We ship on mainnet anyway.
  - Explain why Monad.

## Judging (secondhand)

- **Main track:** five criteria at 20% each. These are quality/completeness, technical excellence, Monad integration, track fit, and innovation/impact.
- **Bounties:** adherence to the brief 40%, technical 30%, Monad integration 20%, innovation 10%.

## Submission form (from the platform JS)

- **Fields:** name (≤120), oneLiner (≤200), description (≤8000), repositoryUrl, demo link, and an optional YouTube video.
- **Evidence kinds:** repository, demo, video, document, file.
- **Each selected bounty adds required answer fields.** Collect them in spec.md §7.

## Sponsor bounties (from the public page)

| Sponsor | Bounty | Amount |
|---|---|---|
| Kuru | Build the Next Consumer Trading App on Kuru | $5k |
| Kuru | Bring New Assets and Markets to Kuru *(not in spec)* | $5k |
| Perpl | Best use of Perpl's API | $5k |
| Perpl | Best Analytics / Risk Tool | $3k |
| Privy | Privy! | $5k |
| MetaMask | Best Agent Wallet Plugin | $2.5k |
| Envio | Best Use of Envio (+ Envio Cloud hosting up to $5k) | $1k |
| Alibaba (Qwen) | Best Builds with Qwen 3.8 Max | $5k credits |
| Kimi | Best Builds Powered by KIMI | $3k credits |
| Monad Foundation | Best Community Team Project (team must be under a Metropolis community supporter) | $5k |
| Monad Foundation | Best Mera-Powered UX / Mera: One Passkey, Many Keys | $2.5k each |
| Nansen | Best use of Nansen | $5k |
| Alchemy | Best Projects using Alchemy | $1k credits |
| Others | Agora ($10k Mobile Trading, $10k Cross-Border Payments), Dynamic $5k, Chainlink CRE $3k, Aurora Intents $5k | |

## Brief excerpts (secondhand)

- **Privy:** "Integrate Privy beyond authentication — login-only integrations will not qualify." Reportedly **mutually exclusive with the Mera bounties**.
- **Envio:** "Meaningfully use Envio's HyperIndex, HyperSync, or HyperRPC to power real on-chain data driving a core feature."
- **Alchemy:** "…deployed on Monad that meaningfully integrates at least one Alchemy service or tool."

## Secondhand sources for card text (2026-09-29)

The platform is login-gated, and the public page lists titles only. Card text in spec §7 is quoted from other teams' public repos:

- nickthelegend/xorv-monad `SUBMISSION.md`: Privy, Envio, Nansen, Kimi, Mera One Passkey, Qwen and MetaMask cards, with tracks. It also says track-locking is stated on the portal's Tracks & Bounties page.
- Monarchy712/Covenant `docs/BOUNTIES.md`: the Kuru consumer-app and Kuru new-assets cards (Track 01).
- s0urledd/plumb `docs/submission.md`: the point-by-point brief for Perpl "Best Analytics / Risk Tool" (Track 01). Plumb is a mature competitor for that bounty.

## Rules & Guidelines v3.0 (read firsthand 2026-09-29, last updated 3 Sep 2026)

- **Track definitions (§3.3).**
  - **Track 01** is "financial instruments, markets, and asset primitives, where the primary user is a trader, protocol, or financial product builder". Proofbook fits here.
  - Track 03 is for products whose core value is social connection or culture "even where financial mechanics are involved".
  - Track 04 is infrastructure that other apps build on, "rather than standalone consumer products".
- **Sponsor bounties (§3.3):** "the submission must meet the requirements published by the relevant Sponsor for that bounty". The rules themselves don't mention track-locking; that comes from the cards.
- **Prize pool (§3.2):** $145k from the Foundation ($25k overall winner, plus $30k per track split $10k × 3). Bounties are extra.
- **Mandatory (§4.1):**
  - A public GitHub repo with complete source, a README with setup, an OSI licence, attribution of external code, and a commit history covering the build window.
  - A public demo video of no more than 3 min showing real operation and Monad interaction.
  - A Monad explanation with contract addresses, on mainnet or testnet.
  - Docs: description, architecture, stack, setup.
  - **The substantial majority must be built in the period.** Pre-existing code is allowed only if identified in the README. **AI coding tools are allowed but must be disclosed in the README.**
- **Deadline (§4.2):** Oct 13 2026, 11:59 PM ET. Submissions are rolling from Sep 1 and editable until the deadline, and the version recorded at the deadline is judged.
- **Judging (§5.2):**
  - Tracks: five criteria at 20% each (quality/completeness, technical, Monad integration, track fit, innovation/impact).
  - Bounties: adherence 40%, technical 30%, Monad 20%, innovation 10%.
  - Submissions are reviewed **non-confidentially**. Never include keys or credentials.
- **Eligibility:**
  - 18+ (§2.1), no sanctioned jurisdictions (§2.2), teams of 1–5 with one primary contact who receives prizes (§2.4).
  - **One project per participant, one track per submission** (§2.5).
  - Sponsor and judge employees can't win (§2.3).
- **Prizes (§6):** USDC to the primary contact's wallet within 30 days, and KYC may be required.
- **IP (§7):** we keep ownership. The Organizer and every Sponsor get a perpetual non-exclusive licence to show and promote the project. The code must stay public on GitHub during and after the hackathon.
- **Conduct (§8, §10):** wash trading and market manipulation are prohibited, which is consistent with our honest house agents.
- **Technical (§9):** the prototype must work (no mockups), the code must be runnable from the README, and the README must state the problem and the intended user.

## Bounty cards, read firsthand 2026-09-29 (hackathon.monad.xyz/tracks/<slug>)

Confirmed on the portal: "Each one names its track, and the ones marked All tracks pair with any."

| Card | Track | Prize |
|---|---|---|
| Best Community Team Project | All | $5k |
| Agora Best Cross-Border Payments App | 02 | $10k |
| **Agora Best Mobile Trading App** | **01** | **$10k** |
| Best Use of Envio | All | $1k |
| Aurora Intents: any-chain liquidity | All | $5k |
| Cleanverse CVI/CVA | 04 | $2k |
| Kuru Consumer Trading App | 01 | $5k |
| Kuru New Assets and Markets | 01 | $5k |
| Best Use of Dynamic | All | $5k |
| Alchemy | All | $1k credits |
| Chainlink CRE | All | $3k |
| **Perpl Best use of API** | **All** | $5k (2 × $2.5k) |
| Perpl Analytics/Risk | 01 | $3k (3 × $1k) |
| Privy | All | $5k |
| Nansen | All | $5k |
| Hunyuan | 03 | $2k vouchers |
| Kimi | All | $3k credits across 10 teams |
| Qwen 3.8 Max | 04 | $5k credits |
| Mera-Powered UX | All | $2.5k |
| Mera One Passkey, Many Keys | All | $2.5k |
| MetaMask Agent Wallet Plugin | 01 | $2.5k |

Details that matter to us (fuller notes in spec §7):

- **Agora Mobile Trading ($10k, Track 01):** the app must authenticate via **Mera** passkeys, hold and show an **AUSD** balance, and execute trades through **Perpl**. Judged on implementation, UX, and creative use of all three. Demo: passkey login → AUSD balance → at least one Perpl trade. Resource: docs.agora.finance/contract-overview.
- **Perpl API ($5k, All tracks):** "production-ready trading bot or automation system on Perpl". Judged on reliable execution, good risk management, ability to be profitable, and real onchain activity. Suggested ideas include "Social trading interface (copy-trading, following, leaderboards, PvP/tournament apps)". Resources: docs.perpl.xyz/resources/for-developers, github.com/PerplFoundation/dex-sdk, PerplFoundation/api-docs.
- **Kuru consumer app ($5k, Track 01):** judged on integration strength, clarity of target user, evidence of user demand, a credible acquisition/retention strategy, and a plan to continue. The submission asks for target users, evidence of demand and a retention plan. Strong teams may get ongoing support or partnership. Resources point to **Kuru testnet docs** (kuru-testnet-docs.mintlify.site) and a faucet gist.
- **MetaMask ($2.5k, Track 01):** a working plugin installable via Agent Wallet (plugins need v6.2.0+). Every tx must go through the Agent Wallet, with no key or token handling and no bypass of signing, policy or MFA. Ship `skills/<name>/SKILL.md`, a README, and a live demo or ≤5 min video.
- **Mera UX ($2.5k, All tracks):** Mera must be the entire account layer (no seed phrase, extension or custody backend). Judged on time-to-first-tx, session design, and the "stateless test": judges clear storage or switch device mid-demo, and identity must rebuild from the passkey. Resources: mera.category.xyz, github.com/category-labs/mera.
- **Privy ($5k, All tracks):** must go beyond login. The demo must clearly show Privy-powered functionality, with a bonus for several features. The card says nothing about exclusivity with Mera.
- **Envio ($1k, All tracks):** judged on depth, a working product, originality and craft. Wants a deployed indexer (Envio Cloud or self-hosted), a public config/schema/handlers, a consumer, and a short demo.
- **Kimi (credits, All tracks):** needs a working product plus **a published article or blog post** about how Kimi was used.
- **Alchemy (credits, All tracks):** at least one Alchemy service meaningfully integrated.
- **Community Team ($5k):** the team must represent an onboarded community chosen in the profile's community field. The same bar as track judging applies.
- **Track 01 page deliverables:**
  - Logo or graphic (JPG/PNG/WEBP, ≤3 MB).
  - A public repo **fully accessible by metropolis@hackathon.monad.xyz**.
  - A technical demo of ≤3 min showing the live product.
  - A **pitch video of ≤2 min** covering the team, the problem and why.
  - A live product link with judge access instructions and test credentials.
  - Optionally, a ≤30 s ad.
- **Track 01 judging (differs from Rules §5.2):** technical execution 20%, design & craft 20%, originality & track insight 15%, **founder & market readiness 25%** ("name a specific first user beyond 'crypto traders'"), traction & path forward 20%.
