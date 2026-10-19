import copy
import sys
from pathlib import Path
import unittest
import torch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'large'))
from models import make_model
from checkpointing import enable

class CheckpointTests(unittest.TestCase):
    def test_same_output_gradient_and_bn_buffers(self):
        torch.set_num_threads(4);torch.manual_seed(217)
        # A real-size large backbone; recomputation must preserve all BN buffers.
        a=make_model('resnet101').train();b=enable(copy.deepcopy(a));x=torch.randn(2,3,128,128)
        y=a(x);z=b(x);torch.testing.assert_close(y,z)
        y.square().mean().backward();z.square().mean().backward()
        for (name,p),(name2,q) in zip(a.named_parameters(),b.named_parameters()):
            self.assertEqual(name,name2);torch.testing.assert_close(p.grad,q.grad,rtol=3e-4,atol=3e-5)
        for (name,p),(name2,q) in zip(a.named_buffers(),b.named_buffers()):
            self.assertEqual(name,name2);torch.testing.assert_close(p,q,rtol=0,atol=0)

if __name__=='__main__':unittest.main()
