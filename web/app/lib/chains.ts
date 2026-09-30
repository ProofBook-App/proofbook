// Per-chain display facts: network name, explorer and vault asset symbols.
// Addresses are the ones in the README and docs/reference (monad.md, perpl.md).
const CHAINS: Record<number, { name: string; explorer: string; assets: Record<string, string> }> = {
  143: {
    name: "Monad",
    explorer: "https://monadvision.com",
    assets: { "0x00000000efe302beaa2b3e6e1b18d08d69a9012a": "AUSD" },
  },
  10143: {
    name: "Monad testnet",
    explorer: "https://testnet.monadvision.com",
    assets: { "0xa9012a055bd4e0edff8ce09f960291c09d5322dc": "AUSD" },
  },
};

export function chainName(chainId: number) {
  return CHAINS[chainId]?.name ?? `Chain ${chainId}`;
}

export function addressUrl(chainId: number, address: string) {
  return `${CHAINS[chainId]?.explorer ?? "https://monadvision.com"}/address/${address}`;
}

export function assetSymbol(chainId: number, asset: string) {
  return CHAINS[chainId]?.assets[asset.toLowerCase()] ?? "tokens";
}
