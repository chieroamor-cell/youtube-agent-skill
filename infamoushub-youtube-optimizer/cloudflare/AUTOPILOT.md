# InfamousHub YouTube Optimizer — Automatic discovery v0.3.0

## Current state (Cloudflare account used only for new long-video optimizer)

- YouTube channel authorized: `infamoushub`, `UC7bPVW93xdIXPREbFoHXVrw`.
- Worker: `infamoushub-youtube-connect`, with authorized admin login and the encrypted YouTube refresh token.
- Scheduled discovery: **`15 * * * *` (hourly at minute 15 UTC)**. `AUTO_DISCOVERY=YES`.
- Channel inspection: only the authenticated owner's latest 50 uploads, and only videos at least **4 minutes** long; livestreams and wrong-channel videos are filtered.
- First automatic scan: **baseline only**. Existing videos are remembered, **without** retroactive changes or proposals.
- Subsequent scans: each new eligible video creates at most one D1 editorial **draft**, using the true YouTube title and description and retaining existing credit text. A thumbnail **design brief** is saved. No thumbnail is rendered/uploaded.
- D1 `optimizer_watch_state`, `optimizer_seen_videos`, `optimizer_drafts`; IDs and proposal drafts stay private in EU-jurisdiction D1.
- Safe D1 batches keep the 50-video baseline and new video+draft pairs atomic and within Free-plan invocation query limits.
- Protected dashboard: `https://infamoushub-youtube-connect.infamoushub-yt-29bea3.workers.dev/connect`; then **Detector automático** and **Propuestas SEO**.
- Manual scan is an optional button for immediate read-only checking, protected by admin session + CSRF.
- `/health` must report `edits_enabled:false`, `uploads_enabled:false`, `publication_enabled:false`.

## Explicit limitations — NOT a fully automatic YouTube optimizer yet

**No titles, descriptions, tags, thumbnails, privacy settings or videos are modified on YouTube.** The system only *discovers and drafts*.
The suggested title defaults to the verified original title: no transcript, frames, or factual evidence are currently analyzed. A draft thumbnail brief is NOT an actual JPG/PNG thumbnail.
A production-quality generator of visual thumbnails and an approved, narrowly-scoped video metadata writer still need implementation and end-to-end testing. Do not enable video writes solely because GitHub CI passes. No views or reach are guaranteed.

## Cost controls

Only uses Cloudflare Workers, D1 and the official YouTube Data API with a bounded hourly cadence. No paid external AI APIs, video/image services, GPU compute, or subscription were activated. The user requires **0 CHF** and no usage charges. Check Cloudflare plan and usage regularly; stop on quota errors rather than upgrading. Cloudflare Images was explored but an independent test returned a service-unavailable response, so the Images binding and image transformations were **not** enabled on the optimizer.

## Recovery

The OAuth credential remains encrypted in the new Cloudflare account; do not move it into GitHub or reveal it. If a Google Testing refresh token later expires, protected read-only scans will fail safely; the admin must review Google's consent-screen mode rather than silently modifying or reauthorizing the old Shorts bot. Do not touch the old Cloudflare account, Shorts Bot or original eleven youtube-agent-skill commands.

## Testing

`node --test cloudflare/autopilot.test.mjs` validates baseline/no duplicates, title accuracy/credits, Shorts exclusion and atomic batch behavior; `node --test cloudflare/yt-connect.test.mjs` validates OAuth and owner authentication, plus the private video list. CI also executes the existing Python tests. The exact last passing run is in the repository GitHub Actions history.

Use the panel to inspect the first live scan. A scheduled trigger existing in Cloudflare is not proof that it has run successfully; check `last_scan_at` and YouTube API read results before calling live discovery verified.

## Update: manual first draft and alternative SEO title

The first automatic scheduled scan on **2026-11-08 21:15:46 UTC** succeeded for the connected `infamoushub` channel:
- `optimizer_watch_state.scan_count=1`, `last_error=NULL`.
- 1 existing long video marked as seen (baseline only); **0 drafts** created, as expected.
- New automatic scans run hourly at minute 15 UTC, using only YouTube read APIs.

To test immediately without waiting for another upload:
1. Open the protected panel, enter the existing administrator password.
2. Select **Ver mis vídeos largos** and click **Preparar propuesta SEO (sin modificar YouTube)** beside the video.
3. The app validates ownership and 4-minute minimum duration again before saving a draft; duplicate clicks cannot create duplicate drafts.
4. Open **Propuestas SEO** to review the original title, alternative title, suggested tags, current credited description and a *thumbnail design brief*.
5. Nothing from this page is applied to YouTube. A real JPG/PNG thumbnail and a tested authorized write workflow are still missing.

**Do not mistake the design brief for an actual miniature**, or a suggested title for confirmed SEO growth. The contents are derived from the existing title and description, not a video transcript. Work on genuine content analysis and quality checks before approving an automatic metadata writer.

The account remains on the 0 CHF objective. No paid image generation, video hosting or subscriptions have been activated. Keep old Shorts deployments completely separate.
