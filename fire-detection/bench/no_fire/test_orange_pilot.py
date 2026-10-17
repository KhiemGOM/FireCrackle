import unittest
from orange_pilot import scores, FIELDS


class OrangePilotTest(unittest.TestCase):
    def test_raw_or_unveil_keeps_evidence(self):
        e={k:{f:0 for f in FIELDS} for k in ['raw','auto','raw_nohud','auto_nohud']}
        e['raw']['single']=10;e['auto']['single']=30
        self.assertEqual(scores(e)['all:single'],30)
        self.assertEqual(scores(e)['nohud:single'],0)


if __name__=='__main__':unittest.main()
