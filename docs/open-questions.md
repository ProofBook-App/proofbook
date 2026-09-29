# Open questions

These are Day 0 items where the spec and the research disagree, or where facts are unverified. When one is resolved, record the decision here, update spec.md, and delete the line.

## Decisions needed
- [x] **Track choice.** Decided 2026-09-29: **Track 01, Onchain Finance & Trading**. Bounties are track-locked, and Track 01 unlocks Agora $10k, Kuru $5k and MetaMask $2.5k. Qwen (Track 04) is lost.
- [x] **Privy vs Mera.** Decided 2026-09-29: **both**, split by user. **Backers use Mera** as the entire account layer (passkey login and signing sessions), for Agora ($10k) and Mera UX ($2.5k). **House agents use Privy** server wallets with policies as the session-key signers, for Privy ($5k, beyond login). Keep Privy out of the backer flow so Mera stays the whole account layer there.
- [x] **House-agent size vs Kuru `minSize`.** Resolved: the minimum applies only to limit orders, and market orders of any size fill (fork-tested). 200 MON ≈ $5.7 anyway.
- [x] **Vault asset.** Decided 2026-09-29: **per vault, chosen at `enter`, AUSD by default** (Perpl, Agora). USDC vaults trade Kuru MON-USDC. Both tokens have 6 decimals, but still check `asset.decimals()` instead of hard-coding it.
- [ ] **Fee recipient.** Pay the performance fee to `IdentityRegistry.ownerOf(agentId)` read live, or to a snapshot taken at `enter`? See `reference/erc-8004.md`. **Scaffold default: live `ownerOf`** (`IAgentRegistry.ownerOf`). The drafted invariant 6 test `test_Inv6_feeFollowsIdentityTransfer` pins live `ownerOf`. Confirm when reviewing the tests.
- [ ] **Notional check.** Spec §5 `IVenueAdapter` has no way for the vault to learn a trade's notional before executing. The scaffold adds `quoteNotional(bytes) view returns (uint256)` to the interface. The drafted invariant 2 tests rely on it. Accept it when reviewing, or pick another mechanism.

- [ ] **Review the Claude-drafted invariant tests** (`contracts/test/invariant/PolicyInvariant.t.sol`, drafted 2026-09-29 at your request). The banner at the top lists the semantics they pin: NAV definition, day roll, flows adjusting dayStartNav, freeze/unfreeze roles, fee model, cap on the receiver. Edit what you disagree with, then remove the banner. Implementation starts only after that.

## Verify
- [x] Read the logged-in /tracks bounty cards (2026-09-29, firsthand; see spec §7 and `reference/hackathon.md`) and the Rules v3.0 modal. All relevant cards are captured, and Alchemy is All tracks. Rules v3.0 were read firsthand on 2026-09-29 and summarized in `reference/hackathon.md`. Update spec §9, which still says v2.0.
- [x] Is Kuru mainnet still v1, or has v2 (AccountCore) shipped? Still v1 (2026-09-29). v2 is testnet-only, so recheck before the demo.
- [x] Read `IExchange.sol` in PerplFoundation/delegated-account. Write a fork test for create → deposit → order → withdraw from a contract. **Yes: a contract can own a Perpl account** (fork spike passed 2026-09-29; see `reference/perpl.md`). Build PerplAdapter.
- [ ] Run `mm chains list` to confirm the MetaMask Agent Wallet supports Monad.
- [x] Confirm the repo must be readable by `metropolis@hackathon.monad.xyz`. Yes, per the Track 01 deliverables. A public repo satisfies this.

## Environment
- [x] Run `foundryup` to Foundry ≥ 1.8. (1.8.3 installed 2026-09-29.)
- [ ] Upgrade Node to ≥ 22.18 (22.15 is installed; `mm` needs 22.18 and Envio recommends 24).
- [x] Add an MIT `LICENSE`. (`git init` and `.gitignore` are done.)
- [x] Register `proofbook.app` on Cloudflare (purchased 2026-09-29).
- [ ] Create the `proofbook-app` GitHub org and a matching X handle.
- [ ] After launch: add `proofbook.app` to Google Search Console and submit `/sitemap.xml`.
