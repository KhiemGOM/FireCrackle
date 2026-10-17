"""Verify immutable Windows/Linux build outputs, then publish through a draft release.

Uses only Python's standard library and the authenticated GitHub CLI. Build-only
runs never call this publisher; published assets are never overwritten.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tempfile
import time
import zipfile

ROOT = Path(__file__).resolve().parents[2]


def command(*args):
    try:
        return subprocess.run(args, check=True, text=True, capture_output=True).stdout
    except subprocess.CalledProcessError as exc:
        raise RuntimeError((exc.stderr or exc.stdout or str(exc)).strip()) from exc


def api(repo, endpoint):
    return json.loads(command("gh", "api", f"repos/{repo}/{endpoint}"))


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def source_version(root=ROOT):
    app = root / "FireCrackle"
    version = json.loads((app / "package.json").read_text())["version"]
    cargo = re.search(r'^version\s*=\s*"([^"]+)"', (app / "src-tauri/Cargo.toml").read_text(), re.M)
    config = json.loads((app / "src-tauri/tauri.conf.json").read_text())
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?", version):
        raise ValueError("Invalid release version")
    if cargo is None or cargo[1] != version or config["version"] != version:
        raise ValueError("package.json, Cargo.toml and tauri.conf.json versions must agree")
    return version


def validate_plan(platform, publish, ref, root=ROOT):
    version = source_version(root)
    if publish and platform != "all":
        raise ValueError("Publishing requires both platforms; select platform=all")
    if ref.startswith("refs/tags/") and ref != f"refs/tags/v{version}":
        raise ValueError(f"Tag must be v{version}")
    return version


def verify_checksums(folder, filename):
    names = set()
    for line in (folder / filename).read_text(encoding="utf-8-sig").splitlines():
        if not line.strip():
            continue
        match = re.fullmatch(r"([0-9a-f]{64})  (.+)", line)
        if not match:
            raise ValueError("Malformed checksum entry")
        name = match[2].removeprefix("./")
        if name in names or name in (".", "..") or "/" in name or "\\" in name or ":" in name:
            raise ValueError("Unsafe or duplicate checksum filename")
        if digest(folder / name) != match[1]:
            raise ValueError(f"Checksum mismatch: {name}")
        names.add(name)
    if not names:
        raise ValueError("Empty checksum manifest")
    return names


def verify_metadata(metadata, version, commit, target):
    if (metadata.get("version") != version or metadata.get("commit") != commit
            or metadata.get("target") != target or metadata.get("workingTreeDirty") is not False
            or metadata.get("checksRun") is not True):
        raise ValueError(f"Build provenance mismatch: {target}")


def verify_windows_archive(archive, version, commit):
    prefix = f"FireCrackle-{version}-windows-x64/"
    with zipfile.ZipFile(archive) as package:
        for entry in package.infolist():
            parts = PurePosixPath(entry.filename).parts
            if not entry.filename.startswith(prefix) or ".." in parts or "\\" in entry.filename:
                raise ValueError("Unsafe Windows ZIP layout")
        for name in ("FireCrackle.exe", "README.txt", "LICENSE.txt", "THIRD_PARTY_NOTICES.txt",
                     "release.json", "SHA256SUMS.txt"):
            package.getinfo(prefix + name)
        if any(entry.filename.startswith(prefix + "tools/") for entry in package.infolist()):
            raise ValueError("Third-party tools must be downloaded separately, not packaged")
        info = package.getinfo(prefix + "release.json")
        if info.file_size > 64 * 1024:
            raise ValueError("Oversized build metadata")
        verify_metadata(json.loads(package.read(info)), version, commit, "windows-x64")


def expected_asset_names(version):
    """The release's installer file names, from the contract the app's update check also reads."""
    templates = json.loads((ROOT / "FireCrackle/release/asset-names.json").read_text(encoding="utf-8"))
    return {key: template.replace("{version}", version) for key, template in templates.items()}


def verify_artifacts(windows, linux, version, commit):
    names = expected_asset_names(version)
    zip_name = names["windowsPortable"]
    setup_name = names["windowsSetup"]
    image_name = names["linuxAppImage"]
    deb_name = names["linuxDeb"]
    if verify_checksums(windows, "SHA256SUMS.txt") != {zip_name, setup_name}:
        raise ValueError("Unexpected Windows artifact list")
    verify_windows_archive(windows / zip_name, version, commit)
    linux_names = {image_name, deb_name, "LICENSE.txt", "THIRD_PARTY_NOTICES.txt",
                   "README-linux.txt", "release-linux.json"}
    if verify_checksums(linux, "SHA256SUMS-linux-x64.txt") != linux_names:
        raise ValueError("Unexpected Linux artifact list")
    verify_metadata(json.loads((linux / "release-linux.json").read_text()), version, commit, "linux-x64")
    return [windows / zip_name, windows / setup_name, windows / "SHA256SUMS.txt",
            *[linux / name for name in sorted(linux_names)], linux / "SHA256SUMS-linux-x64.txt"]


def artifact_folder(download, marker):
    # upload-artifact retains the fresh per-build directories below its glob root.
    matches = list(download.rglob(marker))
    if len(matches) != 1:
        raise ValueError(f"Expected one build output containing {marker}")
    return matches[0].parent


def verify_run(repo, run_id, commit, platform):
    if not str(run_id).isdigit():
        raise ValueError("Specify a numeric workflow run ID")
    run = api(repo, f"actions/runs/{run_id}")
    if run["head_sha"] != commit:
        raise ValueError(f"{platform} build is not successful at the frozen release commit")
    jobs = []
    page = 1
    while True:
        batch = api(repo, f"actions/runs/{run_id}/jobs?filter=all&per_page=100&page={page}")["jobs"]
        jobs.extend(job for job in batch if job["name"] == platform)
        if len(batch) < 100:
            break
        page += 1
    latest = max(jobs, key=lambda job: (job["run_attempt"], job["id"]), default=None)
    if latest is None or latest["conclusion"] != "success":
        raise ValueError(f"{platform} build is not successful at the frozen release commit")


def release_info(repo, tag):
    # Listing also finds authenticated drafts whose tag has not been created yet.
    return next((item for item in api(repo, "releases?per_page=100") if item["tag_name"] == tag), None)


def wait_release_info(repo, tag, *, published=False, asset_names=()):
    # GitHub can briefly omit a newly created draft or return stale assets/state.
    for attempt in range(10):
        info = release_info(repo, tag)
        if (info is not None and (not published or not info["draft"])
                and set(asset_names).issubset({asset["name"] for asset in info["assets"]})):
            return info
        if attempt < 9:
            time.sleep(2)
    raise ValueError("GitHub release state has not settled; the draft/assets are preserved for retry")


def verify_uploaded(repo, tag, files, info, temporary):
    assets = {asset["name"]: asset for asset in info["assets"]}
    for path in files:
        asset = assets.get(path.name)
        if asset is None:
            raise ValueError(f"Uploaded asset missing: {path.name}")
        expected = "sha256:" + digest(path)
        if asset.get("digest"):
            if asset["digest"] != expected:
                raise ValueError(f"Server checksum mismatch: {path.name}")
        else:
            target = temporary / path.name
            command("gh", "release", "download", tag, "--repo", repo, "--pattern", path.name,
                    "--dir", str(temporary), "--clobber")
            if digest(target) != digest(path):
                raise ValueError(f"Downloaded release asset differs: {path.name}")


def publish(args):
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", args.repo) or not re.fullmatch(r"[0-9a-f]{40}", args.commit):
        raise ValueError("Specify an owner/repository and full frozen commit SHA")
    version = source_version(ROOT)
    tag = f"v{version}"
    for platform, run_id in (("windows", args.windows_run), ("linux", args.linux_run)):
        verify_run(args.repo, run_id, args.commit, platform)
    # All staging is newly allocated; no caller-provided directory is removed.
    with tempfile.TemporaryDirectory(prefix="firecrackle-release-") as scratch:
        staging = Path(scratch)
        windows, linux = staging / "windows", staging / "linux"
        for platform, run_id, directory in (("windows", args.windows_run, windows),
                                             ("linux", args.linux_run, linux)):
            command("gh", "run", "download", str(run_id), "--repo", args.repo,
                    "--name", f"FireCrackle-{platform}-x64", "--dir", str(directory))
        files = verify_artifacts(artifact_folder(windows, f"FireCrackle-{version}-windows-x64.zip"),
                                 artifact_folder(linux, "release-linux.json"), version, args.commit)
        info = release_info(args.repo, tag)
        if info and info["target_commitish"] != args.commit:
            raise ValueError("Existing release targets another commit; it will not be overwritten")
        if not info:
            notes = ROOT / f"FireCrackle/release/notes-v{version}.md"
            if not notes.is_file():
                notes = staging / "notes.md"
                notes.write_text(f"FireCrackle {version}: Windows x64 and Linux x86_64 builds.\n"
                                 "See the packaged README and third-party notices. Experimental analysis tool.\n")
            command("gh", "release", "create", tag, "--repo", args.repo, "--target", args.commit,
                    "--draft", "--title", f"FireCrackle v{version}", "--notes-file", str(notes))
            info = wait_release_info(args.repo, tag)
        if info["draft"]:
            command("gh", "release", "upload", tag, "--repo", args.repo, "--clobber", *map(str, files))
        verification = staging / "verify"
        verification.mkdir()
        verify_uploaded(args.repo, tag, files,
                        wait_release_info(args.repo, tag, asset_names=[path.name for path in files]), verification)
        if info["draft"]:
            command("gh", "release", "edit", tag, "--repo", args.repo, "--draft=false")
        final = wait_release_info(args.repo, tag, published=True)
        if final is None or final["draft"]:
            raise ValueError("Release remains unpublished; inspect the existing draft before retrying")
        print(final["html_url"])


def main():
    global ROOT
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    validate = sub.add_parser("validate")
    validate.add_argument("--platform", choices=("all", "windows", "linux"), default="all")
    validate.add_argument("--publish", choices=("true", "false"), default="false")
    validate.add_argument("--ref", default="")
    release = sub.add_parser("publish")
    release.add_argument("--repo", required=True)
    release.add_argument("--commit", required=True)
    release.add_argument("--windows-run", required=True)
    release.add_argument("--linux-run", required=True)
    release.add_argument("--source-root", type=Path, help="Frozen release checkout when recovering with newer publisher tools")
    args = parser.parse_args()
    if args.action == "validate":
        print("version=" + validate_plan(args.platform, args.publish == "true", args.ref))
    else:
        if args.source_root is not None:
            ROOT = args.source_root.resolve()
        publish(args)


if __name__ == "__main__":
    main()
