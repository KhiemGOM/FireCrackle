"""The release and CI workflows must stay fast and pinned: caches present, every action pinned to a full commit."""
from pathlib import Path
import re
import unittest

WORKFLOWS = Path(__file__).resolve().parents[2] / ".github" / "workflows"
SHA = r"[0-9a-f]{40}"


def text(name):
    return (WORKFLOWS / name).read_text(encoding="utf-8")


def job(name, workflow):
    body = text(workflow)
    match = re.search(rf"^  {re.escape(name)}:\n(.*?)(?=^  [A-Za-z0-9_-]+:\n|\Z)", body, re.M | re.S)
    if match is None:
        raise AssertionError(f"{workflow} has no job {name}")
    return match[1]


class WorkflowPolicyTests(unittest.TestCase):
    def test_cache_warm_prepares_generated_gui_assets_before_rust(self):
        for platform in ("windows", "linux"):
            body = job(platform, "rust-cache-warm.yml")
            self.assertIn("prepareGuiAssets", body)
            self.assertLess(body.index("prepareGuiAssets"), body.index("cargo test"))

    def test_python_checks_install_research_image_dependencies(self):
        body = job("python", "ci.yml")
        for dependency in ("pillow", "torch"):
            self.assertRegex(body.lower(), rf"pip install[^\n]*\b{dependency}\b")
        self.assertIn("https://download.pytorch.org/whl/cpu", body)

    def test_cache_warm_installs_shared_unveil_wasm_target(self):
        for platform in ("windows", "linux"):
            self.assertIn("rustup target add wasm32-unknown-unknown", job(platform, "rust-cache-warm.yml"))

    def test_every_action_is_pinned_to_a_full_commit_with_its_version_in_a_comment(self):
        for path in sorted(WORKFLOWS.glob("*.yml")):
            for line in path.read_text(encoding="utf-8").splitlines():
                match = re.search(r"uses:\s*(\S+)", line)
                if match and not match[1].startswith("./"):
                    self.assertRegex(line, rf"@{SHA}\s+#\s*v?\d", f"{path.name}: {line.strip()}")

    def test_release_builds_restore_the_rust_dependency_cache(self):
        for platform in ("windows", "linux"):
            body = job(platform, "firecrackle-release.yml")
            self.assertRegex(body, rf"Swatinem/rust-cache@{SHA}", platform)
            self.assertIn("workspaces: FireCrackle/src-tauri", body)
            self.assertIn(f"shared-key: release-{platform}", body)
            self.assertLess(body.index("rust-cache"), body.index("scripts/release"), "restore the cache before building")

    def test_release_builds_never_save_a_cache_that_a_failed_build_left_half_made(self):
        for platform in ("windows", "linux"):
            self.assertNotIn("cache-on-failure: true", job(platform, "firecrackle-release.yml"))

    def test_windows_release_reuses_the_downloaded_ffmpeg_package(self):
        body = job("windows", "firecrackle-release.yml")
        self.assertRegex(body, rf"actions/cache@{SHA}")
        self.assertIn("FireCrackle/.release-cache", body)
        self.assertIn("hashFiles('FireCrackle/release/runtime-lock.json')", body)

    def test_ci_reuses_compiled_dependencies_and_the_ffmpeg_package(self):
        body = job("windows", "ci.yml")
        self.assertRegex(body, rf"Swatinem/rust-cache@{SHA}")
        for crate in ("FireCrackle/src-tauri", "FireCrackle/crates/studio_core", "fire-detection/core"):
            self.assertIn(crate, body.split("rust-cache", 1)[1].split("- name:", 1)[0], crate)
        self.assertIn("FireCrackle/.release-cache", body)

    def test_a_warm_up_on_main_keeps_the_caches_that_new_release_branches_can_read(self):
        # GitHub only lets a branch restore caches from itself and from the default branch.
        body = text("rust-cache-warm.yml")
        self.assertRegex(body, r"push:\s*\n\s*branches:\s*\[main\]")
        self.assertIn("**/Cargo.lock", body)
        self.assertIn("schedule:", body)
        self.assertIn("workflow_dispatch:", body)
        for platform in ("windows", "linux"):
            self.assertIn(f"shared-key: release-{platform}", body)
        # the same command as the release (tauri adds feature flags a plain cargo build lacks), without the packaging
        self.assertIn("tauri -- build", body)
        self.assertIn("--no-bundle", body)
        self.assertRegex(body, r"cancel-in-progress:\s*true")

    def test_the_warm_up_builds_what_the_release_restores(self):
        body = text("rust-cache-warm.yml")
        self.assertIn("CARGO_TARGET_DIR", body)
        self.assertIn("FireCrackle/src-tauri/target", body)
        self.assertIn("cargo test", body)  # the debug test dependencies too

    def test_release_instructions_say_how_to_rerun_only_what_failed(self):
        readme = (Path(__file__).resolve().parents[1] / "release" / "README.md").read_text(encoding="utf-8")
        self.assertIn("gh run rerun", readme)
        self.assertIn("--failed", readme)


if __name__ == "__main__":
    unittest.main()
