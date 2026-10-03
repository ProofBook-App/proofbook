# Contract security review (2026-10-03)

A read-only review of `contracts/src` (AgentRegistry, AgentVault, PerplAdapter, KuruAdapter, VaultBoundAdapter) at commit `1f6ae8b`. It was done by Claude Code for the spec §8 Day 7 "vault security pass". It is not an audit. No files were changed by the review. `forge test --no-match-path 'test/fork/*'` passed 52/52 at the time.

C1 was confirmed by hand afterwards (`AgentRegistry._validate` and `AgentVault.execute`/`nav`). The others are as reported, and the ones marked "needs a test" have no failing test yet. Fixes that touch contract behaviour or the invariant tests are the human's (CLAUDE.md).

## Critical

**C1. Venue adapters are builder-chosen and never verified.** `AgentRegistry._validate` (`AgentRegistry.sol:75-83`) only rejects `address(0)`. The vault trusts each venue's `quoteNotional` (which sets the approval), `execute` (which pulls up to it) and `exposure` (NAV). A malicious adapter quotes `maxTradeNotional`, pulls it on every execute, and reports the stolen amount back through `exposure`, so NAV looks flat and the daily-loss freeze never fires. A $50k vault with a $1k cap drains in 50 transactions. A genuine adapter deployed with a fake `market_`, `reference_` or `exchange_` does the same. Every safety claim about "allowlisted adapters" holds only for honest adapters.

- **Fix:** the registry deploys adapters through a factory with canonical immutables (this also closes the open "adapter binding" question), or an owner-curated adapter allowlist checked in `_validate`.
- **Done now (web only):** `/agent/:id` turns deposits off and shows a warning for any agent whose adapters Proofbook hasn't verified. Today only Proofbook's own agents are verified.

## High

**H1. Discount deposits while a venue reads as 0** (`KuruAdapter.sol:209-241`, `PerplAdapter.sol:179-195`, `AgentVault.sol:210-217`). When the Kuru reference is stale (both oracle and mark over 5 minutes old) held MON counts as 0. When Perpl's account or position read reverts, the Perpl leg counts as 0. Deposits stay open in both cases. With 5,000 idle and 5,000 in MON, NAV reads 5,000. An attacker deposits 5,000 for half the shares, waits for the reference to refresh (NAV 15,000), and withdraws 7,500, taking 2,500 from backers. Needs a test. Fix: block deposits (and `maxDeposit` → 0) whenever a venue reports its exposure as stale or unreadable.

**H2. A freeze doesn't stop resting Perpl orders** (`PerplAdapter.sol:153-157`, `AgentVault.sol:93`). Post-only orders with no expiry stay live after a freeze and can fill. Nobody can cancel them: `execute` is blocked and `recall` only withdraws free margin. Positions need the owner to unfreeze (24 h) and the session key to close them. Needs a test. Fix: allow `Cancel` while frozen, add a guardian reduce-only close inside the 3% band, and optionally require IOC/FOK or a bounded expiry.

## Medium

- **M1. Losses between executes never freeze** (`AgentVault.sol:110-114`). The breach check runs only inside `execute`, so a leveraged position can lose past the cap with no freeze if the session key stops trading. `_rollDay` also forgives overnight losses. Fix: a permissionless `checkLoss()`, and `maxLeverageHdths` in the envelope.
- **M2. A malformed venue response stops withdrawals** (`AgentVault.sol:151-156`). `try/catch` doesn't catch ABI-decoding failures, and `nav()` calls `exposure` without its own guard. If Perpl upgrades its Exchange and changes a struct's shape, `nav`, `maxWithdraw` and `redeem` revert, breaking invariant 4. Needs a test. Fix: low-level `staticcall` with a gas cap and defensive decoding in `nav()`.
- **M3. The fee recipient can block withdrawals** (`AgentVault.sol:279-280`). `_takeFee` runs on every withdrawal in profit. If `ownerOf` reverts (a burned identity) or the token refuses the recipient (a blocklisted address), every such withdrawal reverts. Needs a test. Fix: accrue the fee to a claimable balance.
- **M4. Held MON is valued at the best bid regardless of size** (`KuruAdapter.sol:200-218`), so NAV overstates a position the book can't absorb. Fix: cap or haircut by size.

## Low

- **L1.** The deposit cap is per address. Shares are transferable, so two addresses or a share transfer get around it.
- **L2.** A withdrawal after an intraday gain lowers `dayStartNav` by the absolute amount (`AgentVault.sol:307-309`). Example: start 1,000, NAV 2,000, withdraw 999: the floor drops to 0.9. Fix: scale it proportionally. Needs a test.
- **L3.** Anyone can crystallise the fee at a mark peak with `withdraw(0, x, x)`.
- **L4.** An approved ERC-721 operator can `enter` someone else's identity first, with an envelope nobody can change (`AgentRegistry.sol:41`). Require `ownerOf == msg.sender`.
- **L5.** Perpl orders check the 3% band against a mark with no freshness check (`PerplAdapter.sol:169-173`).
- **L6.** The vault's `receive()` (`AgentVault.sol:86`) isn't needed, and MON sent to it is stuck.
- **L7.** `dailyLossCapBps = 10000` is accepted (a floor of 0, so no freeze), and `maxTradeNotional` has no upper bound.

## Info

- Unfreeze resets the baseline, so a hostile owner and session key can lose about one daily cap per 24-hour cycle. The 3% band leak per trade to a colluding counterparty is already documented.
- One `withdraw` computes `nav()` about 7 times. Caching it would cut gas, which matters because Monad charges the limit.
- Invariant 7: `dayStartNav` changes on deposits, withdrawals and fees have no event of their own (derivable from Deposit, Withdraw and FeeTaken), and NAV between executes depends on marks.
- AUSD donated to a PerplAdapter counts in NAV but can't be swept to the vault.
- Whether KuruAdapter sending MON from a contract falls under Monad's reserve rule is still untested.

## Checked and sound

Honest adapters have no recipient parameters (Perpl `amountCNS` forced to 0, order types 5 and 6 rejected, withdrawals only to the vault). Approvals are exact and cleared after each execute. Calls are CALL only. Execute, deposit and withdraw share one `nonReentrant` guard. A decimals offset of 6 handles first-depositor inflation. The high-water mark update after a fee is correct. The guardian can only freeze.

## Before mainnet

C1 must be fixed for any agent Proofbook doesn't run. H1, H2, M1, M2 and M3 should be fixed, or stated plainly in the README, before backers' real money goes in.
