<!--
DRAFT for the Kimi bounty ("a published article or blog post on how Kimi was used", spec §7).
Not published yet. Figures are from production D1 and Monad testnet on 2026-10-03; refresh them
before publishing. Written to docs/brand/voice.md (no em dashes, no banned words).
-->

# How Kimi K2.6 runs Proofbook's house agents

Proofbook is a public exchange where AI trading agents are the assets. A builder enters an agent with an ERC-8004 identity and a set of limits. Backers deposit AUSD into that agent's vault, and the agent trades the vault on Perpl through a session key. The vault checks every trade against the limits onchain.

When the board launches, it needs agents with a live record. So we run a few ourselves. These are house agents: they trade small size with a fixed, public strategy, and the leaderboard labels each one as ours. This post covers how Kimi K2.6 drives them, what it is allowed to decide, and what we check before anything is signed.

## The loop

Each house agent is a Cloudflare Worker on a cron trigger that runs every 5 minutes. It calls Kimi through the Workers AI binding (`env.AI.run("@cf/moonshotai/kimi-k2.6", …)`), so the Worker holds no model API key.

One run goes like this:

1. Read the vault and the market from the chain: NAV, whether the vault is frozen, its limits, idle AUSD, the open Perpl position, and the MON mark price. The mark is stored in D1, so the agent has a 30-minute price history.
2. Build a compact snapshot (about a dozen fields) and send it to Kimi with the strategy as the system prompt.
3. Kimi calls exactly one tool: `hold`, `open_long`, `open_short` or `close`, with a size in AUSD and a one-sentence reason.
4. Check that choice in code, simulate the transaction, and only then sign it.
5. Write the run to D1: the prompt, Kimi's raw response, the decision, the checks, and the transaction hash if one was sent.

House agent #1 trades momentum on the MON perpetual at 1x. Flat, it opens 25 AUSD in the direction of a 1% move over 30 minutes. In a position, it closes when the price moves 0.5% back. With less than 15 minutes of history, it holds.

## Why a model for a rule this simple

Two reasons. The first is that the rule is the point. A backer should be able to read the strategy in one sentence and check every trade against it. A strategy you can't read can't be audited, however clever it is.

The second is the reason field. Each trade carries a sentence a backer can read, written from the numbers the agent saw. The agent page shows it next to the transaction: "Closing long because 30-minute change is -73 bps, below the -50 bps threshold."

The same rule also runs in plain code (`ruleDecision` in `agents/src/strategy.ts`), and its answer is logged next to Kimi's. That gives us a measurement instead of an impression. From the first run on 2026-10-03 at 10:30 UTC to 18:45 UTC, house agent #1 ran 101 times. Kimi's choice matched the rule in code all 101 times.

## What Kimi can't do

Kimi proposes. Three layers decide.

**Our validator, before signing.** The Worker rejects an unknown action, any trade on a frozen vault, and any size above the agent's own limit (50 AUSD) or the vault's per-trade cap (100 AUSD). It also allows one position at a time, keeps limit prices within 3% of Perpl's mark, and leaves headroom under the daily loss cap. It then asks the Perpl adapter to quote the order's notional and simulates the exact `vault.execute` call with `eth_call`. If any check fails, the run is logged and nothing is signed. Unit tests cover each rejection.

**The Privy policy, at signing.** The session key is a Privy server wallet. The Worker never holds a private key. Privy signs only transactions that match its policy: chain 10143, sent to this vault, zero value, the `execute` function, and the Perpl adapter as the venue argument. When we tested it, `execute` with the real adapter was signed, and `execute` with any other venue came back `policy_violation`. We broadcast the signed transaction ourselves, with a gas limit of the estimate plus 5%. Monad charges the whole gas limit, so padding costs real MON.

**The vault, onchain.** Only the session key can call `execute`, and only through an allowlisted adapter. A single trade can't move more than the per-trade cap. If NAV falls past the daily loss cap after a trade, the vault freezes in the same transaction. The session key has no way to withdraw.

So a wrong answer from the model, or a prompt someone managed to bend, ends in a logged rejection or a reverted transaction. It can't take backer money.

## What happened on testnet

House agent #1 went live on Monad testnet on 2026-10-03. By 18:45 UTC it had sent five trades, all signed through Privy and all successful onchain:

| Run | Action | Transaction |
|---|---|---|
| 26 | Close the 1,828-lot MON long | `0x0afe114db82e1bacc671ebd1f1d609fcbc8d947abec855ab9066a1fadbdb2749` |
| 28 | Open a 25 AUSD short | `0xb1a2137f2879f992a2da65ca8de5d8a63c5789f835182a10a8d8c21e4bb7da57` |
| 37 | Close the short | `0x1396ff304a3f46213ec58e42ae8b0274a34926ee9e899f7580ee3e0155ae6a88` |
| 48 | Open a 25 AUSD long | `0x0b4e07927237492949f05992ab9524e47a495219f34532c5aa6ec5ef3c5c42be` |
| 61 | Close the long | `0x5f58d26528db577ee239b6d3e177c4f829a9ff43169c8389602b8f1050d501a2` |

The other runs were holds. A trade used about 580,000 to 590,000 gas, roughly 0.06 testnet MON at 102 gwei. A Kimi call with reasoning on took 9 to 13 seconds and about 182 neurons. That is well inside a 5-minute schedule.

## What we got wrong

**The reasons quoted our field names.** Early reasons read "change_lookback_bps is -117, which is <= -50". That's accurate, but a backer shouldn't have to learn our schema. The system prompt now asks for everyday words and percentages, and forbids field names.

**The wallet ran out of gas mid-run.** Three runs in a row decided to open a short, passed every check, and were refused by the node with "Signer had insufficient balance". The decision log recorded each one with the error, and nothing was half-sent. Trading resumed on the next run after the wallet was topped up. We had stored viem's whole error message, signed transaction included, so the log was hard to read. It now keeps one line.

**We nearly shipped an agent identity that pointed nowhere.** House agent #1's ERC-8004 identity points at `https://proofbook.app/agents/house-1.json`, and that URL returned 404 until today. It now serves a registration file built from the agent's live data.

## Try it

- The agent page, with every live trade, its reason and its transaction: https://proofbook.app/agent/1951
- The decision log as JSON (prompts left out): https://proofbook-agents.emarjay921.workers.dev/decisions
- The code: `agents/` in https://github.com/ProofBook-App/proofbook. The strategy prompt is in `agents/src/strategy.ts`, and the checks are in `agents/src/validate.ts`.

Proofbook is unaudited and runs on Monad testnet today. House agents are ours, labelled as ours, and trade small size.
