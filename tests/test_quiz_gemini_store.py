"""Offline checkpoint ownership, immutable writes and lease-loss checks."""

import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / ".test-deps"), str(ROOT / "services/quiz-parser"),
               str(ROOT / "services/quiz-gemini")]

from quiz_gemini.store import (GeminiStore, MAX_CHECKPOINT_BYTES, checkpoint_path,
                              decode_checkpoint)
from quiz_parser.domain import InvalidImport, LeaseLost

JOB_ID = "a6153d3d-a441-4cc5-9b5f-3aa380ff0088"
LEASE = "e7d42bcc-8cf5-4a3c-a65f-07a3bab2f303"
PREVIOUS_LEASE = "c84a6828-970f-4204-830d-1219db8fc699"
VALUE = {"schemaVersion": 1, "value": {"question": []},
         "usage": {"promptTokenCount": 123}, "model": "gemini-3.8-flash"}


def job():
    return {"uid": "owner", "id": JOB_ID, "leaseToken": LEASE}


def asset(name="question", uid="owner", import_id=JOB_ID, lease=LEASE):
    return f"users/{uid}/quiz-imports/{import_id}/assets/{lease}/{name}-extraction.json"


class Blob:
    def __init__(self, store, path, data=None):
        self.store, self.path, self.data = store, path, data
        self.size = len(data) if data is not None else None
        self.generation = 42
        self.reloads, self.downloads, self.uploads = [], [], []

    def reload(self, **kwargs):
        self.reloads.append(kwargs)

    def download_as_bytes(self, **kwargs):
        self.downloads.append(kwargs)
        return self.data

    def upload_from_string(self, data, **kwargs):
        self.store.events.append(("upload", self.path, kwargs))
        self.uploads.append((data, kwargs))
        if self.data is not None and kwargs.get("if_generation_match") == 0:
            raise RuntimeError("Object already exists")
        self.data, self.size = data, len(data)


class Bucket:
    def __init__(self, store):
        self.store, self.blobs, self.requests = store, {}, []

    def blob(self, path):
        self.requests.append(path)
        if path not in self.blobs:
            self.blobs[path] = Blob(self.store, path)
        return self.blobs[path]


class Store(GeminiStore):
    def __init__(self):
        # Do not initialize Firebase Admin or read Application Default Credentials.
        self.events, self.updates = [], []
        self.bucket = Bucket(self)
        self.fail_on_update = None

    def owned_update(self, job, fields):
        self.events.append(("update", dict(fields)))
        self.updates.append(dict(fields))
        if self.fail_on_update == len(self.updates):
            raise LeaseLost("The import lease changed")


class CheckpointPathTests(unittest.TestCase):
    def test_missing_checkpoint_is_normal_and_old_lease_checkpoint_remains_owned(self):
        data = job()
        self.assertIsNone(checkpoint_path(data, "question"))
        data["questionCheckpointPath"] = asset(lease=PREVIOUS_LEASE)
        self.assertEqual(checkpoint_path(data, "question"), asset(lease=PREVIOUS_LEASE))

    def test_other_owner_import_name_and_unexpected_directories_are_rejected(self):
        paths = [asset(uid="other"), asset(import_id=PREVIOUS_LEASE), asset(name="key"),
                 asset().replace("/assets/", "/assets/extra/"),
                 asset().replace("/question-extraction.json", "/extra/question-extraction.json"),
                 asset() + "?key=secret", asset().replace("/assets/", "\\assets\\"),
                 asset(lease=".."), asset(lease="not-a-lease"), asset(lease=LEASE.upper()),
                 asset(lease=LEASE.replace("-", "")), 123]
        for path in paths:
            with self.subTest(path=path), self.assertRaises(InvalidImport):
                checkpoint_path({**job(), "questionCheckpointPath": path}, "question")

    def test_only_known_extraction_names_are_supported(self):
        for name in ("../question", "answers", "", "Question"):
            with self.assertRaises(InvalidImport):
                checkpoint_path(job(), name)


class CheckpointEnvelopeTests(unittest.TestCase):
    def test_valid_json_roundtrip_preserves_usage_model_and_extracted_value(self):
        self.assertEqual(decode_checkpoint(json.dumps(VALUE).encode()), VALUE)

    def test_size_invalid_json_and_invalid_envelope_are_rejected(self):
        invalid = [b"x" * (MAX_CHECKPOINT_BYTES + 1), b"not-json", b"\xff",
                   json.dumps([]).encode(), b"{}"]
        for changes in ({"schemaVersion": 2}, {"value": []}, {"usage": []}, {"model": None}):
            invalid.append(json.dumps({**VALUE, **changes}).encode())
        for value in invalid:
            with self.subTest(value=value[:40]), self.assertRaises(InvalidImport):
                decode_checkpoint(value)


class CheckpointStoreTests(unittest.TestCase):
    def setUp(self):
        self.store, self.job = Store(), job()

    def test_missing_checkpoint_does_not_contact_bucket(self):
        self.assertIsNone(self.store.load_checkpoint(self.job, "question"))
        self.assertEqual(self.store.bucket.requests, [])

    def test_restoring_other_owner_checkpoint_fails_before_blob_lookup(self):
        self.job["questionCheckpointPath"] = asset(uid="other")
        with self.assertRaises(InvalidImport):
            self.store.load_checkpoint(self.job, "question")
        self.assertEqual(self.store.bucket.requests, [])

    def test_load_pins_the_blob_generation_and_bounds_metadata_before_download(self):
        self.job["questionCheckpointPath"] = asset(lease=PREVIOUS_LEASE)
        blob = Blob(self.store, asset(lease=PREVIOUS_LEASE), json.dumps(VALUE).encode())
        self.store.bucket.blobs[blob.path] = blob
        self.assertEqual(self.store.load_checkpoint(self.job, "question"), VALUE)
        self.assertEqual(blob.reloads, [{"timeout": 20}])
        self.assertEqual(blob.downloads, [{"timeout": 30, "if_generation_match": 42}])
        blob.size = MAX_CHECKPOINT_BYTES + 1
        with self.assertRaises(InvalidImport):
            self.store.load_checkpoint(self.job, "question")
        self.assertEqual(len(blob.downloads), 1)

    def test_save_renews_lease_then_immutably_uploads_then_publishes_pointer(self):
        self.store.save_checkpoint(self.job, "question", VALUE)
        path = asset()
        self.assertEqual([event[0] for event in self.store.events], ["update", "upload", "update"])
        self.assertEqual(self.store.updates, [{}, {"questionCheckpointPath": path}])
        blob = self.store.bucket.blobs[path]
        self.assertEqual(blob.uploads[0][1], {"content_type": "application/json", "timeout": 30,
                                            "if_generation_match": 0})
        self.assertEqual(json.loads(blob.data), VALUE)
        self.assertEqual(self.job["questionCheckpointPath"], path)

    def test_lost_lease_before_upload_never_writes_object(self):
        self.store.fail_on_update = 1
        with self.assertRaises(LeaseLost):
            self.store.save_checkpoint(self.job, "question", VALUE)
        self.assertEqual(self.store.bucket.requests, [])
        self.assertNotIn("questionCheckpointPath", self.job)

    def test_lost_lease_after_upload_does_not_publish_or_mutate_job_pointer(self):
        self.store.fail_on_update = 2
        with self.assertRaises(LeaseLost):
            self.store.save_checkpoint(self.job, "question", VALUE)
        self.assertIn(asset(), self.store.bucket.blobs)
        self.assertNotIn("questionCheckpointPath", self.job)

    def test_existing_checkpoint_object_cannot_be_overwritten(self):
        self.store.bucket.blobs[asset()] = Blob(self.store, asset(), b"original")
        with self.assertRaises(RuntimeError):
            self.store.save_checkpoint(self.job, "question", VALUE)
        self.assertEqual(self.store.bucket.blobs[asset()].data, b"original")
        self.assertEqual(self.store.updates, [{}])

    def test_bad_checkpoint_names_lease_ids_and_oversize_values_fail_before_storage(self):
        for name in ("../question", "unknown"):
            with self.assertRaises(InvalidImport):
                self.store.save_checkpoint(self.job, name, VALUE)
        self.job["leaseToken"] = "../another"
        with self.assertRaises(InvalidImport):
            self.store.save_checkpoint(self.job, "question", VALUE)
        self.job["leaseToken"] = LEASE
        with self.assertRaises(InvalidImport):
            self.store.save_checkpoint(self.job, "question", {**VALUE, "value": {"text": "x" * MAX_CHECKPOINT_BYTES}})
        self.assertEqual(self.store.events, [])
        self.assertEqual(self.store.bucket.requests, [])


if __name__ == "__main__":
    unittest.main()
