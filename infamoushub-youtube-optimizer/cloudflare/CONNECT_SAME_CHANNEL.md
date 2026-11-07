# Same YouTube channel — secure new Cloudflare OAuth connection

Status: **staging, OAuth DISABLED, no real YouTube connection yet**.
The existing Shorts bot in the former Cloudflare account is not inspected, modified, or migrated.

## What is already prepared (new Cloudflare account only)

- New Cloudflare account Workers subdomain: `infamoushub-yt-29bea3.workers.dev`
- Worker: `infamoushub-youtube-connect`
- Staging landing page: `https://infamoushub-youtube-connect.infamoushub-yt-29bea3.workers.dev/connect`
- Google OAuth **authorized redirect URI** (copy EXACTLY, without a trailing slash):
  `https://infamoushub-youtube-connect.infamoushub-yt-29bea3.workers.dev/oauth/callback`
- Dedicated D1 database: `infamoushub-youtube-oauth` (EU storage)
- 256-bit AES-GCM key stored as a Cloudflare **secret**, not in GitHub.
- `OAUTH_ENABLED=NO`; no jobs, edits, publishing or connection tokens yet.

## One-time Google account authorization (owner must complete)

1. Open [Google Cloud Console](https://console.cloud.google.com/). Choose a Google Cloud project you control. The existing Shorts project may be reused if you own it, but create a **separate OAuth web client**; do not alter its old client, old secret or callback URI.
2. Enable **YouTube Data API v3**, if it is not enabled in that project. Stop if Google asks to activate paid billing.
3. In **Google Auth Platform → Branding / Audience / Clients**, complete the OAuth consent screen if needed, add the Google account that manages the channel as a test user when the app is in Testing, then create an **OAuth Client ID of type Web application**.
4. Add exactly the authorized redirect URI above. Save. The new OAuth client ID and client secret remain private.
5. Open the **new** Cloudflare account only → Workers & Pages → `infamoushub-youtube-connect` → Settings → Variables and Secrets. Add three **Secret** entries, never plaintext variables:
   - `GOOGLE_OAUTH_CLIENT_ID` = OAuth client ID from Google
   - `GOOGLE_OAUTH_CLIENT_SECRET` = OAuth client secret from Google
   - `OAUTH_ADMIN_CODE` = a newly generated random password of at least 24 characters, saved in a password manager
   The separate secret `OAUTH_TOKEN_KEY_B64` is already stored: **do not overwrite or remove it**, or previously stored tokens would become undecipherable.
6. **Do not send OAuth secrets, API keys, passwords or the admin code in ChatGPT, screenshots or GitHub.** After these secrets are set, the operator may check bindings and switch `OAUTH_ENABLED` from `NO` to `YES`, while keeping all editing and scheduled work disabled.
7. Open the staging landing page using the normal Chrome browser (not an embedded/in-app login browser). Enter the admin code; Google will ask you to select and authorize a Google/Brand channel identity. Confirm that the displayed channel title and **UC...** channel ID match the channel already publishing Shorts. Only then confirm the binding.
8. The connector encrypts the refresh token and marks the channel active, but **does not edit/upload/publish any video**. Perform read-only and private-video trials before enabling any metadata write.

## Important limitations

- The requested `https://www.googleapis.com/auth/youtube.force-ssl` OAuth scope has broad YouTube permissions, including delete; the Worker deliberately contains no delete/update/upload endpoints. Review the Google permission screen before granting it.
- Google's **External / Testing** authorization and refresh token can expire after 7 days for YouTube scopes. Long-term unattended access requires an appropriate OAuth app publishing status and potentially Google verification. Production verification generally needs a verified owned domain, not simply a shared workers.dev hostname.
- The Google user who owns the channel must approve OAuth in their own browser; no tool can do this consent for them.
- This does not yet give the Python optimizer a private cloud runner or automatic screenshots/thumbnail generation. Publishing and metadata writes stay disabled until end-to-end testing and authorization.
- This separate Worker and EU D1 database were created without selecting a paid plan. Verify future usage and provider quotas.

Primary docs: https://developers.google.com/youtube/v3/guides/authentication ; https://developers.google.com/identity/protocols/oauth2/web-server ; https://support.google.com/cloud/answer/15549945
