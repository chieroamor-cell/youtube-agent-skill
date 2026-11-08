CREATE TABLE IF NOT EXISTS optimizer_watch_state (
 channel_id TEXT PRIMARY KEY,initialized_at TEXT NOT NULL,last_scan_at TEXT,last_error TEXT,
 scan_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS optimizer_seen_videos (
 video_id TEXT PRIMARY KEY,channel_id TEXT NOT NULL,first_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS optimizer_seen_channel ON optimizer_seen_videos(channel_id);
CREATE TABLE IF NOT EXISTS optimizer_drafts (
 video_id TEXT PRIMARY KEY,channel_id TEXT NOT NULL,original_title TEXT NOT NULL,
 proposed_title TEXT NOT NULL,alternate_title TEXT NOT NULL DEFAULT '',proposed_description TEXT NOT NULL,suggested_tags_json TEXT NOT NULL,
 thumbnail_brief TEXT NOT NULL,duration_seconds INTEGER NOT NULL,privacy TEXT NOT NULL,video_published_at TEXT,
 status TEXT NOT NULL DEFAULT 'needs_review' CHECK(status IN ('needs_review','approved','archived')),selected_title TEXT NOT NULL DEFAULT 'original' CHECK(selected_title IN ('original','alternate')),approved_at TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS optimizer_drafts_order ON optimizer_drafts(channel_id,created_at);
CREATE TABLE IF NOT EXISTS optimizer_video_inventory (
 video_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, title TEXT NOT NULL,
 privacy TEXT NOT NULL, duration_seconds INTEGER NOT NULL, description TEXT NOT NULL,
 published_at TEXT, last_checked_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS optimizer_video_inventory_channel ON optimizer_video_inventory(channel_id,privacy);
