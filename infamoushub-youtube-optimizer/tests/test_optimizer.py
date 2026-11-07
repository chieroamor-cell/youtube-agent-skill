import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image
from optimizer.metadata import parse_video_id, prepare, make_chapters
from optimizer.thumbnail import create_thumbnail
from optimizer.youtube import patch_preview, apply_package

class FakeRequest:
    def __init__(self, body): self.body = body
    def execute(self): return self.body
class FakeVideos:
    def __init__(self): self.updated = None
    def list(self, part, id):
        return FakeRequest({'items':[{'id':id,'snippet':{'title':'Original','description':'Existing legally required credits','categoryId':'24','channelId':'UC1234567890','tags':['original']},'status':{'privacyStatus':'private'}}]})
    def update(self, part, body):
        self.updated=body
        return FakeRequest({'id':body['id']})
class FakeChannels:
    def list(self, part, mine): return FakeRequest({'items':[{'id':'UC1234567890'}]})
class FakeYoutube:
    def __init__(self): self.v = FakeVideos()
    def videos(self): return self.v
    def channels(self): return FakeChannels()

class MetadataTests(unittest.TestCase):
    def test_video_url(self):
        self.assertEqual(parse_video_id('https://youtu.be/mIcrurbIc70?t=3'),'mIcrurbIc70')
        self.assertEqual(parse_video_id('https://www.youtube.com/watch?v=mIcrurbIc70'),'mIcrurbIc70')
    def test_reject_untrusted_url(self):
        with self.assertRaises(ValueError): parse_video_id('https://youtube.com.evil.test/watch?v=mIcrurbIc70')
    def test_package_accurate_and_in_limit(self):
        pkg=prepare('mIcrurbIc70','Nintendo','This original video covers early years and the growth of Nintendo over time.',angle='Early Years and Growth')
        self.assertLessEqual(len(pkg['selected_title']),100)
        self.assertIn('Nintendo',pkg['selected_title'])
        self.assertFalse(pkg['approved'])
        self.assertIsNone(pkg['thumbnail_path'])
    def test_no_invented_chapters(self):
        with self.assertRaises(ValueError):make_chapters('01:00 Intro\n02:00 More')
        self.assertEqual(make_chapters('00:00 Intro\n02:10 Origins'),'00:00 Intro\n02:10 Origins')
    def test_short_summary_blocked(self):
        with self.assertRaises(ValueError): prepare('mIcrurbIc70','Nintendo','Interesting!')
    def test_existing_credits_preserved(self):
        p=prepare('mIcrurbIc70','Nintendo','This story documents the history of Nintendo and its early games.')
        c={'id':'mIcrurbIc70','snippet':{'channelId':'UC1234567890','categoryId':'24','description':'Attribution and license here','tags':['retain']}}
        result=patch_preview(c,p,expected_channel='UC1234567890')
        self.assertIn('Attribution and license here',result['snippet']['description'])
        self.assertIn('retain',result['snippet']['tags'])
        self.assertNotIn('status',result)
    def test_wrong_channel_rejected(self):
        p=prepare('mIcrurbIc70','Nintendo','This story documents the history of Nintendo and its early games.')
        c={'id':'mIcrurbIc70','snippet':{'channelId':'UC1234567890','categoryId':'24'}}
        with self.assertRaises(ValueError):patch_preview(c,p,expected_channel='UC9999999999')
    def test_dry_run_by_default(self):
        p=prepare('mIcrurbIc70','Nintendo','This story documents the history of Nintendo and its early games.')
        y=FakeYoutube()
        x=apply_package(y,p,expected_channel='UC1234567890')
        self.assertTrue(x['dry_run']);self.assertIsNone(y.v.updated)
    def test_write_requires_both_flag_and_env(self):
        p=prepare('mIcrurbIc70','Nintendo','This story documents the history of Nintendo and its early games.')
        y=FakeYoutube()
        with patch.dict(os.environ, {'YOUTUBE_OPTIMIZER_WRITE':'NO'}):
            x=apply_package(y,p,expected_channel='UC1234567890',allow_write=True)
        self.assertTrue(x['dry_run']);self.assertIsNone(y.v.updated)
    def test_can_update_only_snippet(self):
        p=prepare('mIcrurbIc70','Nintendo','This story documents the history of Nintendo and its early games.')
        p["approved"] = True
        y=FakeYoutube()
        with patch.dict(os.environ, {'YOUTUBE_OPTIMIZER_WRITE':'YES'}):
            x=apply_package(y,p,expected_channel='UC1234567890',allow_write=True)
        self.assertFalse(x['dry_run'])
        self.assertTrue(x['privacy_untouched'])
        self.assertNotIn('status',y.v.updated)
    def test_unapproved_package_cannot_write(self):
        p=prepare('mIcrurbIc70','Nintendo','This video describes the early history and important changes at Nintendo.')
        y=FakeYoutube()
        with patch.dict(os.environ, {'YOUTUBE_OPTIMIZER_WRITE':'YES'}):
            with self.assertRaisesRegex(ValueError, 'aprobación'):
                apply_package(y,p,expected_channel='UC1234567890',allow_write=True)
        self.assertIsNone(y.v.updated)
    def test_missing_thumbnail_blocks_metadata_change(self):
        p=prepare('mIcrurbIc70','Nintendo','This video describes the early history and important changes at Nintendo.')
        p.update({'approved':True,'thumbnail_path':'/path/not/existing.png','image_rights':'owned'})
        y=FakeYoutube()
        with patch.dict(os.environ, {'YOUTUBE_OPTIMIZER_WRITE':'YES'}):
            with self.assertRaises(ValueError):
                apply_package(y,p,expected_channel='UC1234567890',allow_write=True)
        self.assertIsNone(y.v.updated)
    def test_thumb_rights_gate(self):
        with tempfile.TemporaryDirectory() as td:
            image=Path(td)/'photo.jpg'
            Image.new('RGB',(1920,1080),(80,110,145)).save(image)
            with self.assertRaises(ValueError): create_thumbnail(image,Path(td)/'thumb.jpg','THE FULL STORY',rights='unknown')
            out=create_thumbnail(image,Path(td)/'thumb.jpg','THE FULL STORY',rights='owned')
            with Image.open(out) as i: self.assertEqual(i.size,(1280,720))

if __name__=='__main__':unittest.main()
