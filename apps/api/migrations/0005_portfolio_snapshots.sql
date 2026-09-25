CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  user_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  hour_bucket TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  net_equity_usd REAL NOT NULL,
  PRIMARY KEY(user_id, wallet_address, hour_bucket)
);

CREATE INDEX IF NOT EXISTS portfolio_snapshots_history
  ON portfolio_snapshots(user_id, wallet_address, captured_at DESC);
