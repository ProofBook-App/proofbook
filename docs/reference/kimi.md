# Kimi on Cloudflare Workers AI

Firsthand spike, 2026-09-29 (`spikes/kimi/`).

- **Models in the catalog:** `@cf/moonshotai/kimi-k2.6` and `@cf/moonshotai/kimi-k2.7-code` (both 262.1k context). House agents use `kimi-k2.6`.
- **Tool calls work through the `AI` binding** with OpenAI-style `messages` + `tools`. The response is OpenAI-shaped: `choices[0].message.tool_calls[]` with `function.name`, `function.arguments` (a JSON *string*) and ids like `functions.get_market:0`. Tool results go back as `{role: "tool", tool_call_id, name, content}`.
- **Result:** given a fixed public rule (MON 1h change > +2% → long, $50 cap), the model called `get_market`, then `place_order {MON, open_long, 50, reason}`. Correct, within the cap, and the `reason` is usable as the public trade note.
- **Latency:** about 3 s per model call, about 6 s for a full round (read, then act).
- **Cost:** about 104 neurons per round (48 + 56; 391 + 479 tokens, most of the prompt cached). Check the current Workers AI free allowance and price before sizing the loop; a round every 15 min is about 96 rounds, or about 10k neurons, a day per agent.
- **Honesty guard:** the model only proposes. The vault still enforces `maxTradeNotional`, the adapters enforce the price band, and the agent's strategy prompt is published with the agent, so a bad model call can't exceed the envelope.
- **Kimi bounty:** needs a published article on how Kimi was used (spec §7).
