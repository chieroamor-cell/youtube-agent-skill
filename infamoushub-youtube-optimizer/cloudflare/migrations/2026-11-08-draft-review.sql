-- Applied 2026-11-08 to the connected D1; additive, no existing drafts changed.
ALTER TABLE optimizer_drafts ADD COLUMN selected_title TEXT NOT NULL DEFAULT 'original';
ALTER TABLE optimizer_drafts ADD COLUMN approved_at TEXT;
