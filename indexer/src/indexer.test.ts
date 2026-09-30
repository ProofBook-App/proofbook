import { describe, it } from "vitest";
import { createTestIndexer } from "envio";

// Replays the real Monad testnet history of house agent #1 (README "Testnet").
const REGISTRY_DEPLOY = 66_759_038;
const BIND = 66_759_298;
const FIRST_TRADE = [66_916_940, 66_916_945] as const; // deposit 400, margin 100, MON long
const VAULT = "0x98e2af31848B95d751e3BFD5bAB9E5EAB9122B53";
const ADAPTER = "0x583B6bCFcAec599E6Fc09e27db581d6abe7baB09";
const AUSD = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";

describe("house agent #1 on Monad testnet", () => {
  it("indexes registration, the first deposit and the first Perpl trade", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { 10143: { startBlock: REGISTRY_DEPLOY, endBlock: BIND } } });

    const agent = await indexer.Agent.getOrThrow("1951");
    t.expect(agent.vault_id).toBe(VAULT);
    t.expect(agent.venues).toEqual([ADAPTER]);
    t.expect(agent.maxTradeNotional).toBe(100_000_000n);
    t.expect(await indexer.Asset.get(AUSD)).toBeDefined();
    t.expect((await indexer.Adapter.getOrThrow(ADAPTER)).vault_id).toBe(VAULT);

    await indexer.process({ chains: { 10143: { startBlock: FIRST_TRADE[0], endBlock: FIRST_TRADE[1] } } });

    const vault = await indexer.Vault.getOrThrow(VAULT);
    t.expect(vault.deposited).toBe(400_000_000n);
    t.expect(vault.backerCount).toBe(1);
    t.expect(vault.tradeCount).toBe(2); // margin deposit + order
    t.expect(vault.nav).toBe(399_909_625n); // Executed.navAfter of the order (tx 0x0c6a…0fdc)
    t.expect(vault.pnl).toBe(-90_375n);
    t.expect(vault.frozen).toBe(false);

    const adapter = await indexer.Adapter.getOrThrow(ADAPTER);
    t.expect(adapter.kind).toBe("Perpl");
    t.expect(adapter.perplAccountId).toBe(740n);
    t.expect(adapter.perplMarginIn).toBe(100_000_000n);
    t.expect(adapter.perplOrderCount).toBe(1);
  });
});
