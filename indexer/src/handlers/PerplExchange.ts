import { indexer, type EvmOnEventContext as Ctx, type PerplAccount } from "envio";
import { eventId } from "../lib.js";
import { applyChange, mark, perp, toCNS } from "../perpl.js";

// Every handler first drops accounts that aren't ours: the Exchange's events carry no indexed fields.
const ours = (context: Ctx, accountId: bigint) => context.PerplAccount.get(accountId.toString());

indexer.onEvent({ contract: "PerplExchange", event: "MarkUpdated" }, async ({ event, context }) => {
  const pp = await context.Perp.get(event.params.perpId.toString());
  if (!pp) return;
  const next = { ...pp, markPrice: event.params.pricePNS, markUpdatedAt: event.block.timestamp };
  context.Perp.set(next);
  for (const p of await context.PerplPosition.getWhere({ perpId: { _eq: pp.id } })) {
    if (p.side !== "None") context.PerplPosition.set(mark(p, next));
  }
});

async function fill(
  context: Ctx,
  event: { chainId: number; block: { number: number; timestamp: number }; logIndex: number; transaction: { hash: string } },
  acc: PerplAccount,
  perpId: bigint,
  role: "Taker" | "Maker",
  price: bigint,
  lot: bigint,
  fee: bigint,
  orderId: bigint | undefined,
) {
  const pp = await perp(context, perpId);
  const notional = toCNS(price * lot, pp.scaleExp);
  const id = eventId(event);
  context.PerplFill.set({
    id,
    account_id: acc.id,
    vault: acc.vault_id,
    perp_id: pp.id,
    role,
    price,
    lot,
    fee,
    notional,
    orderId,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
  const latest = (await context.PerplAccount.get(acc.id)) ?? acc; // applyChange may have just updated it
  context.PerplAccount.set({
    ...latest,
    fees: latest.fees + fee,
    fillCount: latest.fillCount + 1,
    volume: latest.volume + (notional ?? 0n),
    lastFill: id,
  });
}

// No accountId or perpId: attributed through the position event earlier in the same tx.
indexer.onEvent({ contract: "PerplExchange", event: "TakerOrderFilledV2" }, async ({ event, context }) => {
  const link = await context.PerplTxAccount.get(event.transaction.hash);
  if (!link) return;
  const acc = await context.PerplAccount.getOrThrow(link.account_id);
  const { entryPricePNS, lotLNS, feeCNS } = event.params;
  await fill(context, event, acc, BigInt(link.perp_id), "Taker", entryPricePNS, lotLNS, feeCNS, undefined);
});

indexer.onEvent({ contract: "PerplExchange", event: "MakerOrderFilledV2" }, async ({ event, context }) => {
  const { perpId, accountId, orderId, pricePNS, lotLNS, feeCNS } = event.params;
  const acc = await ours(context, accountId);
  if (!acc) return;
  await fill(context, event, acc, perpId, "Maker", pricePNS, lotLNS, feeCNS, orderId);
});

indexer.onEvent({ contract: "PerplExchange", event: "PositionOpenedV2" }, async ({ event, context }) => {
  const p = event.params;
  const acc = await ours(context, p.accountId);
  if (!acc) return;
  await applyChange(context, event, acc, p.perpId, {
    kind: "Opened",
    positionType: p.positionType,
    price: p.pricePNS,
    lotBefore: 0n,
    lotAfter: p.lotLNS,
    deposit: p.depositCNS,
    leverageHdths: p.leverageHdths,
  });
});

indexer.onEvent({ contract: "PerplExchange", event: "PositionIncreasedV2" }, async ({ event, context }) => {
  const p = event.params;
  const acc = await ours(context, p.accountId);
  if (!acc) return;
  await applyChange(context, event, acc, p.perpId, {
    kind: "Increased",
    positionType: p.positionType,
    price: p.pricePNS,
    lotBefore: p.startLotLNS,
    lotAfter: p.endLotLNS,
    deposit: p.endDepositCNS,
    leverageHdths: p.leverageHdths,
  });
});

indexer.onEvent({ contract: "PerplExchange", event: "PositionDecreased" }, async ({ event, context }) => {
  const p = event.params;
  const acc = await ours(context, p.accountId);
  if (!acc) return;
  await applyChange(context, event, acc, p.perpId, {
    kind: "Decreased",
    positionType: p.positionType,
    lotBefore: p.startLotLNS,
    lotAfter: p.endLotLNS,
    deposit: p.endDepositCNS,
    deltaPnl: p.deltaPnlCNS,
    funding: p.fundingCNS,
  });
});

indexer.onEvent({ contract: "PerplExchange", event: "PositionClosed" }, async ({ event, context }) => {
  const p = event.params;
  const acc = await ours(context, p.accountId);
  if (!acc) return;
  await applyChange(context, event, acc, p.perpId, {
    kind: "Closed",
    price: p.pricePNS,
    lotAfter: 0n,
    deltaPnl: p.deltaPnlCNS,
    funding: p.fundingCNS,
  });
});

// Unverified: positionType is taken to be the side after the flip.
indexer.onEvent({ contract: "PerplExchange", event: "PositionInverted" }, async ({ event, context }) => {
  const p = event.params;
  const acc = await ours(context, p.accountId);
  if (!acc) return;
  await applyChange(context, event, acc, p.perpId, {
    kind: "Inverted",
    positionType: p.positionType,
    price: p.pricePNS,
    lotBefore: p.startLotLNS,
    lotAfter: p.endLotLNS,
    deposit: p.endDepositCNS,
    leverageHdths: p.leverageHdths,
    deltaPnl: p.deltaPnlCNS,
    funding: p.fundingCNS,
  });
});

// Unverified: posLotLNS is taken to be the lot before liquidation and liqLotLNS the part liquidated.
indexer.onEvent({ contract: "PerplExchange", event: "PositionLiquidated" }, async ({ event, context }) => {
  const p = event.params;
  const acc = await ours(context, p.posAccountId);
  if (!acc) return;
  await applyChange(context, event, acc, p.perpId, {
    kind: "Liquidated",
    positionType: p.positionType,
    price: p.liqPricePNS,
    lotBefore: p.posLotLNS,
    lotAfter: p.posLotLNS > p.liqLotLNS ? p.posLotLNS - p.liqLotLNS : 0n,
    deposit: p.posDepositCNS,
    deltaPnl: p.deltaPnlCNS,
    funding: p.fundingCNS,
  });
});

indexer.onEvent({ contract: "PerplExchange", event: "PositionDeleveragedV2" }, async ({ event, context }) => {
  const p = event.params;
  const acc = await ours(context, p.accountId);
  if (!acc) return;
  await applyChange(context, event, acc, p.perpId, {
    kind: "Deleveraged",
    positionType: p.positionType,
    price: p.deleveragePricePNS,
    lotBefore: p.startLotLNS,
    lotAfter: p.endLotLNS,
    deposit: p.endDepositCNS,
    deltaPnl: p.deltaPnlCNS,
    funding: p.fundingCNS,
  });
});

indexer.onEvent({ contract: "PerplExchange", event: "PositionUnwoundV2" }, async ({ event, context }) => {
  const p = event.params;
  const acc = await ours(context, p.accountId);
  if (!acc) return;
  await applyChange(context, event, acc, p.perpId, {
    kind: "Unwound",
    positionType: p.positionType,
    price: p.pricePNS,
    lotBefore: p.lotLNS,
    lotAfter: 0n,
  });
});

indexer.onEvent(
  { contract: "PerplExchange", event: "PositionUnwoundWithoutPaymentV2" },
  async ({ event, context }) => {
    const p = event.params;
    const acc = await ours(context, p.accountId);
    if (!acc) return;
    await applyChange(context, event, acc, p.perpId, {
      kind: "UnwoundWithoutPayment",
      positionType: p.positionType,
      price: p.pricePNS,
      lotBefore: p.lotLNS,
      lotAfter: 0n,
    });
  },
);
