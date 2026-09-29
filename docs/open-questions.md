# Open questions

These are Day 0 items where the spec and the research disagree, or where facts are unverified. When one is resolved, record the decision here, update spec.md, and delete the line.

## Decisions needed
- [x] **Track choice.** Decided 2026-09-29: **Track 01, Onchain Finance & Trading**. Bounties are track-locked, and Track 01 unlocks Agora $10k, Kuru $5k and MetaMask $2.5k. Qwen (Track 04) is lost.
- [x] **Privy vs Mera.** Decided 2026-09-29: **both**, split by user. **Backers use Mera** as the entire account layer (passkey login and signing sessions), for Agora ($10k) and Mera UX ($2.5k). **House agents use Privy** server wallets with policies as the session-key signers, for Privy ($5k, beyond login). Keep Privy out of the backer flow so Mera stays the whole account layer there.
- [x] **House-agent size vs Kuru `minSize`.** Resolved: the minimum applies only to limit orders, and market orders of any size fill (fork-tested). 200 MON ≈ $5.7 anyway.
- [x] **Vault asset.** Decided 2026-09-29: **per vault, chosen at `enter`, AUSD by default** (Perpl, Agora). USDC vaults trade Kuru MON-USDC. Both tokens have 6 decimals, but still check `asset.decimals()` instead of hard-coding it.
- [x] **Fee recipient.** Decided 2026-09-29: live `ownerOf` (approved with the implementation). Pay the performance fee to `IdentityRegistry.ownerOf(agentId)` read live, or to a snapshot taken at `enter`? See `reference/erc-8004.md`. **Scaffold default: live `ownerOf`** (`IAgentRegistry.ownerOf`). The drafted invariant 6 test `test_Inv6_feeFollowsIdentityTransfer` pins live `ownerOf`. Confirm when reviewing the tests.
- [x] **Notional check.** Accepted 2026-09-29: `quoteNotional` (PerplAdapter values orders at lot × max(limit, mark)). Spec §5 `IVenueAdapter` has no way for the vault to learn a trade's notional before executing. The scaffold adds `quoteNotional(bytes) view returns (uint256)` to the interface. The drafted invariant 2 tests rely on it. Accept it when reviewing, or pick another mechanism.

- [x] **Review the Claude-drafted invariant tests** (reviewed; banner removed by the human 2026-09-29) (`contracts/test/invariant/PolicyInvariant.t.sol`, drafted 2026-09-29 at your request). The banner at the top lists the semantics they pin: NAV definition, day roll, flows adjusting dayStartNav, freeze/unfreeze roles, fee model, cap on the receiver. Edit what you disagree with, then remove the banner. Implementation starts only after that.
- [ ] **Open Perpl positions in a frozen vault.** `recall` moves only *free* margin back. Positions stay open until the owner unfreezes (1-day cooldown) and the session key closes them. Options: let the guardian close positions while frozen (reduce-only IOC, needs a price guard against bad fills), or accept and document. Scaffold: accept and document.
- [ ] **Resting orders vs `maxTradeNotional`.** The cap is per execute. An agent can rest several limit orders, each under the cap, that later fill together. Add a per-venue open-notional cap to the envelope, or document it as per-trade only? Scaffold: document.
- [ ] **Leverage cap.** The envelope has no leverage limit; `leverageHdths` passes through to Perpl. Notional is still capped per order. Add `maxLeverageHdths` to the envelope?
- [ ] **Adapter binding.** An adapter is bound to its vault by its deployer after `enter` (`PerplAdapter.bind`). A wrong bind only disables that venue for the vault; it cannot move funds. Alternative: have the registry deploy adapters. Scaffold: `bind`.
- [ ] **Price band on Perpl orders.** KuruAdapter rejects fills more than 3% from the oracle, so a compromised session key can't trade the vault into an attacker's order at an absurd price. PerplAdapter only caps size: an OpenLong with a huge limit can fill against an attacker's ask. Add the same band there (limit price within 3% of mark)? Recommended: yes, it's small.
- [ ] **Kuru valuation depends on Perpl.** Held MON is priced off Perpl's MON oracle. If Perpl is down or stale for over 5 min, Kuru trades revert and MON counts as 0 in NAV, which could trip a freeze. Perpl's owner can also move the mark (the fallback). Alternative: a direct Chainlink/Pyth/Redstone feed on Monad (not yet checked). Scaffold: Perpl oracle.
- [ ] **`unwind` band leak.** Anyone can unwind a frozen vault's MON. A caller who pushes the Kuru bid down first can buy that MON up to 3% under the reference. It's bounded, and only possible while frozen.
- [ ] **Do contracts holding MON fall under Monad's reserve-balance rule?** KuruAdapter holds native MON and Foundry forks don't model the rule. Check on testnet before mainnet.

## Verify
- [x] Read the logged-in /tracks bounty cards (2026-09-29, firsthand; see spec §7 and `reference/hackathon.md`) and the Rules v3.0 modal. All relevant cards are captured, and Alchemy is All tracks. Rules v3.0 were read firsthand on 2026-09-29 and summarized in `reference/hackathon.md`. Update spec §9, which still says v2.0.
- [x] Is Kuru mainnet still v1, or has v2 (AccountCore) shipped? Still v1 (2026-09-29). v2 is testnet-only, so recheck before the demo.
- [x] Read `IExchange.sol` in PerplFoundation/delegated-account. Write a fork test for create → deposit → order → withdraw from a contract. **Yes: a contract can own a Perpl account** (fork spike passed 2026-09-29; see `reference/perpl.md`). Build PerplAdapter.
- [x] MetaMask Agent Wallet supports Monad, **confirmed firsthand** 2026-09-29: the live `mm chains list` has `eip155:143` Monad (relay supported, swap) and `eip155:10143` Monad Testnet. Server Wallet in Guard mode set up; see `reference/metamask.md`.
- [x] Confirm the repo must be readable by `metropolis@hackathon.monad.xyz`. Yes, per the Track 01 deliverables. A public repo satisfies this.

## Environment
- [x] Run `foundryup` to Foundry ≥ 1.8. (1.8.3 installed 2026-09-29.)
- [x] Upgrade Node to ≥ 22.18. Node 24.21.0 is the nvm default as of 2026-09-29. `mm` 7.0.0 is installed. Reinstall wrangler with `--allow-scripts=esbuild,workerd`.
- [x] Add an MIT `LICENSE`. (`git init` and `.gitignore` are done.)
- [x] Register `proofbook.app` on Cloudflare (purchased 2026-09-29).
- [x] Create the GitHub org: `ProofBook-App`, repo https://github.com/ProofBook-App/proofbook (public, pushed 2026-09-29).
- [ ] Create a matching X handle.
- [ ] After launch: add `proofbook.app` to Google Search Console and submit `/sitemap.xml`.
