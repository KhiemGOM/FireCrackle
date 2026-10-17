"""Prepare hash-pinned no-fire model and native inference libraries for a build.
No Python/runtime downloads occur in the installed app. Assets remain ignored.
"""
import argparse,hashlib,json,os,platform,shutil,tarfile,urllib.request,urllib.error,zipfile,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def verify(path,expected):
    digest=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):digest.update(chunk)
    digest=digest.hexdigest()
    if digest!=expected:raise ValueError(f'SHA-256 mismatch: {path}')
def platform_key(system,machine):
    if machine.lower() not in ('amd64','x86_64'):raise ValueError('No-fire runtime supports x64 builds')
    if system.lower() not in ('windows','linux'):raise ValueError('No-fire runtime supports Windows/Linux')
    return system.lower()+'-x64'
def extract(archive,members,destination):
    destination=Path(destination);destination.mkdir(parents=True,exist_ok=True)
    with (zipfile.ZipFile(archive) if zipfile.is_zipfile(archive) else tarfile.open(archive)) as source:
        for member,name in members.items():
            if Path(name).name!=name:raise ValueError('Unsafe output member')
            data=source.read(member) if isinstance(source,zipfile.ZipFile) else source.extractfile(member).read()
            target=destination/name
            if not target.exists() or target.read_bytes()!=data:target.write_bytes(data)
def download(url,destination,sha):
    destination.parent.mkdir(parents=True,exist_ok=True)
    if destination.exists():verify(destination,sha);return destination
    temporary=destination.with_suffix(destination.suffix+'.part')
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'FireCrackle-model-build/1'}),timeout=120) as response,temporary.open('wb') as stream:
                size=0
                while chunk:=response.read(1024*1024):
                    size+=len(chunk)
                    if size>384*1024*1024:raise ValueError('Inference archive exceeds size budget')
                    stream.write(chunk)
            verify(temporary,sha);temporary.replace(destination)
            break
        except (urllib.error.URLError,TimeoutError,ConnectionError):
            if attempt==2:raise
            time.sleep(2**attempt)
        finally:temporary.unlink(missing_ok=True)
    return destination

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--platform');args=parser.parse_args()
    key=args.platform or platform_key(platform.system(),platform.machine())
    manifest=json.loads((ROOT/'release/no-fire-model.json').read_text())
    if key not in manifest['platforms']:raise ValueError('Unsupported platform')
    output=ROOT/'src-tauri/runtime/ai';output.mkdir(parents=True,exist_ok=True)
    model=manifest['model'];local=os.environ.get('FIRECRACKLE_MODEL_SOURCE')
    if local:verify(Path(local),model['sha256']);shutil.copyfile(local,output/'no-fire-v3.onnx')
    else:download(model['url'],output/'no-fire-v3.onnx',model['sha256'])
    cache=ROOT/'.release-cache/no-fire'
    for artifact in manifest['platforms'][key]:
        archive=download(artifact['url'],cache/artifact['sha256'],artifact['sha256'])
        extract(archive,artifact['members'],output)
    (output/'model.json').write_text(json.dumps(model,indent=2)+'\n')
    print(f'Prepared AI no-fire model and {key} inference runtime')
if __name__=='__main__':main()
