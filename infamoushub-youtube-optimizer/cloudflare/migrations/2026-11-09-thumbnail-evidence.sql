-- Already applied to live D1 on 2026-11-09. Apply only if columns are absent.
ALTER TABLE optimizer_drafts ADD COLUMN thumbnail_headline TEXT NOT NULL DEFAULT '';
ALTER TABLE optimizer_drafts ADD COLUMN content_source TEXT NOT NULL DEFAULT 'metadata_only';
