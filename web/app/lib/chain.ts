// viem chain definitions for Monad, built from the facts in chains.ts. Kept apart from chains.ts so
// pages that only format numbers don't pull in viem.
import { defineChain } from "viem";
import { chainName, rpcUrl } from "./chains";

export function chainFor(chainId: number) {
  return defineChain({
    id: chainId,
    name: chainName(chainId),
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl(chainId)] } },
    // Checked with `cast code` on 143 and 10143 (docs/reference/monad.md). Lets viem fold a page's
    // reads into one eth_call, which keeps the public RPCs from rate-limiting us.
    contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  });
}
