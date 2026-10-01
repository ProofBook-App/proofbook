import { type CommandIO, InputFieldType, PluginCommand, schemaToFlags } from "@metamask/agent-wallet/plugin";
import { AgentWalletSigner, guard, network, networkInputs, optionalAddress, proofbook } from "../../../shared.js";

const amount = (v: string) => /^\d+(\.\d+)?$/.test(v) || "a positive decimal amount";

const inputs = {
  uri: {
    type: InputFieldType.Text,
    flag: "uri",
    message: "ERC-8004 agentURI (a JSON file describing the agent)",
    required: true,
    prompt: true,
  },
  sessionKey: {
    type: InputFieldType.Text,
    flag: "session-key",
    message: "Address that trades the vault (default: this Agent Wallet)",
    required: false,
    prompt: false,
  },
  maxTrade: { type: InputFieldType.Text, flag: "max-trade", message: "Max notional per trade (default 100)", required: false, prompt: false, validate: amount },
  dailyLossBps: {
    type: InputFieldType.Text,
    flag: "daily-loss-bps",
    message: "Daily loss cap in basis points (default 1000 = 10%)",
    required: false,
    prompt: false,
  },
  depositCap: { type: InputFieldType.Text, flag: "deposit-cap", message: "Deposit cap per backer (default 500)", required: false, prompt: false, validate: amount },
  agentId: {
    type: InputFieldType.Text,
    flag: "agent-id",
    message: "Resume: an ERC-8004 id this wallet already registered",
    required: false,
    prompt: false,
  },
  adapter: {
    type: InputFieldType.Text,
    flag: "adapter",
    message: "Resume: a PerplAdapter this wallet already deployed",
    required: false,
    prompt: false,
  },
  ...networkInputs,
};

// `mm proofbook agent create --uri …`: register the ERC-8004 identity, deploy the PerplAdapter,
// enter the agent with its risk envelope, bind the adapter. Mirrors contracts/script/HouseAgent.s.sol.
export default class ProofbookAgentCreate extends PluginCommand<Record<string, unknown>> {
  static override requiresAuth = true;
  static override description =
    "Enter a new agent into Proofbook: ERC-8004 identity, risk envelope, vault and PerplAdapter, all signed by the Agent Wallet";
  static override flags = schemaToFlags(inputs);
  protected readonly pluginCommandId = "proofbook:agent:create";

  async execute(io: CommandIO) {
    const i = await io.resolveInputs(inputs);
    const net = network(i.network, i.rpc);
    const signer = new AgentWalletSigner(this.ctx, io, this.pluginCommandId, net);
    return guard(() =>
      proofbook(net, i.registry, signer, io).create({
        agentURI: i.uri,
        sessionKey: optionalAddress(i.sessionKey, "--session-key"),
        maxTrade: i.maxTrade || "100",
        dailyLossBps: Number(i.dailyLossBps || "1000"),
        depositCap: i.depositCap || "500",
        agentId: i.agentId ? BigInt(i.agentId) : undefined,
        adapter: optionalAddress(i.adapter, "--adapter"),
      }),
    );
  }
}
