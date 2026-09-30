# Proofbook voice

How Proofbook writes: the site, the README, the pitch video, X posts and the Kimi article. The aim is copy a careful person would write, not copy that reads like a model wrote it. The banned list comes from Wikipedia's "Signs of AI writing" guide (https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) plus the landing-page tells we kept seeing.

## Who we sound like

An auditor who likes traders. Plain, exact, a little dry. We state what the contract does and let the reader decide. Confidence comes from numbers and mechanisms, not adjectives.

## Rules

1. **Say what happens, with the number.** "A trade over $100 reverts", not "strict risk controls".
2. **Use "is".** Not "serves as", "stands as", "represents", "functions as", "boasts", "features".
3. **Name the thing the same way every time.** An agent is an agent. Don't rotate "bot", "trader", "strategy", "AI" for variety. The words we use:
   - *agent*: the AI trader. *builder*: whoever enters it. *backer*: whoever deposits.
   - *vault*: where backer money sits. *limits*: the rules in the vault (per-trade cap, daily loss cap, venues, deposit cap).
   - *freeze*: what the vault does when the daily loss cap is hit. *record*: the agent's onchain history.
4. **Say what we don't do.** The vault is unaudited. House agents are ours and labelled. Deposits are capped. Saying it early is part of the brand.
5. **Sentence case everywhere.** Headings, buttons, nav. No Title Case, no ALL CAPS labels.
6. **Buttons say exactly what happens.** "Back this agent", "Enter your agent", "Withdraw". The toast repeats the verb: "Withdrawn".
7. **Short sentences, but not all short.** Vary the length. Don't stack three-word punchlines.
8. **No claims we can't point to.** No user counts, returns or partner logos until they exist and link to a source.

## Banned

Words: delve, tapestry, testament, pivotal, crucial, vital, landscape, realm, intricate, meticulous, vibrant, robust, seamless, seamlessly, cutting-edge, groundbreaking, revolutionary, game-changer, unlock, unleash, empower, elevate, supercharge, harness, leverage (as a verb), foster, bolster, underscore, showcase, enhance, navigate (outside navigation), journey, ecosystem (unless it means Monad's), next-generation, state-of-the-art, effortless, "in today's fast-paced world".

Structures:
- **"Not X, it's Y" and "not just X, but Y".** Say Y.
- **Rule of three.** Lists of three adjectives or three parallel clauses. Use two, or four, or one.
- **Trailing "-ing" clauses** that add fake significance: "…, ensuring your funds stay safe." Make it its own sentence with a subject, or cut it.
- **Significance inflation:** "marks a shift", "sets the stage", "the future of trading".
- **Vague attribution:** "experts say", "traders agree".
- **Rhetorical questions as openers.** "Tired of black-box bots?"
- **Colon reveals and one-word dramatic sentences.** "The result? Trust." Cut.

Punctuation and formatting:
- No em dashes in product copy. Use a comma, a full stop or brackets.
- No emoji as bullets. No bold inside running sentences.
- No "A · B · C" meta strings, no "→" on buttons or links.
- No eyebrow labels above headings unless they carry information a reader needs.

## Check before shipping copy

Read it aloud. If a sentence would fit a competitor's site after swapping the name, rewrite it with a number or a mechanism only Proofbook has (the vault freezes in the same transaction, ERC-8004 identity, the session key can't withdraw).
