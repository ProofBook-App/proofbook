import { describe, it } from "vitest";
import { createTestIndexer } from "envio";

// Replays the real Monad testnet history of house agent #1 (README "Testnet").
const REGISTRY_DEPLOY = 66_759_038;
const BIND = 66_759_298;
const FIRST_TRADE = [66_916_940, 66_916_945] as const; // deposit 400, margin 100, MON long
const FIRST_MON_MARK = 66_916_949; // MarkUpdated(64, 2730)
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

    // One range through the first MON mark: the test indexer rejects a range starting past PerplExchange's start_block.
    await indexer.process({ chains: { 10143: { startBlock: FIRST_TRADE[0], endBlock: FIRST_MON_MARK } } });

    const vault = await indexer.Vault.getOrThrow(VAULT);
    t.expect(vault.deposited).toBe(400_000_000n);
    t.expect(vault.backerCount).toBe(1);
    // Two executes: 100 AUSD of margin onto Perpl (tx 0x59c5…ea92), then the MON long (tx 0x0c6a…0fdc).
    // Only the order is a trade.
    t.expect(vault.executeCount).toBe(2);
    t.expect(vault.tradeCount).toBe(1);
    t.expect(vault.tradeVolume).toBe(50_270_000n); // the order's notional, not the margin
    const executes = (await indexer.Trade.getAll()).sort((a, b) => a.timestamp - b.timestamp);
    t.expect(executes.map((e) => [e.kind, e.notional])).toEqual([
      ["MarginIn", 100_000_000n],
      ["Order", 50_270_000n],
    ]);
    t.expect(vault.nav).toBe(399_909_625n); // Executed.navAfter of the order (tx 0x0c6a…0fdc)
    t.expect(vault.pnl).toBe(-90_375n);
    t.expect(vault.frozen).toBe(false);

    const adapter = await indexer.Adapter.getOrThrow(ADAPTER);
    t.expect(adapter.kind).toBe("Perpl");
    t.expect(adapter.perplAccountId).toBe(740n);
    t.expect(adapter.perplMarginIn).toBe(100_000_000n);
    t.expect(adapter.perplOrderCount).toBe(1);

    // Perpl Exchange side, decoded by hand from tx 0x0c6a…0fdc: PositionOpenedV2(64, 740, Long, 1x,
    // deposit 50.0872, price 2736, 1828 lots), then TakerOrderFilledV2(fee 17255 = insFee 2589 + protFee 14666).
    const account = await indexer.PerplAccount.getOrThrow("740");
    t.expect(account.vault_id).toBe(VAULT);
    t.expect(account.fees).toBe(17_255n);
    t.expect(account.fillCount).toBe(1);
    t.expect(account.volume).toBe(50_014_080n); // 2736 x 1828 x 10^1

    t.expect((await indexer.Perp.getOrThrow("64")).scaleExp).toBe(1); // MON: 5 price dp, 0 lot dp

    const fills = await indexer.PerplFill.getAll();
    t.expect(fills).toHaveLength(1);
    t.expect(fills[0]).toMatchObject({ role: "Taker", price: 2_736n, lot: 1_828n, fee: 17_255n, notional: 50_014_080n });

    const pos = await indexer.PerplPosition.getOrThrow("740-64");
    t.expect(pos).toMatchObject({ side: "Long", lot: 1_828n, entryPrice: 2_736n, deposit: 50_087_200n, leverageHdths: 100n });
    t.expect(pos.notional).toBe(49_904_400n); // at the next MON mark, 2730: 2730 x 1828 x 10
    t.expect(pos.unrealisedPnl).toBe(-109_680n);
  });
});
