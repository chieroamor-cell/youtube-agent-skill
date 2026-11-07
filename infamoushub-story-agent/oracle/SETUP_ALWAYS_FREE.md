# Oracle Cloud Always Free — proposed renderer host (NOT DEPLOYED)

This plan prepares an independent **test** of an original 8–12-minute English story video. It does NOT create an Oracle account, charge anything, provision a VM, activate publishing, or turn on the Cloudflare scheduler.

## Account and cost guardrails

1. Sign up at <https://www.oracle.com/cloud/free/> yourself. Oracle requires identity, a phone number and a supported payment card. Never provide passwords, verification codes or card details to the bot or in GitHub.
2. Choose the home region carefully: Always Free compute instances must be in the home region and this cannot readily be changed. Availability of Ampere A1 capacity varies; `Out of host capacity` does not mean the bot is broken.
3. Stay in Free Trial / Always Free. **Do not upgrade to Pay As You Go**, enable a paid resource or rely on expiring $300 trial credits for production.
4. Select an instance shape explicitly marked **Always Free Eligible**: `VM.Standard.A1.Flex`, up to **2 OCPU and 12 GB RAM total** per Always Free tenancy as stated by current Oracle Always Free docs. Use an Always Free-eligible **ARM64 Ubuntu or Oracle Linux** image.
5. Use the minimum practical boot volume (default around 47–50 GB), keeping all block volumes within the included 200 GB. Check the total before applying.
6. Never order paid container, GPU or accelerated compute instances for this 0-CHF project.

Official reference: <https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm>

## Initial security configuration

- Create a unique SSH public key on the user's device; **keep the private key private**. Never paste it into chats or commit it to GitHub.
- Restrict SSH access to trusted IPs and avoid opening ports 11434 (Ollama) or other application ports to the Internet.
- Use outbound authenticated requests from the VM to the **separate** `infamoushub-story-coordinator` Cloudflare Worker. The Worker does not need a public VM endpoint.
- Keep GitHub repo on the `feature/infamoushub-story-videos` branch, with its existing 11 upstream skills unchanged.
- Store YouTube OAuth files and bearer tokens on the VM, with filesystem permissions, **never** in a GitHub repository or Cloudflare plain-text binding.

## Before enabling any automation

1. Verify the VM is ARM64 and has CPU/RAM/disk capacity, and measure whether it can render in a useful timeframe. With 2 CPU cores and **no GPU**, local LLM scripts and FFmpeg video rendering may be slow.
2. Install Python 3.11+, FFmpeg/ffprobe and ARM64-compatible Piper + Ollama from their official sources, with the English Piper voice's `.onnx` **and** matching `.onnx.json`. Review all media/voice licenses.
3. Run the project's `python -m story_agent diagnose` and tests. The local host checker is available in `scripts/` as of v0.3.2.
4. Render a **single local** story video (8–12 minutes); manually verify claims, captions, audio, pacing, image/footage licenses, and attribution.
5. Upload a video to YouTube as **private** for test with the correct account; keep public uploads forbidden.
6. Only after end-to-end acceptance consider configuring a securely stored Worker secret and enabling a twice-weekly Cloudflare trigger. Existing account scripts, Shorts and Pinterest bots are not to be touched.

## Known limitations

- New accounts may be unable to provision an A1 VM due to limited availability. **Never upgrade just to bypass capacity**.
- Oracle may reclaim Always Free VMs deemed idle according to its published thresholds.
- Oracle account verification may place a temporary payment-card authorization hold.
- No guarantee that two fully automated 8–12-minute videos/week can be reliably rendered within 0 CHF on 2 OCPU. Measure actual compute, video quality and workflow reliability first.
- No Oracle Cloud account/VM is currently connected to this chat, and this document is only a deployment checklist.
