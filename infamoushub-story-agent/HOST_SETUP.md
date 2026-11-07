# InfamousHub Story Agent — run on owned hardware (no subscriptions)

**Status:** v0.3.1 is a staging tool, NOT an unattended public publisher. Do not activate Cloudflare scheduling or YouTube publishing before testing one genuine 8–12 minute video.

## What your PC needs

- Remain turned on when production jobs are due. Never expose the Ollama port (11434) to the Internet.
- Python 3.11+, FFmpeg and ffprobe, Ollama, and Piper in the system PATH.
- Local model from `ollama pull llama3.1:8b`, and BOTH Piper voice files: `en_US-lessac-medium.onnx` and `en_US-lessac-medium.onnx.json` in the same folder.
- Review the voice model's MODEL_CARD and its commercial-use license separately.
- Practical advice, NOT a guarantee: at least ~8 GB RAM (12–16 GB preferable), and 15 GB free storage plus room for generated videos; CPU-only builds may take a long time.

## Windows, macOS, Linux — safe test

1. Check out ONLY `feature/infamoushub-story-videos` of the new GitHub repository.
2. Install FFmpeg, Ollama and Piper from their official projects, with Python 3.11+.
3. Place both English Piper voice files under a local `voices/` directory.
4. In the `infamoushub-story-agent` directory, run:

```bash
ollama pull llama3.1:8b
python -m story_agent diagnose --voice voices/en_US-lessac-medium.onnx
python -m unittest discover -s tests -v
```

The diagnostic reports required tools and approximate RAM/free disk but no hostname, tokens or secrets. It makes no purchases, uploads or public posts.

5. Generate ONE private local draft; scheduling must remain OFF:

```bash
python -m story_agent produce "Nintendo" --workdir work/nintendo-story-001 --voice voices/en_US-lessac-medium.onnx
```

6. Manually check the rendered MP4, facts, voice, subtitles, image rights and the complete ATTRIBUTIONS.md, then test a **private** YouTube upload with the intended channel using the documented OAuth flow. Never commit client secrets or bearer tokens.

## No always-on PC?

No automatic 0-CHF renderer has been validated. Cloudflare Workers Free has ~10 ms CPU per invocation, and Cloudflare Containers requires Workers Paid (at least USD 5 per month). Neither can be used here for zero-budget full video rendering.

An optional separate-provider possibility is Oracle Cloud Always Free ARM compute, subject to a new account, regional capacity, performance and terms. No Oracle account or resources were created or authorized by this project.

## Current Cloudflare staging state

`infamoushub-story-coordinator` has `SCHEDULE_ENABLED=NO`, zero Cron Triggers, zero jobs and no installed renderer token. Do not turn on schedules before actual video QA and private upload tests. The original Shorts and Pinterest projects remain in different accounts.


## Check your own computer before downloading any models (v0.3.2)

These small scripts do **not** install programs, charge money, send information or upload videos.

- Windows PowerShell: `powershell -NoProfile -File .\scripts\check-computer.ps1`
- macOS/Linux Terminal: `sh scripts/check-computer.sh`

Start from the `infamoushub-story-agent` folder. If your PowerShell execution policy blocks a script, **do not bypass security settings**; ask for a safe command-by-command check instead.

The results identify missing Python, FFmpeg, Ollama, Piper and English voice files, plus approximate RAM and free disk space. They do not prove your hardware can render an entire video. Only share the anonymized `[OK]`, `[MISSING]` and `[INFO]` lines; never share API keys or login information.
