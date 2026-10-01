import { type CommandIO, InputFieldType, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";
import { AgentWalletSigner, agentIdInput, guard, network, networkInputs, proofbook } from "../../../shared.js";

const inputs = {
  ...agentIdInput,
  amount: {
    type: InputFieldType.Text,
    flag: "amount",
    message: "Amount of the vault asset to deposit (AUSD, e.g. 5)",
    required: true,
    prompt: true,
    index: 1,
    validate: (v: string) => /^\d+(\.\d+)?$/.test(v) || "a positive decimal amount, e.g. 5 or 12.5",
  },
  ...networkInputs,
};

// `mm proofbook agent fund <agentId> <amount>`: approve exactly `amount`, then deposit it.
export default class ProofbookAgentFund extends PluginCommand<Record<string, unknown>> {
  static override requiresAuth = true;
  static override description =
    "Back a Proofbook agent: approve exactly the amount, then deposit it into the agent's vault (two Agent Wallet transactions)";
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "proofbook:agent:fund";

  async execute(io: CommandIO) {
    const i = await io.resolveInputs(inputs);
    const net = network(i.network, i.rpc);
    const signer = new AgentWalletSigner(this.ctx, io, this.pluginCommandId, net);
    return guard(() => proofbook(net, i.registry, signer, io).fund(BigInt(i.agentId), i.amount));
  }
}
