"""Read-only local dependency checks. No paid API, public network call or uploads."""
from __future__ import annotations

import json
import shutil
import urllib.error
import urllib.request
from pathlib import Path


def diagnose(*, voice: Path | None = None, model: str = "llama3.1:8b", check_ollama: bool = True) -> dict:
    tools = {tool: bool(shutil.which(tool)) for tool in ("ffmpeg", "ffprobe", "piper")}
    voice_ready = bool(voice and voice.is_file() and voice.stat().st_size > 0)
    service = {"reachable": False, "model_found": False, "error": None}
    if check_ollama:
        # Only localhost: never sends any text, credentials or scripts to a remote API.
        url = "http://127.0.0.1:11434/api/tags"
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                payload = json.load(response)
            names = [str(m.get("name", "")) for m in payload.get("models", [])]
            service.update(reachable=True, model_found=model in names)
            if model not in names:
                service["error"] = f"Local model {model!r} not installed"
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
            service["error"] = f"Ollama unavailable locally: {type(exc).__name__}"
    else:
        service["error"] = "Ollama check not requested"
    reasons = [f"Install {name}" for name, found in tools.items() if not found]
    if not voice_ready:
        reasons.append("Provide a downloaded English Piper .onnx voice model")
    if check_ollama and not service["model_found"]:
        reasons.append("Start Ollama and install requested local model")
    return {
        "tools": tools,
        "piper_voice_ready": voice_ready,
        "ollama": service,
        "render_prerequisites_ready": not reasons and check_ollama,
        "blocked_reasons": reasons,
        "publishing_enabled": False,
    }
