"""Translate the source-audited screen catalogue into runtime-stable Fabric class IDs."""
import hashlib
import json
from pathlib import Path
import re

root = Path(__file__).resolve().parents[2]
cache = Path.home() / '.gradle/caches/fabric-loom/1.21.11'
official = cache / 'layered/working_dir/layered_hash_1829584439/mojang/client.txt'
names = {}
for line in official.read_text(encoding='utf-8').splitlines():
    if m := re.match(r'^(\S+) -> (\S+):$', line):
        names[m[1]] = m[2]
intermediary = {}
for line in (cache / 'intermediary-v2.tiny').read_text(encoding='utf-8').splitlines():
    if line.startswith('c\t'):
        _, obf, stable = line.split('\t')
        intermediary[obf.replace('/', '.')] = stable.replace('/', '.')
catalogue = root / 'docs/gui_screens_1_21_11.json'
data = json.loads(catalogue.read_text(encoding='utf-8'))
records = []
for screen in data['screens']:
    if screen['abstract']:
        continue
    records.append({k: screen[k] for k in ('id', 'class', 'category')}
                   | {'intermediary': intermediary[names[screen['class']]]})
output = Path(__file__).parent / 'src/main/resources/guilabel-screen-types.json'
output.write_text(json.dumps(records, indent=2) + '\n', encoding='utf-8')
print(f'{len(records)} known screen classes; catalogue SHA256 {hashlib.sha256(catalogue.read_bytes()).hexdigest()}')
