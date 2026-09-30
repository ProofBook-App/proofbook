import { indexer, type Backer, type EvmOnEventContext as Ctx, type Vault } from "envio";
import { eventId, reprice } from "../lib.js";

const ZERO = "0x0000000000000000000000000000000000000000";

type E = { chainId: number; block: { number: number; timestamp: number }; logIndex: number; srcAddress: string };

async function backer(context: Ctx, vault: string, account: string, t: number): Promise<Backer> {
  const id = `${vault}-${account}`;
  return (
    (await context.Backer.get(id)) ?? {
      id,
      vault_id: vault,
      account,
      shares: 0n,
      deposited: 0n,
      withdrawn: 0n,
      firstSeenAt: t,
    }
  );
}

/** Save the vault and, when NAV moved, a NavPoint for the chart. */
function save(context: Ctx, e: E, v: Vault, navMoved: boolean) {
  const next = reprice(v, e.block.timestamp);
  context.Vault.set(next);
  if (navMoved) {
    context.NavPoint.set({
      id: eventId(e),
      vault_id: v.id,
      nav: next.nav,
      sharePrice: next.sharePrice,
      timestamp: e.block.timestamp,
      block: e.block.number,
    });
  }
}

// Shares: mints, burns and transfers all arrive as Transfer, before Deposit/Withdraw in the same tx.
indexer.onEvent({ contract: "AgentVault", event: "Transfer" }, async ({ event, context }) => {
  const { from, to, value } = event.params;
  const t = event.block.timestamp;
  let v = await context.Vault.getOrThrow(event.srcAddress);
  if (from === ZERO) v = { ...v, totalShares: v.totalShares + value };
  else {
    const b = await backer(context, v.id, from, t);
    const shares = b.shares - value;
    if (shares === 0n && b.shares > 0n) v = { ...v, backerCount: v.backerCount - 1 };
    context.Backer.set({ ...b, shares });
  }
  if (to === ZERO) v = { ...v, totalShares: v.totalShares - value };
  else {
    const b = await backer(context, v.id, to, t);
    if (b.shares === 0n && value > 0n) v = { ...v, backerCount: v.backerCount + 1 };
    context.Backer.set({ ...b, shares: b.shares + value });
  }
  context.Vault.set(v);
});

indexer.onEvent({ contract: "AgentVault", event: "Deposit" }, async ({ event, context }) => {
  const { owner, assets, shares } = event.params;
  const v = await context.Vault.getOrThrow(event.srcAddress);
  const b = await backer(context, v.id, owner, event.block.timestamp);
  context.Backer.set({ ...b, deposited: b.deposited + assets });
  context.Flow.set({
    id: eventId(event),
    vault_id: v.id,
    kind: "Deposit",
    account: owner,
    assets,
    shares,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
  save(context, event, { ...v, nav: v.nav + assets, deposited: v.deposited + assets }, true);
});

indexer.onEvent({ contract: "AgentVault", event: "Withdraw" }, async ({ event, context }) => {
  const { owner, assets, shares } = event.params;
  const v = await context.Vault.getOrThrow(event.srcAddress);
  const b = await backer(context, v.id, owner, event.block.timestamp);
  context.Backer.set({ ...b, withdrawn: b.withdrawn + assets });
  context.Flow.set({
    id: eventId(event),
    vault_id: v.id,
    kind: "Withdraw",
    account: owner,
    assets,
    shares,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
  const nav = assets >= v.nav ? 0n : v.nav - assets;
  save(context, event, { ...v, nav, withdrawn: v.withdrawn + assets }, true);
});

indexer.onEvent({ contract: "AgentVault", event: "FeeTaken" }, async ({ event, context }) => {
  const { to, assets, highWaterMark } = event.params;
  const v = await context.Vault.getOrThrow(event.srcAddress);
  context.Flow.set({
    id: eventId(event),
    vault_id: v.id,
    kind: "Fee",
    account: to,
    assets,
    shares: 0n,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
  const nav = assets >= v.nav ? 0n : v.nav - assets;
  save(context, event, { ...v, nav, feesPaid: v.feesPaid + assets, highWaterMark }, true);
});

indexer.onEvent({ contract: "AgentVault", event: "Executed" }, async ({ event, context }) => {
  const { venue, notional, venueDelta, navBefore, navAfter } = event.params;
  const v = await context.Vault.getOrThrow(event.srcAddress);
  context.Trade.set({
    id: eventId(event),
    vault_id: v.id,
    venue,
    notional,
    venueDelta,
    navBefore,
    navAfter,
    timestamp: event.block.timestamp,
    block: event.block.number,
    txHash: event.transaction.hash,
  });
  save(
    context,
    event,
    { ...v, nav: navAfter, tradeCount: v.tradeCount + 1, tradeVolume: v.tradeVolume + notional },
    true,
  );
});

indexer.onEvent({ contract: "AgentVault", event: "DayRolled" }, async ({ event, context }) => {
  const v = await context.Vault.getOrThrow(event.srcAddress);
  context.Vault.set({
    ...v,
    dayStart: Number(event.params.dayStart),
    dayStartNav: event.params.dayStartNav,
    updatedAt: event.block.timestamp,
  });
});

indexer.onEvent({ contract: "AgentVault", event: "PolicyBreach" }, async ({ event, context }) => {
  const v = await context.Vault.getOrThrow(event.srcAddress);
  context.PolicyEvent.set({
    id: eventId(event),
    vault_id: v.id,
    kind: "DailyLossBreach",
    by: undefined,
    nav: event.params.nav,
    dayStartNav: event.params.dayStartNav,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
  context.Vault.set({ ...v, breachCount: v.breachCount + 1, updatedAt: event.block.timestamp });
});

indexer.onEvent({ contract: "AgentVault", event: "Frozen" }, async ({ event, context }) => {
  const v = await context.Vault.getOrThrow(event.srcAddress);
  context.PolicyEvent.set({
    id: eventId(event),
    vault_id: v.id,
    kind: "Frozen",
    by: event.params.by,
    nav: undefined,
    dayStartNav: undefined,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
  context.Vault.set({ ...v, frozen: true, freezeCount: v.freezeCount + 1, updatedAt: event.block.timestamp });
});

indexer.onEvent({ contract: "AgentVault", event: "Unfrozen" }, async ({ event, context }) => {
  const v = await context.Vault.getOrThrow(event.srcAddress);
  context.PolicyEvent.set({
    id: eventId(event),
    vault_id: v.id,
    kind: "Unfrozen",
    by: event.params.by,
    nav: undefined,
    dayStartNav: undefined,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
  context.Vault.set({ ...v, frozen: false, updatedAt: event.block.timestamp });
});

indexer.onEvent({ contract: "AgentVault", event: "SessionKeyRotated" }, async ({ event, context }) => {
  const v = await context.Vault.getOrThrow(event.srcAddress);
  context.PolicyEvent.set({
    id: eventId(event),
    vault_id: v.id,
    kind: "SessionKeyRotated",
    by: event.params.previous,
    nav: undefined,
    dayStartNav: undefined,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
  context.Vault.set({ ...v, sessionKey: event.params.next, updatedAt: event.block.timestamp });
});
