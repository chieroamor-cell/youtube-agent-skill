"""YouTube owner-only metadata updater with explicit opt-in; never changes privacy."""
from __future__ import annotations

import os
from pathlib import Path


def patch_preview(current: dict, pkg: dict, *, expected_channel: str) -> dict:
    if not expected_channel.startswith("UC") or len(expected_channel) < 10:
        raise ValueError("Debes indicar el ID real del canal de YouTube que autorizaste")
    if current.get("id") != pkg.get("video_id"):
        raise ValueError("El ID del paquete no coincide con el vídeo")
    snippet = current.get("snippet") or {}
    if snippet.get("channelId") != expected_channel:
        raise ValueError("Este vídeo pertenece a otro canal. Ningún cambio realizado")
    title = pkg["selected_title"]
    if len(title) > 100 or not title.strip():
        raise ValueError("Título inválido")
    prev = (snippet.get("description") or "").strip()
    new = pkg["description"].strip()
    # Never wipe an existing description that might contain legally-required credits.
    if prev and new not in prev:
        description = new + "\n\n--- Previously supplied description ---\n" + prev
    else:
        description = new if not prev else prev
    if len(description.encode("utf-8")) > 5000:
        raise ValueError("La descripción combinada excede 5000 bytes: revisión manual necesaria")
    old_tags = snippet.get("tags") or []
    tags = list(dict.fromkeys([*old_tags, *pkg.get("tags", [])]))
    if len(",".join(tags).encode("utf-8")) > 450:
        raise ValueError("Hay demasiadas etiquetas combinadas: revisión manual necesaria")
    payload = {"id": current["id"], "snippet": {"title": title, "description": description,
        "categoryId": snippet.get("categoryId") or "24", "tags": tags}}
    for field in ("defaultLanguage", "defaultAudioLanguage"):
        if snippet.get(field):
            payload["snippet"][field] = snippet[field]
    return payload


def client_from_existing_token(token: Path):
    if not token.is_file():
        raise ValueError("Token de YouTube ausente. Primero se necesita autorización OAuth del canal")
    try:
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
        from googleapiclient.discovery import build
    except ImportError as exc:
        raise RuntimeError("Instala las bibliotecas Google de requirements-youtube.txt") from exc
    creds = Credentials.from_authorized_user_file(str(token), scopes=["https://www.googleapis.com/auth/youtube.force-ssl"])
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        token.write_text(creds.to_json(), encoding="utf-8")
        try: token.chmod(0o600)
        except OSError: pass
    if not creds.valid:
        raise ValueError("Token OAuth caducado: vuelve a autorizar el canal")
    return build("youtube", "v3", credentials=creds)


def apply_package(youtube, pkg: dict, *, expected_channel: str, allow_write: bool = False) -> dict:
    result = youtube.videos().list(part="snippet,status", id=pkg["video_id"]).execute()
    videos = result.get("items", [])
    if len(videos) != 1:
        raise ValueError("Vídeo no encontrado o sin permisos")
    # Ensure the OAuth credential is for this channel too (not just a video URL).
    mine = youtube.channels().list(part="id", mine=True).execute()
    if expected_channel not in [c["id"] for c in mine.get("items", [])]:
        raise ValueError("OAuth conectado al canal equivocado; no se cambió ningún vídeo")
    payload = patch_preview(videos[0], pkg, expected_channel=expected_channel)
    dry = not (allow_write and os.environ.get("YOUTUBE_OPTIMIZER_WRITE") == "YES")
    if dry:
        return {"dry_run": True, "video_id": pkg["video_id"], "candidate": payload, "thumbnail_uploaded": False}
    if pkg.get("approved") is not True:
        raise ValueError("El paquete necesita revisión y aprobación editorial antes de aplicar cambios")
    # Validate the image before ANY mutation, avoiding partial changes if the image is invalid.
    photo_path = pkg.get("thumbnail_path")
    image = None
    if photo_path:
        if pkg.get("image_rights") not in {"owned", "licensed"}:
            raise ValueError("La imagen necesita derechos verificados antes de subirse")
        image = Path(photo_path)
        if not image.is_file() or image.suffix.lower() not in {".png", ".jpg", ".jpeg"} or image.stat().st_size == 0:
            raise ValueError("Miniatura no encontrada o con formato no permitido")
        if image.stat().st_size > 50_000_000:
            raise ValueError("Miniatura demasiado grande para YouTube")
    changed = youtube.videos().update(part="snippet", body=payload).execute()
    thumbnail_result = "not_provided"
    if image:
        from googleapiclient.http import MediaFileUpload
        youtube.thumbnails().set(videoId=pkg["video_id"], media_body=MediaFileUpload(str(image), mimetype="image/jpeg" if image.suffix.lower() != ".png" else "image/png")).execute()
        thumbnail_result = "uploaded"
    return {"dry_run": False, "video_id": changed.get("id"), "thumbnail_uploaded": thumbnail_result,
            "privacy_untouched": True}
