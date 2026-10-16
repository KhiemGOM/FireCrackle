import unittest
import numpy as np
from colour_support import bins, support, texel_samples


class ColourSupportTests(unittest.TestCase):
    def test_projection_samples_opaque_texels_only_and_respects_uv_mirror(self):
        sprite = np.zeros((512, 16, 4), np.uint8)
        sprite[3, 2] = [250, 100, 10, 255]
        q = {'s': 0, 'row': 0, 'vis': 1, 'c': [100, 100, 260, 100, 260, 260, 100, 260],
             'uv': [0, 0, 1, 0, 1, 1, 0, 1]}
        label = {'w': 400, 'h': 400, 'fires': [{'quads': [q]}]}
        p = texel_samples(label, [sprite], 400, 400)
        self.assertEqual(len(p), 1)
        self.assertEqual(p[0][:2], (125, 135))
        np.testing.assert_array_equal(p[0][2], [250, 100, 10])
        q['uv'] = [1, 0, 0, 0, 0, 1, 1, 1]
        self.assertEqual(texel_samples(label, [sprite], 400, 400)[0][:2], (235, 135))
        q['vis'] = .5
        self.assertEqual(texel_samples(label, [sprite], 400, 400), [])

    def test_empirical_support_dilates_at_boundary_without_wrapping(self):
        lut = support(np.array([[255, 0, 0]], np.uint8), radius=1)
        colours = np.array([[255, 0, 0], [240, 8, 8], [0, 0, 0], [255, 255, 0]], np.uint8)
        np.testing.assert_array_equal(lut[bins(colours)], [True, True, False, False])


if __name__ == '__main__':
    unittest.main()
