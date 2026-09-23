import unittest
from datetime import datetime, timezone
from tools.py.lib.result import result, exit_code
from tools.py.lib.timeframes import exact_next, on_boundary
from tools.py import candles, learningcheck


class DoctorFoundationTest(unittest.TestCase):
    def test_result_exit_codes(self):
        self.assertEqual(exit_code([result('a','PASS')]), 0)
        self.assertEqual(exit_code([result('a','UNKNOWN')]), 2)
        self.assertEqual(exit_code([result('a','FAIL')]), 1)

    def test_m30_exact_next_and_boundary(self):
        self.assertEqual(exact_next('2026-09-23T01:00:00Z','M30'), '2026-09-23T01:30:00Z')
        self.assertTrue(on_boundary('2026-09-23T01:30:00Z','M30'))
        self.assertFalse(on_boundary('2026-09-23T01:15:00Z','M30'))

    def test_candle_doctor_detects_duplicate_gap_and_stale_source(self):
        rows=[
            {'time':'2026-09-23T01:00:00Z','open':100,'high':101,'low':99,'close':100},
            {'time':'2026-09-23T01:00:00Z','open':100,'high':101,'low':99,'close':100},
            {'time':'2026-09-23T01:02:00Z','open':100,'high':101,'low':99,'close':100},
        ]
        out={r.check:r for r in candles.inspect(rows,'M1','2026-09-23T01:00:00Z',60,datetime(2026,9,23,2,0,tzinfo=timezone.utc))}
        self.assertEqual(out['candles.duplicates'].status,'FAIL')
        self.assertEqual(out['candles.gaps'].status,'WARN')
        self.assertEqual(out['candles.freshness'].status,'FAIL')

    def test_learning_doctor_rejects_wrong_m30_settlement_and_thin_publish(self):
        rows=[{'id':'x','status':'SETTLED','tf':'M30','candleTime':'2026-09-23T01:00:00Z','settlementCandleTime':'2026-09-23T02:00:00Z','createdAt':'2026-09-23T01:00:01Z','settledAt':'2026-09-23T02:00:01Z','publishable':True,'sampleSize':5,'confidence':80,'correct':False}]
        out={r.check:r for r in learningcheck.inspect(rows)}
        self.assertEqual(out['learning.exact_next'].status,'FAIL')
        self.assertEqual(out['learning.sample_gate'].status,'FAIL')


if __name__ == '__main__': unittest.main()
