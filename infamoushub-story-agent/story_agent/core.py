"""Story development for original English-language, source-grounded YouTube videos.

Offline-first: Ollama runs on the user's own computer; no paid APIs required.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

USER_AGENT = "InfamousHubStoryAgent/0.1 (editorial tool; local user; Wikimedia API)"


class StoryError(ValueError):
    pass


def get_json(url: str, *, timeout: int = 30, payload: dict | None = None, no_redirect: bool = False) -> dict:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url, data=data,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json", **({"Content-Type": "application/json"} if data else {})},
    )
    try:
        if no_redirect:
            class NoRedirect(urllib.request.HTTPRedirectHandler):
                def redirect_request(self, request, fp, code, message, headers, newurl):
                    return None
            opener = urllib.request.build_opener(NoRedirect())
            response = opener.open(request, timeout=timeout)
        else:
            response = urllib.request.urlopen(request, timeout=timeout)
        with response:
            return json.load(response)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise StoryError(f"Could not access {urllib.parse.urlsplit(url).netloc}: {exc}") from exc


def wikipedia_research(topic: str) -> dict:
    """Fetch background text; facts must still be editorially checked before public posting."""
    if not topic.strip() or len(topic) > 120:
        raise StoryError("Topic must be between 1 and 120 characters")
    parameters = urllib.parse.urlencode({
        "action": "query", "format": "json", "formatversion": "2",
        "prop": "extracts", "explaintext": "1", "redirects": "1", "titles": topic,
    })
    response = get_json("https://en.wikipedia.org/w/api.php?" + parameters)
    pages = response.get("query", {}).get("pages", [])
    if not pages or pages[0].get("missing") or not pages[0].get("extract", "").strip():
        raise StoryError(f"No usable English Wikipedia article found for {topic!r}; do not invent facts")
    title = pages[0]["title"]
    source = "https://en.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))
    return {"topic": title, "source_url": source, "source_text": pages[0]["extract"][:23000], "retrieved_utc": dt.datetime.now(dt.timezone.utc).isoformat()}


def _extract_object(raw: str) -> dict:
    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.I)
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        start, end = raw.find("{"), raw.rfind("}")
        if start < 0 or end <= start:
            raise StoryError("Local model did not return valid JSON")
        try:
            result = json.loads(raw[start : end + 1])
        except json.JSONDecodeError as exc:
            raise StoryError(f"Local model returned invalid JSON: {exc}") from exc
    if not isinstance(result, dict):
        raise StoryError("Local model response must be a JSON object")
    return result


def generate_story(research: dict, *, model: str = "llama3.1:8b", ollama_url: str = "http://localhost:11434/api/generate") -> dict:
    """Generate an original lively story. The model must be installed locally by the user."""
    endpoint = urllib.parse.urlsplit(ollama_url)
    try:
        local_port = endpoint.port
    except ValueError as exc:
        raise StoryError("Malformed local Ollama endpoint port") from exc
    if (endpoint.scheme != "http" or endpoint.hostname not in ("127.0.0.1", "localhost")
            or endpoint.username is not None or endpoint.password is not None
            or local_port != 11434 or endpoint.path != "/api/generate"
            or endpoint.query or endpoint.fragment):
        raise StoryError("Ollama must use http://127.0.0.1:11434/api/generate; remote endpoints not allowed")
    prompt = f"""You are writing an ORIGINAL English YouTube story video for InfamousHub. Not a dry documentary.
Use exactly the research below as the factual source. Never invent quotes, dates, salaries,
statistics, crimes, scandals, or relationships. If a fact is uncertain, omit it.
Write a thrilling but truthful life/company story with specific turns, setbacks and recoveries.
Narrator only: no host on camera. The target is 8-12 minutes at 135-155 spoken words/minute.
Create 30-42 varied, cinematic scenes, total 1200-1550 SPOKEN English words.
First scene: a specific curiosity-driven hook, not a generic introduction. Include story arc:
hook, origins, breakthrough, setbacks, turning point, consequences, where they stand.
Short paragraphs, fluid spoken English. Be engaging without clickbait claims.
Provide descriptive, safe, relevant visual searches for Wikimedia Commons images per scene.
No copyrighted music or video links. Do not include source quotes verbatim.
Return ONLY a JSON object:
{{"title":"...","description":"...","scenes":[{{"narration":"25-60 spoken words","visual_query":"few concrete image search terms"}}]}}
Use cinematic storytelling, but DO NOT CLAIM you verified anything not present in the research.

Topic: {research['topic']}
Source: {research['source_url']}
Research excerpt:\n{research['source_text']}
"""
    response = get_json(ollama_url, timeout=900, no_redirect=True, payload={
        "model": model, "prompt": prompt, "stream": False, "format": "json",
        "options": {"temperature": 0.6, "num_predict": 10000},
    })
    if not isinstance(response.get("response"), str):
        raise StoryError("Ollama returned no usable generated text. Check that the local model is installed")
    story = _extract_object(response["response"])
    story["topic"] = research["topic"]
    story["references"] = [research["source_url"]]
    story["research_retrieved_utc"] = research["retrieved_utc"]
    validate_story(story)
    return story


def validate_story(story: dict, *, strict: bool = True) -> dict:
    """Deterministic completeness gate, not a substitute for fact checking."""
    if not isinstance(story, dict) or not str(story.get("title", "")).strip():
        raise StoryError("Story requires a title")
    if not isinstance(story.get("references"), list) or not story["references"]:
        raise StoryError("Missing research source URLs")
    if any(not isinstance(u, str) or not u.startswith("https://") for u in story["references"]):
        raise StoryError("Sources must use HTTPS URLs")
    scenes = story.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        raise StoryError("Story must contain scenes")
    for i, scene in enumerate(scenes, start=1):
        if not isinstance(scene, dict) or not isinstance(scene.get("narration"), str) or not scene["narration"].strip():
            raise StoryError(f"Scene {i} has no narration")
        if not isinstance(scene.get("visual_query"), str) or not scene["visual_query"].strip():
            raise StoryError(f"Scene {i} has no visual query")
    words = sum(len(re.findall(r"\b[\w'-]+\b", scene["narration"])) for scene in scenes)
    if strict and not (1100 <= words <= 1900 and 24 <= len(scenes) <= 55):
        raise StoryError(f"Quality gate: {words} words / {len(scenes)} scenes; need 1100-1900 words and 24-55 scenes")
    return {"scene_count": len(scenes), "spoken_words": words, "approx_minutes_at_145_wpm": round(words / 145, 1)}


def write_json(path: Path, content: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(content, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def choose_topic(topics: list[str], previously_used: set[str]) -> str:
    for topic in topics:
        if topic.casefold().strip() not in previously_used:
            return topic
    raise StoryError("All proposed topics were already used; add original topics before continuing")
