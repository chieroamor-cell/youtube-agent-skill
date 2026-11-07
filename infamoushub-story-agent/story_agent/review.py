"""Bind explicit human editorial approval to the exact rendered files.

Never interprets the mere presence of an approval marker as consent to upload.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
from pathlib import Path

from .assets import validate_asset_manifest
from .core import StoryError, read_json, validate_story, write_json
from .media import duration

FILES = (
    "story.json",
    "assets.json",
    "ATTRIBUTIONS.md",
    "captions.en.srt",
    "story-video.mp4",
    "render-report.json",
)


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as source:
        for part in iter(lambda: source.read(1024 * 1024), b""):
            h.update(part)
    return h.hexdigest()


def render_inventory(workdir: Path) -> dict:
    story = read_json(workdir / "story.json")
    validate_story(story)
    validate_asset_manifest(story, read_json(workdir / "assets.json"), workdir)
    report = read_json(workdir / "render-report.json")
    if not isinstance(report, dict):
        raise StoryError("Invalid render report")
    expected = report.get("duration_seconds")
    if isinstance(expected, bool) or not isinstance(expected, (int, float)) or not 480 <= expected <= 720:
        raise StoryError("Render duration must be 8–12 minutes")
    if report.get("published") is not False:
        raise StoryError("Cannot approve a video already marked published")
    if not (workdir / "story-video.mp4").is_file():
        raise StoryError("MP4 file is missing")
    actual = duration(workdir / "story-video.mp4")
    if not 480 <= actual <= 720 or abs(actual - expected) > 3:
        raise StoryError("MP4 actual duration does not match its render report")
    hashes = {}
    for name in FILES:
        file = workdir / name
        if not file.is_file() or file.stat().st_size < 1:
            raise StoryError(f"Missing required review file: {name}")
        hashes[name] = digest(file)
    # An editor must assess originality, facts, image licenses and visual quality.
    # SHA records merely prevent accidental stale approvals after content changes.
    return {"files_sha256": hashes, "duration_seconds": round(actual, 2)}


def approve_render(workdir: Path, *, editor_confirmed: bool = False) -> dict:
    if not editor_confirmed:
        raise StoryError("Explicit --confirm required after reviewing the full video, facts and asset rights")
    inventory = render_inventory(workdir)
    receipt = {
        "schema": "infamoushub-editorial-approval-v1",
        "approved_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "editor_confirmed": True,
        **inventory,
    }
    write_json(workdir / "review-approved.json", receipt)
    return {"approved": True, "duration_seconds": inventory["duration_seconds"], "file_count": len(inventory["files_sha256"])}


def require_current_approval(workdir: Path) -> None:
    receipt_path = workdir / "review-approved.json"
    if not receipt_path.is_file():
        raise StoryError("Editorial approval missing: use 'approve --confirm' AFTER human video review")
    receipt = read_json(receipt_path)
    if (receipt.get("schema") != "infamoushub-editorial-approval-v1" or
        receipt.get("editor_confirmed") is not True or
        not isinstance(receipt.get("approved_at_utc"), str)):
        raise StoryError("Invalid editorial approval receipt")
    if receipt.get("files_sha256") != render_inventory(workdir)["files_sha256"]:
        raise StoryError("Video or credits changed after approval; review and approve again")
