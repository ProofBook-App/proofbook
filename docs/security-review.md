# Contract security review (2026-10-03)

A read-only review of `contracts/src` (AgentRegistry, AgentVault, PerplAdapter, KuruAdapter, VaultBoundAdapter) at commit `1f6ae8b`. It was done by Claude Code for the spec §8 Day 7 "vault security pass". It is not an audit. No files were changed by the review. `forge test --no-match-path 'test/fork/*'` passed 52/52 at the time.

C1 was confirmed by hand afterwards (`AgentRegistry._validate` and `AgentVault.execute`/`nav`). The others are as reported, and the ones marked "needs a test" have no failing test yet. Fixes that touch contract behaviour or the invariant tests are the human's (CLAUDE.md).

## Critical

**C1. Venue adapters are builder-chosen and never verified.** `AgentRegistry._validate` (`AgentRegistry.sol:75-83`) only rejects `address(0)`. The vault trusts each venue's `quoteNotional` (which sets the approval), `execute` (which pulls up to it) and `exposure` (NAV). A malicious adapter quotes `maxTradeNotional`, pulls it on every execute, and reports the stolen amount back through `exposure`, so NAV looks flat and the daily-loss freeze never fires. A $50k vault with a $1k cap drains in 50 transactions. A genuine adapter deployed with a fake `market_`, `reference_` or `exchange_` does the same. Every safety claim about "allowlisted adapters" holds only for honest adapters.

- **Fix:** the registry deploys adapters through a factory with canonical immutables (this also closes the open "adapter binding" question), or an owner-curated adapter allowlist checked in `_validate`.
- **Done now (web only):** `/agent/:id` turns deposits off and shows a warning for any agent whose adapters Proofbook hasn't verified. Today only Proofbook's own agents are verified.
- **Fix drafted, not deployed (2026-10-03):**
  - `contracts/src/AdapterFactory.sol` deploys PerplAdapter and KuruAdapter with the chain's canonical venue addresses, and is their only binder.
  - `AgentRegistry` now takes the factory in its constructor. `_validate` rejects any venue the factory didn't deploy (`UnknownAdapter`), and `enter` binds each adapter to the new vault after its events.
  - Tests: `test/AdapterFactory.t.sol` (12). It includes the drain itself against a registry without the check: the vault empties, NAV still reads 500, and it never freezes. All 52 local tests (the 30 invariant tests unchanged) and 38 mainnet-fork tests pass.
  - `test/Base.t.sol` gets a `MockAdapterFactory` that vouches for the mock venue. `test_bind_isOneShotAndBinderOnly` now checks the factory as binder.
  - The deploy scripts and `proofbook agent create` use the factory.
  - Needs: the human's review, then a new testnet registry. Existing vaults keep the old registry.

## High

**H1. Discount deposits while a venue reads as 0** (`KuruAdapter.sol:209-241`, `PerplAdapter.sol:179-195`, `AgentVault.sol:210-217`). When the Kuru reference is stale (both oracle and mark over 5 minutes old) held MON counts as 0. When Perpl's account or position read reverts, the Perpl leg counts as 0. Deposits stay open in both cases. With 5,000 idle and 5,000 in MON, NAV reads 5,000. An attacker deposits 5,000 for half the shares, waits for the reference to refresh (NAV 15,000), and withdraws 7,500, taking 2,500 from backers. Needs a test. Fix: block deposits (and `maxDeposit` → 0) whenever a venue reports its exposure as stale or unreadable.

- **Fix drafted, not deployed (2026-10-03):**
  - `IVenueAdapter.exposureReliable(vault)`: PerplAdapter returns false when the account or a tracked position can't be read; KuruAdapter returns false while it holds MON and the reference is stale.
  - `AgentVault.venuesReliable()` is false if any venue says so, or if its check reverts. While it's false, `maxDeposit`/`maxMint` return 0 and `deposit`/`mint` revert with `ExposureUnreliable`. Withdrawals are unchanged.
  - Tests: `test/StaleAndFrozen.t.sol`, including the review's 5,000 + 5,000 scenario, real Perpl and Kuru adapters, and withdrawals during the pause.

**H2. A freeze doesn't stop resting Perpl orders** (`PerplAdapter.sol:153-157`, `AgentVault.sol:93`). Post-only orders with no expiry stay live after a freeze and can fill. Nobody can cancel them: `execute` is blocked and `recall` only withdraws free margin. Positions need the owner to unfreeze (24 h) and the session key to close them. Needs a test. Fix: allow `Cancel` while frozen, add a guardian reduce-only close inside the 3% band, and optionally require IOC/FOK or a bounded expiry.

- **Fix drafted, not deployed (2026-10-03):**
  - `PerplAdapter.cancel(perpId, orderId)`: anyone may cancel a resting order while the vault is frozen. It emits `OrderSent` with orderType Cancel, so the indexer needs no change.
  - Every open or close order must expire within `MAX_ORDER_BLOCKS` (6,000 blocks, about 30 minutes at 300 ms; `OrderExpiryTooFar` otherwise). So an order the agent placed before a freeze is gone within half an hour even if nobody cancels it. The house agents and the CLI use 1,000 blocks.
  - Not done: a guardian reduce-only close, so open positions still wait for the owner to unfreeze.

## Medium

- **M1. Losses between executes never freeze** (`AgentVault.sol:110-114`). The breach check runs only inside `execute`, so a leveraged position can lose past the cap with no freeze if the session key stops trading. `_rollDay` also forgives overnight losses. Fix: a permissionless `checkLoss()`, and `maxLeverageHdths` in the envelope.
  - **Fix drafted, not deployed (2026-10-03):** `AgentVault.checkLoss()`. Anyone may call it, and it freezes (emitting `PolicyBreach` and `Frozen`) when NAV is under the stored day's floor, so an overnight loss counts before the next execute rolls the day. It refuses (`ExposureUnreliable`) while a venue can't be priced, because an unreadable venue reads 0 and a griefer could freeze on an outage. Something must call it: the house-agent Worker can on every run, from any funded key. A leverage cap is not done (open question).
- **M2. A malformed venue response stops withdrawals** (`AgentVault.sol:151-156`). `try/catch` doesn't catch ABI-decoding failures, and `nav()` calls `exposure` without its own guard. If Perpl upgrades its Exchange and changes a struct's shape, `nav`, `maxWithdraw` and `redeem` revert, breaking invariant 4. Needs a test. Fix: low-level `staticcall` with a gas cap and defensive decoding in `nav()`.
  - **Fix drafted, not deployed (2026-10-03):** `nav()` reads each venue with a low-level `staticcall`. A revert or a reply shorter than 32 bytes counts as 0, and `venuesReliable()` reports that venue as unreliable, so deposits pause and withdrawals of idle funds keep working. No gas cap is needed, because only factory adapters can be venues (C1).
- **M3. The fee recipient can block withdrawals** (`AgentVault.sol:279-280`). `_takeFee` runs on every withdrawal in profit. If `ownerOf` reverts (a burned identity) or the token refuses the recipient (a blocklisted address), every such withdrawal reverts. Needs a test. Fix: accrue the fee to a claimable balance.
  - **Fix drafted, not deployed (2026-10-03):** `_takeFee` uses `try registry.ownerOf` and `trySafeTransfer`. If either fails, the fee stays pending and the high-water mark stays put, and the next flow after the recipient can receive pays it. While it's unpaid, the fee is recomputed on the shares that remain, so it shrinks a little with each withdrawal (20 to 18.47 after a 100 withdrawal in the test). The difference stays with the remaining backers. That already happened when the fee's cash sat at a venue.
- **M4. Held MON is valued at the best bid regardless of size** (`KuruAdapter.sol:200-218`), so NAV overstates a position the book can't absorb. Fix: cap or haircut by size.

## Low

- **L1.** The deposit cap is per address. Shares are transferable, so two addresses or a share transfer get around it.
- **L2.** A withdrawal after an intraday gain lowers `dayStartNav` by the absolute amount (`AgentVault.sol:307-309`). Example: start 1,000, NAV 2,000, withdraw 999: the floor drops to 0.9. Fix: scale it proportionally.
  - **Fix drafted, not deployed (2026-10-03):** a withdrawal (and a paid fee) scales `dayStartNav` by the share of NAV that stayed, so the day's gain or loss in percent doesn't change. In the review's case the baseline becomes 450.5 instead of 0. It also stops a withdrawal during a loss from making the loss look bigger (down 5% stayed 5%, where subtracting made it 9.5%). While a venue can't be priced NAV reads low, so it falls back to subtracting. Deposits still add the amount. Tests: `test/BaselineAndEntry.t.sol`.
- **L3.** Anyone can crystallise the fee at a mark peak with `withdraw(0, x, x)`.
- **L4.** An approved ERC-721 operator can `enter` someone else's identity first, with an envelope nobody can change (`AgentRegistry.sol:41`). Require `ownerOf == msg.sender`.
  - **Fix drafted, not deployed (2026-10-03):** `enter` requires `identity.ownerOf(agentId) == msg.sender`; approved addresses and operators get `NotAgentOwner`. Tests: `test/BaselineAndEntry.t.sol`.
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
