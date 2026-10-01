#!/usr/bin/env node
// proofbook: enter, fund, run and freeze Proofbook agents on Monad.
// Results print as JSON on stdout; progress goes to stderr. Testnet (10143) unless --network mainnet.
import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { isAddress, type Address } from "viem";
import { NETWORKS, resolveNetwork, addressUrl } from "./networks.js";
import { Proofbook } from "./proofbook.js";
import { runStep, type Action, type StepState } from "./run.js";
import { makeSigner } from "./signer.js";

const HELP = `proofbook: enter, fund, run and freeze Proofbook trading agents on Monad

Usage:
  proofbook chains
  proofbook agent status <agentId>
  proofbook agent create --uri <agentURI> [--session-key <addr>] [--max-trade 100] [--daily-loss-bps 1000] [--deposit-cap 500]
  proofbook agent fund <agentId> <amount>
  proofbook agent run <agentId> [--live] [--once] [--interval 60] [--action auto|deposit|long|close] [--size 10] [--margin <amt>] [--threshold-bps 20] [--log <file>]
  proofbook agent freeze <agentId>
  proofbook faucet [--to <addr>]                testnet AUSD from Agora's faucet

Options:
  --network testnet|mainnet   default testnet (10143). Mainnet (143) only when passed explicitly.
  --signer mm|env             mm (default): every tx through the MetaMask Agent Wallet CLI.
                              env: PROOFBOOK_PK from the environment (local development only).
  --wallet-timeout <sec>      how long mm waits for a wallet job, 2FA approval included (max 600)
  --rpc <url>                 override the RPC URL
  --registry <addr>           override the AgentRegistry address
  -h, --help

Amounts are in the vault asset (AUSD, 6 decimals; decimals are read from the token).
Every transaction is simulated first and sent with an explicit gas limit of estimate + 5%.
'agent run' is a dry run (decide, check, simulate, log) unless --live is passed.
`;

const { values: f, positionals: pos } = parseArgs({
  allowPositionals: true,
  options: {
    network: { type: "string" },
    signer: { type: "string", default: "mm" },
    "wallet-timeout": { type: "string" },
    rpc: { type: "string" },
    registry: { type: "string" },
    uri: { type: "string" },
    "session-key": { type: "string" },
    "max-trade": { type: "string", default: "100" },
    "daily-loss-bps": { type: "string", default: "1000" },
    "deposit-cap": { type: "string", default: "500" },
    "agent-id": { type: "string" },
    adapter: { type: "string" },
    live: { type: "boolean", default: false },
    once: { type: "boolean", default: false },
    interval: { type: "string", default: "60" },
    action: { type: "string", default: "auto" },
    size: { type: "string", default: "10" },
    margin: { type: "string" },
    "threshold-bps": { type: "string", default: "20" },
    log: { type: "string" },
    to: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});

const out = (x: unknown) =>
  process.stdout.write(JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
const progress = (e: Record<string, unknown>) => {
  if (e.event === "send") process.stderr.write(`→ ${e.step}: sending (gas limit ${e.gasLimit})\n`);
  else if (e.event === "mined") process.stderr.write(`✓ ${e.step}: ${e.url} (gas used ${e.gasUsed})\n`);
};

function addr(v: string | undefined, name: string): Address | undefined {
  if (v === undefined) return undefined;
  if (!isAddress(v)) throw new Error(`${name} must be an address, got ${v}`);
  return v;
}

function agentId(v: string | undefined): bigint {
  if (!v || !/^\d+$/.test(v)) throw new Error("Pass the agent's ERC-8004 id, e.g. `proofbook agent status 1951`.");
  return BigInt(v);
}

async function main() {
  if (f.help || pos.length === 0) return void process.stdout.write(HELP);
  const network = resolveNetwork(f.network, f.rpc);
  if (network.name === "mainnet") process.stderr.write("! mainnet (143): real money\n");

  const [cmd, sub, a1, a2] = pos;
  if (cmd === "chains") {
    return out(
      Object.values(NETWORKS).map((n) => ({
        network: n.name,
        chainId: n.chainId,
        default: n.name === "testnet",
        registry: n.registry ?? "not deployed",
        identity: n.identity,
        ausd: n.ausd,
        perplExchange: n.perplExchange,
        explorer: n.registry ? addressUrl(n, n.registry) : n.explorer,
      })),
    );
  }

  const registry = addr(f.registry, "--registry");
  const reads = () => new Proofbook(network, undefined, progress, registry);
  const writes = () => {
    const timeout = f["wallet-timeout"] ? Number(f["wallet-timeout"]) : undefined;
    return new Proofbook(network, makeSigner(f.signer!, network, { walletTimeout: timeout }), progress, registry);
  };

  if (cmd === "faucet") return out(await writes().faucet(addr(f.to, "--to")));
  if (cmd !== "agent") throw new Error(`Unknown command "${cmd}". Run proofbook --help.`);

  switch (sub) {
    case "status":
      return out(await reads().status(agentId(a1)));
    case "create": {
      if (!f.uri) throw new Error("--uri is required: the ERC-8004 agentURI, e.g. https://example.com/my-agent.json");
      return out(
        await writes().create({
          agentURI: f.uri,
          sessionKey: addr(f["session-key"], "--session-key"),
          maxTrade: f["max-trade"]!,
          dailyLossBps: Number(f["daily-loss-bps"]),
          depositCap: f["deposit-cap"]!,
          agentId: f["agent-id"] ? agentId(f["agent-id"]) : undefined,
          adapter: addr(f.adapter, "--adapter"),
        }),
      );
    }
    case "fund":
      if (!a2) throw new Error("Usage: proofbook agent fund <agentId> <amount>");
      return out(await writes().fund(agentId(a1), a2));
    case "freeze":
      return out(await writes().freeze(agentId(a1)));
    case "run":
      return run(agentId(a1), f.live ? writes() : reads());
    default:
      throw new Error(`Unknown agent command "${sub}". Use create, fund, run, freeze or status.`);
  }
}

async function run(id: bigint, pb: Proofbook) {
  const action = f.action as Action;
  if (!["auto", "deposit", "long", "close"].includes(action)) throw new Error("--action is auto, deposit, long or close");
  const once = f.once || action !== "auto";
  const interval = Math.max(5, Number(f.interval)) * 1000;
  const logFile = f.log ?? `proofbook-run-${id}.jsonl`;
  const state: StepState = {};
  process.stderr.write(`${f.live ? "LIVE" : "dry run"}: agent #${id} on ${pb.network.name}, log ${logFile}\n`);
  for (let tick = 1; ; tick++) {
    let step: Record<string, unknown>;
    try {
      step = await runStep(
        pb,
        {
          agentId: id,
          dryRun: !f.live,
          action,
          size: f.size!,
          margin: f.margin,
          thresholdBps: Number(f["threshold-bps"]),
        },
        state,
      );
    } catch (e) {
      step = { agentId: id.toString(), decision: "error", reason: e instanceof Error ? e.message : String(e) };
    }
    const line = { ts: new Date().toISOString(), tick, ...step };
    appendFileSync(logFile, JSON.stringify(line, (_, v) => (typeof v === "bigint" ? v.toString() : v)) + "\n");
    out(line);
    if (once || step.stop) return;
    await new Promise((r) => setTimeout(r, interval));
  }
}

main().catch((e) => {
  process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
