import unittest
from datetime import datetime, timezone
from tools.py.mtf_weekly import week_start, month_start, week_of_month, exact_next

class TestMTFWeekly(unittest.TestCase):
    def test_calendar_boundaries(self):
        self.assertEqual(week_start('2026-09-17T12:00:00Z'),'2026-09-14T00:00:00+00:00')
        self.assertEqual(month_start('2026-09-17T12:00:00Z'),'2026-09-01T00:00:00+00:00')
        self.assertEqual(week_of_month('2026-09-17T12:00:00Z'),3)
        self.assertEqual(week_of_month('2026-10-30T12:00:00Z'),5)
    def test_exact_next(self):
        self.assertEqual(exact_next('2026-09-23T10:00:00Z','M30'),'2026-09-23T10:30:00+00:00')
        self.assertEqual(exact_next('2026-09-23T10:00:00Z','H4'),'2026-09-23T14:00:00+00:00')
        with self.assertRaises(ValueError): exact_next('2026-09-23T10:00:00Z','MN1')

if __name__=='__main__': unittest.main()
