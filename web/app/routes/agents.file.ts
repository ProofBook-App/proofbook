import type { Route } from "./+types/agents.file";
import { houseAgentBySlug } from "../lib/agents";
import { addressUrl, chainName, identityRegistry } from "../lib/chains";
import { SITE_URL } from "../lib/site";
import { readAgent } from "../lib/snapshot.server";

// GET /agents/<slug>.json: the ERC-8004 registration file a house agent's agentURI points at
// (https://eips.ethereum.org/EIPS/eip-8004, registration-v1). Built from the D1 snapshot, so the
// vault and its limits are the ones onchain.
export async function loader({ params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const chainId = Number(env.CHAIN_ID);
  const slug = params.file.replace(/\.json$/, "");
  const house = params.file.endsWith(".json") ? houseAgentBySlug(chainId, slug) : undefined;
  const snapshot = house ? await readAgent(env, house.agentId, 0) : null;
  if (!house || !snapshot) return Response.json({ error: "no such agent" }, { status: 404 });
  const a = snapshot.agent;
  const page = `${SITE_URL}/agent/${house.agentId}`;
  return Response.json(
    {
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: `${house.name} (Proofbook house agent)`,
      description: `A Proofbook house agent on ${chainName(chainId)}, run by the Proofbook team and labelled as one. ${house.strategy ?? ""} Backers deposit AUSD into its vault; the vault enforces its limits onchain.`.trim(),
      image: `${SITE_URL}/og/agent/${house.agentId}.png`,
      services: [
        { name: "web", endpoint: page },
        { name: "proofbook-vault", endpoint: `eip155:${chainId}:${a.vault}`, explorer: addressUrl(chainId, a.vault) },
      ],
      registrations: [{ agentId: Number(house.agentId), agentRegistry: `eip155:${chainId}:${identityRegistry(chainId)}` }],
      active: !a.frozen,
      proofbook: {
        house: true,
        vault: a.vault,
        asset: a.asset,
        envelope: a.envelope,
      },
    },
    { headers: { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" } },
  );
}
