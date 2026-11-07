import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from story_agent.core import StoryError
from story_agent.pipeline import safe_slug, exclusive_directory, run_production, next_topic, record_topic
from story_agent.review import approve_render, require_current_approval
from story_agent.cloudflare_client import cloudflare_request, work_once


class PipelineTests(unittest.TestCase):
    def test_topic_filename_is_safe(self):
        self.assertEqual(safe_slug('LeBron James'), 'lebron-james')
        self.assertEqual(safe_slug('Nintendo: Rise & Fall!'), 'nintendo-rise-fall')
        with self.assertRaises(StoryError):
            safe_slug('!!!')

    def test_directory_lock_prevents_double_runs(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / 'new'
            with exclusive_directory(p):
                with self.assertRaisesRegex(StoryError, 'locked'):
                    with exclusive_directory(p):
                        pass
            self.assertFalse((p / '.running.lock').exists())

    def test_never_overwrites_existing_output(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td)
            (p / 'story-video.mp4').write_bytes(b'previous video')
            with self.assertRaisesRegex(StoryError, 'already contains data'):
                run_production('Nintendo', p, voice=Path('non-existent.onnx'), validate_tools=False)
            self.assertEqual((p / 'story-video.mp4').read_bytes(), b'previous video')

    def test_missing_dependencies_do_not_create_output(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / 'new'
            with patch('story_agent.pipeline.diagnose', return_value={'render_prerequisites_ready':False,'blocked_reasons':['Piper model missing']}):
                with self.assertRaisesRegex(StoryError, 'Piper model missing'):
                    run_production('LeBron James', p, voice=Path('missing.onnx'))
            self.assertFalse(p.exists())

    def test_automated_pipeline_creates_review_not_approval_or_upload(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / 'lebron'
            research = {'topic':'LeBron James','source_url':'https://en.wikipedia.org/wiki/LeBron_James','source_text':'original','retrieved_utc':'now'}
            story = {'title':'Original','references':[research['source_url']],'scenes':[{'narration':'Spoken text','visual_query':'photo'}]}
            manifest = {'images':[], 'credits':[]}
            def fake_render(*args, **kwargs):
                (p/'story-video.mp4').write_bytes(b'test-video-binary')
                return {'duration_seconds':510.0}
            with patch('story_agent.pipeline.wikipedia_research',return_value=research), \
                 patch('story_agent.pipeline.generate_story',return_value=story), \
                 patch('story_agent.pipeline.gather_assets',return_value=manifest), \
                 patch('story_agent.pipeline.render_story',side_effect=fake_render):
                outcome=run_production('LeBron James',p,voice=Path('voice.onnx'),validate_tools=False)
            self.assertEqual(outcome['state'],'needs_human_editorial_review')
            self.assertFalse(outcome['published'])
            self.assertTrue((p/'render-report.json').exists() is False)  # mocked renderer does not create report
            self.assertFalse((p/'review-approved.json').exists())

    def test_history_avoids_duplicate_topics(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td)
            (p/'topics.json').write_text(json.dumps({'topic_queue':['LeBron James','Nintendo']}))
            self.assertEqual(next_topic(p/'topics.json',p/'used.json'),'LeBron James')
            record_topic(p/'used.json','LeBron James')
            self.assertEqual(next_topic(p/'topics.json',p/'used.json'),'Nintendo')
            with self.assertRaisesRegex(StoryError,'duplicate'):
                record_topic(p/'used.json','lebron james')


class ReviewTests(unittest.TestCase):
    def make_review(self, p):
        story={'title':'Original','references':['https://en.wikipedia.org/wiki/Nintendo'],'scenes':[{'narration':'One word', 'visual_query':'photo'}]}
        for name in ('ATTRIBUTIONS.md','captions.en.srt','story-video.mp4'):
            (p/name).write_text(name)
        (p/'story.json').write_text(json.dumps(story))
        (p/'assets.json').write_text(json.dumps({'images':[], 'credits':[]}))
        (p/'render-report.json').write_text(json.dumps({'duration_seconds':510,'published':False}))

    def test_approval_requires_confirm_and_is_bound_to_files(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)
            self.make_review(p)
            with self.assertRaises(StoryError):approve_render(p)
            with patch('story_agent.review.validate_story'), patch('story_agent.review.validate_asset_manifest'), patch('story_agent.review.duration',return_value=510):
                out=approve_render(p,editor_confirmed=True)
                self.assertTrue(out['approved'])
                require_current_approval(p)
                (p/'story-video.mp4').write_text('changed video')
                with self.assertRaisesRegex(StoryError,'changed after approval'):
                    require_current_approval(p)

    def test_rejects_fake_approval(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)
            (p/'review-approved.json').write_text('{}')
            with self.assertRaisesRegex(StoryError,'Invalid editorial approval'):
                require_current_approval(p)


class CoordinatorClientTests(unittest.TestCase):
    def test_missing_token_and_insecure_transport_are_rejected(self):
        with self.assertRaisesRegex(StoryError,'HTTPS'):
            cloudflare_request('http://example.com','x'*40,'/v1/claim',method='POST')
        with self.assertRaisesRegex(StoryError,'token'):
            cloudflare_request('https://example.com','short','/v1/claim',method='POST')
        with self.assertRaisesRegex(StoryError,'HTTPS'):
            cloudflare_request('https://attacker:pass@example.com','x'*40,'/v1/claim')

    def test_does_not_claim_without_voice_model(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)
            with patch('story_agent.preflight.diagnose',return_value={'render_prerequisites_ready':False,'blocked_reasons':['missing voice']}), \
                 patch('story_agent.cloudflare_client.cloudflare_request') as request:
                with self.assertRaisesRegex(StoryError,'missing voice'):
                    work_once(base='https://demo.workers.dev',token='z'*40,voice=p/'missing.onnx',topics_file=p/'topics.json',output_root=p,history_file=p/'history.json')
                request.assert_not_called()

    def test_no_jobs_means_no_render(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)
            (p/'topics.json').write_text(json.dumps({'topic_queue':['Nintendo']}))
            with patch('story_agent.preflight.diagnose',return_value={'render_prerequisites_ready':True}), \
                 patch('story_agent.cloudflare_client.cloudflare_request',return_value=None), \
                 patch('story_agent.cloudflare_client.run_production') as produce:
                result=work_once(base='https://demo.workers.dev',token='z'*40,voice=p/'voice.onnx',topics_file=p/'topics.json',output_root=p,history_file=p/'used.json')
            self.assertEqual(result['state'],'no_jobs')
            produce.assert_not_called()

if __name__ == '__main__': unittest.main()

class YouTubeSkillIntegrationTests(unittest.TestCase):
    def test_upstream_skills_optional_but_never_faked(self):
        from story_agent.quality import analyze_story
        story={'title':'How Nintendo Won', 'scenes':[{'narration':'Nobody expected this company to survive. Then something changed.'}]}
        with tempfile.TemporaryDirectory() as td:
            analysis=analyze_story(story,repository_root=Path(td))
        self.assertFalse(analysis['hook']['available'])
        self.assertFalse(analysis['title']['available'])
        self.assertTrue(analysis['scores_are_editorial_hints'])

    def test_original_skill_scripts_if_present(self):
        from story_agent.quality import analyze_story
        story={'title':'The Rise of Nintendo', 'scenes':[{'narration':'Everyone thought Nintendo would fail, but the company changed the rules.'}]}
        with tempfile.TemporaryDirectory() as td:
            repo=Path(td)
            a=repo/'skills/yt-script/hookscore.py'; a.parent.mkdir(parents=True)
            b=repo/'skills/yt-package/title.py'; b.parent.mkdir(parents=True)
            a.write_text('import json; print(json.dumps([{"verdict":71}]))')
            b.write_text('import json; print(json.dumps([{"score":84}]))')
            result=analyze_story(story,repository_root=repo)
        self.assertTrue(result['hook']['available'])
        self.assertEqual(result['hook']['analysis']['verdict'],71)
        self.assertEqual(result['title']['analysis']['score'],84)
