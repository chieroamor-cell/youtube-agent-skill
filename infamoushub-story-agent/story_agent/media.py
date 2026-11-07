"""Offline TTS and simple dynamic photo motion; local FFmpeg + Piper only."""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path
from .core import StoryError
from .assets import validate_asset_manifest


def require_binary(name: str) -> str:
    found = shutil.which(name)
    if not found:
        raise StoryError(f"Required local program not installed: {name}")
    return found


def run(args: list[str], *, input_text: str | None = None, timeout: int = 600) -> None:
    try:
        done = subprocess.run(args, input=input_text, text=True, check=False, capture_output=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise StoryError(f"Could not run {args[0]}: {exc}") from exc
    if done.returncode:
        raise StoryError(f"{args[0]} failed: {done.stderr[-1000:]}")


def duration(path: Path) -> float:
    binary = require_binary("ffprobe")
    result = subprocess.run([binary, "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)], capture_output=True, text=True)
    if result.returncode or not result.stdout.strip():
        raise StoryError(f"FFprobe cannot read media duration: {path}")
    return float(result.stdout.strip())


def sentences(narration: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+", narration.strip())
    return [p.strip() for p in parts if p.strip()]


def concat_list(paths: list[Path], destination: Path) -> Path:
    if not paths:
        raise StoryError("Cannot concatenate an empty file list")
    destination.parent.mkdir(parents=True, exist_ok=True)
    filelist = destination.parent / (destination.stem + "-concat.txt")
    # Store relative filenames under one workdir; no shell, no glob expansion.
    for p in paths:
        if p.parent.resolve() != destination.parent.resolve():
            raise StoryError("All media paths in the concat group must share one directory")
        if "'" in p.name or "\n" in p.name:
            raise StoryError("Unsafe media filename")
    filelist.write_text("".join(f"file '{p.name}'\n" for p in paths), encoding="utf-8")
    return filelist


def speak_scene(narration: str, directory: Path, *, voice: Path, piper_binary: str = "piper") -> tuple[Path, list[tuple[str, float]]]:
    if not voice.exists():
        raise StoryError(f"Piper voice model missing: {voice}")
    if not directory.exists():
        directory.mkdir(parents=True)
    binary = require_binary(piper_binary)
    lines = sentences(narration)
    audio_files = []
    timing = []
    for index, text in enumerate(lines, start=1):
        wav = directory / f"sentence-{index:03d}.wav"
        run([binary, "--model", str(voice.resolve()), "--output_file", str(wav)], input_text=text + "\n", timeout=180)
        seconds = duration(wav)
        if seconds <= 0:
            raise StoryError("TTS generated empty voice audio")
        audio_files.append(wav)
        timing.append((text, seconds))
    if not audio_files:
        raise StoryError("Scene narration is empty")
    merged = directory / "voice.wav"
    if len(audio_files) == 1:
        shutil.copyfile(audio_files[0], merged)
    else:
        concat_file = concat_list(audio_files, directory / "voice.wav")
        # Use absolute input and output paths; ffmpeg resolves the concat list's relative entries itself.
        run([require_binary("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_file), "-c:a", "pcm_s16le", str(merged)], timeout=240)
    return merged, timing


def make_scene_clip(image: Path, audio: Path, destination: Path) -> None:
    """Ken Burns-style photo move; audio duration determines clip length."""
    if not image.exists() or not audio.exists():
        raise StoryError("Missing licensed image or narration for a scene")
    seconds = duration(audio)
    if seconds < 0.3 or seconds > 120:
        raise StoryError(f"Suspicious scene duration: {seconds}s")
    vf = "scale=1600:900:force_original_aspect_ratio=increase,crop=1600:900,zoompan=z='min(zoom+0.00035,1.08)':d=1:x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':s=1280x720:fps=25,format=yuv420p"
    run([require_binary("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-framerate", "25", "-i", str(image), "-i", str(audio), "-vf", vf, "-t", f"{seconds:.3f}", "-r", "25", "-c:v", "libx264", "-preset", "fast", "-crf", "24", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(destination)], timeout=7200)


def _srt_clock(seconds: float) -> str:
    ms = round(seconds * 1000)
    h, rem = divmod(ms, 3600000)
    m, rem = divmod(rem, 60000)
    s, ms = divmod(rem, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def subtitle_chunks(sentence: str, *, max_words: int = 11) -> list[str]:
    words = sentence.split()
    return [" ".join(words[x:x + max_words]) for x in range(0, len(words), max_words)]


def write_srt(all_timings: list[list[tuple[str, float]]], path: Path) -> None:
    clock = 0.0
    lines = []
    number = 1
    for scene in all_timings:
        for sentence, seconds in scene:
            chunks = subtitle_chunks(sentence)
            if not chunks:
                clock += seconds
                continue
            total = sum(len(c.split()) for c in chunks)
            elapsed = 0.0
            for chunk in chunks:
                delta = seconds * len(chunk.split()) / total
                start, end = clock + elapsed, clock + elapsed + delta
                lines.append(f"{number}\n{_srt_clock(start)} --> {_srt_clock(end)}\n{chunk}\n\n")
                elapsed += delta
                number += 1
            clock += seconds
    path.write_text("".join(lines), encoding="utf-8")


def render_story(story: dict, manifest: dict, workdir: Path, *, piper_voice: Path, piper_binary: str = "piper", minimum: int = 480, maximum: int = 720) -> dict:
    # Any previous successful output must be invalidated on a new render attempt.
    (workdir / "render-report.json").unlink(missing_ok=True)
    (workdir / "story-video.mp4").unlink(missing_ok=True)
    assets = validate_asset_manifest(story, manifest, workdir)
    scenes_dir = workdir / "render"
    scenes_dir.mkdir(exist_ok=True, parents=True)
    clips, timings, narration_files = [], [], []

    # Two-pass pipeline: synthesize all narration, measure actual duration and only
    # then spend CPU on 25-fps HD clips. Invalid lengths never trigger video encoding.
    for n, item in enumerate(story["scenes"], 1):
        directory = scenes_dir / f"scene-{n:03d}"
        directory.mkdir(exist_ok=True)
        wav, sentence_timings = speak_scene(item["narration"], directory, voice=piper_voice, piper_binary=piper_binary)
        narration_files.append(wav)
        timings.append(sentence_timings)
    total = sum(sum(sec for _, sec in t) for t in timings)
    if not (minimum <= total <= maximum):
        raise StoryError(f"Actual narration is {total / 60:.1f} minutes; expected {minimum / 60:.1f}-{maximum / 60:.1f}. No video encoding or upload attempted")

    for n, wav in enumerate(narration_files, 1):
        image = workdir / assets[n]["file"]
        dest = scenes_dir / f"scene-{n:03d}.mp4"
        make_scene_clip(image, wav, dest)
        clips.append(dest)
    subtitle = workdir / "captions.en.srt"
    write_srt(timings, subtitle)
    filelist = concat_list(clips, scenes_dir / "combined.mp4")
    out = workdir / "story-video.mp4"
    # Mux captions as an optional English subtitle track without another video encode.
    # Keep captions.en.srt as a separate file for YouTube upload/review.
    run([require_binary("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y",
         "-f", "concat", "-safe", "0", "-i", str(filelist),
         "-i", str(subtitle), "-map", "0:v:0", "-map", "0:a:0", "-map", "1:s:0",
         "-c:v", "copy", "-c:a", "copy", "-c:s", "mov_text", "-metadata:s:s:0", "language=eng",
         "-movflags", "+faststart", str(out)], timeout=900)
    real = duration(out)
    if not (minimum - 3 <= real <= maximum + 3):
        raise StoryError(f"Final video duration unexpectedly {real:.1f}s. Check render before publishing")
    report = {"video": str(out), "subtitle": str(subtitle), "duration_seconds": round(real, 2), "video_size_bytes": out.stat().st_size, "scene_count": len(clips), "narration_seconds": round(total, 2), "subtitles_embedded": True, "published": False}
    (workdir / "render-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report
