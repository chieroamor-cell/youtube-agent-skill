-- Already applied once to the connected Cloudflare D1 database.
-- For existing versions where optimizer_drafts lacks alternate_title only:
ALTER TABLE optimizer_drafts ADD COLUMN alternate_title TEXT NOT NULL DEFAULT '';
