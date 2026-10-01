// Who signs. Two backends:
// - mm:  every transaction goes through the MetaMask Agent Wallet CLI (`mm wallet send-transaction`).
//        The CLI never sees a key; MetaMask's policy, Guard mode and 2FA apply as usual.
// - env: a local key from PROOFBOOK_PK or PROOFBOOK_PK_FILE, for development and tests only.
// The mm plugin (plugin/) adds a third, built on the Agent Wallet's in-process wallet executor.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createWalletClient, http, toHex, type Address, type Hash, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainOf, type Network } from "./networks.js";

export type TxRequest = {
  /** Undefined for a contract creation. */
  to?: Address;
  data: Hex;
  value: bigint;
  gas: bigint;
  /** EIP-1559 fees read from our own RPC. mm's gas-fee API rejects Monad testnet ("Invalid chainId"). */
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
};

export interface Signer {
  readonly kind: string;
  address(): Promise<Address>;
  /** Signs and broadcasts; resolves with the tx hash once it is broadcast. `intent` is a one-line summary. */
  send(tx: TxRequest, intent: string): Promise<Hash>;
  /** False when the backend cannot send a transaction without a `to` (contract creation). */
  readonly canDeploy: boolean;
}

export class EnvSigner implements Signer {
  readonly kind = "env";
  readonly canDeploy = true;
  readonly #wallet;

  constructor(network: Network, pk = process.env.PROOFBOOK_PK ?? readKeyFile(process.env.PROOFBOOK_PK_FILE)) {
    if (!pk) {
      throw new Error("--signer env needs PROOFBOOK_PK (a private key) or PROOFBOOK_PK_FILE (a file holding one).");
    }
    const key = (pk.startsWith("0x") ? pk : `0x${pk}`) as Hex;
    this.#wallet = createWalletClient({ account: privateKeyToAccount(key), chain: chainOf(network), transport: http(network.rpc) });
  }

  async address() {
    return this.#wallet.account.address;
  }

  async send(tx: TxRequest) {
    return this.#wallet.sendTransaction({
      to: tx.to ?? null,
      data: tx.data,
      value: tx.value,
      gas: tx.gas,
      maxFeePerGas: tx.maxFeePerGas,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
    });
  }
}

function readKeyFile(path: string | undefined) {
  return path ? readFileSync(path, "utf8").trim() : undefined;
}

type MmResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; hint?: string } };

export type MmOptions = {
  /** Binary to run. Default `mm`. */
  bin?: string;
  /** Seconds to wait for a wallet job, MFA approval included (mm caps it at 600). */
  walletTimeout?: number;
  /** Where to report `[AWAITING_MFA]` and other notices while a transaction waits. */
  onNotice?: (notice: Record<string, unknown>) => void;
};

/** MetaMask Agent Wallet via the `mm` CLI (v7.0.0, JSON output). */
export class MmSigner implements Signer {
  readonly kind = "mm";
  // `mm wallet send-transaction` requires a `to` address (MISSING_TO), so it cannot create contracts.
  readonly canDeploy = false;
  #address?: Address;

  constructor(
    readonly network: Network,
    readonly opts: MmOptions = {},
  ) {}

  async address() {
    if (!this.#address) {
      const r = await runMm<{ address: Address }>(this.opts, ["wallet", "address", "--json"]);
      this.#address = r.address;
    }
    return this.#address;
  }

  async send(tx: TxRequest, intent: string) {
    if (!tx.to) throw new Error("mm cannot send a contract-creation transaction (its payload requires `to`).");
    const payload = {
      to: tx.to,
      data: tx.data,
      value: toHex(tx.value),
      gas: toHex(tx.gas),
      ...(tx.maxFeePerGas !== undefined ? { maxFeePerGas: toHex(tx.maxFeePerGas) } : {}),
      ...(tx.maxPriorityFeePerGas !== undefined ? { maxPriorityFeePerGas: toHex(tx.maxPriorityFeePerGas) } : {}),
    };
    const args = [
      "wallet",
      "send-transaction",
      "--chain-id",
      String(this.network.chainId),
      "--payload",
      JSON.stringify(payload),
      "--intent",
      intent,
      "--wait",
      "--json",
    ];
    if (this.opts.walletTimeout) args.push("--wallet-timeout", String(this.opts.walletTimeout));
    const r = await runMm<{ status?: string; hash?: Hash; failureReason?: string; pollingId?: string }>(this.opts, args);
    if (!r.hash) {
      throw new Error(
        `mm did not return a tx hash (status ${r.status ?? "unknown"}${r.failureReason ? `: ${r.failureReason}` : ""}).` +
          (r.pollingId ? ` Track it with: mm wallet requests watch ${r.pollingId}` : ""),
      );
    }
    return r.hash;
  }
}

/**
 * Runs mm and returns `data` from its final JSON line. Headless mm writes NDJSON: zero or more
 * `{"_notice": …}` lines (e.g. an AWAITING_MFA pause) and then the `{ok, data|error}` result.
 */
async function runMm<T>(opts: MmOptions, args: string[]): Promise<T> {
  const bin = opts.bin ?? "mm";
  const { stdout, stderr, code } = await new Promise<{ stdout: string; stderr: string; code: number | null }>(
    (resolve, reject) => {
      const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      let pending = "";
      child.stdout.on("data", (chunk: Buffer) => {
        out += chunk;
        pending += chunk;
        let nl: number;
        while ((nl = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, nl).trim();
          pending = pending.slice(nl + 1);
          const notice = parseNotice(line);
          if (notice) (opts.onNotice ?? defaultNotice)(notice);
        }
      });
      // mm 7.0.0 on a chain its MetaMask-hosted RPC does not serve (Monad testnet, 10143) logs
      // `Invalid chainId` from its block tracker and then polls forever, past --wallet-timeout.
      // Nothing has reached the wallet at that point, so stop it and say why.
      let unsupported = false;
      child.stderr.on("data", (chunk: Buffer) => {
        err += chunk;
        if (!unsupported && err.includes("Invalid chainId")) {
          unsupported = true;
          child.kill();
        }
      });
      // Backstop for any other hang: the wallet timeout (mm's own cap is 600 s) plus a minute.
      const timer = setTimeout(() => child.kill(), ((opts.walletTimeout ?? 600) + 60) * 1000);
      child.on("error", (e) =>
        reject(new Error(`could not run ${bin} (${e.message}). Install it: npm i -g @metamask/agent-wallet`)),
      );
      child.on("close", (code) => {
        clearTimeout(timer);
        if (unsupported) {
          reject(
            new Error(
              `mm's MetaMask RPC rejects this chain ("Invalid chainId"), so the Agent Wallet cannot sign here. Nothing was signed or sent.`,
            ),
          );
        } else resolve({ stdout: out, stderr: err, code });
      });
    },
  );
  // mm prints the result on stdout when it succeeds and on stderr when it fails.
  const result = lastResult<T>(stdout) ?? lastResult<T>(stderr);
  if (!result) throw new Error(`${bin} ${args[0]} ${args[1]} exited ${code} with no JSON result. ${stderr.trim()}`);
  if (!result.ok) {
    const { code: c, message, hint } = result.error;
    throw new Error(`mm ${c}: ${message}${hint ? ` (${hint})` : ""}`);
  }
  return result.data;
}

function parseNotice(line: string): Record<string, unknown> | undefined {
  if (!line.startsWith("{")) return;
  try {
    const j = JSON.parse(line);
    return j && typeof j === "object" && "_notice" in j ? (j._notice as Record<string, unknown>) : undefined;
  } catch {
    return;
  }
}

/**
 * The result is the last top-level JSON object in the output: an NDJSON line, or a pretty-printed
 * document that may follow log lines and stack traces (on stderr). Try each line that starts a
 * top-level object, from the last one back, and parse to the end.
 */
function lastResult<T>(output: string): MmResult<T> | undefined {
  const lines = output.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i]!.startsWith("{")) continue;
    try {
      const j = JSON.parse(lines.slice(i).join("\n"));
      if (j && typeof j === "object" && "ok" in j) return j;
    } catch {}
  }
}

function defaultNotice(notice: Record<string, unknown>) {
  const kind = String(notice.kind ?? "notice");
  process.stderr.write(`[${kind}] ${String(notice.message ?? JSON.stringify(notice))}\n`);
}

export function makeSigner(kind: string, network: Network, mm: MmOptions = {}): Signer {
  if (kind === "mm") return new MmSigner(network, mm);
  if (kind === "env") return new EnvSigner(network);
  throw new Error(`Unknown signer "${kind}". Use mm (MetaMask Agent Wallet) or env (PROOFBOOK_PK, dev only).`);
}
