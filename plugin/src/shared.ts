// Shared plumbing for the Proofbook mm commands.
//
// Signing: every transaction goes through `ctx.walletExecutor` (the `wallet-submit` capability), the
// same executor `mm wallet send-transaction` uses. MetaMask policy, Guard mode and 2FA apply; this
// plugin never sees a key, a session token or the SRP. Reads go to the Monad RPC directly.
import { CommandError, InputFieldType, type CommandIO, type InputSchema } from "@metamask/agent-wallet/plugin";
import { Proofbook, resolveNetwork, type Network, type Signer, type TxRequest } from "proofbook";
import { isAddress, type Address, type Hash } from "viem";

/** Inputs every command takes. Testnet unless --network mainnet is passed explicitly. */
export const networkInputs = {
  network: {
    type: InputFieldType.Text,
    flag: "network",
    message: "testnet (10143, default) or mainnet (143)",
    required: false,
    prompt: false,
  },
  rpc: { type: InputFieldType.Text, flag: "rpc", message: "Override the Monad RPC URL", required: false, prompt: false },
  registry: {
    type: InputFieldType.Text,
    flag: "registry",
    message: "Override the Proofbook AgentRegistry address",
    required: false,
    prompt: false,
  },
} satisfies InputSchema;

export const agentIdInput = {
  agentId: {
    type: InputFieldType.Text,
    flag: "agent-id",
    message: "The agent's ERC-8004 id (e.g. 1951)",
    required: true,
    prompt: true,
    index: 0,
    validate: (v: string) => /^\d+$/.test(v) || "an ERC-8004 agent id is a whole number",
  },
} satisfies InputSchema;

export function network(flag: string | undefined, rpc: string | undefined): Network {
  try {
    return resolveNetwork(flag || undefined, rpc || undefined);
  } catch (e) {
    throw new CommandError("INVALID_NETWORK", (e as Error).message, "Pass --network testnet or --network mainnet.");
  }
}

export function optionalAddress(v: string | undefined, name: string): Address | undefined {
  if (!v) return undefined;
  if (!isAddress(v)) throw new CommandError("INVALID_ADDRESS", `${name} must be an address, got ${v}.`, `Pass a 0x address to ${name}.`);
  return v;
}

/** What the plugin needs from the restricted context (typed loosely: the SDK types are host-internal). */
type Ctx = {
  walletStateManager: { read(): unknown };
  walletExecutor: (io: CommandIO<never>, source: string) => Promise<(intent: unknown, opts?: unknown) => Promise<unknown>>;
};

/** Signs through the Agent Wallet's wallet executor. */
export class AgentWalletSigner implements Signer {
  readonly kind = "agent-wallet";
  // Matches `mm wallet send-transaction`, whose payload requires `to`. See README "Known gaps".
  readonly canDeploy = false;

  constructor(
    readonly ctx: Ctx,
    readonly io: CommandIO<never>,
    readonly commandId: string,
    readonly net: Network,
  ) {}

  async address(): Promise<Address> {
    const s = this.ctx.walletStateManager.read() as {
      selectedWallet?: { address?: string };
      remoteWallets?: { address?: string }[];
      byokWallets?: { address?: string }[];
    };
    const a = s.selectedWallet?.address ?? s.remoteWallets?.[0]?.address ?? s.byokWallets?.[0]?.address;
    if (!a || !isAddress(a)) throw new CommandError("NO_WALLET", "No active Agent Wallet.", "Run `mm init` first.");
    return a;
  }

  async send(tx: TxRequest, summary: string): Promise<Hash> {
    if (!tx.to) {
      throw new CommandError(
        "UNSUPPORTED_DEPLOY",
        "The Agent Wallet does not send contract-creation transactions.",
        "See the plugin README, Known gaps.",
      );
    }
    const execute = await this.ctx.walletExecutor(this.io, this.commandId);
    const result = (await execute(
      {
        kind: "transaction",
        chainId: this.net.chainId,
        transaction: {
          to: tx.to,
          data: tx.data,
          value: tx.value,
          gas: tx.gas,
          ...(tx.maxFeePerGas !== undefined ? { maxFeePerGas: tx.maxFeePerGas } : {}),
          ...(tx.maxPriorityFeePerGas !== undefined ? { maxPriorityFeePerGas: tx.maxPriorityFeePerGas } : {}),
        },
        intent: { action: "custom", summary },
      },
      { signal: this.io.signal },
    )) as { kind?: string; hash?: Hash; status?: string; failureDescription?: string; pendingJob?: { pollingId?: string } };
    if (!result.hash) {
      const job = result.pendingJob?.pollingId;
      throw new CommandError(
        "TX_NOT_SENT",
        `The Agent Wallet returned no tx hash (status ${result.status ?? "unknown"}${result.failureDescription ? `: ${result.failureDescription}` : ""}).`,
        job ? `Track it with: mm wallet requests watch ${job}` : "Run with --verbose for details.",
      );
    }
    return result.hash;
  }
}

export function proofbook(net: Network, registry: string | undefined, signer?: Signer, io?: CommandIO<never>) {
  try {
    return new Proofbook(
      net,
      signer,
      (e) => {
        if (!io) return;
        if (e.event === "send") io.progress(`${e.step}: waiting for the Agent Wallet (gas limit ${e.gasLimit})`);
        if (e.event === "mined") {
          io.progress();
          io.emit(`${e.step}: ${e.url}`);
        }
      },
      optionalAddress(registry, "--registry"),
    );
  } catch (e) {
    throw new CommandError("NOT_DEPLOYED", (e as Error).message, "Use --network testnet, or pass --registry.");
  }
}

/** Turns thrown errors into a CommandError with a code and a hint. */
export async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    throw new CommandError("PROOFBOOK_ERROR", e instanceof Error ? e.message : String(e), "Run `mm proofbook agent status <id>` to check the agent.");
  }
}
