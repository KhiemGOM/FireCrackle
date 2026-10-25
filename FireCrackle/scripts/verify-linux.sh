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
for resource in no-fire-v3.onnx native.zip ONNX-Runtime-LICENSE.txt; do
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
# Downloaded on first use, never packaged: the tools and the quad-phase models (0.4.2-0.6.0 shipped the models).
# The names come from the same manifests the publisher checks (publish_release.separately_downloaded_names).
external="$(python3 -c 'import sys; sys.path.insert(0, sys.argv[1]); import publish_release as r; print("\n".join(sorted(r.separately_downloaded_names())))' "$project/scripts")"
for tree in "$work/deb" "$work/squashfs-root"; do
  while IFS= read -r name; do
    [[ -z $name ]] && continue
    if [[ -n $(find "$tree" -type f -name "$name" -print -quit) ]]; then
      echo "Packaged a file that is downloaded on demand: $name" >&2; exit 1
    fi
  done <<< "$external"
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
# the packaged runtime runs the quad-phase models the app downloads (staged by prepare-quad-phase.py)
for model in quad-phase-v1.onnx quad-soul-phase-v1.onnx; do
  "$CARGO_TARGET_DIR/release/examples/phase" "$ai_runtime" "$project/src-tauri/runtime/models/$model" "$work/phase.rgb"
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
