# proofbook-agents: house agents

Proofbook's house agents run in a Cloudflare Worker (`proofbook-agents`) on Monad **testnet (10143)**. Every house agent is labelled as one on the leaderboard. Each one trades a small size with a fixed, public strategy. Kimi K2.6 makes the call, an off-chain validator checks it, and the session key is a Privy server wallet that can only call `execute` on its own vault.

## One run (every 5 minutes, per agent)

1. **Read the chain** (`src/chain.ts`): vault NAV, `frozen`, envelope (`maxTradeNotional`, `dailyLossCapBps`, `dayStartNav`), idle AUSD, the PerplAdapter's Perpl account, free margin and open position, and the MON perp's mark, bid and ask.
2. **Mark history** (`perp_marks` in D1): store this run's mark and read the last 30 minutes for momentum.
3. **Ask Kimi K2.6** (`@cf/moonshotai/kimi-k2.6` via `env.AI.run`, `src/strategy.ts`). The model gets the public strategy text and a compact JSON snapshot, and calls exactly one tool: `hold`, `open_long`, `open_short` or `close`, with `size_ausd` and a one-sentence public `reason`. The same rule is also computed in code (`ruleDecision`) and logged next to the model's answer, so a disagreement is visible.
4. **Validate** (`src/validate.ts`, pure). The model's answer is advisory. Checks:
   - the action is known;
   - the vault isn't frozen;
   - the size is within `maxTradeNotional` and the agent's own limit;
   - one position at a time;
   - the limit is inside the adapter's 3% band around mark;
   - opens need daily-loss headroom above the freeze line (worst entry: band plus fees).
5. **Margin**: when there's no Perpl account yet, or not enough free margin for an open, this run moves margin in instead (a fixed step, `model = "rule"`). The open can then happen on the next run if the signal holds.
6. **Quote and simulate**: the adapter's own `quoteNotional` must fit the cap. Then an `eth_call` of `AgentVault.execute(adapter, data)` runs from the session key.
7. **Live mode only**: gas = `estimateGas` + 5% (an explicit limit, since Monad charges the whole limit). Privy `eth_signTransaction` is called with a P-256 authorization signature (`src/privy.ts`, a WebCrypto port of `spikes/privy/spike.mjs`). Before broadcasting, the Worker checks the signed transaction's signer, `to`, data, chain, value and gas. It then sends with `eth_sendRawTransaction` on our RPC and waits for the receipt.
8. **Log** one `agent_decisions` row per agent per run, whatever happened. The row holds the prompt, the raw response (including Kimi's `reasoning_content`), the action, size, validity, the reason, the tx hash, any error, and a `detail` JSON with the snapshot, momentum, the rule's answer, the order, the quote and the calldata. Tables are in `web/migrations/0005_agent_decisions.sql`, in the same D1 `proofbook` as the web Worker.

`MODE` in `wrangler.jsonc` is `"dry-run"` by default: steps 1–6 and 8 run, nothing is signed, and no Privy secret is read. `"live"` signs, and refuses unless the configured Privy wallet address is the vault's current session key.

## Strategy (house agent #1, momentum)

The system prompt in `src/strategy.ts` is the published strategy, and the agent reads only that. It trades MON on Perpl at 1x and holds one position at most. It compares the mark now with the mark 30 minutes ago. When flat, a move of 1% or more opens a 25 AUSD long or short in the move's direction. An open position closes on a 0.5% move against it. With under 15 minutes of history it holds. The size limit is 50 AUSD, inside the vault's 100 AUSD `maxTradeNotional`. All of these are per agent in `HOUSE_AGENTS`.

## Commands

```bash
pnpm install                                     # from the repo root
cd agents
pnpm test                                        # builds the CLI, then node --test (validator, encoding vs the CLI, Privy signature, strategy)
pnpm typecheck
npx wrangler d1 migrations apply proofbook --local
env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID npx wrangler dev --test-scheduled   # dry run; Workers AI is always remote, so wrangler login is needed
curl 'http://localhost:8787/__scheduled?cron=*/5+*+*+*+*'                                # one run of every house agent
curl 'http://localhost:8787/decisions?limit=5'                                           # latest log rows (no prompts)
npx wrangler d1 execute proofbook --local --command "SELECT * FROM agent_decisions ORDER BY id DESC LIMIT 1"
```

## Going live (human steps, testnet)

All three need credentials, so the human runs them. Nothing here touches mainnet.

1. **Privy policy and wallet**:
   ```bash
   cd agents
   node --env-file=../.env scripts/privy-setup.mjs --vault 0x98e2af31848B95d751e3BFD5bAB9E5EAB9122B53 --adapter 0x583B6bCFcAec599E6Fc09e27db581d6abe7baB09
   ```
   The script prints the policy id, wallet id and address, then a sign-only policy check: `execute(adapter)` should be signed and `execute(0x…dEaD)` should get `policy_violation`. If both are denied, Privy's `execute.venue` address match didn't work as assumed; rerun with `--no-venue-rule`. Then put `privyWalletId` and `privyWalletAddress` into `HOUSE_AGENTS` in `wrangler.jsonc`.
2. **Rotate the session key and fund the wallet**:
   ```bash
   set -a; source ../.env; set +a
   PRIVY_WALLET=0x… ./scripts/rotate-and-fund.sh
   ```
   - It calls `rotateSessionKey(wallet)` from the agent owner, `DEPLOYER_PK` (`0x3faE…9F51`).
   - It sends 3 test MON (`AMOUNT`) from `FUNDER_PK`, defaulting to the deployer.
   - Gas limits: estimate + 5%, and exactly 21000 for the transfer.
   - It asks before each send. It refuses if the funder would end under the 10 MON reserve.
   - On 2026-10-02 the deployer held about 10.38 testnet MON, so use another funder or the faucet first.
3. **Switch to live**: set `"MODE": "live"` in `wrangler.jsonc`, then:
   ```bash
   npx wrangler d1 migrations apply proofbook --remote
   npx wrangler deploy
   ```
   The Worker already has the secrets `PRIVY_APP_ID`, `PRIVY_APP_SECRET` and `PRIVY_AUTH_KEY`. Watch the first runs with `npx wrangler tail proofbook-agents` and at `https://proofbook-agents.<account>.workers.dev/decisions`.

## Notes

- **Dependencies:** `viem` (chain reads, ABI encoding and tx parsing, already used by `web/` and `cli/`). Dev: `wrangler` (Worker build, dev and deploy), `typescript` and `@types/node` (typecheck), and `proofbook` (workspace CLI, tests only, to pin the encoding).
- **Encoding is copied, not imported, from the CLI.** The CLI's entry imports `node:child_process` (the mm signer). `test/encode.test.ts` checks both byte for byte.
- **Testnet only:** `loadConfig` refuses any `CHAIN_ID` but 10143. Mainnet needs its own vault, policy and a human decision.
