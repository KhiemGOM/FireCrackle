import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
import zipfile

from catalogue_training_data import inspect_jsonl, inspect_manifest, line_count, npy_header, npz_headers


def array_header(shape, dtype="|u1", version=1):
    header = repr({"descr": dtype, "fortran_order": False, "shape": shape}).encode("latin1") + b"\n"
    return b"\x93NUMPY" + bytes([version, 0]) + struct.pack("<H" if version == 1 else "<I", len(header)) + header


class CatalogueTests(unittest.TestCase):
    def test_headers_do_not_need_tensor_payload_or_unpickle(self):
        self.assertEqual(npy_header(io.BytesIO(array_header((9, 64, 64, 3))))["shape"], [9, 64, 64, 3])
        self.assertEqual(npy_header(io.BytesIO(array_header((2,), "|O", 2)))["dtype"], "|O")
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "data.npz"
            with zipfile.ZipFile(path, "w") as z:
                z.writestr("x.npy", array_header((3, 64, 64, 3)))
                z.writestr("y.npy", array_header((3,), "<i8"))
            self.assertEqual(npz_headers(path)["y"]["shape"], [3])

    def test_unsupported_or_invalid_array_headers_fail(self):
        with self.assertRaises(ValueError):
            npy_header(io.BytesIO(b"broken"))
        with self.assertRaises(ValueError):
            npy_header(io.BytesIO(b"\x93NUMPY\x09\x00"))

    def test_optional_quad_schema_is_found_after_initial_empty_frames(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "labels.jsonl"
            rows = [{"f": i, "fires": []} for i in range(20)]
            rows.append({"f": 20, "fires": [{"src": "entity", "quads": [{"row": 4, "s": 1}]}]})
            path.write_text("\n".join(json.dumps(r) for r in rows), encoding="utf-8")
            data = inspect_jsonl(path, True)
            self.assertEqual(data["lines"], 21)
            self.assertIn("quads", json.dumps(data["observed_schemas"]))
            self.assertEqual(line_count(path), 21)

    def test_bare_selection_lists_keep_counts_splits_and_field_schema(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "selected.json"
            path.write_text(json.dumps([{"frame": 4, "split": "train", "video": "a"}, {"frame": 9, "split": "test", "video": "b"}]), encoding="utf-8")
            data = inspect_manifest(path)
            self.assertEqual(data["records_count"], 2)
            self.assertEqual(data["records_splits"], {"train": 1, "test": 1})
            self.assertEqual(data["records_schema"]["frame"], "int")


if __name__ == "__main__":
    unittest.main()
