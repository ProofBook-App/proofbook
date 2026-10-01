import { type CommandIO, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";
import { AgentWalletSigner, agentIdInput, guard, network, networkInputs, proofbook } from "../../../shared.js";

const inputs = { ...agentIdInput, ...networkInputs };

// `mm proofbook agent freeze <agentId>`: the kill switch. Only the agent owner or the guardian.
export default class ProofbookAgentFreeze extends PluginCommand<Record<string, unknown>> {
  static override requiresAuth = true;
  static override description =
    "Freeze a Proofbook agent's vault (kill switch). The active wallet must be the agent owner or the guardian. Backers can still withdraw";
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "proofbook:agent:freeze";

  async execute(io: CommandIO) {
    const i = await io.resolveInputs(inputs);
    const net = network(i.network, i.rpc);
    const signer = new AgentWalletSigner(this.ctx, io, this.pluginCommandId, net);
    return guard(() => proofbook(net, i.registry, signer, io).freeze(BigInt(i.agentId)));
  }
}
