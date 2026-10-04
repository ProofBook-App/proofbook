// Per-network addresses. Every address was checked with `cast code` on its chain; sources are
// contracts/script/Chains.sol, the README deployment tables and docs/reference/{perpl,erc-8004}.md.
import { defineChain, type Address, type Chain } from "viem";

export type NetworkName = "testnet" | "mainnet";

export type Network = {
  name: NetworkName;
  chainId: number;
  rpc: string;
  explorer: string;
  /** Proofbook AgentRegistry. Undefined until it is deployed on this chain. */
  registry?: Address;
  identity: Address;
  ausd: Address;
  perplExchange: Address;
  /** Perpl MON perp id: 64 on testnet, 10 on mainnet. */
  monPerpId: bigint;
  /** Agora's testnet AUSD faucet: requestFunds(recipient), 10,000 AUSD, one claim a minute across everyone. */
  ausdFaucet?: Address;
};

export const NETWORKS: Record<NetworkName, Network> = {
  testnet: {
    name: "testnet",
    chainId: 10143,
    rpc: "https://testnet-rpc.monad.xyz",
    explorer: "https://testnet.monadvision.com",
    registry: "0xD791Bd907Ee2a1B327DB92a21660e118EDe5b6cD", // 2026-10-04, security fixes incl. L3 (README, Testnet)
    identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    ausd: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
    perplExchange: "0x1964C32f0bE608E7D29302AFF5E61268E72080cc",
    monPerpId: 64n,
    ausdFaucet: "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C",
  },
  mainnet: {
    name: "mainnet",
    chainId: 143,
    rpc: "https://rpc.monad.xyz",
    explorer: "https://monadvision.com",
    registry: undefined, // not deployed yet: README "Mainnet deployments"
    identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    ausd: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",
    perplExchange: "0x34B6552d57a35a1D042CcAe1951BD1C370112a6F",
    monPerpId: 10n,
  },
};

/**
 * Testnet unless `--network mainnet` is passed explicitly. Mainnet moves real money, so there is
 * no environment variable or default that selects it.
 */
export function resolveNetwork(flag: string | undefined, rpcOverride?: string): Network {
  const name = flag ?? "testnet";
  if (name !== "testnet" && name !== "mainnet") {
    throw new Error(`Unknown network "${name}". Use testnet (10143, the default) or mainnet (143).`);
  }
  const n = { ...NETWORKS[name] };
  if (rpcOverride) n.rpc = rpcOverride;
  return n;
}

export function requireRegistry(n: Network): Address {
  if (!n.registry) {
    throw new Error(`Proofbook is not deployed on ${n.name} (${n.chainId}) yet. Pass --registry <address> if it is.`);
  }
  return n.registry;
}

export function chainOf(n: Network): Chain {
  return defineChain({
    id: n.chainId,
    name: n.name === "mainnet" ? "Monad" : "Monad testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [n.rpc] } },
    contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  });
}

export const txUrl = (n: Network, hash: string) => `${n.explorer}/tx/${hash}`;
export const addressUrl = (n: Network, address: string) => `${n.explorer}/address/${address}`;
