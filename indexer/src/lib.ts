import type { Vault } from "envio";

// Vault shares carry 6 more decimals than the asset (AgentVault DECIMALS_OFFSET = 6).
const SHARE_PRICE_SCALE = 10n ** 24n;
export const WAD = 10n ** 18n;

type Ev = { chainId: number; block: { number: number }; logIndex: number };

export const eventId = (e: Ev) => `${e.chainId}-${e.block.number}-${e.logIndex}`;

export const sharePrice = (nav: bigint, shares: bigint) => (shares === 0n ? WAD : (nav * SHARE_PRICE_SCALE) / shares);

/** Re-derive price, peak, drawdown and PnL after nav, shares or flows change. */
export function reprice(v: Vault, timestamp: number): Vault {
  const price = sharePrice(v.nav, v.totalShares);
  const peak = price > v.peakSharePrice ? price : v.peakSharePrice;
  const dd = peak === 0n ? 0 : Number(((peak - price) * 10_000n) / peak);
  return {
    ...v,
    sharePrice: price,
    peakSharePrice: peak,
    maxDrawdownBps: dd > v.maxDrawdownBps ? dd : v.maxDrawdownBps,
    pnl: v.nav + v.withdrawn + v.feesPaid - v.deposited,
    updatedAt: timestamp,
  };
}
