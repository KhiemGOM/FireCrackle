import unittest
from compare_rules import counts,shared_blocked

class ComparisonContracts(unittest.TestCase):
    def test_tp_is_no_fire_fp_is_fire_wrongly_cleared(self):
        self.assertEqual(counts([{'fire':False,'clear':True},{'fire':True,'clear':True},{'fire':True,'clear':False}], 'clear'),
            {'TP':1,'FP':1,'eligible':1,'fire':2,'coverage':1.})
    def test_uncertainty_is_symmetric_and_no_gate_means_no_proof(self):
        self.assertFalse(shared_blocked(True,False,.2,False,False))
        for args in [(False,False,.2,False,False),(True,False,.85,False,False),(True,False,.2,True,False),(True,False,.2,False,True)]:
            self.assertTrue(shared_blocked(*args))

if __name__=='__main__':unittest.main()
