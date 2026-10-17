"""Cut a release in a separate worktree without changing the development checkout."""
import argparse
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
VERSION = r"\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?"
FILES = ["package.json", "package-lock.json", "src-tauri/tauri.conf.json",
         "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]


# The crates the CI checks, so the CI cannot fail on something this cut could have caught in seconds.
RUST_CRATES = ["FireCrackle/src-tauri", "FireCrackle/crates/studio_core", "fire-detection/core",
               "FireCrackle/crates/no_fire_cnn"]


def run(*args, cwd=ROOT):
    return subprocess.run(args, cwd=cwd, check=True, text=True, capture_output=True).stdout.strip()


def run_command(argv, cwd):
    """Run a check without raising: (exit code, combined output)."""
    done = subprocess.run(argv, cwd=cwd, text=True, capture_output=True)
    return done.returncode, (done.stdout or "") + (done.stderr or "")


def preflight_commands(clippy=False):
    """(crate, argv) for every check made before pushing. Formatting is instant; clippy compiles, so it is opt-in."""
    commands = [(crate, ["cargo", "fmt", "--manifest-path", f"{crate}/Cargo.toml", "--", "--check"]) for crate in RUST_CRATES]
    if clippy:
        commands += [(crate, ["cargo", "clippy", "--manifest-path", f"{crate}/Cargo.toml", "--all-targets",
                              "--no-deps", "--", "-D", "warnings"]) for crate in RUST_CRATES]
    return commands


def run_preflight(root, runner=None, clippy=False):
    """Check the frozen release before it is pushed. Raises one RuntimeError naming every failing check."""
    runner = runner or run_command
    failures = []
    done = []
    for crate, argv in preflight_commands(clippy):
        try:
            code, output = runner(argv, root)
        except FileNotFoundError as exc:
            raise RuntimeError(f"Cannot run the pre-push checks: {exc} was not found. Install the Rust toolchain "
                               "(cargo, rustfmt) or pass --skip-preflight.") from exc
        if code != 0:
            failures.append(f"{crate}: {' '.join(argv)}\n{output.strip()[:2000]}")
        done.append(f"{crate}: {argv[1]}")
    if failures:
        raise RuntimeError("Pre-push checks failed; nothing was pushed.\n\n" + "\n\n".join(failures))
    return done


def bump_version(root, version):
    if not re.fullmatch(VERSION, version):
        raise ValueError("Use a semantic version such as 0.1.1")
    app = root / "FireCrackle"
    changes = {}
    for name in FILES[:3]:
        path = app / name
        data = json.loads(path.read_text(encoding="utf-8"))
        data["version"] = version
        if name == "package-lock.json":
            data["packages"][""]["version"] = version
        changes[path] = json.dumps(data, indent=2) + "\n"
    path = app / "src-tauri/Cargo.toml"
    changes[path], count = re.subn(r'(?m)^version\s*=\s*"[^"]+"',
                                   f'version = "{version}"', path.read_text(), count=1)
    if count != 1:
        raise ValueError("Missing desktop package version")
    path = app / "src-tauri/Cargo.lock"
    changes[path], count = re.subn(r'(\[\[package\]\]\s+name = "firecrackle"\s+version = ")[^"]+(")',
                                   lambda match: match[1] + version + match[2], path.read_text())
    if count != 1:
        raise ValueError("Missing or duplicate firecrackle lockfile package")
    # Validate every input before writing any file.
    for path, content in changes.items():
        path.write_text(content, encoding="utf-8", newline="\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument("--source", default="main", help="Committed branch/ref to freeze; dirty changes are excluded")
    parser.add_argument("--repo", default=None)
    parser.add_argument("--clippy", action="store_true", help="Also run clippy (-D warnings) before pushing; slower")
    parser.add_argument("--skip-preflight", action="store_true", help="Push without the local formatting checks")
    args = parser.parse_args()
    if not re.fullmatch(VERSION, args.version) or args.source.startswith("-"):
        parser.error("Invalid version or source ref")
    repo = args.repo or run("gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner")
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", repo):
        parser.error("Invalid repository")
    existing = subprocess.run(["git", "ls-remote", "--exit-code", "--tags", "origin", f"refs/tags/v{args.version}"],
                              cwd=ROOT, capture_output=True, text=True)
    if existing.returncode != 2:
        raise RuntimeError("Release tag already exists or remote could not be checked; nothing changed")
    commit = run("git", "rev-parse", "--verify", args.source + "^{commit}")
    branch = f"codex/release-v{args.version}"
    target = ROOT / ".release-worktrees" / f"v{args.version}"
    if target.exists():
        raise RuntimeError(f"Release workspace already exists: {target}. Inspect it before retrying.")
    run("git", "worktree", "add", "-b", branch, str(target), commit)
    bump_version(target, args.version)
    run("git", "add", "--", *["FireCrackle/" + name for name in FILES], cwd=target)
    dirty = run("git", "diff", "--cached", "--name-only", cwd=target)
    if dirty:
        run("git", "commit", "-m", f"Prepare FireCrackle v{args.version}", cwd=target)
    if not args.skip_preflight:
        try:
            run_preflight(target, clippy=args.clippy)
        except RuntimeError:
            # Nothing was pushed: drop the workspace and branch made a moment ago so the cut can simply be retried.
            for cleanup in (("git", "worktree", "remove", "--force", str(target)), ("git", "branch", "-D", branch)):
                try:
                    run(*cleanup)
                except subprocess.CalledProcessError:
                    pass
            raise
    run("git", "push", "-u", "origin", branch, cwd=target)
    run("gh", "workflow", "run", "firecrackle-release.yml", "--repo", repo, "--ref", branch,
        "-f", "platform=all", "-f", "publish=true", cwd=target)
    print(f"Frozen release workspace: {target}\nBranch: {branch}\n"
          f"Builds and publication: https://github.com/{repo}/actions/workflows/firecrackle-release.yml\n"
          "Your development checkout was not switched or staged. Keep this workspace until the release completes.")


if __name__ == "__main__":
    main()
