// D1 access: the decision log (the house agents' auditable track record) and perp mark history.
// Tables: web/migrations/0005_agent_decisions.sql.
import type { MarkSample } from "./strategy.ts";

export type DecisionRow = {
  chainId: number;
  agentId: string;
  mode: string;
  model: string;
  prompt?: unknown;
  response?: unknown;
  action: string;
  size?: string | null;
  valid: boolean;
  reason?: string | null;
  txHash?: string | null;
  error?: string | null;
  detail?: unknown;
};

const KEEP_MARKS_SECONDS = 2 * 86_400;

/** JSON with bigints as decimal strings. */
export const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

export async function logDecision(db: D1Database, r: DecisionRow) {
  const row = await db
    .prepare(
      `INSERT INTO agent_decisions (chain_id, agent_id, mode, model, prompt, response, action, size, valid, reason, tx_hash, error, detail)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13) RETURNING id`,
    )
    .bind(
      r.chainId,
      r.agentId,
      r.mode,
      r.model,
      json(r.prompt),
      json(r.response),
      r.action,
      r.size ?? null,
      r.valid ? 1 : 0,
      r.reason ?? null,
      r.txHash ?? null,
      r.error ?? null,
      json(r.detail),
    )
    .first<{ id: number }>();
  return row?.id;
}

/** Stores this run's mark and returns the samples inside the lookback (plus slack), oldest first. */
export async function recordMark(db: D1Database, chainId: number, perpId: bigint, sample: MarkSample, priceDecimals: number, lookbackMinutes: number) {
  const perp = perpId.toString();
  await db.batch([
    db
      .prepare(`INSERT OR REPLACE INTO perp_marks (chain_id, perp_id, at, mark, price_decimals) VALUES (?1, ?2, ?3, ?4, ?5)`)
      .bind(chainId, perp, sample.at, sample.mark.toString(), priceDecimals),
    db.prepare(`DELETE FROM perp_marks WHERE chain_id = ?1 AND perp_id = ?2 AND at < ?3`).bind(chainId, perp, sample.at - KEEP_MARKS_SECONDS),
  ]);
  const since = sample.at - lookbackMinutes * 60 - 600;
  const { results } = await db
    .prepare(`SELECT at, mark FROM perp_marks WHERE chain_id = ?1 AND perp_id = ?2 AND at >= ?3 AND at < ?4 ORDER BY at`)
    .bind(chainId, perp, since, sample.at)
    .all<{ at: number; mark: string }>();
  return results.map((r) => ({ at: r.at, mark: BigInt(r.mark) }));
}

export async function recentDecisions(db: D1Database, chainId: number, limit: number) {
  const { results } = await db
    .prepare(
      `SELECT id, chain_id, agent_id, at, mode, model, action, size, valid, reason, tx_hash, error
       FROM agent_decisions WHERE chain_id = ?1 ORDER BY id DESC LIMIT ?2`,
    )
    .bind(chainId, limit)
    .all();
  return results;
}
