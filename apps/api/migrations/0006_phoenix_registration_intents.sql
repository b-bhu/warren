CREATE TABLE IF NOT EXISTS phoenix_registration_intents (
  registration_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('non_referral','referral')),
  state TEXT NOT NULL CHECK(state IN ('review','submitted','confirmed','failed','unknown')),
  signature TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS phoenix_registration_intents_owner
  ON phoenix_registration_intents(user_id, wallet_address, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS phoenix_registration_intents_signature
  ON phoenix_registration_intents(signature) WHERE signature IS NOT NULL;
