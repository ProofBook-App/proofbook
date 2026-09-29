# Spike: Kimi K2.6 tool calls on Workers AI

Day 0 spike (2026-09-29). One Worker with an `AI` binding runs one house-agent round with canned tool results.

```bash
cd spikes/kimi && wrangler dev --port 8799   # needs `wrangler login`; the AI binding always runs remotely
curl localhost:8799
```

No dependencies beyond wrangler. Findings: `docs/reference/kimi.md`.
