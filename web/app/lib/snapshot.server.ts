import {
  ACTIVITY_QUERY,
  BACKER_QUERY,
  TRADES_QUERY,
  gql,
  NAV_POINT_PAGE,
  SNAPSHOT_QUERY,
  type IndexedActivity,
  type IndexedBacker,
  type IndexedTrades,
  type SnapshotData,
} from "./indexer.server";
import { houseAgent } from "./agents";

// The Worker's cron copies the indexer into D1 every minute (syncSnapshot). Pages, the JSON API and
// preview images read D1 (readLeaderboard, readAgent), so they don't depend on Envio being up.

const STALE_AFTER_MS = 5 * 60_000;
const NAV_PAGES_PER_SYNC = 5;

export type SnapshotEnv = { DB: D1Database; ENVIO_GRAPHQL_URL: string; CHAIN_ID: string };

export type SyncResult = { chainId: number; vaults: number; positions: number; navPoints: number; indexerBlock: number | null };

export async function syncSnapshot(env: SnapshotEnv): Promise<SyncResult> {
  const chainId = Number(env.CHAIN_ID);
  const attemptedAt = new Date().toISOString();
  try {
    const result = await copy(env.DB, env.ENVIO_GRAPHQL_URL, chainId, attemptedAt);
    return result;
  } catch (err) {
    // Keep the last good snapshot and record why this one failed.
    await env.DB.prepare(
      `INSERT INTO snapshot_meta (chain_id, attempted_at, last_error) VALUES (?1, ?2, ?3)
       ON CONFLICT(chain_id) DO UPDATE SET attempted_at = excluded.attempted_at, last_error = excluded.last_error`,
    )
      .bind(chainId, attemptedAt, String(err instanceof Error ? err.message : err).slice(0, 500))
      .run();
    throw err;
  }
}

async function copy(db: D1Database, url: string, chainId: number, attemptedAt: string): Promise<SyncResult> {
  const last = await db
    .prepare(`SELECT COALESCE(MAX(block), 0) AS block FROM nav_points WHERE chain_id = ?1`)
    .bind(chainId)
    .first<{ block: number }>();
  let sinceBlock = last?.block ?? 0;

  let data = await gql<SnapshotData>(url, SNAPSHOT_QUERY, { chainId, sinceBlock, navLimit: NAV_POINT_PAGE });
  const meta = data._meta[0];
  if (!meta) throw new Error(`indexer has no chain ${chainId}`);

  // Rows go in as one JSON array per table and are unpacked with json_each: a statement per table
  // rather than per row, because D1 counts every statement against the per-invocation query limit.
  const statements: D1PreparedStatement[] = [];

  const vaults = data.Vault.map((v) => ({
    vault: v.id, agent_id: v.agent.id, owner: v.agent.owner, asset: v.asset, frozen: v.frozen ? 1 : 0, nav: v.nav,
    total_shares: v.totalShares, share_price: v.sharePrice, peak_share_price: v.peakSharePrice,
    max_drawdown_bps: v.maxDrawdownBps, deposited: v.deposited, withdrawn: v.withdrawn, fees_paid: v.feesPaid,
    pnl: v.pnl, trade_count: v.tradeCount, trade_volume: v.tradeVolume, breach_count: v.breachCount,
    freeze_count: v.freezeCount, backer_count: v.backerCount, max_trade_notional: v.agent.maxTradeNotional,
    daily_loss_cap_bps: v.agent.dailyLossCapBps, deposit_cap_per_backer: v.agent.depositCapPerBacker,
    venues: JSON.stringify(v.agent.venues), created_at: v.createdAt, updated_at: v.updatedAt,
  }));
  if (vaults.length) statements.push(insertJson(db, "vaults", Object.keys(vaults[0]), chainId, vaults));

  // Closed positions drop out of the query, so positions are replaced wholesale.
  statements.push(db.prepare(`DELETE FROM positions WHERE chain_id = ?1`).bind(chainId));
  const positions = data.PerplPosition.map((p) => ({
    id: p.id, vault: p.vault, perp_id: p.perpId, side: p.side, lot: p.lot, entry_price: p.entryPrice,
    deposit: p.deposit, leverage_hdths: p.leverageHdths, realised_pnl: p.realisedPnl, funding: p.funding,
    notional: p.notional, unrealised_pnl: p.unrealisedPnl, mark_price: p.perp.markPrice, updated_at: p.updatedAt,
  }));
  if (positions.length) statements.push(insertJson(db, "positions", Object.keys(positions[0]), chainId, positions));

  const navColumns = ["id", "vault", "nav", "share_price", "timestamp", "block"];
  let navPoints = 0;
  for (let page = 0; ; page++) {
    if (data.NavPoint.length) {
      const rows = data.NavPoint.map((n) => ({
        id: n.id, vault: n.vault_id, nav: n.nav, share_price: n.sharePrice, timestamp: n.timestamp, block: n.block,
      }));
      statements.push(insertJson(db, "nav_points", navColumns, chainId, rows));
    }
    navPoints += data.NavPoint.length;
    // A full page means there may be more. The next page starts at the last block (a block can hold
    // several points, so `_gte`); if one block alone fills a page, stop rather than loop.
    const lastBlock = data.NavPoint.at(-1)?.block;
    if (data.NavPoint.length < NAV_POINT_PAGE || lastBlock === undefined || lastBlock === sinceBlock) break;
    if (page + 1 >= NAV_PAGES_PER_SYNC) break; // the rest comes on the next run
    sinceBlock = lastBlock;
    data = await gql<SnapshotData>(url, SNAPSHOT_QUERY, { chainId, sinceBlock, navLimit: NAV_POINT_PAGE });
  }

  statements.push(
    db
      .prepare(
        `INSERT OR REPLACE INTO snapshot_meta (chain_id, synced_at, indexer_block, chain_block, attempted_at, last_error)
         VALUES (?1, ?2, ?3, ?4, ?2, NULL)`,
      )
      .bind(chainId, attemptedAt, meta.progressBlock, meta.sourceBlock),
  );

  // One batch is one transaction: readers never see half a snapshot.
  await db.batch(statements);
  return {
    chainId,
    vaults: data.Vault.length,
    positions: data.PerplPosition.length,
    navPoints,
    indexerBlock: meta.progressBlock,
  };
}

// INSERT OR REPLACE every row of a JSON array. Column names are ours, never user input.
function insertJson(
  db: D1Database,
  table: string,
  columns: string[],
  chainId: number,
  rows: object[],
) {
  const f = (col: string) => `json_extract(j.value, '$.${col}')`;
  return db
    .prepare(
      `INSERT OR REPLACE INTO ${table} (chain_id, ${columns.join(", ")})
       SELECT ?1, ${columns.map(f).join(", ")} FROM json_each(?2) AS j`,
    )
    .bind(chainId, JSON.stringify(rows));
}

// ------------------------------------------------------------------ reads

type VaultRow = {
  vault: string;
  agent_id: string;
  owner: string;
  asset: string;
  frozen: number;
  nav: string;
  total_shares: string;
  share_price: string;
  peak_share_price: string;
  max_drawdown_bps: number;
  deposited: string;
  withdrawn: string;
  fees_paid: string;
  pnl: string;
  trade_count: number;
  trade_volume: string;
  breach_count: number;
  freeze_count: number;
  backer_count: number;
  max_trade_notional: string;
  daily_loss_cap_bps: number;
  deposit_cap_per_backer: string;
  venues: string;
  created_at: number;
  updated_at: number;
};

type PositionRow = {
  id: string;
  vault: string;
  perp_id: string;
  side: string;
  lot: string;
  entry_price: string;
  deposit: string;
  leverage_hdths: string;
  realised_pnl: string;
  funding: string;
  notional: string | null;
  unrealised_pnl: string | null;
  mark_price: string | null;
  updated_at: number;
};

type MetaRow = {
  synced_at: string | null;
  indexer_block: number | null;
  chain_block: number | null;
  attempted_at: string | null;
  last_error: string | null;
};

const WAD = 10n ** 18n;

export type LeaderboardAgent = ReturnType<typeof toAgent>;

// Amounts stay decimal strings of base units: format them with formatUnits(x, 6) in the UI.
function toAgent(chainId: number, r: VaultRow, openPnl: bigint | null) {
  const house = houseAgent(chainId, r.agent_id);
  return {
    agentId: r.agent_id,
    name: house?.name ?? `Agent #${r.agent_id}`,
    house: house !== undefined,
    owner: r.owner,
    vault: r.vault,
    asset: r.asset,
    frozen: r.frozen === 1,
    nav: r.nav,
    totalShares: r.total_shares,
    sharePrice: r.share_price,
    // Share-price return since inception in basis points: the ranking metric.
    returnBps: Number(((BigInt(r.share_price) - WAD) * 10_000n) / WAD),
    peakSharePrice: r.peak_share_price,
    maxDrawdownBps: r.max_drawdown_bps,
    deposited: r.deposited,
    withdrawn: r.withdrawn,
    feesPaid: r.fees_paid,
    pnl: r.pnl,
    // Unrealised PnL of open Perpl positions at the latest mark. NAV already counts them as of the
    // last execute, so this is informational and must not be added to NAV.
    openPnl: openPnl === null ? null : openPnl.toString(),
    tradeCount: r.trade_count,
    tradeVolume: r.trade_volume,
    breachCount: r.breach_count,
    freezeCount: r.freeze_count,
    backerCount: r.backer_count,
    envelope: {
      maxTradeNotional: r.max_trade_notional,
      dailyLossCapBps: r.daily_loss_cap_bps,
      depositCapPerBacker: r.deposit_cap_per_backer,
      venues: JSON.parse(r.venues) as string[],
    },
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toPosition(r: PositionRow) {
  return {
    id: r.id,
    perpId: r.perp_id,
    side: r.side,
    lot: r.lot,
    entryPrice: r.entry_price,
    markPrice: r.mark_price,
    deposit: r.deposit,
    leverageHdths: r.leverage_hdths,
    notional: r.notional,
    unrealisedPnl: r.unrealised_pnl,
    realisedPnl: r.realised_pnl,
    funding: r.funding,
    updatedAt: r.updated_at,
  };
}

function toMeta(chainId: number, m: MetaRow | null) {
  const syncedAt = m?.synced_at ?? null;
  return {
    chainId,
    syncedAt,
    indexerBlock: m?.indexer_block ?? null,
    chainBlock: m?.chain_block ?? null,
    stale: syncedAt === null || Date.now() - Date.parse(syncedAt) > STALE_AFTER_MS,
    lastError: m?.last_error ?? null,
  };
}

async function readMeta(db: D1Database, chainId: number) {
  return db.prepare(`SELECT * FROM snapshot_meta WHERE chain_id = ?1`).bind(chainId).first<MetaRow>();
}

// Before the first cron run (a fresh deploy, or local dev) there is no snapshot, and if the cron
// stops the snapshot goes stale. Either way, take one inline.
async function ensureSnapshot(env: SnapshotEnv, chainId: number) {
  const meta = await readMeta(env.DB, chainId);
  if (meta?.synced_at && !toMeta(chainId, meta).stale) return meta;
  try {
    await syncSnapshot(env);
  } catch {
    // Fall through: the reader reports the empty snapshot and the error.
  }
  return readMeta(env.DB, chainId);
}

function openPnlByVault(rows: PositionRow[]) {
  const sums = new Map<string, bigint | null>();
  for (const p of rows) {
    const prev = sums.has(p.vault) ? sums.get(p.vault)! : 0n;
    // One position without a mark makes the vault's total unknown.
    sums.set(p.vault, prev === null || p.unrealised_pnl === null ? null : prev + BigInt(p.unrealised_pnl));
  }
  return sums;
}

// Best share-price return first; ties go to the vault with more trades, then the older agent.
function byRank(a: LeaderboardAgent, b: LeaderboardAgent) {
  return b.returnBps - a.returnBps || b.tradeCount - a.tradeCount || a.createdAt - b.createdAt;
}

export async function readLeaderboard(env: SnapshotEnv) {
  const chainId = Number(env.CHAIN_ID);
  const meta = await ensureSnapshot(env, chainId);
  const [vaults, positions] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM vaults WHERE chain_id = ?1`).bind(chainId),
    env.DB.prepare(`SELECT * FROM positions WHERE chain_id = ?1`).bind(chainId),
  ]);
  const open = openPnlByVault(positions.results as PositionRow[]);
  const agents = (vaults.results as VaultRow[])
    .map((r) => toAgent(chainId, r, open.has(r.vault) ? open.get(r.vault)! : 0n))
    .sort(byRank)
    .map((a, i) => ({ rank: i + 1, ...a }));
  return { ...toMeta(chainId, meta), agents };
}

export async function readAgent(env: SnapshotEnv, agentId: string, navPointLimit = 500) {
  const chainId = Number(env.CHAIN_ID);
  const meta = await ensureSnapshot(env, chainId);
  // Every vault, to place this one on the board. There are few enough that this is one small read.
  const all = await env.DB.prepare(`SELECT * FROM vaults WHERE chain_id = ?1`).bind(chainId).all<VaultRow>();
  const row = all.results.find((r) => r.agent_id === agentId);
  if (!row) return null;
  const rank = all.results.map((r) => toAgent(chainId, r, null)).sort(byRank).findIndex((a) => a.agentId === agentId) + 1;
  const [positions, navPoints] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM positions WHERE chain_id = ?1 AND vault = ?2 ORDER BY id`).bind(chainId, row.vault),
    // Latest points, returned oldest first for charting.
    env.DB.prepare(
      `SELECT nav, share_price, timestamp, block FROM (
         SELECT * FROM nav_points WHERE chain_id = ?1 AND vault = ?2 ORDER BY block DESC, id DESC LIMIT ?3
       ) ORDER BY block, id`,
    ).bind(chainId, row.vault, navPointLimit),
  ]);
  const positionRows = positions.results as PositionRow[];
  const open = openPnlByVault(positionRows);
  return {
    ...toMeta(chainId, meta),
    agent: toAgent(chainId, row, open.has(row.vault) ? open.get(row.vault)! : 0n),
    rank,
    of: all.results.length,
    positions: positionRows.map(toPosition),
    navPoints: (navPoints.results as { nav: string; share_price: string; timestamp: number; block: number }[]).map(
      (n) => ({ nav: n.nav, sharePrice: n.share_price, timestamp: n.timestamp, block: n.block }),
    ),
  };
}

// Latest trades, flows and policy events, read live. Null when the indexer can't be reached.
export async function readActivity(env: SnapshotEnv, vault: string, limit = 20) {
  try {
    return await gql<IndexedActivity>(env.ENVIO_GRAPHQL_URL, ACTIVITY_QUERY, { vault, limit }, 4000);
  } catch {
    return null;
  }
}

// A backer's portfolio: every agent on the board (so the client can read its shares in each from the
// chain), what the indexer knows about this account's deposits, and the open positions and latest
// trades of the vaults it backs. `history` is null when the indexer can't be reached.
export async function readBacker(env: SnapshotEnv, account: string, limit = 20) {
  const board = await readLeaderboard(env);
  let history: (IndexedBacker & IndexedTrades) | null = null;
  try {
    const mine = await gql<IndexedBacker>(env.ENVIO_GRAPHQL_URL, BACKER_QUERY, { account, limit }, 4000);
    const vaults = mine.Backer.map((b) => b.vault_id);
    const trades = vaults.length
      ? await gql<IndexedTrades>(env.ENVIO_GRAPHQL_URL, TRADES_QUERY, { vaults, limit }, 4000)
      : { Trade: [] };
    history = { ...mine, ...trades };
  } catch {
    // Live balances still come from the chain.
  }
  const vaults = history?.Backer.map((b) => b.vault_id) ?? [];
  const positions = vaults.length
    ? (
        await env.DB.prepare(
          `SELECT * FROM positions WHERE chain_id = ?1 AND vault IN (${vaults.map((_, i) => `?${i + 2}`).join(",")}) ORDER BY id`,
        )
          .bind(board.chainId, ...vaults)
          .all<PositionRow>()
      ).results.map((r) => ({ vault: r.vault, ...toPosition(r) }))
    : [];
  return { ...board, account, history, positions };
}
