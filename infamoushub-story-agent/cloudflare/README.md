# Cloudflare account for orchestration (not deployed)

The new Cloudflare account is reserved for job scheduling, status and optional job queueing.
The CPU-intensive steps (local Ollama, Piper, FFmpeg) must run on an owned computer or other
explicitly authorized machine. A Cloudflare Worker cannot render an 8–12 minute video end-to-end
on the Free tier.

No Cloudflare resources, billing options, queues or public endpoints have been created by this package.
Before a deploy, verify the correct new Cloudflare account is selected, explicitly confirm limits,
and connect only the new project. Never use the existing Shorts/Pinterest account.

Recommended next implementation milestone: authenticated job queue + health/status page for a
local renderer. Do not put YouTube OAuth tokens or Google client secrets in a public Worker route.
