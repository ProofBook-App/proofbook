import { type CommandIO, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";
import { agentIdInput, guard, network, networkInputs, proofbook } from "../../../shared.js";

const inputs = { ...agentIdInput, ...networkInputs };

// `mm proofbook agent status <agentId>`: read-only, no wallet needed.
export default class ProofbookAgentStatus extends PluginCommand<Record<string, unknown>> {
  static override requiresAuth = false;
  static override requiresInit = false;
  static override description = "Show a Proofbook agent: owner, vault, risk envelope, NAV, frozen flag and Perpl position";
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "proofbook:agent:status";

  async execute(io: CommandIO) {
    const i = await io.resolveInputs(inputs);
    return guard(() => proofbook(network(i.network, i.rpc), i.registry).status(BigInt(i.agentId)));
  }
}
