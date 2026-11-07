"""Read-only local dependency checks. No paid API, public network call or uploads."""
from __future__ import annotations

import json
import platform
import os
import shutil
import urllib.error
import urllib.request
from pathlib import Path


def diagnose(*, voice: Path | None = None, model: str = "llama3.1:8b", check_ollama: bool = True) -> dict:
    tools = {tool: bool(shutil.which(tool)) for tool in ("ffmpeg", "ffprobe", "piper")}
    voice_ready = bool(voice and voice.is_file() and voice.stat().st_size > 0)
    # Piper voice files require a matching .onnx.json config.
    config_path = Path(str(voice) + ".json") if voice else None
    config_ready = False
    if config_path and config_path.is_file() and config_path.stat().st_size > 0:
        try:
            with config_path.open(encoding="utf-8") as f:
                config_ready = isinstance(json.load(f), dict)
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            pass
    try:
        ram_gb = round(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / (1024 ** 3), 1)
    except (ValueError, OSError, AttributeError):
        ram_gb = None
    try:
        disk_gb = round(shutil.disk_usage(Path.cwd()).free / (1024 ** 3), 1)
    except OSError:
        disk_gb = None
    hardware = {"os": platform.system(), "architecture": platform.machine(),
                "ram_gb": ram_gb, "free_disk_gb": disk_gb, "advice": []}
    if ram_gb is not None and ram_gb < 8:
        hardware["advice"].append("Less than 8 GB RAM: local 8B-model drafting may not be practical")
    if disk_gb is not None and disk_gb < 15:
        hardware["advice"].append("Less than 15 GB free: download models, voices and video assets with caution")
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
    if not config_ready:
        reasons.append("Provide its matching .onnx.json Piper voice config")
    if check_ollama and not service["model_found"]:
        reasons.append("Start Ollama and install requested local model")
    return {
        "tools": tools,
        "piper_voice_ready": voice_ready,
        "piper_voice_config_ready": config_ready,
        "hardware": hardware,
        "ollama": service,
        "render_prerequisites_ready": not reasons and check_ollama,
        "blocked_reasons": reasons,
        "publishing_enabled": False,
    }
