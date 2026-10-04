// Worker config from wrangler.jsonc vars and secrets. Secrets are read only in live mode, so a
// dry run (the default) needs no Privy credentials at all.
import { getAddress, isAddress, type Address } from "viem";
import type { PrivySecrets } from "./privy.ts";

export type Mode = "dry-run" | "live";

/** Public, fixed strategies (spec §3 item 8). "random" is the control: a coin anyone can recompute. */
export type Strategy = "momentum" | "mean-reversion" | "random";
const STRATEGIES: Strategy[] = ["momentum", "mean-reversion", "random"];

export type HouseAgent = {
  agentId: string;
  label: string;
  strategy: Strategy;
  vault: Address;
  adapter: Address;
  perpId: bigint;
  /** Size the strategy asks for, and the most it may ask for (AUSD). Both inside maxTradeNotional. */
  sizeAusd: number;
  maxSizeAusd: number;
  /** The mark move over the lookback that opens a position; half of it closes one (momentum, mean reversion). */
  thresholdBps: number;
  lookbackMinutes: number;
  privyWalletId?: string;
  privyWalletAddress?: Address;
  /** Close-only: never opens, closes on the strategy's own close rule, then returns free margin to the vault. */
  windDown?: boolean;
};

export type Config = {
  chainId: number;
  /** Alchemy (ALCHEMY_RPC_URL secret) first when set, then RPC_URL. */
  rpcs: string[];
  explorer: string;
  mode: Mode;
  model: string;
  agents: HouseAgent[];
};

type Raw = Record<string, unknown>;
type Secrets = { PRIVY_APP_ID?: string; PRIVY_APP_SECRET?: string; PRIVY_AUTH_KEY?: string };

export function loadConfig(env: Env): Config {
  const mode = String(env.MODE);
  if (mode !== "dry-run" && mode !== "live") throw new Error(`MODE must be "dry-run" or "live", got "${mode}"`);
  const chainId = Number(env.CHAIN_ID);
  if (chainId !== 10143) {
    // Mainnet moves real money: it needs its own deploy, policy and a human decision (CLAUDE.md, Safety).
    throw new Error(`proofbook-agents runs on Monad testnet (10143) only; CHAIN_ID is ${env.CHAIN_ID}`);
  }
  const rawAgents = (typeof env.HOUSE_AGENTS === "string" ? JSON.parse(env.HOUSE_AGENTS) : env.HOUSE_AGENTS) as Raw[];
  return {
    chainId,
    rpcs: [(env as unknown as { ALCHEMY_RPC_URL?: string }).ALCHEMY_RPC_URL, String(env.RPC_URL)].filter((u): u is string => !!u),
    explorer: String(env.EXPLORER),
    mode,
    model: String(env.MODEL),
    agents: rawAgents.map(parseAgent),
  };
}

function parseAgent(a: Raw): HouseAgent {
  const addr = (k: string) => {
    const v = String(a[k] ?? "");
    if (!isAddress(v)) throw new Error(`house agent ${String(a.agentId)}: ${k} "${v}" is not an address`);
    return getAddress(v);
  };
  const wallet = String(a.privyWalletAddress ?? "");
  const agent: HouseAgent = {
    agentId: String(a.agentId),
    label: String(a.label),
    strategy: (a.strategy ?? "momentum") as Strategy,
    vault: addr("vault"),
    adapter: addr("adapter"),
    perpId: BigInt(String(a.perpId)),
    sizeAusd: Number(a.sizeAusd),
    maxSizeAusd: Number(a.maxSizeAusd),
    thresholdBps: Number(a.thresholdBps),
    lookbackMinutes: Number(a.lookbackMinutes),
    privyWalletId: a.privyWalletId ? String(a.privyWalletId) : undefined,
    privyWalletAddress: isAddress(wallet) ? getAddress(wallet) : undefined,
    windDown: a.windDown === true,
  };
  if (!STRATEGIES.includes(agent.strategy)) {
    throw new Error(`house agent ${agent.agentId}: strategy must be one of ${STRATEGIES.join(", ")}`);
  }
  if (!(agent.sizeAusd > 0 && agent.sizeAusd <= agent.maxSizeAusd)) {
    throw new Error(`house agent ${agent.agentId}: sizeAusd must be in (0, maxSizeAusd]`);
  }
  return agent;
}

/** Privy credentials, only for live mode. Throws naming the missing secret, never its value. */
export function privySecrets(env: Env): PrivySecrets {
  const s = env as unknown as Secrets;
  const missing = (["PRIVY_APP_ID", "PRIVY_APP_SECRET", "PRIVY_AUTH_KEY"] as const).filter((k) => !s[k]);
  if (missing.length) throw new Error(`live mode needs the Worker secrets ${missing.join(", ")}`);
  return { appId: s.PRIVY_APP_ID!, appSecret: s.PRIVY_APP_SECRET!, authKey: s.PRIVY_AUTH_KEY! };
}
