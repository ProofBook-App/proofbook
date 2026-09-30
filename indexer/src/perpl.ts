import type { EvmOnEventContext as Ctx, Perp, PerplAccount, PerplPosition } from "envio";

export const SIDES = ["Long", "Short"] as const;
export const side = (positionType: bigint) => SIDES[Number(positionType)] ?? "None";

/** CNS for price x lot at a perp's scale (10^scaleExp CNS per PNS x LNS). Null while the scale is unknown. */
export function toCNS(priceTimesLot: bigint, scaleExp: number | undefined): bigint | undefined {
  if (scaleExp === undefined) return undefined;
  return scaleExp >= 0 ? priceTimesLot * 10n ** BigInt(scaleExp) : priceTimesLot / 10n ** BigInt(-scaleExp);
}

/** OrderSent.notional = ceil(lot x max(limit, mark) x 10^(6 - pd - ld)); within the 3% band, so rounding
 * notional / (limit x lot) to the nearest power of ten recovers the exponent exactly. */
export function scaleExpOf(notional: bigint, price: bigint, lot: bigint): number | undefined {
  if (notional === 0n || price === 0n || lot === 0n) return undefined;
  return Math.round(Math.log10(Number(notional) / Number(price * lot)));
}

export async function perp(context: Ctx, perpId: bigint): Promise<Perp> {
  const id = perpId.toString();
  return (
    (await context.Perp.get(id)) ?? { id, scaleExp: undefined, markPrice: undefined, markUpdatedAt: undefined }
  );
}

/** Notional and unrealised PnL at the perp's mark. */
export function mark(p: PerplPosition, pp: Perp): PerplPosition {
  if (p.side === "None" || pp.markPrice === undefined) return { ...p, notional: undefined, unrealisedPnl: undefined };
  const notional = toCNS(pp.markPrice * p.lot, pp.scaleExp);
  const cost = toCNS(p.entryPrice * p.lot, pp.scaleExp);
  if (notional === undefined || cost === undefined) return p;
  return { ...p, notional, unrealisedPnl: p.side === "Long" ? notional - cost : cost - notional };
}

export type Change = {
  kind: string;
  positionType?: bigint; // resulting side; omitted when the event doesn't carry one
  price?: bigint;
  lotBefore?: bigint; // defaults to the tracked lot
  lotAfter: bigint;
  deposit?: bigint;
  leverageHdths?: bigint;
  deltaPnl?: bigint;
  funding?: bigint;
};

type E = { chainId: number; block: { number: number; timestamp: number }; logIndex: number; transaction: { hash: string } };

/** Apply one Perpl position event to one of our accounts. */
export async function applyChange(context: Ctx, e: E, acc: PerplAccount, perpId: bigint, c: Change) {
  const pp = await perp(context, perpId);
  context.Perp.set(pp);
  const id = `${acc.id}-${pp.id}`;
  const t = e.block.timestamp;
  const prev: PerplPosition = (await context.PerplPosition.get(id)) ?? {
    id,
    account_id: acc.id,
    vault: acc.vault_id,
    perp_id: pp.id,
    perpId: pp.id,
    side: "None",
    lot: 0n,
    entryPrice: 0n,
    deposit: 0n,
    leverageHdths: 0n,
    realisedPnl: 0n,
    funding: 0n,
    notional: undefined,
    unrealisedPnl: undefined,
    openedAt: t,
    updatedAt: t,
  };
  const lotBefore = c.lotBefore ?? prev.lot;
  let entryPrice = prev.entryPrice;
  let openedAt = prev.openedAt;
  if (c.kind === "Opened" || c.kind === "Inverted") {
    entryPrice = c.price ?? 0n;
    openedAt = t;
  } else if (c.kind === "Increased" && c.lotAfter > 0n && c.price !== undefined) {
    entryPrice = (prev.entryPrice * lotBefore + c.price * (c.lotAfter - lotBefore)) / c.lotAfter;
  }
  const open = c.lotAfter > 0n;
  const deltaPnl = c.deltaPnl ?? 0n;
  const funding = c.funding ?? 0n;
  const next: PerplPosition = mark(
    {
      ...prev,
      side: !open ? "None" : c.positionType !== undefined ? side(c.positionType) : prev.side,
      lot: c.lotAfter,
      entryPrice: open ? entryPrice : 0n,
      deposit: open ? (c.deposit ?? prev.deposit) : 0n,
      leverageHdths: c.leverageHdths ?? prev.leverageHdths,
      realisedPnl: prev.realisedPnl + deltaPnl,
      funding: prev.funding + funding,
      openedAt,
      updatedAt: t,
    },
    pp,
  );
  context.PerplPosition.set(next);
  context.PerplAccount.set({ ...acc, realisedPnl: acc.realisedPnl + deltaPnl, funding: acc.funding + funding });
  context.PerplPositionChange.set({
    id: `${e.chainId}-${e.block.number}-${e.logIndex}`,
    account_id: acc.id,
    vault: acc.vault_id,
    perp_id: pp.id,
    kind: c.kind,
    side: next.side,
    price: c.price,
    lotBefore,
    lotAfter: c.lotAfter,
    depositAfter: c.deposit,
    deltaPnl: c.deltaPnl,
    funding: c.funding,
    timestamp: t,
    txHash: e.transaction.hash,
  });
  context.PerplTxAccount.set({ id: e.transaction.hash, account_id: acc.id, perp_id: pp.id });
}
