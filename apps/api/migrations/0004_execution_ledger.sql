CREATE TABLE IF NOT EXISTS execution_intents (
  execution_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  product TEXT NOT NULL CHECK(product IN ('spot','perpetual')),
  state TEXT NOT NULL CHECK(state IN ('review','submitted','confirmed','failed','unknown')),
  signature TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS execution_intents_user_activity
  ON execution_intents(user_id, updated_at DESC, execution_id DESC);

CREATE INDEX IF NOT EXISTS execution_intents_wallet_activity
  ON execution_intents(wallet_address, updated_at DESC, execution_id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS execution_intents_signature
  ON execution_intents(signature) WHERE signature IS NOT NULL;
