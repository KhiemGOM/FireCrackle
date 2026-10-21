"""The bundled FFmpeg pin must stay the Gyan FULL build (libdav1d), and every consumer must follow the lock's archive kind.

The essentials build has no libdav1d, so AV1 falls back to libaom and roughly halves decode speed.
"""
import json
import re
import unittest
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
LOCK = PROJECT / "release" / "runtime-lock.json"
KINDS = {"zip": ".zip", "7z": ".7z"}


def lock_problems(lock):
    problems = []
    url = str(lock.get("url", ""))
    kind = lock.get("kind")
    if "essentials" in url.lower():
        problems.append("pins the essentials build, which has no libdav1d")
    if "full_build" not in url:
        problems.append("does not pin a full_build package")
    if kind not in KINDS:
        problems.append(f"unknown archive kind {kind!r}")
    elif not url.endswith(KINDS[kind]):
        problems.append(f"kind {kind!r} does not match the url extension")
    if not re.fullmatch(r"[0-9a-f]{64}", str(lock.get("sha256", ""))):
        problems.append("sha256 is not 64 lowercase hex characters")
    version = str(lock.get("version", ""))
    if not version or f"ffmpeg-{version}-" not in url:
        problems.append("version does not appear in the url")
    if not url.startswith("https://"):
        problems.append("url is not https")
    return problems


def good():
    return json.loads(LOCK.read_text(encoding="utf-8"))


class RuntimeLockTests(unittest.TestCase):
    def test_the_pinned_lock_is_the_full_build(self):
        self.assertEqual([], lock_problems(good()))

    def test_essentials_is_rejected(self):
        lock = good()
        lock["url"] = "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip"
        lock["kind"] = "zip"
        self.assertTrue(any("essentials" in p for p in lock_problems(lock)))

    def test_kind_and_extension_must_agree(self):
        lock = good()
        lock["kind"] = "zip" if lock["kind"] == "7z" else "7z"
        self.assertTrue(any("extension" in p for p in lock_problems(lock)))

    def test_missing_kind_or_bad_hash_is_rejected(self):
        lock = good()
        del lock["kind"]
        self.assertTrue(lock_problems(lock))
        lock = good()
        lock["sha256"] = lock["sha256"].upper()
        self.assertTrue(lock_problems(lock))

    def test_stale_version_in_url_is_rejected(self):
        lock = good()
        lock["version"] = "0.0.0"
        self.assertTrue(any("version" in p for p in lock_problems(lock)))

    def test_consumers_follow_the_lock(self):
        script = (PROJECT / "scripts" / "prepare-runtime.ps1").read_text(encoding="utf-8")
        self.assertIn("$lock.kind", script)
        rust = (PROJECT / "src-tauri" / "src" / "external_tools.rs").read_text(encoding="utf-8")
        self.assertIn("lock.kind", rust)
        self.assertIn("has_dav1d", rust)
        self.assertNotIn('kind: "zip".into(),\n        };\n        let dir = install("ffmpeg"', rust)


if __name__ == "__main__":
    unittest.main()
