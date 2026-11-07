# InfamousHub Story Agent — v0.3.0 (2026-11-07)

## Verified

- New GitHub account `chieroamor-cell`, isolated `feature/infamoushub-story-videos` branch and draft PR #1. No changes to original 11 YouTube Agent Skills or `main`.
- New Cloudflare account has isolated Worker `infamoushub-story-coordinator` with D1 `infamoushub-story-jobs`, `SCHEDULE_ENABLED=NO`, **zero cron triggers**, **zero jobs**. No YouTube tokens or renderers were deployed.
- Existing 14 Python tests, plus 13 new local pipeline/review/connector/skill tests pass (27 total).
- The new `produce` command runs all stages locally; no uploads. Explicit approval is now tied to exact SHA256 checksums, preventing stale approvals.
- The upstream `yt-script/hookscore.py` and `yt-package/title.py` scripts are invoked when present; they provide advice, not proof of virality.
- A real 2.1-second FFmpeg sample generated H.264 video + AAC audio + an English `mov_text` subtitle stream. This is **NOT** a real complete story video.
- Cloudflare connector is HTTPS-only; bearer tokens must be provided by environment variable, not command-line arguments, and redirects are blocked.

## Not tested/implemented end-to-end

- Real Ollama text generation, Piper narration, model downloads and a human-quality 8–12 minute edited English video (models/voice unavailable on this execution machine).
- Source/asset legal and factual review; licensed motion footage/music beyond animated Commons photos.
- User-owned always-on computer or self-hosted runner required for full rendering.
- Strong Cloudflare renderer token, production job claims, lease renewal for >2h jobs, and unattended cron **not active**.
- YouTube OAuth private test upload, verified intended channel and public publishing **not active**.
- 0 CHF recurring costs are a target, not a guarantee of unlimited compute; own hardware, electricity and bandwidth are required.

## Next safety gate

Set up a computer capable of Ollama, Piper and FFmpeg; produce one real English story, inspect its research/visual rights, pass verified review approval and perform a private YouTube test upload. Only then consider cron scheduling and publication.
