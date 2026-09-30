-- Testnet gas drips for new backer accounts (app/lib/drip.server.ts). One row per drip, so the
-- per-address and per-IP limits can be checked, and so we can see how many people got started.
CREATE TABLE drips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain_id INTEGER NOT NULL,
  address TEXT NOT NULL,
  ip TEXT,
  mon_tx TEXT,
  ausd_tx TEXT,
  at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX drips_address ON drips (chain_id, address, at);
CREATE INDEX drips_ip ON drips (ip, at);
