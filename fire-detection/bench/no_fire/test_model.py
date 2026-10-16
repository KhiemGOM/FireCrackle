import unittest
import numpy as np
from model import predict
class ModelTest(unittest.TestCase):
 def test_portable_inference_and_feature_count_validation(self):
  model={'mean':[0,0],'scale':[1,1],'w1':[[1,-1]],'b1':[0],'w2':[[2]],'b2':[0]}
  result=predict(model,np.array([[0,1],[2,1]],dtype=np.float32))
  np.testing.assert_allclose(result,[.5,1/(1+np.exp(-2))])
  with self.assertRaises(ValueError):predict(model,[0,1,2])
if __name__=='__main__':unittest.main()
