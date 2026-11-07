CREATE TABLE IF NOT EXISTS oauth_attempts (
 state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL,
 code_verifier TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_channel (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 channel_id TEXT NOT NULL,channel_title TEXT NOT NULL,
 token_iv TEXT NOT NULL,token_ct TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','active')),
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_attempts_expiry ON oauth_attempts(expires_at);