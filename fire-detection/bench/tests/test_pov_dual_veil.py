import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pov_dual_veil import combine, decision, select_without, WIDTHS, POLICIES


class DualVeilTests(unittest.TestCase):
    def test_uncertain_only_controls_second_branch(self):
        bs = [{'row': 2, 'accepted': True, 'evidence': .6},
              {'row': 3, 'accepted': True, 'evidence': .9}]
        self.assertEqual(combine(bs, False, False, 'max_evidence'), (2, True))
        self.assertEqual(combine(bs, False, True, 'max_evidence'), (3, True))

    def test_two_votes_have_no_majority_when_conflicting(self):
        bs = [{'row': 2, 'accepted': True, 'evidence': .6},
              {'row': 3, 'accepted': True, 'evidence': .9}]
        self.assertEqual(combine(bs, False, True, 'no_conflict'), (2, False))
        self.assertEqual(combine(bs, False, True, 'agreement'), (2, False))
        self.assertEqual(combine(bs, False, True, 'auto_priority'), (2, True))

    def test_one_eligible_branch_and_tie_priority(self):
        bs = [{'row': 2, 'accepted': False, 'evidence': .9},
              {'row': 3, 'accepted': True, 'evidence': .6}]
        self.assertEqual(combine(bs, False, True, 'max_evidence'), (3, True))
        self.assertEqual(combine(bs, False, True, 'agreement'), (2, False))
        bs[0]['accepted'], bs[0]['evidence'] = True, .6
        self.assertEqual(combine(bs, False, True, 'max_evidence'), (2, True))
        self.assertEqual(combine(bs, True, True, 'max_evidence'), (3, True))

    def test_same_row_agreement_and_no_eligible(self):
        bs = [{'row': 2, 'accepted': True, 'evidence': .6},
              {'row': 2, 'accepted': True, 'evidence': .9}]
        self.assertEqual(combine(bs, True, True, 'agreement'), (2, True))
        for b in bs:
            b['accepted'] = False
        self.assertEqual(combine(bs, True, True, 'max_evidence'), (2, False))

    def test_branch_preserves_original_and_opaque(self):
        f = {'row': 2, 'raw': .6, 'opaque': -.5, 'broad': -.5, 'margin': 0., 'span': 0}
        self.assertTrue(decision({'fov': 0, 'fovs': [f]})['accepted'])
        f['raw'], f['opaque'] = -.5, .6
        self.assertTrue(decision({'fov': 0, 'fovs': [f]})['accepted'])
        f['opaque'], f['broad'] = -.5, .6
        self.assertFalse(decision({'fov': 0, 'fovs': [f]})['accepted'])
        f['margin'], f['span'] = .5, 2
        self.assertTrue(decision({'fov': 0, 'fovs': [f]})['accepted'])

    def test_selection_never_uses_excluded_metrics(self):
        def source():
            return {'results':[{'correct':10,'false_positives':0,'wrong_rows':0,
                'lost_correct':0,'dual_frames':i} for i in range(len(WIDTHS)*len(POLICIES))]}
        sources={'train':source(),'excluded':source()}
        sources['train']['results'][3]['correct']=11
        self.assertEqual(select_without(sources,'excluded'),3)
        for r in sources['excluded']['results']:
            r['correct']=1000;r['false_positives']=100
        self.assertEqual(select_without(sources,'excluded'),3)


if __name__ == '__main__':
    unittest.main()
