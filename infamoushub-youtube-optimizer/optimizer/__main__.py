"""Create an optimization preview and optionally apply to a verified YouTube channel."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from .metadata import prepare
from .thumbnail import create_thumbnail
from .youtube import client_from_existing_token, apply_package
from .uploads import scan_new_uploads


def main():
    ap = argparse.ArgumentParser(description="InfamousHub YouTube optimizer; preview first; never publishes or changes visibility")
    sub = ap.add_subparsers(dest="action", required=True)
    prep = sub.add_parser("prepare")
    prep.add_argument("--url", required=True, help="Your existing YouTube video URL or ID")
    prep.add_argument("--topic", required=True)
    prep.add_argument("--summary-file", required=True, type=Path, help="Verified text describing the actual video")
    prep.add_argument("--angle", default="", help="Verified interesting angle of the actual video")
    prep.add_argument("--chapters-file", type=Path, help="Optional actual timestamps, never invented")
    prep.add_argument("--photo", type=Path, help="Optional authorized image used for thumbnail")
    prep.add_argument("--photo-rights", choices=["owned", "licensed"])
    prep.add_argument("--thumb-text", default="THE FULL STORY")
    prep.add_argument("--out", type=Path, required=True)
    scan = sub.add_parser("scan", help="Read-only detection of new owner-channel videos (never edits YouTube)")
    scan.add_argument("--token", type=Path, required=True, help="Private existing YouTube OAuth token")
    scan.add_argument("--channel-id", required=True, help="Channel allowlist, starts with UC")
    scan.add_argument("--state", type=Path, default=Path("private/youtube-upload-state.json"))
    scan.add_argument("--max-items", type=int, default=50)
    scan.add_argument("--min-seconds", type=int, default=240, help="Ignore Shorts and other videos shorter than this")
    approve = sub.add_parser("approve")
    approve.add_argument("--package", type=Path, required=True)
    approve.add_argument("--confirm-reviewed", action="store_true", help="I checked the video, factual accuracy, thumbnail and rights")
    apply = sub.add_parser("apply")
    apply.add_argument("--package", type=Path, required=True)
    apply.add_argument("--token", type=Path, required=True, help="YouTube OAuth token stored privately, never in git")
    apply.add_argument("--channel-id", required=True, help="Allowlist only this owner channel ID")
    apply.add_argument("--confirm-write", action="store_true")
    a = ap.parse_args()
    try:
        if a.action == "prepare":
            chapters = a.chapters_file.read_text(encoding="utf-8") if a.chapters_file else ""
            package = prepare(a.url, a.topic, a.summary_file.read_text(encoding="utf-8"), angle=a.angle, chapters=chapters)
            a.out.mkdir(parents=True, exist_ok=True)
            if a.photo:
                if not a.photo_rights:
                    raise ValueError("Debes indicar --photo-rights owned o licensed")
                p = create_thumbnail(a.photo, a.out / "thumbnail.jpg", a.thumb_text, rights=a.photo_rights)
                package.update(thumbnail_path=str(p.resolve()), thumbnail_status="generated_from_authorized_image", image_rights=a.photo_rights)
            (a.out/"package.json").write_text(json.dumps(package, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps({"saved": str(a.out / "package.json"), "title_candidates": package["title_candidates"], "thumbnail_status":package["thumbnail_status"],"published":False},indent=2))
        elif a.action == "scan":
            client = client_from_existing_token(a.token)
            result = scan_new_uploads(client, expected_channel=a.channel_id, state_path=a.state,
                                      max_items=a.max_items, min_seconds=a.min_seconds)
            print(json.dumps(result, ensure_ascii=False, indent=2))
        elif a.action == "approve":
            if not a.confirm_reviewed:
                raise ValueError("Utiliza --confirm-reviewed después de revisar todo el paquete")
            pkg = json.loads(a.package.read_text(encoding="utf-8"))
            if pkg.get("thumbnail_path") and not Path(pkg["thumbnail_path"]).is_file():
                raise ValueError("La miniatura aprobada no existe")
            pkg["approved"] = True
            a.package.write_text(json.dumps(pkg, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps({"approved": True, "video_id":pkg["video_id"], "published":False},indent=2))
        else:
            pkg = json.loads(a.package.read_text(encoding="utf-8"))
            client = client_from_existing_token(a.token)
            result = apply_package(client,pkg,expected_channel=a.channel_id,allow_write=a.confirm_write)
            print(json.dumps(result, indent=2))
    except (OSError, ValueError, RuntimeError) as err:
        ap.exit(2, f"Blocked safely: {err}\n")

if __name__ == '__main__':
    main()
