// House agents are ours, and the leaderboard and preview images must say so plainly (spec §9).
// Nothing onchain marks an agent as ours, so they are listed here by chain and ERC-8004 agent id.
const HOUSE_AGENTS: Record<number, Record<string, { name: string }>> = {
  10143: {
    "1951": { name: "House agent 1" }, // PerplAdapter, AUSD vault 0x98e2…2B53 (README, Testnet)
  },
};

export function houseAgent(chainId: number, agentId: string) {
  return HOUSE_AGENTS[chainId]?.[agentId];
}
