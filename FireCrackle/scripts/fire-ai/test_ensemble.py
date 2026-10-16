import unittest
from diagnose_ensemble import plurality, reciprocal_rank


class EnsembleRulesTests(unittest.TestCase):
    def test_ties_prefer_colour_and_other_votes_can_override(self):
        row = dict(colour=dict(order=[7]), a=dict(order=[8]), b=dict(order=[9]))
        self.assertEqual(plurality(row,['colour','a','b']),[7])
        row['b']['order']=[8]
        self.assertEqual(plurality(row,['colour','a','b']),[8])

    def test_empty_rankings_abstain(self):
        row=dict(colour=dict(order=[]),a=dict(order=[]))
        self.assertEqual(plurality(row,['colour','a']),[])
        self.assertEqual(reciprocal_rank(row,['colour','a']),[])

    def test_rank_fusion_ties_and_five_candidate_limit(self):
        row=dict(colour=dict(order=[7,8]),a=dict(order=[8,7]))
        self.assertEqual(reciprocal_rank(row,['colour','a']),[7,8])
        row['a']['order']=[1,2,3,4,5,99]
        self.assertNotIn(99,reciprocal_rank(row,['colour','a']))


if __name__=='__main__':
    unittest.main()
