import unittest
from datetime import datetime, timezone
from tools.py import newscheck, syncdoctor, croncheck


class NewsSyncDoctorTest(unittest.TestCase):
    def test_news_rejects_duplicate_event_and_wrong_m30_checkpoint(self):
        rows=[
          {'id':'n1','eventAt':'2026-09-23T12:00:00Z','actual':'3.2','forecast':'3.1','previous':'3.0','checkpoints':{'M5':'2026-09-23T12:05:00Z','M30':'2026-09-23T13:00:00Z'}},
          {'id':'n1','eventAt':'2026-09-23T12:00:00Z','actual':'3.2','forecast':'3.1','previous':'3.0','checkpoints':{}}
        ]
        out={r.check:r for r in newscheck.inspect(rows)}
        self.assertEqual(out['news.duplicate_ids'].status,'FAIL')
        self.assertEqual(out['news.checkpoints'].status,'FAIL')

    def test_news_preserves_missing_checkpoint_instead_of_later_substitute(self):
        rows=[{'id':'n2','eventAt':'2026-09-23T12:00:00Z','actual':'3.2','forecast':'3.1','previous':'3.0','checkpoints':{'M30':None}}]
        out={r.check:r for r in newscheck.inspect(rows)}
        self.assertEqual(out['news.checkpoints'].status,'WARN')

    def test_sync_detects_mixed_snapshot_lineage_and_stale_apk(self):
        snapshots=[
          {'name':'bbma','generationId':'g1','generatedAt':'2026-09-23T12:00:00Z'},
          {'name':'intelligence','generationId':'g2','generatedAt':'2026-09-23T12:01:00Z'}]
        out={r.check:r for r in syncdoctor.inspect(snapshots, now=datetime(2026,9,23,14,0,tzinfo=timezone.utc), max_age_seconds=1800)}
        self.assertEqual(out['sync.lineage'].status,'FAIL')
        self.assertEqual(out['sync.freshness'].status,'FAIL')

    def test_cron_detects_multiple_writer_groups_for_production_data(self):
        workflows=[
          {'name':'news','group':'market-data-writer','writes':['news-auto.js']},
          {'name':'bbma','group':'bbma-candle-watch','writes':['data/bbma-watch.json']},
          {'name':'intel','group':'intelligence-360','writes':['data/intelligence-360.json']}
        ]
        out={r.check:r for r in croncheck.inspect(workflows)}
        self.assertEqual(out['cron.writer_serialization'].status,'FAIL')


if __name__ == '__main__': unittest.main()
