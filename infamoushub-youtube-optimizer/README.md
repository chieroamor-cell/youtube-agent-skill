# InfamousHub YouTube Post-Upload Optimizer (prototype v0.1.0)

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

- No Google OAuth channel has been connected to this tool in this chat; neither metadata nor thumbnail has been applied to any actual YouTube video.
- The package generator relies on a **truthful user-provided summary**; it does not watch or transcribe YouTube videos automatically. Chapter times require a real transcript or user-supplied timestamps.
- The thumbnail is made from an image the user owns or licenses. It does not download copyrighted images or take frames from YouTube without permission.
- Title/thumbnail can affect click-through rate; YouTube also evaluates retention, satisfaction and viewer preferences. There is no guarantee of reach, views, subscribers or monetization.
- Automating detection of new uploads and updates requires a future authenticated service connection, account-level authorization and safeguards for idempotency. YouTube API quota and possible app verification requirements apply.
- No subscription, billing product, video posting, scheduled job or service deployment has been activated. This is a read-only/protected-code proof of concept.

Run tests with `python -m unittest discover -s tests -v`.
