"""Independent recount of cached decisions and fixed selector boundary checks."""
import json
import unittest
import numpy as np
from run import OUT,choose,select

class SelectorTests(unittest.TestCase):
    def test_override_requires_both_confidence_conditions(self):
        p=np.array([[.4,.6],[.6,.4],[.5,.5],[.4,.6]])
        manual=np.array([0,1,1,-1]);margin=np.array([.03,.029,.1,1.])
        pred,override=choose(p,manual,margin,dict(cnn_below=.7,matcher_margin_at_least=.03))
        np.testing.assert_array_equal(pred,[0,0,1,1])
        np.testing.assert_array_equal(override,[True,False,True,False])
        pred,_=choose(p,manual,margin,dict(cnn_below=.5,matcher_margin_at_least=.03))
        np.testing.assert_array_equal(pred,p.argmax(1))

    def test_agreement_and_ties_preserve_cnn(self):
        p=np.array([[.8,.2],[.9,.1]]);m=np.array([0,0]);y=np.array([0,0])
        selection,_=select(p,m,np.array([1.,1.]),y)
        self.assertEqual(selection['overrides'],0)
        self.assertEqual(selection['rule']['cnn_below'],0.)

def audit():
    r=json.loads((OUT/'results.json').read_text());z=np.load(OUT/'predictions.npz')
    p=z['calibration_probabilities'];m=z['calibration_matcher'];margin=z['calibration_margin'];y=z['calibration_truth']
    selected,_=select(p,m,margin,y);assert selected['rule']==r['selection']['rule']
    assert selected['correct']==r['calibration']['ensemble_correct']
    p=z['cnn_probabilities'];m=z['matcher'];y=z['truth'];pred=z['ensemble'];cnn=p.argmax(1)
    expected,over=choose(p,m,z['margin'],selected['rule']);np.testing.assert_array_equal(pred,expected)
    assert (pred==y).sum()==r['test']['ensemble_correct']
    assert (over&(m==y)&(cnn!=y)).sum()==r['test']['override_helped']
    assert (over&(cnn==y)&(m!=y)).sum()==r['test']['override_hurt']
    for name,values in [('cnn',cnn),('matcher',m),('ensemble',pred)]:
        matrix=np.array(r['test']['confusion'][name]);assert matrix.sum()==617
        actual=np.zeros((32,33),dtype=int)
        np.add.at(actual,(y,np.where(values>=0,values,32)),1)
        np.testing.assert_array_equal(matrix,actual)
        assert np.trace(matrix[:,:32])==(values==y).sum()
    agree=cnn==m;assert agree.sum()==301 and ((cnn==y)&agree).sum()==295
    assert sum(r['test']['paired'][k] for k in r['test']['paired'] if k!='n')==617
    assert r['baseline_parity']==617
    print(json.dumps(dict(audit_passed=True,calibration=len(z['calibration_indices']),test=len(y),ensemble_correct=int((pred==y).sum()),agreement_correct=295,agreement_wrong=6)))

if __name__=='__main__':
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(SelectorTests)
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():raise SystemExit(1)
    audit()
