"""Prepare accurate YouTube packages from a supplied verified video brief."""
from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse

VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
CHAPTER = re.compile(r"^(\d{2}:\d{2}(?::\d{2})?)\s+(.+)$")


def parse_video_id(value: str) -> str:
    value = value.strip()
    if VIDEO_ID.fullmatch(value):
        return value
    url = urlparse(value)
    if url.scheme not in {"http", "https"} or (url.hostname or "").lower() not in {"youtu.be", "youtube.com", "www.youtube.com", "m.youtube.com"}:
        raise ValueError("Introduce el ID o una URL auténtica de YouTube")
    if url.hostname == "youtu.be":
        video_id = url.path.strip("/").split("/")[0]
    elif url.path == "/watch":
        video_id = parse_qs(url.query).get("v", [""])[0]
    elif url.path.startswith(("/shorts/", "/live/")):
        video_id = url.path.split("/")[2]
    else:
        video_id = ""
    if not VIDEO_ID.fullmatch(video_id):
        raise ValueError("No se encontró un ID de YouTube válido")
    return video_id


def clean(s: str, max_length: int) -> str:
    s = re.sub(r"\s+", " ", s).strip()
    s = s.replace("<", "").replace(">", "")
    return s[:max_length].strip()


def make_titles(topic: str, angle: str = "") -> list[str]:
    topic = clean(topic, 68)
    angle = clean(angle, 58)
    if not topic or len(topic) < 3:
        raise ValueError("Falta el tema del vídeo")
    choices = [f"The Story of {topic}", f"{topic}: The Full Story"]
    if angle:
        choices.insert(0, f"{topic}: {angle}")
    output = []
    for candidate in choices:
        if len(candidate) <= 100 and candidate not in output:
            output.append(candidate)
    return output


def make_chapters(lines: str) -> str:
    if not lines.strip():
        return ""
    parsed = []
    for line in lines.splitlines():
        if not line.strip():
            continue
        m = CHAPTER.fullmatch(line.strip())
        if not m:
            raise ValueError("Formato de capítulos incorrecto. Ejemplo: 00:00 Introduction")
        tm, label = m.groups()
        vals = list(map(int, tm.split(":")))
        secs = vals[0] * 60 + vals[1] if len(vals) == 2 else vals[0] * 3600 + vals[1] * 60 + vals[2]
        if not parsed and secs != 0:
            raise ValueError("Los capítulos deben comenzar en 00:00")
        if parsed and secs <= parsed[-1][0]:
            raise ValueError("Los capítulos deben estar en orden creciente")
        if vals[-1] >= 60 or (len(vals) == 3 and vals[-2] >= 60):
            raise ValueError("Minutos o segundos no válidos")
        parsed.append((secs, f"{tm} {clean(label, 80)}"))
    return "\n".join(line for _, line in parsed)


def prepare(video_id: str, topic: str, overview: str, *, angle: str = "", chapters: str = "", link: str = "https://infamoushub.com/") -> dict:
    video_id = parse_video_id(video_id)
    overview = clean(overview, 2000)
    if len(overview) < 30:
        raise ValueError("Escribe un resumen real del contenido (mínimo 30 caracteres), sin inventar datos")
    if not re.match(r"^https://", link):
        raise ValueError("El enlace del sitio debe usar HTTPS")
    choices = make_titles(topic, angle)
    chapter_text = make_chapters(chapters)
    header = f"Discover the story of {clean(topic, 70)} — the people, decisions and moments covered in this video."
    desc = header + "\n\n" + overview + "\n\n" + "More stories: " + link
    if chapter_text:
        desc += "\n\nChapters:\n" + chapter_text
    desc += "\n\n#InfamousHub"
    if len(desc.encode("utf-8")) > 5000:
        raise ValueError("La descripción supera el límite de YouTube")
    tags = list(dict.fromkeys([clean(topic, 70), clean(topic + " story", 90), "InfamousHub"]))
    return {"schema_version": 1, "video_id": video_id, "topic": clean(topic, 68), "title_candidates": choices,
            "selected_title": choices[0], "description": desc, "tags": tags,
            "thumbnail_status": "requires_rights_verified_image", "thumbnail_path": None,
            "source": "user_supplied_video_summary", "approved": False,
            "note": "A title and thumbnail may improve CTR; views are not guaranteed. Video facts were not independently checked."}
