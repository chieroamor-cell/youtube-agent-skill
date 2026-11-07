"""Safety checks for a free self-hosted local renderer."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from story_agent.core import StoryError, generate_story
from story_agent.media import speak_scene
from story_agent.preflight import diagnose

class HostReadinessTests(unittest.TestCase):
    def test_absent_voice_sidecar_blocks_false_ready(self):
        with tempfile.TemporaryDirectory() as td:
            voice = Path(td) / 'en_US-lessac-medium.onnx'
            voice.write_bytes(b'fake model contents - test only')
            with patch('story_agent.preflight.shutil.which', return_value='/usr/bin/demo'):
                result = diagnose(voice=voice, check_ollama=False)
            self.assertTrue(result['piper_voice_ready'])
            self.assertFalse(result['piper_voice_config_ready'])
            self.assertIn('Provide its matching .onnx.json Piper voice config', result['blocked_reasons'])

    def test_valid_voice_sidecar_is_recognized_and_invalid_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            voice = Path(td) / 'en_US-lessac-medium.onnx'
            voice.write_bytes(b'fake model contents - test only')
            sidecar = Path(str(voice) + '.json')
            sidecar.write_text(json.dumps({'audio': {'sample_rate': 22050}}))
            self.assertTrue(diagnose(voice=voice, check_ollama=False)['piper_voice_config_ready'])
            sidecar.write_text('not JSON')
            self.assertFalse(diagnose(voice=voice, check_ollama=False)['piper_voice_config_ready'])

    def test_piper_refuses_missing_config_before_tts(self):
        with tempfile.TemporaryDirectory() as td:
            voice = Path(td) / 'en_US-test.onnx'
            voice.write_bytes(b'fake voice')
            with self.assertRaisesRegex(StoryError, 'matching'):
                speak_scene('Test sentence', Path(td) / 'output', voice=voice)

    def test_ollama_blocks_external_host_tricks_without_network(self):
        research = {'topic': 'Test', 'source_url': 'https://en.wikipedia.org/wiki/Test',
                    'source_text': 'Test', 'retrieved_utc': 'now'}
        malicious = [
            'http://localhost:11434@evil.example/api/generate',
            'http://127.0.0.1:11434.evil.example/api/generate',
            'http://localhost:1234/api/generate',
            'http://localhost:11434/api/generate?query=evil',
            'http://localhost:11434/api/anything',
            'https://localhost:11434/api/generate',
        ]
        with patch('story_agent.core.get_json') as req:
            for url in malicious:
                with self.subTest(url=url):
                    with self.assertRaises(StoryError):
                        generate_story(research, ollama_url=url)
            req.assert_not_called()

    def test_host_report_omits_secrets(self):
        status = diagnose(voice=None, check_ollama=False)
        self.assertFalse(status['publishing_enabled'])
        self.assertIn('hardware', status)
        self.assertIn('free_disk_gb', status['hardware'])
        self.assertNotIn('hostname', status['hardware'])

if __name__ == '__main__': unittest.main()
