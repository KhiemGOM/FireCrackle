import unittest
import torch
from models import make_model

class ModelTests(unittest.TestCase):
    def test_both_architectures_accept_native_crop_and_predict32_phases(self):
        torch.set_num_threads(2)
        for name in ['resnet101','vit_b16']:
            model=make_model(name).eval()
            with torch.inference_mode():output=model(torch.zeros(2,3,64,64))
            self.assertEqual(tuple(output.shape),(2,32));self.assertTrue(torch.isfinite(output).all());self.assertGreater(sum(p.numel() for p in model.parameters()),40000000)

if __name__=='__main__':unittest.main()
