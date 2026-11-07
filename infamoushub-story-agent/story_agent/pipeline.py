"""Single-run local pipeline. Does NOT upload or publish to YouTube.

All expensive operations run on the user's own computer. A unique work directory,
lock, and journal prevent accidental overwrites and duplicate concurrent renders.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
from contextlib import contextmanager
from pathlib import Path

from .assets import gather_assets
from .core import StoryError, generate_story, wikipedia_research, write_json
from .media import render_story
from .preflight import diagnose
from .review import digest
from .quality import analyze_story


def safe_slug(topic: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", topic.casefold()).strip("-")[:60].strip("-")
    if not slug:
        raise StoryError("Topic does not produce a safe filename")
    return slug


@contextmanager
def exclusive_directory(directory: Path):
    directory.mkdir(parents=True, exist_ok=True)
    lock = directory / ".running.lock"
    try:
        handle = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError as exc:
        raise StoryError(f"Production directory is locked: {directory}") from exc
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as f:
            f.write("local production in progress; if interrupted, manually inspect before removing\n")
        yield
    finally:
        lock.unlink(missing_ok=True)


def run_production(topic: str, workdir: Path, *, voice: Path, model: str = "llama3.1:8b", piper: str = "piper", validate_tools: bool = True) -> dict:
    if not topic.strip() or len(topic) > 120:
        raise StoryError("Topic must contain 1-120 characters")
    # Never silently overwrite a draft, an approval or previous output.
    if workdir.exists() and any(workdir.iterdir()):
        raise StoryError("Work directory already contains data; use a unique directory for each new story")
    if validate_tools:
        dep = diagnose(voice=voice, model=model)
        if not dep["render_prerequisites_ready"]:
            raise StoryError("Missing local renderer dependencies: " + "; ".join(dep["blocked_reasons"]))
    with exclusive_directory(workdir):
        journal = {"state": "started", "topic": topic, "started_at": dt.datetime.now(dt.timezone.utc).isoformat(), "publishing": "disabled"}
        def set_state(state: str) -> None:
            journal["state"] = state
            write_json(workdir / "pipeline-state.json", journal)
        try:
            set_state("researching")
            research = wikipedia_research(topic)
            write_json(workdir / "research.json", research)
            set_state("drafting")
            story = generate_story(research, model=model)
            write_json(workdir / "story.json", story)
            write_json(workdir / "youtube-skill-analysis.json", analyze_story(story))
            set_state("collecting_licensed_assets")
            manifest = gather_assets(story, workdir)
            set_state("rendering")
            report = render_story(story, manifest, workdir, piper_voice=voice, piper_binary=piper)
            journal.update({"duration_seconds": report["duration_seconds"], "mp4_sha256": digest(workdir / "story-video.mp4")})
            set_state("needs_human_editorial_review")
            return {"topic": topic, "workdir": str(workdir), "state": journal["state"], "duration_seconds": report["duration_seconds"], "mp4_sha256": journal["mp4_sha256"], "published": False}
        except Exception as exc:
            journal["error_class"] = type(exc).__name__
            set_state("failed")
            raise


def next_topic(topics_file: Path, history_file: Path) -> str:
    data = json.loads(topics_file.read_text(encoding="utf-8"))
    if not isinstance(data.get("topic_queue"), list) or not all(isinstance(t, str) for t in data["topic_queue"]):
        raise StoryError("topics JSON must contain a topic_queue list of strings")
    from .core import choose_topic
    used = set()
    if history_file.exists():
        prev = json.loads(history_file.read_text(encoding="utf-8"))
        if not isinstance(prev, list):
            raise StoryError("History must be a JSON list")
        used = {str(x).casefold().strip() for x in prev}
    return choose_topic(data["topic_queue"], used)


def record_topic(history_file: Path, topic: str) -> None:
    history_file.parent.mkdir(parents=True, exist_ok=True)
    history = json.loads(history_file.read_text(encoding="utf-8")) if history_file.exists() else []
    if not isinstance(history, list):
        raise StoryError("Invalid topic history")
    if topic.casefold().strip() in {str(t).casefold().strip() for t in history}:
        raise StoryError("Topic already recorded; do not duplicate")
    history.append(topic)
    tmp = history_file.with_suffix(history_file.suffix + ".tmp")
    tmp.write_text(json.dumps(history, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, history_file)
