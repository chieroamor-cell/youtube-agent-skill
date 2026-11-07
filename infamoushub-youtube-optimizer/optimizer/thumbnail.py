"""Generate a high-contrast custom 1280x720 thumbnail from an authorized image."""
from __future__ import annotations

from pathlib import Path


def create_thumbnail(image: Path, target: Path, words: str, *, rights: str) -> Path:
    if rights not in {"owned", "licensed"}:
        raise ValueError("Confirma los derechos de la imagen: owned o licensed")
    words = " ".join(words.split()).strip()
    if not 1 <= len(words.split()) <= 5 or len(words) > 55:
        raise ValueError("Utiliza entre 1 y 5 palabras en la miniatura")
    if not image.is_file() or image.stat().st_size == 0:
        raise ValueError("Falta la imagen con derechos de uso")
    from PIL import Image, ImageDraw, ImageFont, ImageOps
    with Image.open(image) as original:
        if original.width < 400 or original.height < 250:
            raise ValueError("Imagen demasiado pequeña para una miniatura")
        original = ImageOps.exif_transpose(original).convert("RGB")
        img = ImageOps.fit(original, (1280, 720), method=Image.Resampling.LANCZOS)
    # Darkening the left of the image keeps letters legible on a phone.
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    pixels = ImageDraw.Draw(overlay)
    for x in range(850):
        alpha = int(230 * (1 - x / 850) ** 1.6)
        pixels.line([(x, 0), (x, 720)], fill=(4, 12, 23, alpha))
    img = Image.alpha_composite(img.convert("RGBA"), overlay)
    draw = ImageDraw.Draw(img)
    font = None
    for candidate in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf", "C:/Windows/Fonts/arialbd.ttf"):
        if Path(candidate).is_file():
            font = ImageFont.truetype(candidate, size=86)
            break
    if font is None:
        font = ImageFont.load_default(size=72)
    words_list = words.upper().split()
    lines = []
    current = ""
    for word in words_list:
        candidate = (current + " " + word).strip()
        if current and draw.textbbox((0, 0), candidate, font=font)[2] > 720:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    if len(lines) > 4:
        raise ValueError("Demasiado texto para la miniatura")
    y = 360 - len(lines) * 60
    for i, line in enumerate(lines):
        draw.text((55, y + i * 110), line, font=font, fill=(255, 255, 255, 255), stroke_width=4, stroke_fill=(0, 0, 0, 220))
    draw.rounded_rectangle((55, 650, 330, 688), radius=8, fill=(245, 181, 55, 235))
    brandfont = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 23) if Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf").exists() else ImageFont.load_default(size=22)
    draw.text((75, 656), "INFAMOUSHUB", font=brandfont, fill=(5, 10, 20, 255))
    target.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(target, "JPEG", quality=90, optimize=True)
    if target.stat().st_size > 50_000_000:
        raise ValueError("La miniatura excede los límites de YouTube")
    return target
