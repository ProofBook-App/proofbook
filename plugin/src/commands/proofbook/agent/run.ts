import { type CommandIO, InputFieldType, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";
import { runStep, type Action, type StepState } from "proofbook";
import { AgentWalletSigner, agentIdInput, guard, network, networkInputs, proofbook } from "../../../shared.js";

const inputs = {
  ...agentIdInput,
  live: {
    type: InputFieldType.Boolean,
    flag: "live",
    message: "Send transactions. Without it the step is a dry run: decide, check, simulate, log",
    required: false,
    prompt: false,
    default: false,
  },
  action: {
    type: InputFieldType.Select,
    flag: "action",
    message: "auto (momentum strategy), or force one action",
    required: false,
    prompt: false,
    options: [
      { value: "auto", label: "auto: momentum on Perpl's MON mark" },
      { value: "deposit", label: "deposit: move margin into Perpl" },
      { value: "long", label: "long: open a MON long of --size" },
      { value: "close", label: "close: close the whole MON long" },
    ],
  },
  ticks: { type: InputFieldType.Text, flag: "ticks", message: "Steps to run (default 1)", required: false, prompt: false },
  interval: { type: InputFieldType.Text, flag: "interval", message: "Seconds between steps (default 60)", required: false, prompt: false },
  size: { type: InputFieldType.Text, flag: "size", message: "Long size in the vault asset (default 10)", required: false, prompt: false },
  margin: { type: InputFieldType.Text, flag: "margin", message: "Margin to move into Perpl (default: Perpl's minimum account open)", required: false, prompt: false },
  thresholdBps: { type: InputFieldType.Text, flag: "threshold-bps", message: "Momentum threshold in bps (default 20)", required: false, prompt: false },
  ...networkInputs,
};

type Step = Record<string, unknown>;

// `mm proofbook agent run <agentId>`: the Agent Wallet acts as the vault's session key and calls
// vault.execute(adapter, data). Each step is yielded as one JSON line: observation, decision,
// reason, checks and tx hash. A bounded number of ticks, so it never runs unattended forever.
export default class ProofbookAgentRun extends PluginCommand<{ steps: Step[] }, Step> {
  static override requiresAuth = true;
  static override description =
    "Run a Proofbook agent with this Agent Wallet as its session key (dry run unless --live). Momentum on Perpl MON, 1x, long-only";
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "proofbook:agent:run";

  async execute(io: CommandIO<Step>) {
    const i = await io.resolveInputs(inputs);
    const net = network(i.network, i.rpc);
    const action = (i.action || "auto") as Action;
    const live = i.live === true;
    const signer = live ? new AgentWalletSigner(this.ctx, io as CommandIO<never>, this.pluginCommandId, net) : undefined;
    const pb = proofbook(net, i.registry, signer, io as CommandIO<never>);
    const ticks = action === "auto" ? Math.min(Math.max(Number(i.ticks || "1"), 1), 1440) : 1;
    const interval = Math.max(Number(i.interval || "60"), 5) * 1000;
    const state: StepState = {};
    const steps: Step[] = [];
    for (let tick = 1; tick <= ticks && !io.signal.aborted; tick++) {
      const step: Step = await guard(() =>
        runStep(
          pb,
          {
            agentId: BigInt(i.agentId),
            dryRun: !live,
            action,
            size: i.size || "10",
            margin: i.margin || undefined,
            thresholdBps: Number(i.thresholdBps || "20"),
          },
          state,
        ),
      );
      const line = JSON.parse(JSON.stringify({ ts: new Date().toISOString(), tick, ...step }, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
      io.yield(line);
      steps.push(line);
      if (step.stop || tick === ticks) break;
      await new Promise((r) => setTimeout(r, interval));
    }
    return { steps };
  }
}
