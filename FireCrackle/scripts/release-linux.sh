#!/usr/bin/env bash
set -euo pipefail

project="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project"
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || {
  echo 'Build this package on Linux x86_64.' >&2; exit 1;
}
for tool in node npm cargo rustc ffmpeg ffprobe dpkg-deb sha256sum; do
  command -v "$tool" >/dev/null || { echo "Missing build prerequisite: $tool" >&2; exit 1; }
done
version="$(node --input-type=module -e '
import fs from "node:fs";
const pkg = JSON.parse(fs.readFileSync("package.json"));
const config = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json"));
const cargo = fs.readFileSync("src-tauri/Cargo.toml", "utf8").match(/^version\s*=\s*"([^"]+)"/m)?.[1];
if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(pkg.version) || pkg.version !== config.version || pkg.version !== cargo) throw Error("Release versions must agree");
console.log(pkg.version);')"
if [[ ${GITHUB_REF:-} == refs/tags/* && $GITHUB_REF != "refs/tags/v$version" ]]; then
  echo "Tag must be v$version." >&2; exit 1
fi
if [[ ${1:-} == --validate-only ]]; then
  echo "Linux release configuration valid: v$version"; exit 0
fi
[[ $# == 0 ]] || { echo 'Usage: release-linux.sh [--validate-only]' >&2; exit 1; }
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$project/src-tauri/target}"
export FIRECRACKLE_TEST_FFMPEG="$(command -v ffmpeg)"
python3 scripts/prepare-no-fire.py
export FIRECRACKLE_TEST_ORT="$project/.release-cache/no-fire/native-linux-x64/libonnxruntime.so"
export FIRECRACKLE_TEST_MODEL="$project/src-tauri/runtime/ai/no-fire-v3.onnx"
npm ci
npm test
npm run build
for manifest in crates/studio_core/Cargo.toml ../fire-detection/core/Cargo.toml crates/no_fire_cnn/Cargo.toml; do
  cargo test --manifest-path "$manifest"
done
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run tauri -- build --config src-tauri/tauri.linux.conf.json --bundles deb,appimage

stamp="$(date -u +%Y%m%d-%H%M%S)"
output="$project/releases/v$version/linux-x64-$stamp-$$"
mkdir -p "$output"
shopt -s nullglob
appimages=("$CARGO_TARGET_DIR/release/bundle/appimage/"*.AppImage)
debs=("$CARGO_TARGET_DIR/release/bundle/deb/"*.deb)
[[ ${#appimages[@]} == 1 && ${#debs[@]} == 1 ]] || {
  echo 'Expected exactly one AppImage and one Debian package.' >&2; exit 1;
}
cp "${appimages[0]}" "$output/FireCrackle-$version-linux-x86_64.AppImage"
cp "${debs[0]}" "$output/FireCrackle-$version-linux-amd64.deb"
chmod +x "$output/FireCrackle-$version-linux-x86_64.AppImage"
cp release/README-linux.txt "$output/README-linux.txt"
cp ../LICENSE "$output/LICENSE.txt"
cp ../THIRD_PARTY_NOTICES.md "$output/THIRD_PARTY_NOTICES.txt"
export FIRECRACKLE_RELEASE_OUTPUT="$output"
node --input-type=module -e '
import fs from "node:fs";
import {execFileSync} from "node:child_process";
const metadata = {product:"FireCrackle",version:JSON.parse(fs.readFileSync("package.json")).version,target:"linux-x64",builtUtc:new Date().toISOString(),commit:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),workingTreeDirty:execFileSync("git",["status","--porcelain"],{encoding:"utf8"}).trim().length>0,checksRun:true,videoTools:"System ffmpeg and ffprobe; not bundled"};
fs.writeFileSync(process.env.FIRECRACKLE_RELEASE_OUTPUT+"/release-linux.json",JSON.stringify(metadata,null,2)+"\n");'
(
  cd "$output"
  sha256sum ./*.AppImage ./*.deb LICENSE.txt THIRD_PARTY_NOTICES.txt README-linux.txt release-linux.json > SHA256SUMS-linux-x64.txt
  sha256sum --check SHA256SUMS-linux-x64.txt
)
bash scripts/verify-linux.sh "$output"
echo "Release files: $output"
