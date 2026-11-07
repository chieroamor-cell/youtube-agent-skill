# InfamousHub Story Agent — isolated local prototype v0.1.1

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
- Offline Piper neural narration and FFmpeg animated photos, captions, MP4 assembly
- Hard duration gate: **8–12 actual minutes**, measured from TTS **before costly video encoding**, then verified after FFmpeg
- Validate image attribution/approved license and reject missing files, path traversal and stale outputs
- YouTube OAuth upload integration with **private** default; public upload requires separate
  `ALLOW_YOUTUBE_PUBLISH=YES` and `--allow-public`, plus an editorial approval file
- No Cloudflare or GitHub Actions background renders, no automatic public uploads

## What's still needed for the fully automatic goal

A source-verification and editorial-checking process, stronger narrative QA, more diverse
**licensed motion footage**, music with documented licenses, thumbnail design, persistent queue,
retries, secure OAuth authorization, separate Cloudflare orchestration and a **local/self-hosted**
render worker. First authorize and test a private YouTube upload before anything public.
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

The diagnostic never accesses paid APIs or publishes videos. It reports missing local FFmpeg, Piper, voice model, and Ollama model. In our test environment FFmpeg works, but Piper, its English voice model and local Ollama are missing, so a *real narrated full-length* end-to-end run is **blocked**, not passed. A mocked 8-minute-timeline test is included and is not a finished video.

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

Before rendering, visually verify all chosen asset credits, quality and factual accuracy;
Commons license metadata is not a legal guarantee. If Commons cannot find properly licensed
images, the system **stops** rather than silently stealing assets.

Generated files:

- `work/story.json` — original English script / shot list
- `work/assets.json`, `work/ATTRIBUTIONS.md` — visual material provenance
- `work/story-video.mp4` — output video
- `work/captions.en.srt` — approximate English captions, timing based on Piper sentence audio
- `work/render-report.json` — measured runtime and file size

## Private YouTube upload (optional)

Only after checking every fact, pacing, licensing and thumbnail, place an
`review-approved.txt` file in `work/` as the explicit editorial approval. Store Google OAuth
client credentials **only locally**, in `private/`, never in GitHub or Cloudflare. Set up your
own Google Cloud YouTube Data API OAuth consent and client application. The script requests only
`youtube.upload` scope.

```bash
python -m pip install -r requirements-youtube.txt
python -m story_agent upload --workdir work --credentials private/client_secrets.json --privacy private
```

A **public** upload is purposely not available until all guards are met:

```bash
ALLOW_YOUTUBE_PUBLISH=YES python -m story_agent upload --workdir work --credentials private/client_secrets.json --privacy public --allow-public
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
The separate Cloudflare account is reserved for a later coordination service; no deploy is done.

MIT licensing of the **upstream skill repository** does not grant a license to any music,
photographs, YouTube footage or voice models. Every independently used asset needs its own rights.
