import copy
import tempfile
import unittest
from pathlib import Path
from story_agent.assets import clean_html, license_allowed
from story_agent.core import StoryError, choose_topic, validate_story, wikipedia_research
from story_agent.media import _srt_clock, sentences, subtitle_chunks, write_srt
from story_agent.youtube import upload_video


class StoryTests(unittest.TestCase):
    def setUp(self):
        self.story = {
            "title": "How an icon changed the game",
            "references": ["https://en.wikipedia.org/wiki/Example"],
            "scenes": [{"narration": "This is a story about a surprising new idea. " * 5,
                        "visual_query": "historic technology"} for _ in range(30)],
        }

    def test_quality_gate(self):
        outcome = validate_story(self.story)
        self.assertEqual(outcome["scene_count"], 30)
        self.assertGreater(outcome["spoken_words"], 1100)

    def test_missing_references_and_scenes_blocked(self):
        temp = copy.deepcopy(self.story)
        temp["references"] = []
        with self.assertRaises(StoryError): validate_story(temp)
        temp = copy.deepcopy(self.story)
        temp["scenes"][2]["visual_query"] = ""
        with self.assertRaises(StoryError): validate_story(temp)

    def test_short_story_blocked(self):
        self.story["scenes"] = self.story["scenes"][:2]
        with self.assertRaises(StoryError): validate_story(self.story)

    def test_licenses_allow_attribution_but_not_nonc(self):
        self.assertTrue(license_allowed("CC0 1.0"))
        self.assertTrue(license_allowed("CC BY-SA 4.0"))
        self.assertTrue(license_allowed("Public domain"))
        self.assertFalse(license_allowed("CC BY-NC 4.0"))
        self.assertFalse(license_allowed("All rights reserved"))
        self.assertFalse(license_allowed("CC BY-ND 2.0"))
        self.assertEqual(clean_html("<i>Alice</i> &amp; Bob"), "Alice & Bob")

    def test_caption_timecode_and_text(self):
        self.assertEqual(_srt_clock(3661.75), "01:01:01,750")
        self.assertEqual(sentences("The first story. Then the second!"), ["The first story.", "Then the second!"])
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "sub.srt"
            write_srt([[('One two three four five six seven eight nine ten eleven twelve.', 6.0)]], out)
            data = out.read_text()
            self.assertIn("00:00:00,000 --> 00:00:05,500", data)
            self.assertIn("00:00:05,500 --> 00:00:06,000", data)

    def test_topic_dedupe(self):
        self.assertEqual(choose_topic(["LeBron James", "Nintendo"], {"lebron james"}), "Nintendo")
        with self.assertRaises(StoryError): choose_topic(["Nintendo"], {"nintendo"})

    def test_public_upload_is_restricted(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            file = root / "clip.mp4"
            secrets = root / "client.json"
            file.write_bytes(b"dummy")
            secrets.write_text("{}")
            with self.assertRaises(StoryError):
                upload_video(file, self.story, client_secrets=secrets, token_file=root / "token.json", privacy="public")

    def test_research_rejects_invalid_topic_offline(self):
        with self.assertRaises(StoryError): wikipedia_research(" ")


if __name__ == "__main__":
    unittest.main()

# Keep media integration checks separate from TTS: one synthetic image and tone use no network.
class LocalMediaSmokeTests(unittest.TestCase):
    @unittest.skipUnless(__import__('shutil').which('ffmpeg') and __import__('shutil').which('ffprobe'), 'FFmpeg not available')
    def test_ken_burns_one_second_clip(self):
        import subprocess
        from story_agent.media import duration, make_scene_clip
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=1600x900:d=1', '-frames:v', '1', str(base/'picture.jpg')], check=True)
            subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=1.2', '-c:a', 'pcm_s16le', str(base/'narration.wav')], check=True)
            make_scene_clip(base/'picture.jpg', base/'narration.wav', base/'clip.mp4')
            self.assertTrue((base/'clip.mp4').stat().st_size > 5000)
            self.assertAlmostEqual(duration(base/'clip.mp4'), 1.2, delta=0.1)

class PreflightAndRenderSafetyTests(unittest.TestCase):
    def setUp(self):
        self.story = {
            "title": "An original story",
            "references": ["https://en.wikipedia.org/wiki/Example"],
            "scenes": [{"narration": "This story really happened, and a surprise followed.", "visual_query": "some notable event"} for _ in range(30)],
        }

    def manifest(self, base):
        # Local stubs are used solely to test metadata/path gates; not publishable footage.
        (base / "images").mkdir(exist_ok=True)
        assets = []
        for i in range(1, 31):
            path = base / "images" / f"{i:03d}.jpg"
            path.write_bytes(b"not-a-real-photo-for-unit-test" * 2)
            assets.append({
                "scene": i, "file": f"images/{i:03d}.jpg",
                "url": f"https://upload.wikimedia.org/wikipedia/commons/{i:02d}/test.jpg",
                "page": f"https://commons.wikimedia.org/wiki/File:Test_{i}.jpg",
                "title": f"File:Test_{i}.jpg", "license": "CC BY-SA 4.0",
                "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
                "author": "Sample photographer",
            })
        return {"images": assets, "credits": assets.copy()}

    def test_manifest_rejects_missing_license(self):
        from story_agent.assets import validate_asset_manifest
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            manifest = self.manifest(base)
            manifest["images"][4]["license"] = "CC BY-NC 4.0"
            with self.assertRaisesRegex(StoryError, "license is not allowed"):
                validate_asset_manifest(self.story, manifest, base)

    def test_manifest_rejects_traversal_and_missing_credits(self):
        from story_agent.assets import validate_asset_manifest
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            manifest = self.manifest(base)
            manifest["images"][0]["file"] = "../../sensitive.txt"
            with self.assertRaisesRegex(StoryError, "missing or unsafe"):
                validate_asset_manifest(self.story, manifest, base)
            manifest = self.manifest(base)
            manifest["credits"] = []
            with self.assertRaisesRegex(StoryError, "missing from credit"):
                validate_asset_manifest(self.story, manifest, base)

    def test_length_checked_before_expensive_video_encoding(self):
        from unittest.mock import patch
        from story_agent.media import render_story
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            manifest = self.manifest(base)
            (base / "render-report.json").write_text('old report', encoding='utf-8')
            (base / "story-video.mp4").write_bytes(b"old video")
            with patch("story_agent.media.speak_scene", return_value=(base / "fake.wav", [("Hello!", 2.0)])), \
                    patch("story_agent.media.make_scene_clip") as encoder:
                with self.assertRaisesRegex(StoryError, "No video encoding"):
                    render_story(self.story, manifest, base, piper_voice=base / "nonexistent.onnx")
                encoder.assert_not_called()
            self.assertFalse((base / "render-report.json").exists())
            self.assertFalse((base / "story-video.mp4").exists())

    def test_8_minute_timeline_reaches_concat_stage_with_mocked_audio(self):
        from unittest.mock import patch
        from story_agent.media import render_story
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            manifest = self.manifest(base)
            def fake_clip(_, __, dest):
                dest.write_bytes(b"mock clip: not a real video")
            def fake_run(args, **kwargs):
                # Never executes FFmpeg; ONLY verifies 8-12m render orchestration.
                Path(args[-1]).write_bytes(b"mock final mp4")
            with patch("story_agent.media.speak_scene", return_value=(base / "fake.wav", [("Original script sentence.", 17.0)])), \
                    patch("story_agent.media.make_scene_clip", side_effect=fake_clip) as enc, \
                    patch("story_agent.media.run", side_effect=fake_run), \
                    patch("story_agent.media.require_binary", return_value="ffmpeg"), \
                    patch("story_agent.media.duration", return_value=510.0):
                report = render_story(self.story, manifest, base, piper_voice=base / "fake.onnx")
                self.assertEqual(enc.call_count, 30)
            self.assertEqual(report["duration_seconds"], 510.0)
            self.assertEqual(report["scene_count"], 30)
            self.assertIn("00:08:30,000", (base / "captions.en.srt").read_text())

    def test_diagnose_is_read_only_when_services_are_missing(self):
        from unittest.mock import patch
        from story_agent.preflight import diagnose
        with patch("story_agent.preflight.shutil.which", return_value=None):
            status = diagnose(voice=None, check_ollama=False)
        self.assertFalse(status["render_prerequisites_ready"])
        self.assertFalse(status["publishing_enabled"])
        self.assertIn("Install piper", status["blocked_reasons"])
