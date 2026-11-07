# InfamousHub Story Agent — Cloudflare staging coordinator (v0.2.0)

The new independent Cloudflare account now contains:
- Worker script: `infamoushub-story-coordinator`
- D1: `infamoushub-story-jobs` in EU jurisdiction
- D1 binding: `DB`
- `SCHEDULE_ENABLED=NO` (**disabled**)
- Zero Cron Triggers and zero scheduled jobs.

This is a **staging metadata coordinator only**, not a complete automatic YouTube video creator. The Worker accepts no public publication requests; it has no YouTube OAuth tokens and does not generate videos or upload to YouTube. Health is read-only. Protected job routes require a 32+ character `RENDERER_TOKEN`, which is **not configured** yet. No secret is stored in GitHub.

Source and SQL are in `coordinator.mjs` and `schema.sql`; tests in `coordinator.test.mjs`. GitHub CI verifies safety with `node --test`. It must remain disabled until a local/self-hosted renderer has finished a real original English story, verified sources and rights, and passed a private YouTube upload test.

Cloudflare Workers are only for coordinating job status, not long FFmpeg rendering. This setup made no purchase or subscription; actual free-tier availability and future consumption must be monitored. Existing Shorts and Pinterest bots remain untouched.
