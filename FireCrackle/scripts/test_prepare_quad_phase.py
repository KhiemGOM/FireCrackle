import hashlib,importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('prepare_phase',Path(__file__).with_name('prepare-quad-phase.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class PhaseStaging(unittest.TestCase):
    def setup_root(self,d,url=None):
        root=Path(d);(root/'release').mkdir();payload=b'verified phase weights';source=root/'weights';source.write_bytes(payload)
        metadata=dict(file='quad-phase-v1.onnx',sha256=hashlib.sha256(payload).hexdigest(),url=url)
        (root/'release/quad-phase-model.json').write_text(json.dumps(metadata))
        soul={**metadata,'file':'quad-soul-phase-v1.onnx'}
        (root/'release/quad-soul-phase-model.json').write_text(json.dumps(soul));return root,source
    def test_local_staging_checks_hash_and_records_metadata(self):
        with tempfile.TemporaryDirectory() as d:
            root,source=self.setup_root(d)
            with patch.object(m,'ROOT',root),patch.dict(m.os.environ,{'FIRECRACKLE_PHASE_MODEL_SOURCE':str(source),'FIRECRACKLE_SOUL_PHASE_MODEL_SOURCE':str(source)}):m.main()
            # staged for the build's model tests only: runtime/ai is packaged, and the app downloads these on first use
            self.assertEqual((root/'src-tauri/runtime/models/quad-phase-v1.onnx').read_bytes(),source.read_bytes())
            self.assertTrue((root/'src-tauri/runtime/models/quad-phase-v1.json').is_file())
            self.assertEqual((root/'src-tauri/runtime/models/quad-soul-phase-v1.onnx').read_bytes(),source.read_bytes())
            self.assertFalse((root/'src-tauri/runtime/ai').exists())
            source.write_bytes(b'tampered')
            with patch.object(m,'ROOT',root),patch.dict(m.os.environ,{'FIRECRACKLE_PHASE_MODEL_SOURCE':str(source)}),self.assertRaisesRegex(ValueError,'SHA'):m.main()
    def test_missing_unpublished_asset_is_a_loud_build_error(self):
        with tempfile.TemporaryDirectory() as d:
            root,_=self.setup_root(d)
            with patch.object(m,'ROOT',root),patch.dict(m.os.environ,{},clear=True),self.assertRaisesRegex(RuntimeError,'not staged'):m.main()
    def test_soul_missing_does_not_silently_pass_normal_only(self):
        with tempfile.TemporaryDirectory() as d:
            root,source=self.setup_root(d)
            with patch.object(m,'ROOT',root),patch.dict(m.os.environ,{'FIRECRACKLE_PHASE_MODEL_SOURCE':str(source)},clear=True),self.assertRaisesRegex(RuntimeError,'quad-soul'):m.main()
if __name__=='__main__':unittest.main()
