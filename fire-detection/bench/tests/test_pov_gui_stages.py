import copy,importlib.util,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]))
import pov_gui_stages as m

def record():
 base={'sz':[0.]*32,'cz':[0.]*32,'sum':[0.]*32,'used':[100]*32,'total':[100]*32,'weight':2.}
 base['sz'][1]=3.;base['cz'][1]=2.;base['sum'][1]=60.
 mask=copy.deepcopy(base);mask['sz']=[0.]*32;mask['sz'][3]=10.;mask['cz']=[0.]*32;mask['cz'][4]=4.;mask['used']=[20]*32;mask['sum']=[0.]*32;mask['sum'][3]=18.;mask['sum'][4]=17.
 return {'stats':[copy.deepcopy(base),copy.deepcopy(base),*[copy.deepcopy(mask) for _ in range(6)]]}
def idx(s,c,g,f='frozen'):return m.CONFIGS.index({'coverage':'all_gui','silhouette':s,'colour':('raw_sum' if c==0 else 'mask_sum') if isinstance(c,int) else c,'gate':g,'fov':f})
class StageTests(unittest.TestCase):
 def test_shape_and_colour_can_be_changed_independently(self):
  rows,scores,base=m.combine(record())
  self.assertEqual(base,(1,.6));self.assertEqual(rows[idx(1,0,'raw')],3);self.assertEqual(rows[idx(0,1,'raw')],4);self.assertEqual(rows[idx(1,1,'raw')],3)
 def test_normalization_and_neutral_denominator_are_distinct(self):
  rows,scores,_=m.combine(record());self.assertAlmostEqual(scores[idx(1,1,'visible')],.9);self.assertAlmostEqual(scores[idx(1,1,'neutral')],.18)
 def test_frozen_gate_retains_original_detection_even_when_row_changes(self):
  r=record();r['stats'][0]['sum'][1]=r['stats'][1]['sum'][1]=20.
  rows,scores,_=m.combine(r)
  self.assertEqual(rows[idx(1,1,'frozen')],3);self.assertLess(scores[idx(1,1,'frozen')],.5);self.assertGreater(scores[idx(1,1,'visible')],.5)
 def test_insufficient_remaining_support_never_divides_by_zero(self):
  r=record()
  for s in r['stats'][2:]:s['used']=[0]*32;s['sum']=[0.]*32
  rows,scores,_=m.combine(r);self.assertEqual(scores[idx(1,1,'visible')],0.)
 def test_fov_ties_keep_seventy_and_gui_fov_can_change_it(self):
  r=record();r['stats'][7]['sum'][3]=19.
  rows,scores,_=m.combine(r);self.assertAlmostEqual(scores[idx(1,1,'visible','frozen')],.9);self.assertAlmostEqual(scores[idx(1,1,'visible','visible')],.95)
if __name__=='__main__':unittest.main()


class NormalizedRankingTests(unittest.TestCase):
 def test_unmasked_mean_is_separate_from_gui_masking(self):
  r=record()
  for s in r['stats'][:2]:
   s['sz']=[0.]*32;s['used'][2]=s['total'][2]=10;s['sum'][2]=8.
  rows,_,_=m.combine(r)
  self.assertEqual(rows[idx(0,'raw_sum','raw')],1)
  self.assertEqual(rows[idx(0,'raw_mean','raw')],2)
 def test_matrix_has_360_distinct_parameter_combinations(self):
  self.assertEqual(len(m.CONFIGS),360)
  self.assertEqual(len({tuple(c.values()) for c in m.CONFIGS}),360)

if __name__=='__main__':unittest.main()
