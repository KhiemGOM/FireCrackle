"""Stage the hash-pinned phase model alongside the existing ONNX Runtime files."""
import importlib.util,json,os,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('prepare_ai_runtime',Path(__file__).with_name('prepare-no-fire.py'))
shared=importlib.util.module_from_spec(spec);spec.loader.exec_module(shared)
verify=shared.verify
def stage(metadata_file,source_env):
    metadata=json.loads((ROOT/'release'/metadata_file).read_text());target=ROOT/'src-tauri/runtime/ai'/metadata['file'];target.parent.mkdir(parents=True,exist_ok=True)
    local=os.environ.get(source_env)
    if local:
        source=Path(local);verify(source,metadata['sha256'])
        if source.resolve()!=target.resolve():shutil.copyfile(source,target)
    elif target.exists():verify(target,metadata['sha256'])
    elif metadata['url']:
        shared.download(metadata['url'],target,metadata['sha256'])
    else:raise RuntimeError(f'Quad AI model {metadata["file"]} is not staged. Set {source_env} to the verified export; its public asset URL has not been published yet.')
    target.with_suffix('.json').write_text(json.dumps(metadata,indent=2)+'\n')
    print(f'Verified {metadata["file"]}; using the same native ONNX Runtime as no-fire')
def main():
    stage('quad-phase-model.json','FIRECRACKLE_PHASE_MODEL_SOURCE')
    stage('quad-soul-phase-model.json','FIRECRACKLE_SOUL_PHASE_MODEL_SOURCE')
if __name__=='__main__':main()
