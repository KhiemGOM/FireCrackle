import unittest
from retention_pilot import retain_policy

class RetentionPolicyTests(unittest.TestCase):
 def test_requires_confirmed_veil(self):
  self.assertFalse(retain_policy(False,[{'retain':True}]))
 def test_raw_gui_evidence_cannot_trigger(self):
  self.assertFalse(retain_policy(True,[{'retain':True},{'retain':False}]))
 def test_restored_evidence_retains(self):
  self.assertTrue(retain_policy(True,[{'retain':False},{'retain':True}]))
 def test_empty_is_not_retained(self):
  self.assertFalse(retain_policy(True,[]))

if __name__=='__main__':unittest.main()
