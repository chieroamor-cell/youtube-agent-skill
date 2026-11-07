# Cloudflare — InfamousHub Story Agent

Separate Cloudflare account and D1 database for lightweight orchestration. This does **not** render, make, approve or publish any video. Local Ollama, Piper and FFmpeg remain necessary.

Safety gates:
- \`SCHEDULE_ENABLED\` is \`NO\` by default and no cron should be registered until actual end-to-end testing.
- No public YouTube upload handler exists. No OAuth tokens are stored here.
- Public health endpoint is read-only. All job endpoints require \`RENDERER_TOKEN\` secret of 32+ characters.
- Jobs are deduplicated by UTC day; Tuesday/Friday planned cadence. Claim expires after 2h; max 3 attempts.
- The D1 job table stores metadata only; no videos or credentials.

The Worker requires D1 binding \`DB\`. Provision secret \`RENDERER_TOKEN\` **only after** a private renderer is ready. Do not place it in Git. The actual renderer runs on owned hardware, not Cloudflare Workers and not GitHub hosted Actions.

This is staging and not an unattended publishing system. Zero paid services were activated.
