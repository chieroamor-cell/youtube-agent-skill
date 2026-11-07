"""License-aware imagery discovery through Wikimedia Commons.

No YouTube downloads, copyrighted-film scraping, or unlicensed fallbacks.
"""
from __future__ import annotations

import html
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from .core import StoryError, USER_AGENT, get_json, write_json

ALLOWED_PREFIXES = ("CC0", "CC BY ", "CC BY-SA ", "Public domain", "Public Domain")
MAX_ASSET_BYTES = 15 * 1024 * 1024


def clean_html(value: str) -> str:
    return html.unescape(re.sub(r"<[^>]*>", "", value or "")).strip()


def license_allowed(label: str) -> bool:
    return any(label.strip().casefold().startswith(x.casefold()) for x in ALLOWED_PREFIXES)


def commons_candidates(query: str) -> list[dict]:
    params = urllib.parse.urlencode({
        "action": "query", "format": "json", "formatversion": "2", "generator": "search",
        "gsrsearch": f'filetype:bitmap {query[:100]}', "gsrnamespace": "6", "gsrlimit": "25",
        "prop": "imageinfo", "iiprop": "url|extmetadata|mime", "iiurlwidth": "1400",
    })
    data = get_json("https://commons.wikimedia.org/w/api.php?" + params)
    pages = data.get("query", {}).get("pages", [])
    images = []
    for page in pages:
        info = (page.get("imageinfo") or [{}])[0]
        meta = info.get("extmetadata", {})
        license_label = clean_html(meta.get("LicenseShortName", {}).get("value", ""))
        uri = info.get("thumburl", info.get("url", ""))
        parsed = urllib.parse.urlsplit(uri)
        mime = info.get("mime", "")
        if not (license_allowed(license_label) and parsed.scheme == "https" and parsed.netloc == "upload.wikimedia.org" and mime in ("image/jpeg", "image/png", "image/webp")):
            continue
        images.append({
            "url": uri, "page": info.get("descriptionurl", ""), "title": page.get("title", ""),
            "license": license_label, "license_url": clean_html(meta.get("LicenseUrl", {}).get("value", "")),
            "author": clean_html(meta.get("Artist", {}).get("value", "Unknown"))[:250],
        })
    return images


def download_image(url: str, target: Path) -> None:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.netloc != "upload.wikimedia.org":
        raise StoryError("Image host not in allowed Wikimedia Commons domain")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=60) as r, target.open("wb") as f:
            remaining = MAX_ASSET_BYTES
            while True:
                piece = r.read(min(65536, remaining + 1))
                if not piece:
                    break
                remaining -= len(piece)
                if remaining < 0:
                    raise StoryError("Image exceeded 15 MB limit")
                f.write(piece)
    except (urllib.error.URLError, TimeoutError) as exc:
        target.unlink(missing_ok=True)
        raise StoryError(f"Image download failed: {exc}") from exc
    except Exception:
        target.unlink(missing_ok=True)
        raise


def gather_assets(story: dict, workdir: Path, *, maximum_reuses: int = 3) -> dict:
    root = workdir / "images"
    root.mkdir(parents=True, exist_ok=True)
    used: dict[str, int] = {}
    credits = []
    assignment = []
    for index, scene in enumerate(story["scenes"], start=1):
        matches = commons_candidates(scene["visual_query"])
        selected = next((m for m in matches if used.get(m["url"], 0) < maximum_reuses), None)
        if not selected:
            raise StoryError(f"Scene {index}: no suitably licensed photo for {scene['visual_query']!r}. Add an image manually with rights evidence; never substitute unlicensed images")
        suffix = Path(urllib.parse.urlsplit(selected["url"]).path).suffix.lower()
        if suffix not in (".jpeg", ".jpg", ".png", ".webp"):
            suffix = ".jpg"
        target = root / f"{index:03d}{suffix}"
        download_image(selected["url"], target)
        used[selected["url"]] = used.get(selected["url"], 0) + 1
        assignment.append({"scene": index, "file": str(target.relative_to(workdir)), **selected})
        if selected["url"] not in [c["url"] for c in credits]:
            credits.append(selected)
    manifest = {"images": assignment, "credits": credits, "policy": "Commons imagery with public domain / CC0 / CC BY / CC BY-SA license metadata; human rights review still required"}
    write_json(workdir / "assets.json", manifest)
    text = "# Visual credits\n\n"
    for c in credits:
        text += f"- {c['title']} — {c['author']} — {c['license']} — {c['page']} — {c['license_url']}\n"
    (workdir / "ATTRIBUTIONS.md").write_text(text, encoding="utf-8")
    return manifest


def validate_asset_manifest(story: dict, manifest: dict, workdir: Path) -> dict[int, dict]:
    """Refuse rendering if any image lacks traceable Commons provenance or is outside workdir.

    This checks metadata completeness/allowed license labels, *not* legal ownership of
    the image or whether the media depicts what the narration says.
    """
    images = manifest.get("images", [])
    credits = manifest.get("credits", [])
    if not isinstance(images, list) or len(images) != len(story["scenes"]):
        raise StoryError("Exactly one licensed asset per story scene is required")
    if not isinstance(credits, list):
        raise StoryError("Asset credits are missing")
    credit_urls = {x.get("url") for x in credits if isinstance(x, dict)}
    base = workdir.resolve()
    numbers: set[int] = set()
    indexed: dict[int, dict] = {}
    for image in images:
        if not isinstance(image, dict):
            raise StoryError("Invalid image manifest record")
        number = image.get("scene")
        if type(number) is not int or number in numbers or not 1 <= number <= len(story["scenes"]):
            raise StoryError("Duplicate or out-of-range scene index in asset manifest")
        numbers.add(number)
        label = str(image.get("license") or "").strip()
        source_url = urllib.parse.urlsplit(str(image.get("page") or ""))
        download_url = urllib.parse.urlsplit(str(image.get("url") or ""))
        if not license_allowed(label):
            raise StoryError(f"Scene {number}: image license is not allowed: {label!r}")
        if source_url.scheme != "https" or source_url.netloc != "commons.wikimedia.org":
            raise StoryError(f"Scene {number}: missing verified Commons attribution page")
        if download_url.scheme != "https" or download_url.netloc != "upload.wikimedia.org":
            raise StoryError(f"Scene {number}: invalid Commons image download host")
        if not str(image.get("title") or "").strip():
            raise StoryError(f"Scene {number}: title missing from image credit")
        if label.casefold().startswith(("cc by ", "cc by-sa ")):
            url = urllib.parse.urlsplit(str(image.get("license_url") or ""))
            if url.scheme != "https" or url.netloc not in ("creativecommons.org", "www.creativecommons.org"):
                raise StoryError(f"Scene {number}: CC BY image has no Creative Commons license URL")
            if not str(image.get("author") or "").strip():
                raise StoryError(f"Scene {number}: attribution author is missing")
        if image["url"] not in credit_urls:
            raise StoryError(f"Scene {number}: image missing from credit manifest")
        name = image.get("file")
        if not isinstance(name, str) or not name.strip():
            raise StoryError(f"Scene {number}: image file path is missing")
        path = (workdir / name).resolve()
        if not path.is_relative_to(base) or not path.is_file() or path.stat().st_size < 16:
            raise StoryError(f"Scene {number}: missing or unsafe image file")
        indexed[number] = image
    if numbers != set(range(1, len(story["scenes"]) + 1)):
        raise StoryError("Asset manifest missing scene entries")
    return indexed
