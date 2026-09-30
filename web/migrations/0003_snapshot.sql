-- Leaderboard snapshot, copied from the Envio indexer by the Worker's cron (app/lib/snapshot.server.ts).
-- Amounts are decimal strings of base units (AUSD/USDC: 6 dp; share prices WAD) because they pass 2^53.
-- Every table is keyed by chain so mainnet (143) can sit next to testnet (10143).

-- One row per agent vault: the leaderboard.
CREATE TABLE IF NOT EXISTS vaults (
  chain_id               INTEGER NOT NULL,
  vault                  TEXT NOT NULL,
  agent_id               TEXT NOT NULL,
  owner                  TEXT NOT NULL,
  asset                  TEXT NOT NULL,
  frozen                 INTEGER NOT NULL,
  nav                    TEXT NOT NULL,
  total_shares           TEXT NOT NULL,
  share_price            TEXT NOT NULL,
  peak_share_price       TEXT NOT NULL,
  max_drawdown_bps       INTEGER NOT NULL,
  deposited              TEXT NOT NULL,
  withdrawn              TEXT NOT NULL,
  fees_paid              TEXT NOT NULL,
  pnl                    TEXT NOT NULL,
  trade_count            INTEGER NOT NULL,
  trade_volume           TEXT NOT NULL,
  breach_count           INTEGER NOT NULL,
  freeze_count           INTEGER NOT NULL,
  backer_count           INTEGER NOT NULL,
  max_trade_notional     TEXT NOT NULL,
  daily_loss_cap_bps     INTEGER NOT NULL,
  deposit_cap_per_backer TEXT NOT NULL,
  venues                 TEXT NOT NULL, -- JSON array of adapter addresses
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  PRIMARY KEY (chain_id, vault)
);
CREATE INDEX IF NOT EXISTS vaults_agent ON vaults (chain_id, agent_id);

-- Open Perpl positions, replaced on every sync. Prices are raw Perpl PNS; amounts CNS (6 dp).
CREATE TABLE IF NOT EXISTS positions (
  chain_id       INTEGER NOT NULL,
  id             TEXT NOT NULL, -- accountId-perpId
  vault          TEXT NOT NULL,
  perp_id        TEXT NOT NULL,
  side           TEXT NOT NULL,
  lot            TEXT NOT NULL,
  entry_price    TEXT NOT NULL,
  deposit        TEXT NOT NULL,
  leverage_hdths TEXT NOT NULL,
  realised_pnl   TEXT NOT NULL,
  funding        TEXT NOT NULL,
  notional       TEXT,
  unrealised_pnl TEXT,
  mark_price     TEXT,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (chain_id, id)
);
CREATE INDEX IF NOT EXISTS positions_vault ON positions (chain_id, vault);

-- Share-price history for charts, copied incrementally by block.
CREATE TABLE IF NOT EXISTS nav_points (
  chain_id    INTEGER NOT NULL,
  id          TEXT NOT NULL,
  vault       TEXT NOT NULL,
  nav         TEXT NOT NULL,
  share_price TEXT NOT NULL,
  timestamp   INTEGER NOT NULL,
  block       INTEGER NOT NULL,
  PRIMARY KEY (chain_id, id)
);
CREATE INDEX IF NOT EXISTS nav_points_vault ON nav_points (chain_id, vault, block);

-- One row per chain: when the snapshot last succeeded and how far the indexer had got.
CREATE TABLE IF NOT EXISTS snapshot_meta (
  chain_id      INTEGER PRIMARY KEY,
  synced_at     TEXT,    -- last successful sync (ISO)
  indexer_block INTEGER, -- indexer progress block at that sync
  chain_block   INTEGER, -- chain head the indexer saw
  attempted_at  TEXT,    -- last attempt, successful or not
  last_error    TEXT     -- null after a successful sync
);
