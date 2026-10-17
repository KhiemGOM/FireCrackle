"""Run canonical GUI classification once per frozen, unveiled native frame."""
import hashlib
import json
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[4]
OUT=ROOT/'.board/gui-occlusion-eval'
BENCH=ROOT/'.board/occlusion-all-videos'


def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()


def main():
    OUT.mkdir(exist_ok=True);source=Path(__file__).with_name('batch.rs');binary=OUT/'batch.exe'
    subprocess.run(['rustc','--edition=2021','-C','opt-level=3',str(source),'-o',str(binary)],check=True)
    lines=[];frames=[]
    for name in ['quad1','survival1','new_recording']:
        m=json.loads((BENCH/name/'exact/manifest.json').read_text());dest=OUT/name;dest.mkdir(exist_ok=True)
        for frame in sorted({r['frame'] for r in m['samples']}):
            native=Path(m['native_source'])/f'{frame}.rgb';stem=dest/str(frame)
            lines.append(f'{m["width"]}\t{m["height"]}\t{native}\t{stem}')
            frames.append(dict(video=name,frame=frame,width=m['width'],height=m['height'],stem=str(stem),rgb_sha256=sha(native)))
    task=OUT/'inputs.tsv';task.write_text('\n'.join(lines)+'\n')
    protocol=dict(canonical_gui_sha256=sha(ROOT/'fire-detection/core/src/gui_mask.rs'),canonical_veil_sha256=sha(ROOT/'fire-detection/core/src/veil.rs'),
        batch_sha256=sha(source),input='Same already-unveiled native RGB used in all-video benchmark',frames=frames,
        controlled_footage_assumption='Controlled vanilla1.16.5 recordings for offline research; no project attestation file or app permission is changed',
        treatment='Zero sample weight when a bilinear source tap intersects a detected opaque/translucent/unknown GUI pixel. No arbitrary rectangles; unreliable fit leaves weights unchanged.')
    (OUT/'protocol.json').write_text(json.dumps(protocol,indent=2))
    with (OUT/'detection.tsv').open('w') as log:
        subprocess.run([str(binary),str(ROOT/'fire-detection/data/assets/gui'),str(task)],stdout=log,check=True)
    print(f'{len(frames)} native frames classified',flush=True)


if __name__=='__main__':main()
