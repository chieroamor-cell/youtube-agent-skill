import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
from optimizer.uploads import duration_seconds, list_recent_owned_videos, scan_new_uploads


class ApiRequest:
    def __init__(self, body): self.body = body
    def execute(self): return self.body

class FakeApi:
    def __init__(self, ids, channel="UC1234567890", durations=None):
        self.ids=list(ids)
        self.channel=channel
        self.durations=durations or {}
        self.mutated=False
    def channels(self): return self
    def playlistItems(self): return self
    def videos(self): return self
    def list(self, *, part, mine=None, playlistId=None, maxResults=None, id=None):
        if mine:
            return ApiRequest({"items":[{"id":self.channel,"contentDetails":{"relatedPlaylists":{"uploads":"UU1234567890"}}}]})
        if playlistId:
            return ApiRequest({"items":[{"contentDetails":{"videoId":v}} for v in self.ids[:maxResults]]})
        if id is not None:
            return ApiRequest({"items":[{"id":v,"snippet":{"channelId":self.channel,"title":"The story of "+v,"description":"A real video with factual footage and interview."},"contentDetails":{"duration":self.durations.get(v, "PT8M40S")},"status":{"privacyStatus":"private"}} for v in id.split(",")]})
        raise AssertionError("unexpected API request")


class UploadDetectionTests(unittest.TestCase):
    def test_iso_durations(self):
        self.assertEqual(duration_seconds("PT8M40S"),520)
        self.assertEqual(duration_seconds("PT1H2M"),3720)
        self.assertEqual(duration_seconds("P1DT15S"),86415)
        with self.assertRaises(ValueError): duration_seconds("not-duration")

    def test_first_scan_baselines_no_old_uploads(self):
        with tempfile.TemporaryDirectory() as temp:
            state=Path(temp)/"state.json"
            yt=FakeApi(["AAAAABBBBB1","AAAAABBBBB2"])
            result=scan_new_uploads(yt,expected_channel=yt.channel,state_path=state)
            self.assertTrue(result["baseline_created"])
            self.assertEqual(result["new_videos"], [])
            self.assertTrue(state.is_file())
            self.assertFalse(result["writes_to_youtube"])

    def test_new_private_upload_once_only(self):
        with tempfile.TemporaryDirectory() as temp:
            state=Path(temp)/"state.json"
            yt=FakeApi(["AAAAABBBBB1"])
            scan_new_uploads(yt,expected_channel=yt.channel,state_path=state)
            yt.ids.insert(0, "AAAAABBBBB2")
            updated=scan_new_uploads(yt,expected_channel=yt.channel,state_path=state)
            self.assertEqual([v["video_id"] for v in updated["new_videos"]],["AAAAABBBBB2"])
            self.assertEqual(updated["new_videos"][0]["privacy"], "private")
            self.assertEqual(scan_new_uploads(yt,expected_channel=yt.channel,state_path=state)["new_videos"],[])

    def test_short_videos_skipped_and_remembered(self):
        with tempfile.TemporaryDirectory() as temp:
            state=Path(temp)/"state.json"
            yt=FakeApi(["AAAAABBBBB1"],durations={"AAAAABBBBB2":"PT59S"})
            scan_new_uploads(yt,expected_channel=yt.channel,state_path=state)
            yt.ids.insert(0, "AAAAABBBBB2")
            r=scan_new_uploads(yt,expected_channel=yt.channel,state_path=state)
            self.assertEqual(r["new_videos"], [])
            self.assertEqual(r["ignored_short_videos"],1)
            self.assertEqual(scan_new_uploads(yt,expected_channel=yt.channel,state_path=state)["ignored_short_videos"],0)

    def test_different_account_cannot_read_or_replace_state(self):
        with tempfile.TemporaryDirectory() as temp:
            state=Path(temp)/"state.json"
            yt=FakeApi(["AAAAABBBBB1"])
            scan_new_uploads(yt,expected_channel=yt.channel,state_path=state)
            data=state.read_text()
            with self.assertRaisesRegex(ValueError,"another channel"):
                scan_new_uploads(yt,expected_channel="UC9999999999",state_path=state)
            self.assertEqual(state.read_text(),data)

    def test_api_channel_mismatch_blocked(self):
        with tempfile.TemporaryDirectory() as temp:
            state=Path(temp)/"state.json"
            yt=FakeApi(["AAAAABBBBB1"])
            with self.assertRaisesRegex(ValueError,"mismatch"):
                scan_new_uploads(yt,expected_channel="UC9999999999",state_path=state)
            self.assertFalse(state.exists())

    def test_invalid_or_symlink_state_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            state=Path(temp)/"state.json"
            state.write_text("not a json")
            with self.assertRaises(json.JSONDecodeError):
                scan_new_uploads(FakeApi([]),expected_channel="UC1234567890",state_path=state)
            self.assertEqual(state.read_text(),"not a json")

    def test_playlist_uses_owned_channel_and_no_write(self):
        yt=FakeApi(["AAAAABBBBB1"])
        results=list_recent_owned_videos(yt,channel_id=yt.channel)
        self.assertEqual(results[0]["channel_id"],yt.channel)
        self.assertFalse(yt.mutated)

if __name__=="__main__":unittest.main()
