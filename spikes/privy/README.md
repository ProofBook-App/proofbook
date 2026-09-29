# Privy spike: server wallet as a house-agent session key

Day 0 question: can a Privy server wallet be the house-agent session key on Monad mainnet (`eip155:143`), with a Privy policy that allows only `AgentVault.execute(address,bytes)` on one vault and denies everything else?

**Answer: yes** (2026-09-29, sign-only). Findings are in [`docs/reference/privy.md`](../../docs/reference/privy.md).

## What it does

`spike.mjs` is plain Node (fetch plus `node:crypto`, no dependencies). It:

1. Loads `PRIVY_APP_ID`, `PRIVY_APP_SECRET` and `PRIVY_AUTH_KEY` from the repo-root `.env`. If `PRIVY_AUTH_KEY` is missing, it generates a P-256 authorization key and appends it to `.env`. Secrets are never printed.
2. Creates a policy owned by that key: `to == vault`, `chain_id == 143`, `value == 0`, calldata `function_name == execute` (decoded with the `execute(address venue, bytes data)` ABI), for `eth_signTransaction` and `eth_sendTransaction`.
3. Creates a server wallet with that policy and the same owner.
4. Calls `eth_signTransaction` for one allowed tx and several txs that should be denied, then checks the signed RLP with `cast decode-transaction` to confirm the signer is the wallet.
5. Tries to `PATCH` the policy with only the app secret, which should fail because the policy has an owner.

It **only signs**. Nothing is broadcast and no funds move. The wallet holds 0 MON.

Policy and wallet IDs are cached in `state.json`, so reruns reuse them. The last run's responses are in `results.json`. Both files hold IDs and a public key only, no secrets.

## Run

```bash
source ~/.nvm/nvm.sh && nvm use 24
node spikes/privy/spike.mjs
```

Needs `cast` (Foundry) on PATH. To start from scratch, delete `state.json`. Deleting it leaves the old policy and wallet in the Privy app; archive them in the dashboard if they bother you.
