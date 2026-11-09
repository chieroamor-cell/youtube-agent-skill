# InfamousHub YouTube Post-Upload Optimizer (prototype v0.2.0)

**You upload your own video to YouTube. This project prepares honest English titles, descriptions, tags and an optional 1280×720 thumbnail from a photo whose usage rights you have verified.** It can change metadata on an owned channel with an authorized YouTube OAuth token **only after an explicit opt-in**. It cannot guarantee views. It does **not** create or publish a video, and never changes video privacy status.

The original 11 `youtube-agent-skill` commands remain intact. For stronger language and real video-specific SEO, review the suggestions with `/yt-package`, `/yt-seo` and, when a transcript is available, `/yt-chapters`.

## Prepare without YouTube access

```bash
cd infamoushub-youtube-optimizer
python -m pip install -r requirements.txt
printf 'This video tells the verified story of Nintendo, from its early history to its games.\n' > video-summary.txt
python -m optimizer prepare --url 'https://youtu.be/mIcrurbIc70' --topic 'Nintendo' --summary-file video-summary.txt --out private/preview
```

The video URL above is an **illustrative example of syntax only**, not a Nintendo video. Use the URL of **your own** uploaded video. The summary must describe the video you actually uploaded, not be invented. To generate a thumbnail from a rights-cleared image:

```bash
python -m optimizer prepare --url 'YOUR_VIDEO_URL' --topic 'Nintendo' --summary-file video-summary.txt --photo /path/to/your/image.jpg --photo-rights owned --thumb-text 'THE FULL STORY' --out private/preview
```

For local dry-run reading of the upload's metadata, you need an authorized YouTube OAuth token for the intended channel and optional Google Python packages:

```bash
python -m pip install -r requirements-youtube.txt
python -m optimizer apply --package private/preview/package.json --token private/youtube-oauth.json --channel-id 'UC_REAL_CHANNEL_ID'
```

This defaults to **read-only preview**. Even with an OAuth token present, writing needs an approved package (`python -m optimizer approve --package private/preview/package.json --confirm-reviewed`), **both** `--confirm-write` and environment variable `YOUTUBE_OPTIMIZER_WRITE=YES`. Test the result on an **unlisted/private** video first; do not enable for public channel automation before review. OAuth token creation is NOT provided by this prototype and requires a first-party Google Cloud OAuth authorization flow.

## Important limitations / next work

- **Google OAuth is now connected** in the new Cloudflare account to the user's YouTube channel `infamoushub` (`UC7bPVW93xdIXPREbFoHXVrw`); the channel identity was verified read-only and YouTube reported 30 videos. Neither metadata nor thumbnail has been applied to any actual video.
- The package generator relies on a **truthful user-provided summary**; it does not watch or transcribe YouTube videos automatically. Chapter times require a real transcript or user-supplied timestamps.
- The thumbnail is made from an image the user owns or licenses. It does not download copyrighted images or take frames from YouTube without permission.
- Title/thumbnail can affect click-through rate; YouTube also evaluates retention, satisfaction and viewer preferences. There is no guarantee of reach, views, subscribers or monetization.
- **Read-only upload detection is implemented** (via the authenticated channel's uploads playlist). The first scan creates a baseline and does **not** flag old videos; subsequent scans report new videos once only. Videos under four minutes are ignored by default to avoid Shorts. An invalid/cross-channel state file causes a safe failure.
- This local Python `scan` command still runs **only when invoked** and requires its own token on an authorized host. **Separately**, the new Cloudflare Worker stores the user's encrypted channel OAuth refresh token and provides a protected on-demand list of recent long-form videos. No scheduled job, automatic video editing or publishing has been enabled. GitHub Actions only runs mocked tests.
- Automatic scheduled optimization still requires secure private execution, rights-verified thumbnail creation and review gates. OAuth is already present in the new Cloudflare Worker; never copy the stored token or OAuth secrets to GitHub, screenshots or chat. YouTube API quotas and possible app verification requirements apply.
- The read-only OAuth and video-list Worker **is deployed** on the user's separate Cloudflare account. No new subscription, video posting, automatic scheduled job or write capability has been activated. This remains a protected prototype.

Run tests with `python -m unittest discover -s tests -v`.

## Detect uploads from your own channel (v0.2.0)

Use this only on a securely authenticated host, **after you authorize YouTube OAuth** and verify that the token belongs to the exact desired channel. The following is a read-only scan, not a cloud deployment:

```bash
python -m optimizer scan \
  --token private/youtube-oauth.json \
  --channel-id UC_YOUR_REAL_CHANNEL_ID \
  --state private/youtube-upload-state.json
```

First run = safe baseline (reports no old videos); next runs = newly uploaded long-form video IDs. The scan reads `channels.list(mine=true)`, the owner's `uploads` playlist and video duration/privacy, and saves the list locally. It **does not** generate a thumbnail, alter YouTube metadata, change privacy or guarantee reach.

Once a new video is detected, the next step is preparing a truthful preview from its actual content or verified summary, reviewing the thumbnail rights, and authorizing only the exact changes. We have **not** wired this to Cloudflare's scheduling yet.

## Live Cloudflare video inventory (connected, read-only)

- **Owner channel:** `infamoushub` — `UC7bPVW93xdIXPREbFoHXVrw`.
- **Open panel:** <https://infamoushub-youtube-connect.infamoushub-yt-29bea3.workers.dev/connect>. Enter the existing admin password (never share it); no new Google consent is needed to list videos.
- **Read-only inventory:** <https://infamoushub-youtube-connect.infamoushub-yt-29bea3.workers.dev/channel/videos>.
- The Worker requests the authenticated owner's uploads playlist (up to the most recent 50), then `videos.list` for truthful title, duration, owner and visibility. It excludes videos shorter than 240 seconds, ongoing livestreams and videos belonging to other channels.
- The inventory works only with an authenticated administrator session. Public requests to `/channel/videos` return HTTP 401.
- **Security:** stored refresh token is AES-GCM encrypted at rest. The Worker only calls Google OAuth for a refreshed access token and makes read-only YouTube API calls; it exposes no public write, upload, publication or delete endpoints.
- **Verification:** offline GitHub Actions run `42501824377` passed at its branch head; the subsequent Cloudflare deployment confirmed bindings/secrets preserved and authenticated access enforced. The user successfully tested `/channel/verify` with the real account. The **live inventory response has not yet been viewed through the owner's authenticated browser**, so do not claim verified real per-video counts or lists until that occurs.
- This is not yet an autonomous optimizer. User upload remains manual; title/description suggestions and rights-cleared thumbnails require a truthful analysis of actual video content, followed by explicit approval before any real change.

Never merge this prototype to `main` or enable edits merely because unit tests pass.

## Automatic hourly discovery and editorial drafts (November 8, 2026)

The separate Cloudflare Worker now has an enabled Cron Trigger `15 * * * *` (hourly, UTC) and `AUTO_DISCOVERY=YES`. It reads the verified owner channel's latest 50 videos, excludes videos shorter than 4 minutes, and creates **D1-only editorial proposals** for newly uploaded eligible videos. The first run establishes a baseline of existing IDs and **does not** generate proposals for old uploads. SQL uses atomic D1 batches to respect Cloudflare Free invocation limits.

Owner-only pages after login:

- `/channel/videos`: most recent long videos.
- `/watch/status`: scheduled watcher status, last recorded scan, and optional manual read-only scan.
- `/drafts`: queued original titles, descriptions preserving prior credits, suggested tags and thumbnail concepts.

**Do not confuse this with completed full automation:** The cron is active but the first live scheduled scan still needs to be observed; no YouTube metadata or thumbnails are changed. No actual JPG/PNG thumbnail generation has been approved or deployed. Cloudflare Images' independent test did not work in this account, and no paid image plan was enabled. Titles default to original verified titles, not AI-generated clickbait; no transcript is inspected. A dedicated approved metadata writer, rights-cleared thumbnail generator, first private-video test, and safeguards for automatic writes remain pending.

See `cloudflare/AUTOPILOT.md` for deployed config, costs, privacy, and follow-up acceptance checks.

## New: actual JPEG previews and owner review (v0.4.0, Cloudflare)

The owner-facing `/drafts` screen can now render and download **actual 1280×720 JPG thumbnails** using Cloudflare Browser Run on demand. They are original branded graphics based on the verified existing title and must be reviewed for relevance. The exact module was tested live in the connected Cloudflare account with a 62 KB JPG; the test Worker was deleted.

Private owner review forms can store an approved original or alternate title, subject to another YouTube check of owner, privacy and title freshness. Code for an explicit private-only metadata + JPG upload test is implemented with a durable one-time attempt guard, but **the Cloudflare variable `YOUTUBE_WRITE_ENABLED=NO` forbids any real writes**. No automatic YouTube edits, thumbnail uploads, visibility changes or publications have occurred. The hourly cron continues read-only discovery and safe proposals.

See [Cloudflare Autopilot](cloudflare/AUTOPILOT.md) for accurate current status, the first live scan, acceptance blockers, free-tier considerations, and test evidence.
