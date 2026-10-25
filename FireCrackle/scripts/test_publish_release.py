import hashlib
import json
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest
from unittest.mock import patch
import zipfile

import publish_release as release


class ReleaseSafetyTests(unittest.TestCase):
    def test_publish_retry_checks_all_attempts_and_accepts_latest_successful_platform_job(self):
        jobs = [{"id": 1, "name": "windows", "run_attempt": 1, "conclusion": "success"},
                {"id": 2, "name": "publish", "run_attempt": 2, "conclusion": "failure"},
                {"id": 3, "name": "windows", "run_attempt": 2, "conclusion": "success"}]
        with patch.object(release, "api", side_effect=[{"head_sha": "a" * 40}, {"jobs": jobs}]) as api:
            release.verify_run("owner/repo", 42, "a" * 40, "windows")
            self.assertIn("filter=all", api.call_args[0][1])

    def test_publish_retry_never_falls_back_to_an_older_success_after_a_failed_build(self):
        jobs = [{"id": 1, "name": "windows", "run_attempt": 1, "conclusion": "success"},
                {"id": 3, "name": "windows", "run_attempt": 2, "conclusion": "failure"}]
        with patch.object(release, "api", side_effect=[{"head_sha": "a" * 40}, {"jobs": jobs}]):
            with self.assertRaisesRegex(ValueError, "not successful"):
                release.verify_run("owner/repo", 42, "a" * 40, "windows")

    def test_publish_retry_rejects_a_different_frozen_commit(self):
        with patch.object(release, "api", return_value={"head_sha": "b" * 40}):
            with self.assertRaisesRegex(ValueError, "frozen release commit"):
                release.verify_run("owner/repo", 42, "a" * 40, "windows")

    def test_publish_retry_pages_past_other_jobs(self):
        first = [{"id": i, "name": "publish", "run_attempt": i, "conclusion": "failure"} for i in range(100)]
        last = [{"id": 101, "name": "linux", "run_attempt": 1, "conclusion": "success"}]
        with patch.object(release, "api", side_effect=[{"head_sha": "a" * 40}, {"jobs": first}, {"jobs": last}]) as api:
            release.verify_run("owner/repo", 42, "a" * 40, "linux")
            self.assertIn("page=2", api.call_args[0][1])

    def test_command_errors_include_the_actual_github_diagnostic(self):
        error = subprocess.CalledProcessError(1, ["gh"], stderr="permission denied")
        with patch.object(release.subprocess, "run", side_effect=error):
            with self.assertRaisesRegex(RuntimeError, "permission denied"):
                release.command("gh", "release", "create")

    def test_recovery_can_use_frozen_release_sources_with_current_publisher(self):
        with patch.object(release, "ROOT", self.root), patch.object(sys, "argv", ["publish_release.py", "publish",
                "--repo", "owner/repo", "--commit", "a" * 40, "--windows-run", "42", "--linux-run", "42",
                "--source-root", str(self.root / "frozen")]), patch.object(release, "publish") as publish:
            release.main()
            self.assertEqual(release.ROOT, (self.root / "frozen").resolve())
            publish.assert_called_once()

    def test_waits_for_draft_assets_and_published_state_with_a_bounded_retry(self):
        draft = {"draft": True, "assets": []}
        final = {"draft": False, "assets": [{"name": "app"}]}
        with patch.object(release, "release_info", side_effect=[None, draft, final]), patch.object(release.time, "sleep"):
            self.assertEqual(release.wait_release_info("owner/repo", "v0.1.0", published=True, asset_names=["app"]), final)
        with patch.object(release, "release_info", return_value=None) as lookup, patch.object(release.time, "sleep"):
            with self.assertRaisesRegex(ValueError, "preserved for retry"):
                release.wait_release_info("owner/repo", "v0.1.0")
            self.assertEqual(lookup.call_count, 10)

    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix="firecrackle-release-test-")
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)

    def source(self, cargo="0.1.0"):
        app = self.root / "FireCrackle"
        (app / "src-tauri").mkdir(parents=True)
        (app / "package.json").write_text('{"version":"0.1.0"}')
        (app / "src-tauri/tauri.conf.json").write_text('{"version":"0.1.0"}')
        (app / "src-tauri/Cargo.toml").write_text(f'[package]\nversion = "{cargo}"\n')

    def metadata(self, **changes):
        return {"version": "0.1.0", "commit": "a" * 40, "target": "windows-x64",
                "checksRun": True, "workingTreeDirty": False, **changes}

    def test_rejects_mismatched_versions_before_building(self):
        self.source(cargo="0.1.1")
        with self.assertRaisesRegex(ValueError, "versions must agree"):
            release.source_version(self.root)

    def test_tag_and_both_platforms_are_required_for_publication(self):
        self.source()
        with self.assertRaisesRegex(ValueError, "both platforms"):
            release.validate_plan("linux", True, "", self.root)
        with self.assertRaisesRegex(ValueError, "Tag must be"):
            release.validate_plan("all", True, "refs/tags/v9.9.9", self.root)
        self.assertEqual(release.validate_plan("all", True, "refs/tags/v0.1.0", self.root), "0.1.0")

    def test_rejects_dirty_skipped_or_different_commit_builds(self):
        for change in ({"workingTreeDirty": True}, {"checksRun": False}, {"commit": "b" * 40},
                       {"version": "0.1.1"}, {"target": "linux-x64"}):
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, "provenance"):
                release.verify_metadata(self.metadata(**change), "0.1.0", "a" * 40, "windows-x64")

    def test_rejects_checksum_tampering_and_path_escape(self):
        artifact = self.root / "app"
        artifact.write_bytes(b"verified")
        checksum = hashlib.sha256(artifact.read_bytes()).hexdigest()
        manifest = self.root / "SUMS"
        manifest.write_text(f"{checksum}  ./app\n")
        self.assertEqual(release.verify_checksums(self.root, "SUMS"), {"app"})
        artifact.write_bytes(b"modified")
        with self.assertRaisesRegex(ValueError, "Checksum mismatch"):
            release.verify_checksums(self.root, "SUMS")
        for name in ("../app", "C:\\app", "/app"):
            manifest.write_text(f"{checksum}  {name}\n")
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "Unsafe"):
                release.verify_checksums(self.root, "SUMS")

    def test_rejects_zip_path_escape_before_reading_metadata(self):
        archive = self.root / "app.zip"
        with zipfile.ZipFile(archive, "w") as package:
            package.writestr("FireCrackle-0.1.0-windows-x64/../project.json", "private")
        with self.assertRaisesRegex(ValueError, "Unsafe Windows ZIP"):
            release.verify_windows_archive(archive, "0.1.0", "a" * 40)

    def test_rejects_changed_uploaded_bytes(self):
        artifact = self.root / "app"
        artifact.write_bytes(b"verified")
        info = {"assets": [{"name": "app", "digest": "sha256:" + "0" * 64}]}
        with self.assertRaisesRegex(ValueError, "Server checksum mismatch"):
            release.verify_uploaded("owner/repo", "v0.1.0", [artifact], info, self.root)

    def test_accepts_lean_archive_but_rejects_bundled_tools(self):
        archive = self.root / "lean.zip"
        prefix = "FireCrackle-0.1.0-windows-x64/"
        with zipfile.ZipFile(archive, "w") as package:
            for name in ("FireCrackle.exe", "README.txt", "LICENSE.txt", "THIRD_PARTY_NOTICES.txt", "SHA256SUMS.txt"):
                package.writestr(prefix + name, "fixture")
            package.writestr(prefix + "release.json", json.dumps(self.metadata()))
        release.verify_windows_archive(archive, "0.1.0", "a" * 40)
        with zipfile.ZipFile(archive, "a") as package:
            package.writestr(prefix + "tools/ffmpeg.exe", "must download separately")
        with self.assertRaisesRegex(ValueError, "downloaded separately"):
            release.verify_windows_archive(archive, "0.1.0", "a" * 40)

    def test_rejects_any_on_demand_tool_or_separately_published_model_anywhere_in_the_archive(self):
        # 0.4.2-0.6.0 shipped the two quad-phase models in ai/ (330 MB instead of 26 MB): the tools/ check missed them
        prefix = "FireCrackle-0.1.0-windows-x64/"
        for packaged in ("ai/quad-phase-v1.onnx", "ai/quad-soul-phase-v1.onnx", "ffmpeg.exe", "ai/ffprobe.exe",
                         "yt-dlp.exe", "bin/deno.exe", "jolt.exe"):
            archive = self.root / f"bloated-{packaged.replace('/', '-')}.zip"
            with zipfile.ZipFile(archive, "w") as package:
                for name in ("FireCrackle.exe", "README.txt", "LICENSE.txt", "THIRD_PARTY_NOTICES.txt", "SHA256SUMS.txt",
                             "ai/onnxruntime.dll", "ai/DirectML.dll"):
                    package.writestr(prefix + name, "fixture")
                package.writestr(prefix + "release.json", json.dumps(self.metadata()))
                package.writestr(prefix + packaged, "must download separately")
            with self.assertRaisesRegex(ValueError, "downloaded separately", msg=packaged):
                release.verify_windows_archive(archive, "0.1.0", "a" * 40)

    def test_the_separately_downloaded_names_come_from_the_manifests(self):
        names = release.separately_downloaded_names()
        for name in ("ffmpeg.exe", "ffprobe.exe", "ffmpeg", "ffprobe", "yt-dlp.exe", "yt-dlp_linux", "deno.exe", "deno",
                     "jolt.exe", "jolt", "quad-phase-v1.onnx", "quad-soul-phase-v1.onnx"):
            self.assertIn(name, names)
        # what does ship is not on it
        for name in ("FireCrackle.exe", "onnxruntime.dll", "DirectML.dll", "no-fire-v3.onnx", "libonnxruntime.so"):
            self.assertNotIn(name, names)

    def test_every_asset_has_a_size_budget_and_an_asset_over_it_is_rejected(self):
        names = release.expected_asset_names("0.1.0")
        budgets = release.asset_budgets()
        self.assertEqual(set(budgets), set(names))
        small = self.root / names["windowsPortable"]
        with open(small, "wb") as f:
            f.truncate(20 * 1024 * 1024)
        release.verify_asset_sizes({"windowsPortable": small})
        big = self.root / names["windowsSetup"]
        with open(big, "wb") as f:
            f.truncate((budgets["windowsSetup"] + 1) * 1024 * 1024)
        with self.assertRaisesRegex(ValueError, r"FireCrackle-0\.1\.0-windows-x64-Setup\.exe.*budget"):
            release.verify_asset_sizes({"windowsSetup": big})

    def test_the_budgets_would_have_stopped_a_bundled_model(self):
        # 0.4.1 (no models) passes; 0.6.0 (both models bundled) does not, on every platform
        before = {"windowsSetup": 23, "windowsPortable": 26, "linuxAppImage": 356, "linuxDeb": 281}
        after = {"windowsSetup": 325, "windowsPortable": 330, "linuxAppImage": 659, "linuxDeb": 585}
        budgets = release.asset_budgets()
        for key in before:
            self.assertLess(before[key], budgets[key], key)
            self.assertGreater(after[key], budgets[key], key)

    def test_retained_build_directories_are_resolved_without_ambiguity(self):
        output = self.root / "v0.1.0" / "fresh-build"
        output.mkdir(parents=True)
        (output / "release-linux.json").write_text("{}")
        self.assertEqual(release.artifact_folder(self.root, "release-linux.json"), output)
        (self.root / "release-linux.json").write_text("{}")
        with self.assertRaisesRegex(ValueError, "Expected one"):
            release.artifact_folder(self.root, "release-linux.json")


if __name__ == "__main__":
    unittest.main()


class AssetNameContractTests(unittest.TestCase):
    """The app's update check looks for these file names (release/asset-names.json); the publisher must produce them."""

    def test_the_publisher_names_assets_as_the_app_expects(self):
        contract = json.loads((release.ROOT / "FireCrackle/release/asset-names.json").read_text(encoding="utf-8"))
        self.assertEqual(set(contract), {"windowsSetup", "windowsPortable", "linuxAppImage", "linuxDeb"})
        names = release.expected_asset_names("1.2.3")
        self.assertEqual(set(names), set(contract))
        for key, template in contract.items():
            self.assertIn("{version}", template)
            self.assertEqual(names[key], template.replace("{version}", "1.2.3"), key)

    def test_the_names_carry_the_version_and_no_path(self):
        for name in release.expected_asset_names("0.2.10").values():
            self.assertIn("0.2.10", name)
            self.assertNotIn("/", name)
            self.assertNotIn("\\", name)

    def test_verification_accepts_files_named_by_the_contract(self):
        names = release.expected_asset_names("0.2.3")
        self.assertEqual(names["windowsPortable"], "FireCrackle-0.2.3-windows-x64.zip")
        self.assertEqual(names["windowsSetup"], "FireCrackle-0.2.3-windows-x64-Setup.exe")
        self.assertEqual(names["linuxAppImage"], "FireCrackle-0.2.3-linux-x86_64.AppImage")
        self.assertEqual(names["linuxDeb"], "FireCrackle-0.2.3-linux-amd64.deb")
