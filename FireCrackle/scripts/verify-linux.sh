#!/usr/bin/env bash
set -euo pipefail
[[ $# == 1 ]] || { echo 'Usage: verify-linux.sh RELEASE_DIRECTORY' >&2; exit 1; }
output="$(cd -- "$1" && pwd)"
project="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(node -p "JSON.parse(require('fs').readFileSync('$project/package.json')).version")"
image="$output/FireCrackle-$version-linux-x86_64.AppImage"
deb="$output/FireCrackle-$version-linux-amd64.deb"
(cd "$output" && sha256sum --check SHA256SUMS-linux-x64.txt)
[[ $(dpkg-deb --field "$deb" Architecture) == amd64 ]]
[[ $(dpkg-deb --field "$deb" Version) == "$version" ]]
dpkg-deb --field "$deb" Depends | grep -Eq '(^|[, ])ffmpeg([, (]|$)'
work="$(mktemp -d)"
# Only this newly allocated directory is removed; never remove a caller-provided path.
trap 'rm -rf -- "$work"' EXIT
dpkg-deb --extract "$deb" "$work/deb"
binary="$work/deb/usr/bin/firecrackle"
for resource in no-fire-v3.onnx quad-phase-v1.onnx quad-phase-v1.json quad-soul-phase-v1.onnx quad-soul-phase-v1.json native.zip ONNX-Runtime-LICENSE.txt; do
  [[ -n $(find "$work/deb" -type f -name "$resource" -print -quit) ]] || { echo "Missing AI resource: $resource" >&2; exit 1; }
done
test -x "$binary"
file "$binary" | grep -q 'ELF 64-bit.*x86-64'
ldd "$binary" > "$work/dependencies.txt"
if grep -q 'not found' "$work/dependencies.txt"; then echo 'Missing native dependency.' >&2; exit 1; fi
for notice in LICENSE.txt THIRD_PARTY_NOTICES.txt README-linux.txt; do
  packaged="$(find "$work/deb" -type f -name "$notice" -print -quit)"
  [[ -n $packaged ]] || { echo "Missing packaged notice: $notice" >&2; exit 1; }
done
if find "$work/deb" -type f \( -iname '*.exe' -o -iname '*.mkv' -o -name project.json -o -name labels.jsonl \) -print -quit | grep -q .; then
  echo 'Unexpected Windows runtime or personal video data in Linux package.' >&2; exit 1
fi
(
  cd "$work"
  "$image" --appimage-extract >/dev/null
)
test -x "$work/squashfs-root/AppRun"
for resource in quad-phase-v1.onnx quad-phase-v1.json quad-soul-phase-v1.onnx quad-soul-phase-v1.json; do
  [[ -n $(find "$work/squashfs-root" -type f -name "$resource" -print -quit) ]] || { echo "Missing AppImage AI resource: $resource" >&2; exit 1; }
done
for notice in LICENSE.txt THIRD_PARTY_NOTICES.txt README-linux.txt; do
  [[ -n $(find "$work/squashfs-root" -type f -name "$notice" -print -quit) ]] || {
    echo "Missing AppImage notice: $notice" >&2; exit 1;
  }
done
# Load the actual extracted package's AI model/runtime on CPU, even on runners without GPUs.
ai_archive="$(find "$work/deb" -type f -name native.zip -print -quit)"
python3 -c 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$ai_archive" "$work/ai"
ai_runtime="$work/ai/libonnxruntime.so"
ai_model="$(find "$work/deb" -type f -name no-fire-v3.onnx -print -quit)"
python3 -c 'import sys; open(sys.argv[1],"wb").write(bytes(224*224*3))' "$work/black.rgb"
cargo build --release --manifest-path "$project/crates/no_fire_cnn/Cargo.toml" --example infer --example phase
"$CARGO_TARGET_DIR/release/examples/infer" "$ai_runtime" "$ai_model" "$work/black.rgb" cpu
python3 -c 'import sys; open(sys.argv[1],"wb").write(bytes(128*128*3))' "$work/phase.rgb"
for model in quad-phase-v1.onnx quad-soul-phase-v1.onnx; do
  packaged="$(find "$work/deb" -type f -name "$model" -print -quit)"
  "$CARGO_TARGET_DIR/release/examples/phase" "$ai_runtime" "$packaged" "$work/phase.rgb"
done
# Remote CI only: exercise both packages under a virtual display, without touching the user's desktop.
for app in "$binary" "$work/squashfs-root/AppRun"; do
  status=0
  WEBKIT_DISABLE_DMABUF_RENDERER=1 LIBGL_ALWAYS_SOFTWARE=1 \
    dbus-run-session -- xvfb-run -a timeout --signal=TERM 12s "$app" >"$work/startup.log" 2>&1 || status=$?
  if [[ $status != 124 ]]; then
    cat "$work/startup.log" >&2
    echo "Linux startup failed (exit $status): $app" >&2
    exit 1
  fi
done
echo 'Linux package contents, dependencies, checksums and headless startup verified.'
