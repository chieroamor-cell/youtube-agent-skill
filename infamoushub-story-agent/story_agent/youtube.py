"""YouTube OAuth uploader. Public posting is intentionally OFF unless explicitly enabled."""
from __future__ import annotations

import os
from pathlib import Path
from .core import StoryError

SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]


def upload_video(video: Path, story: dict, *, client_secrets: Path, token_file: Path, privacy: str = "private", allow_public: bool = False, description_credits: str = "") -> dict:
    if not video.is_file():
        raise StoryError("Video file does not exist")
    if not client_secrets.is_file():
        raise StoryError("Missing user's own YouTube API OAuth client_secrets.json")
    if privacy not in {"private", "unlisted", "public"}:
        raise StoryError("Invalid privacy setting")
    if privacy == "public" and not (allow_public and os.environ.get("ALLOW_YOUTUBE_PUBLISH") == "YES"):
        raise StoryError("Public uploads disabled; require --allow-public and ALLOW_YOUTUBE_PUBLISH=YES")
    try:
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
        from google_auth_oauthlib.flow import InstalledAppFlow
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaFileUpload
    except ImportError as exc:
        raise StoryError("Install optional dependencies: pip install -r requirements-youtube.txt") from exc

    creds = None
    if token_file.is_file():
        creds = Credentials.from_authorized_user_file(str(token_file), SCOPES)
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    if not creds or not creds.valid:
        flow = InstalledAppFlow.from_client_secrets_file(str(client_secrets), SCOPES)
        creds = flow.run_local_server(port=0)
    token_file.parent.mkdir(parents=True, exist_ok=True)
    token_file.write_text(creds.to_json(), encoding="utf-8")
    try:
        token_file.chmod(0o600)
    except OSError:
        pass

    youtube = build("youtube", "v3", credentials=creds)
    credits = description_credits.strip()
    description = (str(story.get("description") or "").strip() + "\n\nSources:\n" + "\n".join(story["references"]) + "\n\nVisual credits:\n" + credits)
    if len(description) > 4900:
        raise StoryError("Video description exceeds space needed for complete asset attribution; consolidate credits with a verified full-credit link before upload")
    request = youtube.videos().insert(
        part="snippet,status",
        body={"snippet": {"title": story["title"][:100], "description": description, "categoryId": "24", "defaultLanguage": "en"}, "status": {"privacyStatus": privacy, "selfDeclaredMadeForKids": False}},
        media_body=MediaFileUpload(str(video), chunksize=4 * 1024 * 1024, resumable=True, mimetype="video/mp4"),
    )
    response = None
    while response is None:
        _, response = request.next_chunk()
    return {"id": response.get("id"), "privacy": privacy, "published": privacy == "public"}
