import unittest
from full_video import metrics,intervals

class FullVideoAccounting(unittest.TestCase):
    def test_unknown_labels_are_not_negatives(self):
        rows=[{'fire':False,'union':True},{'fire':False,'union':False},{'fire':True,'union':True},{'fire':True,'union':False},{'fire':None,'union':True}]
        m=metrics(rows,'union')
        self.assertEqual((m['TP'],m['FP'],m['eligible'],m['fire']),(1,1,2,2))
        self.assertEqual(m['TP_rate'],.5);self.assertEqual(m['unscored_clears'],1)
    def test_clear_runs_do_not_bridge_uncleared_frames(self):
        rows=[{'frame':i,'union':i in [0,1,3,4,5]} for i in range(7)]
        self.assertEqual([(r['start'],r['end']) for r in intervals(rows)],[(0,1),(3,5)])

if __name__=='__main__':unittest.main()
