import pathlib, sqlite3, unittest
SQL=pathlib.Path(__file__).resolve().parents[1].joinpath('db/helix-research.sql').read_text()
class JournalTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:')
  self.db.execute('PRAGMA foreign_keys=ON')
  self.db.executescript(SQL)
 def put(self, fail=False):
  with self.db:
   self.db.execute("INSERT OR IGNORE INTO helix_research_snapshots (id,symbol,provider,as_of,quality,payload_json) VALUES (?,?,?,?,?,?)",('a'*64,'XAUUSD','test','2026-11-08T02:15:00Z','VALIDATED','{}'))
   if fail: raise RuntimeError('crash before outbox')
   self.db.execute("INSERT OR IGNORE INTO helix_delivery_outbox (id,snapshot_id,destination,state) VALUES (?,?,?,'PREVIEW')",('b'*64,'a'*64,'preview:local'))
 def test_atomicity_and_retry(self):
  with self.assertRaises(RuntimeError):self.put(True)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM helix_research_snapshots').fetchone()[0],0)
  self.put();self.put()
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM helix_delivery_outbox').fetchone()[0],1)
 def test_foreign_key(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("INSERT INTO helix_delivery_outbox (id,snapshot_id,destination) VALUES ('x','missing','preview:local')")
 def test_restart(self):
  import tempfile,os
  fd,path=tempfile.mkstemp();os.close(fd)
  try:
   a=sqlite3.connect(path);a.executescript(SQL)
   a.execute("INSERT INTO helix_research_snapshots (id,symbol,provider,as_of,quality,payload_json) VALUES (?,?,?,?,?,?)",('a'*64,'XAUUSD','test','2026-11-08T02:15:00Z','VALIDATED','{}'));a.commit();a.close()
   b=sqlite3.connect(path)
   self.assertEqual(b.execute('SELECT COUNT(*) FROM helix_research_snapshots').fetchone()[0],1);b.close()
  finally:os.unlink(path)
if __name__=='__main__':unittest.main()
