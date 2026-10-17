"""Runtime/model packaging must reject tampering and extract only named native files."""
import importlib.util,tempfile,unittest,zipfile,hashlib,json
from pathlib import Path
spec=importlib.util.spec_from_file_location('prepare_no_fire',Path(__file__).with_name('prepare-no-fire.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class RuntimePackage(unittest.TestCase):
    def test_windows_pipeline_packages_pinned_ai_resources(self):
        root=Path(__file__).resolve().parents[1]
        script=(root/'scripts/release.ps1').read_text()
        self.assertIn('prepare-no-fire.py',script)
        self.assertIn("'src-tauri/runtime/ai'",script)
        self.assertIn("'ai'",script)
    def test_linux_runtime_contains_cuda_without_python_binding(self):
        manifest=json.loads((Path(__file__).resolve().parents[1]/'release/no-fire-model.json').read_text())
        outputs=[name for artifact in manifest['platforms']['linux-x64'] for name in artifact['members'].values()]
        self.assertIn('libonnxruntime_providers_cuda.so',outputs)
        self.assertFalse(any('pybind' in name for name in outputs))
    def test_hash_is_required(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'x';p.write_bytes(b'bad')
            with self.assertRaisesRegex(ValueError,'SHA'):m.verify(p,'0'*64)
    def test_exact_member_does_not_extract_other_files(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);z=root/'x.zip'
            with zipfile.ZipFile(z,'w') as archive:
                archive.writestr('native/ok.dll',b'ok');archive.writestr('../escape',b'bad')
            m.extract(z,{'native/ok.dll':'ok.dll'},root/'out')
            self.assertEqual((root/'out/ok.dll').read_bytes(),b'ok');self.assertFalse((root/'escape').exists())
    def test_unchanged_loaded_library_is_not_rewritten(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);z=root/'x.zip';dest=root/'out';dest.mkdir();(dest/'ok.dll').write_bytes(b'ok')
            with zipfile.ZipFile(z,'w') as archive:archive.writestr('native/ok.dll',b'ok')
            with patch.object(Path,'write_bytes',side_effect=PermissionError('Loaded DLL')):
                m.extract(z,{'native/ok.dll':'ok.dll'},dest)
    def test_transient_download_retries_and_validates(self):
        from unittest.mock import patch
        import io, urllib.error
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'runtime';payload=b'verified'
            with patch.object(m.urllib.request,'urlopen',side_effect=[urllib.error.URLError('503'),io.BytesIO(payload)]),patch.object(m.time,'sleep'):
                m.download('https://example.invalid/runtime',p,hashlib.sha256(payload).hexdigest())
            self.assertEqual(p.read_bytes(),payload)
            self.assertFalse(p.with_suffix('.part').exists())
    def test_unsupported_platform_rejected(self):
        with self.assertRaises(ValueError):m.platform_key('darwin','arm64')
if __name__=='__main__':unittest.main()
