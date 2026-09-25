CREATE TABLE IF NOT EXISTS kamino_lending_actions (
  action_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('review','in_progress','confirmed','failed','unknown','refresh_required')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE(user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS kamino_lending_actions_owner
  ON kamino_lending_actions(user_id, wallet_address, updated_at DESC);
