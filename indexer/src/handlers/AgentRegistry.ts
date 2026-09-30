import { indexer } from "envio";
import { WAD } from "../lib.js";

indexer.contractRegister({ contract: "AgentRegistry", event: "AgentRegistered" }, async ({ event, context }) => {
  for (const venue of event.params.envelope.venues) context.chain.VenueAdapter.add(venue);
});

indexer.contractRegister({ contract: "AgentRegistry", event: "VaultLinked" }, async ({ event, context }) => {
  context.chain.AgentVault.add(event.params.vault);
});

indexer.onEvent({ contract: "AgentRegistry", event: "AssetAllowed" }, async ({ event, context }) => {
  context.Asset.set({ id: event.params.asset, allowedAt: event.block.timestamp });
});

indexer.onEvent({ contract: "AgentRegistry", event: "AgentRegistered" }, async ({ event, context }) => {
  const { agentId, owner, envelope } = event.params;
  context.Agent.set({
    id: agentId.toString(),
    owner,
    maxTradeNotional: envelope.maxTradeNotional,
    dailyLossCapBps: Number(envelope.dailyLossCapBps),
    depositCapPerBacker: envelope.depositCapPerBacker,
    venues: [...envelope.venues],
    vault_id: undefined,
    registeredAt: event.block.timestamp,
    registeredTx: event.transaction.hash,
  });
  for (const venue of envelope.venues) {
    const existing = await context.Adapter.get(venue);
    if (existing) continue;
    context.Adapter.set({
      id: venue,
      kind: "Unknown",
      vault_id: undefined,
      perplAccountId: undefined,
      perplMarginIn: 0n,
      perplMarginOut: 0n,
      perplOrderCount: 0,
      kuruBaseHeld: 0n,
      kuruQuoteIn: 0n,
      kuruQuoteOut: 0n,
    });
  }
});

indexer.onEvent({ contract: "AgentRegistry", event: "VaultLinked" }, async ({ event, context }) => {
  const { agentId, vault, asset, sessionKey } = event.params;
  const agent = await context.Agent.getOrThrow(agentId.toString());
  context.Agent.set({ ...agent, vault_id: vault });
  const t = event.block.timestamp;
  context.Vault.set({
    id: vault,
    agent_id: agent.id,
    asset,
    sessionKey,
    frozen: false,
    nav: 0n,
    totalShares: 0n,
    sharePrice: WAD,
    peakSharePrice: WAD,
    maxDrawdownBps: 0,
    deposited: 0n,
    withdrawn: 0n,
    feesPaid: 0n,
    pnl: 0n,
    highWaterMark: 10n ** 12n, // AgentVault units: assets * 1e18 / shares, so 1e12 is 1.0
    dayStart: 0,
    dayStartNav: 0n,
    tradeCount: 0,
    tradeVolume: 0n,
    breachCount: 0,
    freezeCount: 0,
    backerCount: 0,
    createdAt: t,
    updatedAt: t,
  });
});
