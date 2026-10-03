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

## Strategies

Each house agent has one fixed, public strategy (`strategy` in `HOUSE_AGENTS`). The same rule runs in code (`ruleDecision`) and is logged next to Kimi's answer, so a disagreement shows.

- **`momentum`** (house agent #1): flat, open long when MON rose at least `thresholdBps` over `lookbackMinutes`, short when it fell that much. Close when it moves half the threshold back.
- **`mean-reversion`**: the mirror image. It shorts a rise of `thresholdBps` and buys a fall, then closes when price moves half the threshold back its way.
- **`random`** (the control): ignores the price. Every run it computes FNV-1a over `"<agentId>:<slot>"`, where slot is the 5-minute block-time slot. On roll 0 (one run in six) it opens long or short by the coin, or closes an open position. Anyone can recompute the coin from the agent id and the block time.

Every agent trades `sizeAusd` at 1x, holds one position at most, and stays inside the vault's limits.

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

## Adding house agents #2 and #3 (human steps, testnet)

Every step signs with your keys, so you run them. Check the deployer's balance first. Entering an agent deploys an adapter, and Monad expects every EOA to keep 10 MON, so top up from https://testnet.monad.xyz if it's near 10.

```bash
cd /Users/iemarjay/Projects/metropolis/paddock && pnpm --filter proofbook build
set -a; source .env; set +a; export PROOFBOOK_PK="$DEPLOYER_PK"
node cli/dist/cli.js faucet --signer env                                   # test AUSD for the deposit
node cli/dist/cli.js agent create --uri https://proofbook.app/agents/house-2.json --max-trade 100 --daily-loss-bps 1000 --deposit-cap 500 --signer env
#   prints the agent id, vault and adapter; the session key starts as the deployer
node cli/dist/cli.js agent fund <agentId> 200 --signer env                 # the vault needs AUSD to trade
cd agents && node --env-file=../.env scripts/privy-setup.mjs --vault <vault> --adapter <adapter>
AGENT_ID=<agentId> VAULT=<vault> PRIVY_WALLET=<wallet address> AMOUNT=0.5 ./scripts/rotate-and-fund.sh
```

Repeat with `house-3.json` for the control. Then add each agent to `HOUSE_AGENTS` in `wrangler.jsonc`, with the same fields as #1951 plus `"strategy": "mean-reversion"` or `"strategy": "random"`, its `label`, and the Privy wallet id and address. Label it in `web/app/lib/agents.ts`, then deploy both Workers. Agents on the same perp share the mark history in `perp_marks`.

## Notes

- **Dependencies:** `viem` (chain reads, ABI encoding and tx parsing, already used by `web/` and `cli/`). Dev: `wrangler` (Worker build, dev and deploy), `typescript` and `@types/node` (typecheck), and `proofbook` (workspace CLI, tests only, to pin the encoding).
- **Encoding is copied, not imported, from the CLI.** The CLI's entry imports `node:child_process` (the mm signer). `test/encode.test.ts` checks both byte for byte.
- **Testnet only:** `loadConfig` refuses any `CHAIN_ID` but 10143. Mainnet needs its own vault, policy and a human decision.
