import json,unittest
from pathlib import Path
import numpy as np
from masks import fields,raster


class ReviewMaskControls(unittest.TestCase):
    def test_empty_annotation_is_identity(self):
        for mask in fields(dict(definite=[],uncertain=[])).values():self.assertTrue(np.all(mask==1))

    def test_core_and_expanded_have_nested_exclusion(self):
        f=fields(dict(definite=[[[25,25],[75,25],[75,75],[25,75]]],uncertain=[]))
        self.assertTrue(np.all(f['expanded']<=f['definite']));self.assertTrue(np.all(f['definite']<=f['core']))

    def test_uncertainty_is_not_treated_as_positive_ownership(self):
        f=fields(dict(definite=[],uncertain=[[[0,0],[100,0],[100,100],[0,100]]]))
        self.assertTrue(np.all(f['definite']==1));self.assertTrue(np.all(f['uncertain']==0))

    def test_shift_control_preserves_mask_area(self):
        f=fields(dict(definite=[[[2,3],[23,3],[23,41],[2,41]]],uncertain=[]))
        self.assertEqual(float(f['definite'].sum()),float(f['control_shift'].sum()))

    def test_rejects_invalid_polygons(self):
        with self.assertRaises(ValueError):raster([[[0,0],[101,0],[0,50]]])
        with self.assertRaises(ValueError):raster([[[0,0],[50,0]]])

    def test_fifty_unique_records_without_sprite_or_prediction_labels(self):
        review=json.loads(Path(__file__).with_name('annotations.json').read_text())
        self.assertEqual(len(review['cases']),50);self.assertEqual(len({c['code'] for c in review['cases']}),50)
        for c in review['cases']:
            self.assertEqual(set(c),{'code','definite','uncertain','note'})
            for mask in fields(c).values():self.assertTrue(np.isfinite(mask).all() and mask.min()>=0 and mask.max()<=1)


if __name__=='__main__':unittest.main()
