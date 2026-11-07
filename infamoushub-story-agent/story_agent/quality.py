"""Reuse the ORIGINAL YouTube Agent Skill analyzers without modifying them.

Their scores are editorial hints, not virality predictions or factual checks.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path


def analyze_story(story: dict, *, repository_root: Path | None = None) -> dict:
    repo = repository_root or Path(__file__).resolve().parents[2]
    first = story["scenes"][0]["narration"]
    # Use the first spoken sentence or 24 words, not the whole 30-second scene.
    opening = re.split(r"(?<=[.!?])\s+", first, maxsplit=1)[0]
    opening = " ".join(opening.split()[:24])
    scripts = {
        "hook": (repo / "skills/yt-script/hookscore.py", ["--json", "--hook", opening]),
        "title": (repo / "skills/yt-package/title.py", ["--json", "--title", story["title"]]),
    }
    output = {"method": "original_upstream_skill_scripts", "scores_are_editorial_hints": True}
    for name, (script, args) in scripts.items():
        if not script.is_file():
            output[name] = {"available": False, "reason": "Original YouTube Agent Skill script not installed alongside standalone package"}
            continue
        try:
            result = subprocess.run([sys.executable, str(script), *args], capture_output=True, text=True, timeout=20, check=True)
            parsed = json.loads(result.stdout)
            if not isinstance(parsed, list) or len(parsed) != 1 or not isinstance(parsed[0], dict):
                raise ValueError("Unexpected skill output")
            output[name] = {"available": True, "analysis": parsed[0]}
        except (subprocess.SubprocessError, ValueError, OSError):
            output[name] = {"available": False, "reason": "Upstream analysis failed; no score was invented"}
    return output
