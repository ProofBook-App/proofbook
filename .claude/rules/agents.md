---
paths:
  - "agents/**"
  - "cli/**"
  - "plugin/**"
---

# Agents, CLI and plugin rules

- **Default LLM: Kimi K2.6 on Cloudflare Workers AI** (we have a paid Cloudflare plan). This counts as "genuinely powered by KIMI" for the Kimi bounty; the bounty also needs a published blog post.
  - Model `@cf/moonshotai/kimi-k2.6`: tool calling, reasoning, 262k context. Also available: `@cf/moonshotai/kimi-k2.7-code`.
  - OpenAI-compatible base URL `https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai/v1` with `Authorization: Bearer $CLOUDFLARE_API_TOKEN`. Inside a Worker, use the `env.AI.run()` binding instead.
  - K2.6 controls reasoning with `chat_template_kwargs.thinking` and returns it in the `reasoning` field (K2.5 used different names).
- **LLM clients:** Workers AI, Qwen and Kimi (Moonshot direct) are all OpenAI-compatible. Use one client and swap `baseURL`. Qwen is still usable, but its bounty is Track 04-locked.
  - Qwen: `https://dashscope-us.aliyuncs.com/compatible-mode/v1`, model `qwen3.8-max`
  - Kimi: `https://api.moonshot.ai/v1`, model `kimi-k3`. Kimi differs slightly from OpenAI on `temperature`, `tool_choice` and thinking handling.
- **LLM output is advisory.** Validate every proposed action against the envelope off-chain before signing. The vault enforces it again onchain.
- **Logging:** log prompt, response, decision and tx hash for every step. That log is the auditable track record.
- **Gas:** set an explicit, tight gas limit on every tx. Monad charges the full limit, so padded estimates waste MON.
- **MetaMask Agent Wallet:**
  - CLI `mm` (`npm i -g @metamask/agent-wallet`, Node ≥ 22.18). Run `mm doctor` first.
  - Skills: https://github.com/MetaMask/agent-skills
  - Claude Code plugin: `metamask-agent-wallet@metamask`
  - Our plugin lets an `mm` wallet act as a Proofbook session key and drive `proofbook agent create|fund|run|freeze`.
- **House-agent session keys live in Privy server wallets** with a Privy policy (allowlist the vault `execute` target and cap value). This is our Privy bounty entry ("beyond login"). The agent loop signs through Privy and never holds a raw key. Show the policy in the demo.
- **House agents:** keep strategies simple and explainable (momentum, mean reversion, random-walk control). Don't coordinate them with each other or trade them against each other.
