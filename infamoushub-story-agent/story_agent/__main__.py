"""Run via python -m story_agent. Offline processing defaults to no publication."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from .assets import gather_assets
from .core import StoryError, generate_story, read_json, validate_story, wikipedia_research, write_json
from .media import render_story
from .youtube import upload_video
from .preflight import diagnose


def arguments():
    parser = argparse.ArgumentParser(description="InfamousHub Story Agent: original stories, offline narration and video")
    cmds = parser.add_subparsers(dest="command", required=True)
    research = cmds.add_parser("research", help="Find cited background on one topic")
    research.add_argument("topic")
    research.add_argument("--out", type=Path, default=Path("work/research.json"))

    draft = cmds.add_parser("draft", help="Write original English story with local Ollama")
    draft.add_argument("--research", type=Path, default=Path("work/research.json"))
    draft.add_argument("--out", type=Path, default=Path("work/story.json"))
    draft.add_argument("--model", default="llama3.1:8b")

    check = cmds.add_parser("check", help="Inspect a storyboard quality gate (does not fact-check)")
    check.add_argument("--story", type=Path, default=Path("work/story.json"))

    assets = cmds.add_parser("assets", help="Find licensed Commons images for each story scene")
    assets.add_argument("--workdir", type=Path, default=Path("work"))

    render = cmds.add_parser("render", help="Render local video with Piper TTS and FFmpeg")
    render.add_argument("--workdir", type=Path, default=Path("work"))
    render.add_argument("--voice", type=Path, required=True, help="Local Piper voice .onnx file")
    render.add_argument("--piper", default="piper")

    diag = cmds.add_parser("diagnose", help="Read-only check of local rendering dependencies")
    diag.add_argument("--voice", type=Path, help="Path to a downloaded English Piper .onnx model")
    diag.add_argument("--model", default="llama3.1:8b")

    upload = cmds.add_parser("upload", help="Upload via your own YouTube OAuth (private by default)")
    upload.add_argument("--workdir", type=Path, default=Path("work"))
    upload.add_argument("--credentials", type=Path, required=True)
    upload.add_argument("--token", type=Path, default=Path("private/youtube-token.json"))
    upload.add_argument("--privacy", choices=["private", "unlisted", "public"], default="private")
    upload.add_argument("--allow-public", action="store_true")
    return parser.parse_args()


def main():
    a = arguments()
    try:
        if a.command == "diagnose":
            report = diagnose(voice=a.voice, model=a.model)
            print(json.dumps(report, indent=2))
            return 0 if report["render_prerequisites_ready"] else 2
        elif a.command == "research":
            content = wikipedia_research(a.topic)
            write_json(a.out, content)
            print(f"Source recorded: {content['source_url']}\nSaved: {a.out}")
        elif a.command == "draft":
            content = generate_story(read_json(a.research), model=a.model)
            write_json(a.out, content)
            print(f"Original English draft saved: {a.out} — {validate_story(content)}")
        elif a.command == "check":
            print(json.dumps(validate_story(read_json(a.story)), indent=2))
        elif a.command == "assets":
            story = read_json(a.workdir / "story.json")
            validate_story(story)
            manifest = gather_assets(story, a.workdir)
            print(f"Licensed images: {len(manifest['images'])}; rights record: {a.workdir / 'ATTRIBUTIONS.md'}")
        elif a.command == "render":
            story = read_json(a.workdir / "story.json")
            validate_story(story)
            result = render_story(story, read_json(a.workdir / "assets.json"), a.workdir, piper_voice=a.voice, piper_binary=a.piper)
            print(json.dumps(result, indent=2))
        elif a.command == "upload":
            story = read_json(a.workdir / "story.json")
            validate_story(story)
            if not (a.workdir / "render-report.json").is_file():
                raise StoryError("Render report missing: do not upload an unverified file")
            details = read_json(a.workdir / "render-report.json")
            if not 480 <= details["duration_seconds"] <= 720:
                raise StoryError("Video length gate failed")
            if not (a.workdir / "review-approved.txt").is_file():
                raise StoryError("Human editorial approval missing: create work/review-approved.txt only after checking facts and image rights")
            credits = (a.workdir / "ATTRIBUTIONS.md").read_text(encoding="utf-8")
            print(json.dumps(upload_video(a.workdir / "story-video.mp4", story, client_secrets=a.credentials, token_file=a.token, privacy=a.privacy, allow_public=a.allow_public, description_credits=credits), indent=2))
    except (StoryError, OSError, KeyError, ValueError) as exc:
        print(f"Blocked safely: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
