import { indexer, type Adapter, type EvmOnEventContext as Ctx } from "envio";
import { blankAdapter, eventId } from "../lib.js";
import { mark, perp, scaleExpOf, toCNS } from "../perpl.js";

// PerplAdapter and KuruAdapter events. The kind is learned from the first kind-specific event.

type E = {
  chainId: number;
  block: { number: number; timestamp: number };
  logIndex: number;
  srcAddress: string;
  transaction: { hash: string };
};

type Action = {
  vault: string;
  kind: string;
  perpId?: bigint;
  orderType?: number;
  orderId?: bigint;
  price?: bigint;
  size?: bigint;
  quote?: bigint;
  leverageHdths?: bigint;
};

async function adapter(context: Ctx, address: string): Promise<Adapter> {
  return (await context.Adapter.get(address)) ?? blankAdapter(address);
}

function record(context: Ctx, e: E, a: Action) {
  context.VenueAction.set({
    id: eventId(e),
    adapter_id: e.srcAddress,
    vault: a.vault,
    kind: a.kind,
    perpId: a.perpId,
    orderType: a.orderType,
    orderId: a.orderId,
    price: a.price,
    size: a.size,
    quote: a.quote,
    leverageHdths: a.leverageHdths,
    timestamp: e.block.timestamp,
    txHash: e.transaction.hash,
  });
}

/** First order on a perp: learn its CNS scale, then price the fill this order just made and any open
 * position on it (both were written before OrderSent, which the adapter emits after execOrder). */
async function learnScale(
  context: Ctx,
  txHash: string,
  accountId: bigint | undefined,
  perpId: bigint,
  notional: bigint,
  price: bigint,
  lot: bigint,
) {
  const pp = await perp(context, perpId);
  if (pp.scaleExp !== undefined) return;
  const scaleExp = scaleExpOf(notional, price, lot);
  if (scaleExp === undefined) return;
  const next = { ...pp, scaleExp };
  context.Perp.set(next);
  if (accountId === undefined) return;
  const acc = await context.PerplAccount.get(accountId.toString());
  if (!acc?.lastFill) return;
  const f = await context.PerplFill.get(acc.lastFill);
  if (f && f.txHash === txHash && f.notional === undefined && f.perp_id === pp.id) {
    const n = toCNS(f.price * f.lot, scaleExp)!;
    context.PerplFill.set({ ...f, notional: n });
    context.PerplAccount.set({ ...acc, volume: acc.volume + n });
  }
  const pos = await context.PerplPosition.get(`${acc.id}-${pp.id}`);
  if (pos) context.PerplPosition.set(mark(pos, next));
}

indexer.onEvent({ contract: "VenueAdapter", event: "Bound" }, async ({ event, context }) => {
  const a = await adapter(context, event.srcAddress);
  context.Adapter.set({ ...a, vault_id: event.params.vault });
});

// ------------------------------------------------------------------ Perpl

indexer.onEvent({ contract: "VenueAdapter", event: "PerpTracked" }, async ({ event, context }) => {
  const a = await adapter(context, event.srcAddress);
  context.Adapter.set({ ...a, kind: "Perpl" });
  context.Perp.set(await perp(context, event.params.perpId)); // before the Exchange events of this order
});

indexer.onEvent({ contract: "VenueAdapter", event: "MarginDeposited" }, async ({ event, context }) => {
  const { vault, amountCNS, accountId } = event.params;
  const a = await adapter(context, event.srcAddress);
  context.Adapter.set({ ...a, kind: "Perpl", perplAccountId: accountId, perplMarginIn: a.perplMarginIn + amountCNS });
  // From here on, PerplExchange handlers keep this account's events.
  const id = accountId.toString();
  if (!(await context.PerplAccount.get(id))) {
    context.PerplAccount.set({
      id,
      adapter_id: a.id,
      vault_id: vault,
      realisedPnl: 0n,
      funding: 0n,
      fees: 0n,
      fillCount: 0,
      volume: 0n,
      lastFill: undefined,
    });
  }
  record(context, event, { vault, kind: "MarginDeposited", quote: amountCNS });
});

indexer.onEvent({ contract: "VenueAdapter", event: "MarginWithdrawn" }, async ({ event, context }) => {
  const { vault, amountCNS } = event.params;
  const a = await adapter(context, event.srcAddress);
  context.Adapter.set({ ...a, kind: "Perpl", perplMarginOut: a.perplMarginOut + amountCNS });
  record(context, event, { vault, kind: "MarginWithdrawn", quote: amountCNS });
});

indexer.onEvent({ contract: "VenueAdapter", event: "Recalled" }, async ({ event, context }) => {
  const { vault, amountCNS } = event.params;
  const a = await adapter(context, event.srcAddress);
  context.Adapter.set({ ...a, kind: "Perpl", perplMarginOut: a.perplMarginOut + amountCNS });
  record(context, event, { vault, kind: "Recalled", quote: amountCNS });
});

indexer.onEvent({ contract: "VenueAdapter", event: "OrderSent" }, async ({ event, context }) => {
  const { vault, perpId, orderType, orderId, pricePNS, lotLNS, leverageHdths, notional } = event.params;
  const a = await adapter(context, event.srcAddress);
  context.Adapter.set({ ...a, kind: "Perpl", perplOrderCount: a.perplOrderCount + 1 });
  await learnScale(context, event.transaction.hash, a.perplAccountId, perpId, notional, pricePNS, lotLNS);
  record(context, event, {
    vault,
    kind: "OrderSent",
    perpId,
    orderType: Number(orderType),
    orderId,
    price: pricePNS,
    size: lotLNS,
    quote: notional,
    leverageHdths,
  });
});

// ------------------------------------------------------------------ Kuru

indexer.onEvent({ contract: "VenueAdapter", event: "Bought" }, async ({ event, context }) => {
  const { vault, quoteIn, baseOut, referencePrice } = event.params;
  const a = await adapter(context, event.srcAddress);
  context.Adapter.set({
    ...a,
    kind: "Kuru",
    kuruBaseHeld: a.kuruBaseHeld + baseOut,
    kuruQuoteIn: a.kuruQuoteIn + quoteIn,
  });
  record(context, event, { vault, kind: "Bought", price: referencePrice, size: baseOut, quote: quoteIn });
});

indexer.onEvent({ contract: "VenueAdapter", event: "Sold" }, async ({ event, context }) => {
  const { vault, baseIn, quoteOut, referencePrice } = event.params;
  const a = await adapter(context, event.srcAddress);
  context.Adapter.set({
    ...a,
    kind: "Kuru",
    kuruBaseHeld: a.kuruBaseHeld - baseIn,
    kuruQuoteOut: a.kuruQuoteOut + quoteOut,
  });
  record(context, event, { vault, kind: "Sold", price: referencePrice, size: baseIn, quote: quoteOut });
});

indexer.onEvent({ contract: "VenueAdapter", event: "Unwound" }, async ({ event, context }) => {
  const { vault, baseIn, quoteOut } = event.params;
  const a = await adapter(context, event.srcAddress);
  context.Adapter.set({
    ...a,
    kind: "Kuru",
    kuruBaseHeld: a.kuruBaseHeld - baseIn,
    kuruQuoteOut: a.kuruQuoteOut + quoteOut,
  });
  record(context, event, { vault, kind: "Unwound", size: baseIn, quote: quoteOut });
});
