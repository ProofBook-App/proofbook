# Mainnet runbook (chain 143)

Every step below moves real MON or AUSD, so the human runs it (CLAUDE.md, Safety). Nothing here has been run. `--rpc-url monad` reads `MONAD_RPC_URL` from `.env` (`contracts/foundry.toml`). Costs use mainnet gas at 102 gwei (read on 2026-10-03) and the gas the same scripts used on testnet. Monad charges the full gas limit.

## 0. Decide first

- **Guardian:** `GUARDIAN_ADDRESS` is fixed into the registry and every vault at deploy, and it can freeze any vault. Use a key that is not the deployer and is not online in a Worker.
- **House-agent size:** the testnet agents use a 100 AUSD per-trade cap, a 10% daily loss cap and 500 AUSD per backer. Keep those or lower them; nobody can change them after entry.
- **Backer gas on mainnet** (`docs/open-questions.md`): either a small real-MON drip per new passkey account, or no drip with a "send MON to this address" step. The testnet drip (`/api/drip`) refuses to run off testnet, by design.
- **Daily-loss window wording** (rolling 24 h vs UTC day): settle before the README claims either.

## 1. Fund the wallets

| Wallet | Needs | Why |
|---|---|---|
| Deployer | 10 MON reserve + about 2 MON | Registry about 0.41 MON (4.03M gas), each house agent about 0.55 MON (5.36M gas limit), rotate about 0.009 MON |
| Each house agent's Privy wallet | 10 MON reserve + about 1 MON | Every EOA keeps 10 MON on Monad; a trade is about 0.06 MON |
| Seed AUSD for each house vault | 100 to 500 AUSD | A Perpl account needs margin before the first order |

Check balances with `cast balance <addr> --ether --rpc-url https://rpc.monad.xyz` before each step.

## 2. Contracts

```bash
cd contracts
set -a; source ../.env; set +a
# dry run first (no --broadcast), read the output, then broadcast
forge script script/Deploy.s.sol --rpc-url monad --private-key $DEPLOYER_PK --slow
forge script script/Deploy.s.sol --rpc-url monad --broadcast --private-key $DEPLOYER_PK --slow
# house agent #1: Perpl, AUSD
REGISTRY=<registry> SESSION_KEY=<deployer for now> VENUE=perpl AGENT_URI=https://proofbook.app/agents/house-1.json \
  forge script script/HouseAgent.s.sol --rpc-url monad --broadcast --private-key $DEPLOYER_PK --slow
```

Then verify on MonadVision (Sourcify, `docs/reference/monad.md`) and put every address and tx hash in the README "Mainnet deployments" table straight away.

## 3. Privy and the session key

```bash
cd agents
node --env-file=../.env scripts/privy-setup.mjs --vault <mainnet vault> --adapter <mainnet PerplAdapter>
```

`privy-setup.mjs` (`CHAIN_ID = 10143`) and `rotate-and-fund.sh` (the chain check and the testnet registry `0x25D4…8ABC`) are pinned to testnet today. Before running them on mainnet, switch the policy's chain, the RPC check and the registry address to mainnet's. Code that refuses mainnet should only change in a reviewed commit. Then rotate the vault's session key to the Privy wallet and fund that wallet with more than 10 MON.

## 4. Indexer

Add chain 143 to `indexer/config.yaml` with the registry address and its deploy block as `start_block`, run `pnpm codegen && pnpm test`, and deploy to Envio Cloud. Note the new GraphQL URL.

## 5. Workers

- **web:** set `CHAIN_ID` to `"143"` and `ENVIO_GRAPHQL_URL` to the mainnet indexer in `web/wrangler.jsonc`; add chain 143's house agents to `web/app/lib/agents.ts`; deploy. The drip stays off on 143.
- **agents:** `agents/src/config.ts` refuses any chain but 10143. Lifting that is a deliberate code change: allow 143, add the mainnet house agent to `HOUSE_AGENTS` with its Privy wallet, start in `"MODE": "dry-run"`, watch a few decisions, then switch to live.
- **Alchemy:** set `ALCHEMY_RPC_URL` to the mainnet endpoint on both Workers.

## 6. MetaMask Agent Wallet

Add the registry, the vaults, AUSD and USDC to the Agent Wallet allowlist (human, with 2FA; `docs/reference/metamask.md`). Then test `mm proofbook agent status` and a small `fund` through mm. That is the first chain where mm signs.

## 7. Check before telling anyone

- `/leaderboard` shows the mainnet agent, labelled as a house agent.
- A passkey deposit of a few AUSD from a phone, then a withdrawal.
- The first Kimi decision is in `/decisions`, and the first trade is in the README.
