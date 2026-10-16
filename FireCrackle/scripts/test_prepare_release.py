import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import prepare_release as release


class ReleaseCutTests(unittest.TestCase):
    def test_updates_all_version_files_without_touching_dependency_versions(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            app = root / "FireCrackle"
            (app / "src-tauri").mkdir(parents=True)
            for name in release.FILES[:3]:
                (app / name).write_text(json.dumps({"version": "0.1.0", "packages": {"": {"version": "0.1.0"}}}))
            (app / "src-tauri/Cargo.toml").write_text('[package]\nversion = "0.1.0"\n')
            lock = app / "src-tauri/Cargo.lock"
            lock.write_text('[[package]]\nname = "dependency"\nversion = "1.2.3"\n\n'
                            '[[package]]\nname = "firecrackle"\nversion = "0.1.0"\n')
            release.bump_version(root, "0.2.0")
            self.assertIn('name = "dependency"\nversion = "1.2.3"', lock.read_text())
            self.assertIn('name = "firecrackle"\nversion = "0.2.0"', lock.read_text())
            for name in release.FILES[:3]:
                self.assertEqual(json.loads((app / name).read_text())["version"], "0.2.0")
            self.assertEqual(json.loads((app / "package-lock.json").read_text())["packages"][""]["version"], "0.2.0")
            before = {name: (app / name).read_bytes() for name in release.FILES}
            lock.write_text("missing package")
            with self.assertRaisesRegex(ValueError, "lockfile"):
                release.bump_version(root, "0.3.0")
            for name in release.FILES[:-1]:
                self.assertEqual((app / name).read_bytes(), before[name])

    def test_invalid_version_cannot_create_a_workspace_path(self):
        with self.assertRaises(ValueError):
            release.bump_version(Path("unused"), "../../bad")


class PreflightTests(unittest.TestCase):
    """What the cut checks before anything is pushed: the failures that cost the v0.2.0 cut a push and a CI run each."""

    def test_checks_formatting_of_every_rust_crate_the_ci_checks(self):
        commands = release.preflight_commands()
        self.assertEqual([crate for crate, _ in commands],
                         ["FireCrackle/src-tauri", "FireCrackle/crates/studio_core", "fire-detection/core"])
        for crate, argv in commands:
            self.assertEqual(argv, ["cargo", "fmt", "--manifest-path", f"{crate}/Cargo.toml", "--", "--check"])

    def test_clippy_is_opt_in_because_it_compiles(self):
        plain = release.preflight_commands()
        full = release.preflight_commands(clippy=True)
        self.assertFalse(any("clippy" in argv for _, argv in plain))
        clippy = [(c, a) for c, a in full if "clippy" in a]
        self.assertEqual(len(clippy), 3)
        for crate, argv in clippy:
            self.assertEqual(argv, ["cargo", "clippy", "--manifest-path", f"{crate}/Cargo.toml", "--all-targets",
                                    "--no-deps", "--", "-D", "warnings"])
        self.assertEqual(full[:3], plain)  # the cheap checks still come first

    def test_passes_when_every_check_passes_and_runs_them_in_the_worktree(self):
        calls = []
        def runner(argv, cwd):
            calls.append((argv, cwd))
            return 0, ""
        done = release.run_preflight(Path("work"), runner=runner)
        self.assertEqual(len(calls), 3)
        self.assertTrue(all(cwd == Path("work") for _, cwd in calls))
        self.assertEqual(len(done), 3)

    def test_reports_every_failing_crate_with_the_tools_own_output(self):
        def runner(argv, cwd):
            return (1, f"Diff in {argv[3]}") if "studio_core" not in argv[3] else (0, "")
        with self.assertRaises(RuntimeError) as caught:
            release.run_preflight(Path("work"), runner=runner)
        message = str(caught.exception)
        self.assertIn("FireCrackle/src-tauri", message)
        self.assertIn("fire-detection/core", message)
        self.assertNotIn("Diff in FireCrackle/crates/studio_core", message)
        self.assertIn("Diff in FireCrackle/src-tauri/Cargo.toml", message)

    def test_a_missing_tool_is_a_clear_error_not_a_traceback_from_deep_inside(self):
        def runner(argv, cwd):
            raise FileNotFoundError(argv[0])
        with self.assertRaisesRegex(RuntimeError, "cargo"):
            release.run_preflight(Path("work"), runner=runner)

    def test_the_default_runner_captures_output_and_the_exit_code(self):
        code, output = release.run_command([sys.executable, "-c", "import sys; print('hi'); sys.exit(3)"], Path("."))
        self.assertEqual(code, 3)
        self.assertIn("hi", output)


class CutOrderTests(unittest.TestCase):
    """A failed check must stop the cut before the branch is pushed or the workflow is started."""

    def cut(self, preflight):
        calls = []
        def fake_run(*args, cwd=None):
            calls.append(args)
            return "x"
        with tempfile.TemporaryDirectory() as scratch,                 patch.object(release, "ROOT", Path(scratch)),                 patch.object(release, "run", fake_run),                 patch.object(release, "bump_version"),                 patch.object(release, "run_preflight", preflight),                 patch.object(release.subprocess, "run", return_value=type("R", (), {"returncode": 2})()),                 patch.object(sys, "argv", ["prepare_release.py", "--version", "9.9.9", "--repo", "o/r"]):
            try:
                release.main()
                error = None
            except RuntimeError as exc:
                error = exc
        return calls, error

    def test_a_passing_cut_checks_before_it_pushes(self):
        order = []
        calls, error = self.cut(lambda *a, **k: order.append("preflight"))
        self.assertIsNone(error)
        names = [c[1] for c in calls if c[0] == "git"] + [c[1] for c in calls if c[0] == "gh"]
        self.assertIn("push", names)
        self.assertEqual(order, ["preflight"])
        verbs = [(c[0], c[1]) for c in calls]
        self.assertLess(verbs.index(("git", "commit")), verbs.index(("git", "push")))

    def test_a_failing_check_never_pushes_or_starts_the_workflow_and_cleans_up_what_it_created(self):
        def failing(*a, **k):
            raise RuntimeError("cargo fmt failed in FireCrackle/src-tauri")
        calls, error = self.cut(failing)
        self.assertIsNotNone(error)
        self.assertIn("cargo fmt", str(error))
        flat = [" ".join(map(str, c)) for c in calls]
        self.assertFalse(any(" push " in f"{c} " or c.startswith("gh workflow") for c in flat), flat)
        self.assertTrue(any("worktree remove" in c for c in flat), flat)
        self.assertTrue(any("branch -D codex/release-v9.9.9" in c for c in flat), flat)
