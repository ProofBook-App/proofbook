// House agents are ours, and the leaderboard and preview images must say so plainly (spec §9).
// Nothing onchain marks an agent as ours, so they are listed here by chain and ERC-8004 agent id.
// `slug` names the ERC-8004 registration file the agent's agentURI points at (/agents/<slug>.json),
// and `strategy` is the one-line public strategy it carries.
type House = { name: string; slug?: string; strategy?: string };
const HOUSE_AGENTS: Record<number, Record<string, House>> = {
  10143: {
    // PerplAdapter, AUSD vault 0x6b2a…76Df on registry 0xD791…b6cD, with every security fix (README, Testnet).
    // agentURI https://proofbook.app/agents/house-1.json
    "2000": {
      name: "House agent 1",
      slug: "house-1",
      strategy:
        "Momentum on the MON perpetual at 1x: opens 25 AUSD in the direction of a 1% move over 30 minutes, closes on a 0.5% move back. Kimi K2.6 applies the rule every 5 minutes; a Privy wallet signs.",
    },
    // The first house agent 1, on the 2026-09-29 registry 0x25D4…8ABC (vault 0x98e2…2B53), replaced by #2000 on
    // 2026-10-04. agentURI https://proofbook.app/agents/house-1-old.json
    "1951": {
      name: "House agent 1 (old registry)",
      slug: "house-1-old",
      strategy: "Replaced on 2026-10-04 by agent #2000, which runs the same momentum rule on the registry with the security fixes.",
    },
    "1976": { name: "CLI test agent" }, // ours: entered, traded and frozen by the CLI's testnet run (README, CLI)
  },
};

export function houseAgent(chainId: number, agentId: string) {
  return HOUSE_AGENTS[chainId]?.[agentId];
}

/** The house agent whose registration file is /agents/<slug>.json, on this chain. */
export function houseAgentBySlug(chainId: number, slug: string) {
  const hit = Object.entries(HOUSE_AGENTS[chainId] ?? {}).find(([, a]) => a.slug === slug);
  return hit ? { agentId: hit[0], ...hit[1] } : undefined;
}
