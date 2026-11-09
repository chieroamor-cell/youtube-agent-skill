"""Read-only detection of newly uploaded videos on the authenticated owner channel.

No searches, uploads, title edits, thumbnail edits or scheduled jobs.
Safe on first run: it records a baseline and reports no "new" videos.
"""
from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path


DURATION = re.compile(r"^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$")
CHANNEL_ID = re.compile(r"^UC[A-Za-z0-9_-]{10,}$")
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


def duration_seconds(iso: str) -> int:
    m = DURATION.fullmatch(str(iso))
    if not m:
        raise ValueError("Invalid YouTube ISO 8601 duration")
    day, hour, minute, second = [int(v or 0) for v in m.groups()]
    return day * 86400 + hour * 3600 + minute * 60 + second


def find_channel(youtube, expected_channel: str) -> str:
    if not CHANNEL_ID.fullmatch(expected_channel):
        raise ValueError("Expected an actual YouTube channel ID beginning with UC")
    channels = youtube.channels().list(part="id,contentDetails", mine=True).execute().get("items", [])
    owned = [c for c in channels if c.get("id") == expected_channel]
    if len(owned) != 1:
        raise ValueError("OAuth channel mismatch: no videos were inspected or changed")
    uploads = (((owned[0].get("contentDetails") or {}).get("relatedPlaylists") or {}).get("uploads"))
    if not isinstance(uploads, str) or not uploads:
        raise ValueError("No uploads playlist for authenticated owner channel")
    return uploads


def list_recent_owned_videos(youtube, *, channel_id: str, max_items: int = 50) -> list[dict]:
    if not 1 <= max_items <= 50:
        raise ValueError("max_items must be between 1 and 50")
    uploads = find_channel(youtube, channel_id)
    response = youtube.playlistItems().list(part="contentDetails", playlistId=uploads, maxResults=max_items).execute()
    ids = []
    for item in response.get("items", []):
        vid = (item.get("contentDetails") or {}).get("videoId")
        if isinstance(vid, str) and VIDEO_ID.fullmatch(vid) and vid not in ids:
            ids.append(vid)
    if not ids:
        return []
    response = youtube.videos().list(part="snippet,contentDetails,status", id=",".join(ids)).execute()
    details = {}
    for item in response.get("items", []):
        vid = item.get("id")
        if vid not in ids:
            continue
        snippet = item.get("snippet") or {}
        if snippet.get("channelId") != channel_id:
            continue
        if snippet.get("liveBroadcastContent") in {"live", "upcoming"}:
            continue
        try:
            seconds = duration_seconds((item.get("contentDetails") or {}).get("duration") or "")
        except ValueError:
            continue
        if seconds <= 0:
            continue
        details[vid] = {
            "video_id": vid,
            "title": str(snippet.get("title") or "")[:100],
            "description": str(snippet.get("description") or "")[:2000],
            "privacy": str((item.get("status") or {}).get("privacyStatus") or "unknown"),
            "duration_seconds": seconds,
            "channel_id": channel_id,
            "url": f"https://www.youtube.com/watch?v={vid}",
        }
    return [details[vid] for vid in ids if vid in details]


def _load_state(path: Path, channel_id: str) -> dict | None:
    if path.is_symlink():
        raise ValueError("Refusing symlink upload state file")
    if not path.exists():
        return None
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or raw.get("schema_version") != 1 or raw.get("channel_id") != channel_id:
        raise ValueError("Existing upload state belongs to another channel or is invalid; refusing to overwrite")
    seen = raw.get("seen")
    if not isinstance(seen, list) or len(seen) > 20000 or any(not isinstance(x, str) or not VIDEO_ID.fullmatch(x) for x in seen):
        raise ValueError("Corrupt upload state; refusing to overwrite")
    return raw


def _save_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise ValueError("Refusing symlink upload state file")
    temp_name = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, prefix=".youtube-uploads-", suffix=".tmp", delete=False) as f:
            temp_name = f.name
            json.dump(state, f, indent=2, ensure_ascii=False)
            f.write("\n")
        try:
            os.chmod(temp_name, 0o600)
        except OSError:
            pass
        os.replace(temp_name, path)
        temp_name = None
    finally:
        if temp_name is not None:
            try:
                os.unlink(temp_name)
            except FileNotFoundError:
                pass


def scan_new_uploads(youtube, *, expected_channel: str, state_path: Path,
                     max_items: int = 50, min_seconds: int = 240) -> dict:
    """A read-only API scan with local dedupe; initial scan establishes a baseline."""
    if not 0 <= min_seconds <= 86400:
        raise ValueError("Invalid minimum duration")
    state_path = Path(state_path)
    prior = _load_state(state_path, expected_channel)  # fail closed BEFORE network
    recent = list_recent_owned_videos(youtube, channel_id=expected_channel, max_items=max_items)
    ids = [v["video_id"] for v in recent]
    baseline = prior is None
    old_seen = set(prior["seen"]) if prior else set()
    discovered = [] if baseline else [v for v in recent if v["video_id"] not in old_seen and v["duration_seconds"] >= min_seconds]
    all_seen = list(dict.fromkeys([*ids, *(prior["seen"] if prior else [])]))
    if len(all_seen) > 20000:
        raise ValueError("Too many saved uploads; manual history review required")
    _save_state(state_path, {"schema_version": 1, "channel_id": expected_channel, "seen": all_seen})
    return {
        "baseline_created": baseline,
        "checked": len(recent),
        "new_videos": list(reversed(discovered)),
        "ignored_short_videos": 0 if baseline else sum(1 for v in recent if v["video_id"] not in old_seen and v["duration_seconds"] < min_seconds),
        "writes_to_youtube": False,
        "next_action": "Review suggestions and create approved thumbnails; do not auto-edit before connecting the verified channel.",
    }
