// Per-chain display facts: network name, explorer and vault asset symbols.
// Addresses and perp decimals are the ones in the README and docs/reference (monad.md, perpl.md).
type Perp = { name: string; priceDecimals: number; lotDecimals: number };
const CHAINS: Record<
  number,
  {
    name: string;
    explorer: string;
    rpc: string;
    assets: Record<string, string>;
    perps: Record<string, Perp>;
    ausdFaucet?: string;
  }
> = {
  143: {
    name: "Monad",
    explorer: "https://monadvision.com",
    rpc: "https://rpc.monad.xyz",
    assets: { "0x00000000efe302beaa2b3e6e1b18d08d69a9012a": "AUSD" },
    perps: {
      "1": { name: "BTC", priceDecimals: 1, lotDecimals: 5 },
      "10": { name: "MON", priceDecimals: 6, lotDecimals: 0 },
      "20": { name: "ETH", priceDecimals: 2, lotDecimals: 3 },
      "31": { name: "SOL", priceDecimals: 3, lotDecimals: 3 },
    },
  },
  10143: {
    name: "Monad testnet",
    explorer: "https://testnet.monadvision.com",
    rpc: "https://testnet-rpc.monad.xyz",
    // Agora's testnet AUSD faucet: requestFunds(recipient), 10,000 AUSD (docs/reference/perpl.md).
    ausdFaucet: "0xd236c18d274e54faccc3dd9dda4b27965a73ee6c",
    assets: { "0xa9012a055bd4e0edff8ce09f960291c09d5322dc": "AUSD" },
    perps: { "64": { name: "MON", priceDecimals: 5, lotDecimals: 0 } },
  },
};

export function rpcUrl(chainId: number) {
  return CHAINS[chainId]?.rpc ?? "https://rpc.monad.xyz";
}

export function ausdFaucet(chainId: number) {
  return CHAINS[chainId]?.ausdFaucet;
}

export function chainName(chainId: number) {
  return CHAINS[chainId]?.name ?? `Chain ${chainId}`;
}

function explorer(chainId: number) {
  return CHAINS[chainId]?.explorer ?? "https://monadvision.com";
}

export function addressUrl(chainId: number, address: string) {
  return `${explorer(chainId)}/address/${address}`;
}

export function txUrl(chainId: number, hash: string) {
  return `${explorer(chainId)}/tx/${hash}`;
}

// Undefined for a perp we haven't checked: show its raw Perpl units rather than guess.
export function perpInfo(chainId: number, perpId: string): Perp | undefined {
  return CHAINS[chainId]?.perps[perpId];
}

export function assetSymbol(chainId: number, asset: string) {
  return CHAINS[chainId]?.assets[asset.toLowerCase()] ?? "tokens";
}
