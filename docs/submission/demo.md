# Submission drafts: demo, pitch, judge access

Drafts for the Track 01 deliverables (`docs/reference/hackathon.md`). Written to `docs/brand/voice.md`. The demo must show the live product; the rules want real mainnet operation, so record it once mainnet is up and swap the testnet links. Lines marked TODO need the human.

## Technical demo (≤ 3 minutes)

Record on a phone for the backer half (the installed app) and on a laptop for the builder half. Clear site data on the phone first, so the first passkey prompt is on camera.

| Time | Screen | What to say |
|---|---|---|
| 0:00–0:15 | proofbook.app, the leaderboard | "Proofbook is a public exchange where AI trading agents are the assets. Every number on this board comes from onchain events." |
| 0:15–0:45 | `/agent/1951` | Point at the limits card, the open Perpl position and "Why it trades". "This is a house agent, ours and labelled. Every 5 minutes Kimi K2.6 decides, our code checks it against the vault's limits, and a Privy wallet signs. Here is its last trade and the reason it gave." Tap a transaction link. |
| 0:45–1:30 | The installed app on the phone, `/agent/1951` | Tap "Back this agent", then "Create an account". Approve the passkey. Test funds arrive. Type 100 and tap Deposit. "That's the whole account: a passkey, no seed phrase, no extension. One prompt, then the deposit signs with no more prompts for 15 minutes." Show the receipt and the "First deposit: N taps, N s" line. |
| 1:30–1:50 | `/portfolio` on the phone | "My stake, what it's worth now, and the agent's open position that my money is part of." |
| 1:50–2:10 | The stateless test | Clear site data (or open a second phone), go to `/portfolio`, tap "Log in with your passkey". "Same passkey, same account, rebuilt from the passkey alone." |
| 2:10–2:45 | Laptop terminal | `proofbook agent status 1951`, then `mm proofbook agent status 1951`. "Builders enter with the CLI or the MetaMask Agent Wallet plugin. The limits go in at entry and nobody can change them." Show `docs/reference/privy.md`'s denied test: "the Privy policy refuses anything but this vault." |
| 2:45–3:00 | `/agent/1951` limits card | "A trade over the cap reverts. A loss past the daily cap freezes the vault in the same transaction. Backers can withdraw whatever is idle in the vault, frozen or not. It's unaudited, and deposits are capped at 500 AUSD per backer." |

## Pitch (≤ 2 minutes)

TODO(human): the team and the named first user. Track 01 weights founder and market readiness at 25% and asks for "a specific first user beyond crypto traders".

1. **Who we are** (15 s). TODO(human).
2. **The problem** (30 s). AI trading agents are easy to launch and hard to trust. Their track records are screenshots, and backing one means handing over keys or funds to whoever runs it.
3. **What Proofbook does** (45 s). An agent enters with an ERC-8004 identity and limits that are fixed at entry. Backers deposit AUSD into that agent's own vault, and the agent trades it through a session key that can't withdraw. A trade over the cap reverts. A loss past the daily cap freezes the vault in the same transaction. The record is every trade onchain, so the leaderboard is built from events, not claims.
4. **Why now, why Monad** (15 s). 300 ms blocks and cheap gas make a per-trade onchain record affordable, and Perpl and Kuru give agents onchain venues to trade through a contract.
5. **First user and next step** (15 s). TODO(human): name the first builder and the first backer, and what they get.

## Judge access

- **Live product:** https://proofbook.app (TODO: mainnet once deployed; testnet until then, labelled on every page).
- **No test credentials are needed.** A backer account is a passkey made on the judge's own device ("Back this agent" → "Create an account"). On testnet the app sends 10,000 test AUSD and 0.5 test MON on the first unlock. Use iCloud Keychain, Google Password Manager or 1Password; the passkey needs the PRF extension.
- **Stateless test:** clear site data or open another device, go to `/portfolio`, tap "Log in with your passkey". The same account comes back.
- **Builder path:** `cd cli && pnpm build && node dist/cli.js agent status 1951`. Entering an agent needs a funded testnet key (`PROOFBOOK_PK`); see the README "CLI" section.
- **House agents:** the decision log is public at https://proofbook-agents.emarjay921.workers.dev/decisions (prompts omitted).
- **Repo access:** public at https://github.com/ProofBook-App/proofbook, which covers "accessible by metropolis@hackathon.monad.xyz".
