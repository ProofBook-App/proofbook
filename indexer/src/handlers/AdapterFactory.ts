import { indexer, type EvmOnEventContext as Ctx, type Factory } from "envio";
import { blankAdapter } from "../lib.js";

// Canonical adapters. Kind comes from the factory here, rather than from the adapter's first event.

const KINDS = ["Perpl", "Kuru"] as const; // AdapterFactory.Kind

async function factory(context: Ctx, id: string, timestamp: number): Promise<Factory> {
  return (await context.Factory.get(id)) ?? { id, registry: undefined, adapterCount: 0, createdAt: timestamp };
}

// Track the adapter from birth, so nothing it emits before AgentRegistered is missed.
indexer.contractRegister({ contract: "AdapterFactory", event: "AdapterDeployed" }, async ({ event, context }) => {
  context.chain.VenueAdapter.add(event.params.adapter);
});

indexer.onEvent({ contract: "AdapterFactory", event: "RegistrySet" }, async ({ event, context }) => {
  const f = await factory(context, event.srcAddress, event.block.timestamp);
  context.Factory.set({ ...f, registry: event.params.registry });
});

indexer.onEvent({ contract: "AdapterFactory", event: "AdapterDeployed" }, async ({ event, context }) => {
  const { adapter, kind, by } = event.params;
  const f = await factory(context, event.srcAddress, event.block.timestamp);
  context.Factory.set({ ...f, adapterCount: f.adapterCount + 1 });
  const a = (await context.Adapter.get(adapter)) ?? blankAdapter(adapter);
  context.Adapter.set({
    ...a,
    kind: KINDS[Number(kind)] ?? "Unknown",
    factory_id: f.id,
    deployedBy: by,
    deployedAt: event.block.timestamp,
  });
});
