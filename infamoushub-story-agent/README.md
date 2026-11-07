# InfamousHub Story Agent — isolated local producer v0.3.2

Original English-language **story videos** (8–12 minutes), in the style of punchy "the complete
story of ..." biographies and company rise/fall stories. **Not** slow academic documentaries.
Reference style: the user-provided "La Historia Completa de LeBron James" by Basket World.
Use it for pacing and structure only. **Never copy** its script, video, copyrighted footage,
thumbnail or music.

This is an **initial working foundation**, not yet a fully autonomous verified publishing service.
It preserves the upstream [youtube-agent-skill](https://github.com/Jakeschincariol/youtube-agent-skill)
Fork untouched. The upstream 11 skills are for planning and optimizing; they do not produce or
publish completed videos by themselves.

## What is implemented

- Wikipedia source capture and source URL, English only
- Fresh narrative script generation using a **locally running** Ollama model (no paid API)
- Strict nonempty sources/scene count/word count checks; they **cannot** certify factual accuracy
- Image discovery through Wikimedia Commons with recorded metadata and license whitelist
- Offline Piper neural narration and FFmpeg animated photos, captions embedded as an MP4 subtitle track, MP4 assembly
- Hard duration gate: **8–12 actual minutes**, measured from TTS **before costly video encoding**, then verified after FFmpeg
- Validate image attribution/approved license and reject missing files, path traversal and stale outputs
- A single safe local production command (`produce`) with unique-workdir protection and state journal
- Reuses the original upstream `/yt-script` hook-score and `/yt-package` title-lint Python tools when running inside the GitHub Fork; scores are not view predictions
- Exact-file-hash editorial approval (`approve --confirm`), invalidated when the MP4, script or credits change
- YouTube OAuth upload integration with **private** default; public upload requires separate
  `ALLOW_YOUTUBE_PUBLISH=YES` and `--allow-public`, plus current editorial approval
- Separate Cloudflare staging coordinator and D1 already created, but scheduling stays OFF and zero jobs exist
- Local `cloudflare-once` can claim one authenticated job after the renderer is ready; no public uploads
- No GitHub-hosted video renders, no automatic public uploads

## What's still needed for the fully automatic goal

A source-verification and editorial-checking process, stronger narrative QA, more diverse
**licensed motion footage**, music with documented licenses, thumbnail design, robust factual verification, publication review, background queue retries and secure YouTube OAuth
authorization. The Cloudflare metadata coordinator exists but has **no active schedules**. A
**local/self-hosted** render machine is still required. Test a private upload before anything public.
Public YouTube API uploads may be restricted for unverified API projects.

## 0 CHF objective

Core scripts use only Python standard library. You must supply your **own hardware/compute**,
Internet and electricity (not free in the economic sense). This is not an unlimited hosted video
service. Ollama, Piper and FFmpeg are locally running tools. Do **not** use GitHub Actions
runners to mass-render personal entertainment videos; keep the build/test jobs light.

## Verify prerequisites before trying the full render

```bash
python -m story_agent diagnose --voice voices/en_US-lessac-medium.onnx
python -m unittest discover -s tests -v
```

The diagnostic also checks the matching `.onnx.json` Piper voice configuration and reports local RAM/free disk advice. See [HOST_SETUP.md](HOST_SETUP.md). It never accesses paid APIs or publishes videos. It reports missing local FFmpeg, Piper, voice model, and Ollama model. In our test environment FFmpeg works, but Piper, its English voice model and local Ollama are missing, so a *real narrated full-length* end-to-end run is **blocked**, not passed. A mocked 8-minute-timeline test is included and is not a finished video.

## Run the new local production pipeline (v0.3.0)

The new command performs research → original English script → licensed visuals → local
Piper narration → 720p animated scene montage with an English subtitle track. It **does not
upload**. It requires installed local tools and Internet access for Wikimedia content.

```bash
python -m story_agent diagnose --voice voices/en_US-lessac-medium.onnx
python -m story_agent produce "Nintendo" \
  --workdir work/nintendo-story-001 \
  --voice voices/en_US-lessac-medium.onnx
```

Use a **new empty work directory for every story**. Every stage is recorded in
`pipeline-state.json`. `youtube-skill-analysis.json` contains optional scores from the upstream
skills; those scores are merely suggestions, not predictions or fact checks.

For Cloudflare, the new separate account holds Worker `infamoushub-story-coordinator` and D1
`infamoushub-story-jobs`, but `SCHEDULE_ENABLED=NO`, with zero cron triggers and zero jobs.
Once an owned computer is ready, a user-supplied strong secret can be bound in Cloudflare **and**
stored only on that computer. The guarded, single-claim path is:

```bash
# Set STORY_COORDINATOR_URL and STORY_RENDERER_TOKEN privately on the computer.
# Do NOT paste secrets into this chat or commit them to GitHub.
python -m story_agent cloudflare-once \
  --voice voices/en_US-lessac-medium.onnx \
  --topics topics.example.json \
  --output-root work
```

This endpoint cannot render without Piper/Ollama/FFmpeg and a dedicated machine; disabling
cron does not prevent a manual authorized claim, but there are no queued jobs at present.
Never activate unattended cron or public posting before a real end-to-end review.

## Run on your own computer

Install Python 3.11+, [FFmpeg](https://ffmpeg.org/), [Ollama](https://ollama.com/),
[Piper TTS](https://github.com/rhasspy/piper) and an English Piper `.onnx` voice model.
The piper binary and model file need to be present locally. Run Ollama and download a local model:

```bash
ollama pull llama3.1:8b
python -m story_agent research "LeBron James" --out work/research.json
python -m story_agent draft --research work/research.json --out work/story.json --model llama3.1:8b
python -m story_agent check --story work/story.json
python -m story_agent assets --workdir work
python -m story_agent render --workdir work --voice voices/en_US-lessac-medium.onnx
```

Before publication, visually verify all chosen asset credits, quality and factual accuracy;
Commons license metadata is not a legal guarantee. If Commons cannot find properly licensed
images, the system **stops** rather than silently stealing assets.

Generated files:

- `work/story.json` — original English script / shot list
- `work/assets.json`, `work/ATTRIBUTIONS.md` — visual material provenance
- `work/story-video.mp4` — output video
- `work/captions.en.srt` — approximate English captions, timing based on Piper sentence audio
- `work/render-report.json` — measured runtime and file size

## Private YouTube upload (optional)

Only after reviewing the full **rendered** video, its factual sources, music, image credits
and editorial quality, issue a **file-bound approval** using the following command:

```bash
python -m story_agent approve --workdir work/nintendo-story-001 --confirm
```

This creates `review-approved.json` with SHA256 hashes tied to the MP4, story and license
record; editing any approved file invalidates the approval. Store Google OAuth
client credentials **only locally**, in `private/`, never in GitHub or Cloudflare. Set up your
own Google Cloud YouTube Data API OAuth consent and client application. The script requests only
`youtube.upload` scope.

```bash
python -m pip install -r requirements-youtube.txt
python -m story_agent upload --workdir work/nintendo-story-001 --credentials private/client_secrets.json --privacy private
```

A **public** upload is purposely not available until all guards are met:

```bash
ALLOW_YOUTUBE_PUBLISH=YES python -m story_agent upload --workdir work/nintendo-story-001 --credentials private/client_secrets.json --privacy public --allow-public
```

No private/public uploads are attempted unless `upload` is explicitly called. YouTube OAuth will
prompt the owner to sign in on the first run. Unverified API projects may be limited to private
videos until Google completes its required process.

## Test offline (no credentials, no network, no payments)

```bash
python -m unittest discover -s tests -v
```

## Isolation and provenance

Develop this project in **a separate feature branch** of your new GitHub Fork
`chieroamor-cell/youtube-agent-skill`, under the `infamoushub-story-agent/` subfolder. Preserve
all 11 upstream skills and LICENSE. Do not alter the account holding Shorts/Pinterest bots.
The separate Cloudflare account hosts a disabled staging coordinator, not a video renderer.
No schedules, video uploads or paid services were activated. Do not use GitHub-hosted
Actions as a mass entertainment-video renderer.

MIT licensing of the **upstream skill repository** does not grant a license to any music,
photographs, YouTube footage or voice models. Every independently used asset needs its own rights.
