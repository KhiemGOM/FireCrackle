"""Install the pinned official Sodium Fabric artifact in this isolated instance."""
import hashlib
import json
from pathlib import Path
import urllib.request
import zipfile

ARTIFACTS = [
    ('sodium', 'sodium-fabric-0.8.14+mc1.21.11.jar',
     'https://cdn.modrinth.com/data/AANobbMI/versions/rkdTcxoT/sodium-fabric-0.8.14%2Bmc1.21.11.jar',
     '04c43f9e8534b87a52c42ffd51b0e344d4ef92dc9cc52da33d13af6a18bf74b05380d2027f1e0db982698d0aff274c42741c1e21b313b0cd75ed3af005fc98d9'),
    ('fabric-api', 'fabric-api-0.140.2+1.21.11.jar',
     'https://cdn.modrinth.com/data/P7dR8mSH/versions/gB6TkYEJ/fabric-api-0.140.2%2B1.21.11.jar',
     'af4465797d80401021a6aefc8c547200e7c0f8cae134299bf3fafbc310fa81f055246b0614fc0e037538f4a844e55aad30abfa3c67460422853dfc426f086d00'),
]
for mod_id, filename, url, expected in ARTIFACTS:
    destination = Path(__file__).parent / 'run/mods' / filename
    destination.parent.mkdir(parents=True, exist_ok=True)
    data = destination.read_bytes() if destination.exists() else urllib.request.urlopen(
        urllib.request.Request(url, headers={'User-Agent': 'FireCrackle-GUI-Recorder/0.1'}), timeout=60).read()
    if hashlib.sha512(data).hexdigest() != expected:
        raise SystemExit(f'{mod_id} hash mismatch; nothing installed')
    import io
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        metadata = json.loads(archive.read('fabric.mod.json'))
    if metadata['id'] != mod_id:
        raise SystemExit('Unexpected mod ID')
    destination.write_bytes(data)
    print(json.dumps({'installed': str(destination.resolve()), 'version': metadata['version'], 'depends': metadata['depends']}))
