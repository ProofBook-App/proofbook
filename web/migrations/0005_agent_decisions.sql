-- House-agent track record, written by the proofbook-agents Worker (agents/src/run.ts) every run.
-- One row per agent per run: what the model saw and said, what the validator decided, and the tx.
-- Amounts are decimal strings in the vault asset (AUSD, 6 dp). No secrets are ever stored here.
CREATE TABLE IF NOT EXISTS agent_decisions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  chain_id  INTEGER NOT NULL,
  agent_id  TEXT NOT NULL,
  at        INTEGER NOT NULL DEFAULT (unixepoch()),
  mode      TEXT NOT NULL,     -- 'dry-run' | 'live'
  model     TEXT NOT NULL,     -- '@cf/moonshotai/kimi-k2.6', or 'rule' when no model was asked (frozen, margin)
  prompt    TEXT,              -- JSON: the messages sent to the model
  response  TEXT,              -- JSON: the model's raw response
  action    TEXT NOT NULL,     -- what was proposed: hold | open_long | open_short | close | deposit_margin | stop | none
  size      TEXT,              -- proposed size (AUSD) for opens and margin moves
  valid     INTEGER NOT NULL,  -- 1 when it passed the validator, the adapter quote and the eth_call simulation
  reason    TEXT,              -- the one-sentence public reason
  tx_hash   TEXT,              -- live mode only
  error     TEXT,              -- why it was rejected or failed
  detail    TEXT               -- JSON: observation, momentum, the published rule's answer, checks, calldata, gas
);
CREATE INDEX IF NOT EXISTS agent_decisions_agent ON agent_decisions (chain_id, agent_id, at);

-- Perp mark samples, one per run, for the momentum lookback. Raw Perpl PNS (price decimals alongside).
CREATE TABLE IF NOT EXISTS perp_marks (
  chain_id       INTEGER NOT NULL,
  perp_id        TEXT NOT NULL,
  at             INTEGER NOT NULL,
  mark           TEXT NOT NULL,
  price_decimals INTEGER NOT NULL,
  PRIMARY KEY (chain_id, perp_id, at)
);
