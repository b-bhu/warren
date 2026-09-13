CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active');
CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id), family TEXT NOT NULL CHECK(family IN ('evm','solana')),
  namespace TEXT NOT NULL, chain_id TEXT, cluster TEXT, address_normalized TEXT NOT NULL, address_display TEXT NOT NULL,
  verified_at TEXT NOT NULL, revoked_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS wallets_canonical_active ON wallets(namespace, chain_id, cluster, address_normalized) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS wallets_profile_family_active ON wallets(profile_id, family) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS auth_attempts (
  id TEXT PRIMARY KEY, purpose TEXT NOT NULL, initiating_profile_id TEXT REFERENCES profiles(id), family TEXT NOT NULL,
  provider_id TEXT NOT NULL, capability_digest TEXT NOT NULL, state TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sign_challenges (
  id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES auth_attempts(id), protocol TEXT NOT NULL, nonce TEXT NOT NULL UNIQUE,
  message_utf8 TEXT NOT NULL, message_sha256 TEXT NOT NULL, address_normalized TEXT NOT NULL, address_display TEXT NOT NULL, chain_context TEXT NOT NULL,
  issued_at TEXT NOT NULL, not_before TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT, invalidated_at TEXT
);
CREATE TABLE IF NOT EXISTS provider_requests (
  id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES auth_attempts(id), challenge_id TEXT NOT NULL REFERENCES sign_challenges(id),
  provider_request_id TEXT NOT NULL UNIQUE, state TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(attempt_id, challenge_id)
);
CREATE TABLE IF NOT EXISTS session_families (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id), created_at TEXT NOT NULL, revoked_at TEXT, revoke_reason TEXT);
CREATE TABLE IF NOT EXISTS access_tokens (id TEXT PRIMARY KEY, family_id TEXT NOT NULL REFERENCES session_families(id), digest TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT);
CREATE TABLE IF NOT EXISTS refresh_tokens (id TEXT PRIMARY KEY, family_id TEXT NOT NULL REFERENCES session_families(id), digest TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT, revoked_at TEXT, replaced_by TEXT);
CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, category TEXT NOT NULL, attempt_id TEXT, profile_id TEXT, metadata TEXT NOT NULL DEFAULT '{}');
