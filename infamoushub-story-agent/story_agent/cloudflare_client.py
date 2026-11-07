"""Safely claim one job from the user's separate Cloudflare Worker.

Never uploads/publishes to YouTube; token is supplied ONLY in an env var.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from .core import StoryError
from .pipeline import next_topic, record_topic, run_production, safe_slug


def cloudflare_request(base: str, token: str, endpoint: str, *, method: str = "GET", payload: dict | None = None) -> dict | None:
    parts = urllib.parse.urlsplit(base)
    if parts.scheme != "https" or not parts.netloc or parts.username or parts.password or parts.query or parts.fragment or parts.path not in ("", "/"):
        raise StoryError("Cloudflare endpoint must be an HTTPS base URL with no credentials or query")
    if len(token) < 32 or not endpoint.startswith("/v1/"):
        raise StoryError("Missing secure renderer token or invalid route")
    url = base.rstrip("/") + endpoint
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, method=method, data=data, headers={"Authorization": "Bearer " + token, "Accept": "application/json", **({"Content-Type": "application/json"} if data else {})})
    # Never forward bearer credentials across redirects or change of origin.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, request, fp, code, message, headers, newurl):
            return None
    opener = urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(req, timeout=30) as response:
            if response.status == 204:
                return None
            if response.headers.get("Content-Type", "").split(";")[0] != "application/json":
                raise StoryError("Coordinator returned unexpected response type")
            result = json.load(response)
            if not isinstance(result, dict):
                raise StoryError("Coordinator returned invalid JSON")
            return result
    except urllib.error.HTTPError as exc:
        raise StoryError(f"Coordinator returned HTTP {exc.code}; check URL and permissions") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise StoryError(f"Cloudflare coordinator unavailable: {type(exc).__name__}") from exc


def work_once(*, base: str, token: str, voice: Path, topics_file: Path, output_root: Path, history_file: Path, model: str = "llama3.1:8b", piper: str = "piper") -> dict:
    # Check prerequisites BEFORE claiming a job, to avoid lease starvation.
    from .preflight import diagnose
    dep = diagnose(voice=voice, model=model)
    if not dep["render_prerequisites_ready"]:
        raise StoryError("Cannot claim a job: " + "; ".join(dep["blocked_reasons"]))
    topic = next_topic(topics_file, history_file)
    response = cloudflare_request(base, token, "/v1/claim", method="POST")
    if response is None:
        return {"state": "no_jobs", "published": False}
    job = response.get("job")
    if not isinstance(job, dict) or not isinstance(job.get("id"), str) or not isinstance(job.get("lease_id"), str):
        raise StoryError("Cloudflare returned an invalid job claim")
    if not job["id"].startswith("story-") or len(job["id"]) > 35:
        raise StoryError("Unexpected job identifier")
    name = f"{job['id']}-{safe_slug(topic)}"
    directory = output_root / name
    try:
        result = run_production(topic, directory, voice=voice, model=model, piper=piper, validate_tools=False)
        record_topic(history_file, topic)
        cloudflare_request(base, token, "/v1/report", method="POST", payload={"id": job["id"], "lease_id": job["lease_id"], "state": "rendered", "duration_seconds": result["duration_seconds"], "result_sha256": result["mp4_sha256"]})
        return {"state": "needs_human_editorial_review", "job": job["id"], "workdir": str(directory), "published": False}
    except Exception:
        try:
            cloudflare_request(base, token, "/v1/report", method="POST", payload={"id": job["id"], "lease_id": job["lease_id"], "state": "failed"})
        except StoryError:
            pass
        raise
