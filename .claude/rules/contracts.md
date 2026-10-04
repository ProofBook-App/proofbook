---
paths:
  - "contracts/**"
---

# Contracts rules

- **`foundry.toml` must have:**
  - `evm_version = "osaka"`
  - `network = "monad"` (needs Foundry ≥ 1.8)
  - `bytecode_hash = "none"`, `use_literal_content = true` (needed for Sourcify verification). Foundry 1.8 rejects the older `metadata`/`metadata_hash` keys.
- **Test order:** write the spec §6 invariant tests first, then the implementation. Adapter code is only trusted after a mainnet fork test: `forge test --fork-url $MONAD_RPC_URL`.
- **AUSD has 6 decimals.** Guard the ERC-4626 vault against first-depositor inflation with OpenZeppelin `_decimalsOffset()`, and write a test for it.
- **Do not deploy our own ERC-8004 registry.**
  - Builders register with the canonical IdentityRegistry themselves.
  - `AgentRegistry.enter(agentId, envelope)` checks `ownerOf(agentId) == msg.sender` (approved operators are refused, security review L4).
  - The reason is that `register()` mints to `msg.sender`. See `docs/reference/erc-8004.md`.
- **Kuru:**
  - Funds must sit in the Kuru MarginAccount before a limit order is placed.
  - Use the SDK ABI, not docs.kuru.io. `minAmountOut` is uint256. `addBuyOrder`/`addSellOrder` return nothing, so get orderIds from `OrderCreated`.
  - MON-AUSD's base is native MON, so the vault needs `receive()`.
  - Details: `docs/reference/kuru.md`.
- **NAV** = vault balances + MarginAccount balances + funds locked in resting orders + positions at a *conservative* mark.
  - The Kuru mid can be manipulated. Test daily-loss freezing under a manipulated mid.
- **Perpl:** model `PerplAdapter` on Perpl's `DelegatedAccount.sol`. See `docs/reference/perpl.md`.
- **Events:** every state change emits an event (invariant 7). When you add an event, update the indexer schema in the same PR.
- **Addresses:** all canonical addresses live in `docs/reference/monad.md`. Never hard-code an address you haven't checked with `cast code`.
