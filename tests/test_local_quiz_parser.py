"""Local-runtime security guards and source-backed preview reconstruction."""

import base64
import importlib.util
import io
import json
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import patch
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]
if (ROOT / ".test-deps").is_dir():
    sys.path.insert(0, str(ROOT / ".test-deps"))
import httpx
from PIL import Image

SPEC = importlib.util.spec_from_file_location("run_local_quiz_parser", ROOT / "scripts" / "run_local_quiz_parser.py")
local = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(local)


def token(project="demo-revsy", *, algorithm="none", signature=""):
    def encoded(value):
        return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")
    return ".".join([encoded({"alg": algorithm}), encoded({"aud": project, "sub": "local-user",
                       "iss": "https://securetoken.google.com/" + project,
                       "exp": time.time() + 3600}), signature])


class LocalGuardTests(unittest.TestCase):
    def test_production_project_and_buckets_are_rejected(self):
        for project, bucket in [("revsy-c66e0", "revsy-c66e0.firebasestorage.app"),
                                ("demo-revsy", "revsy-c66e0.firebasestorage.app")]:
            with self.assertRaises(ValueError):
                local.local_settings(project, bucket)

    def test_missing_hf_token_has_safe_actionable_error(self):
        with self.assertRaisesRegex(ValueError, "server-only HF_TOKEN"):
            local.PreviewClient("")

    def test_nonloopback_emulator_hosts_are_rejected(self):
        for endpoint in ("firebase.googleapis.com:443", "127.0.0.1:8080/escape", "user@localhost:8080",
                         "localhost:8080?redirect=remote", "127.0.0.1"):
            with self.assertRaises(ValueError):
                local.emulator_origin(endpoint)
        self.assertEqual(local.emulator_origin("127.0.0.1:8080"), "http://127.0.0.1:8080")

    def test_firestore_values_roundtrip_quiz_and_attempt_data(self):
        value = {"correct": 2, "answers": [0, None], "title": "Quiz $x^2$", "question": [],
                 "source": {"paperPath": "users/local/paper.pdf"}, "enabled": True}
        self.assertEqual(local.decode_value(local.encode_value(value)), value)

    def test_production_token_rejected_before_emulator_network(self):
        calls = []
        client = httpx.Client(transport=httpx.MockTransport(lambda request: calls.append(request)))
        store = local.EmulatorStore(local.local_settings(), client=client)
        with self.assertRaises(local.InvalidImport):
            store.verify_token(token("revsy-c66e0", algorithm="RS256", signature="signed"))
        self.assertEqual(calls, [])
        client.close()

    def test_emulator_token_still_requires_real_local_account_lookup(self):
        requests = []
        def respond(request):
            requests.append(request)
            return httpx.Response(200, json={"users": [{"localId": "local-user"}]})
        client = httpx.Client(transport=httpx.MockTransport(respond))
        store = local.EmulatorStore(local.local_settings(), client=client)
        self.assertEqual(store.verify_token(token()), "local-user")
        self.assertEqual(requests[0].url.host, "127.0.0.1")
        self.assertIn("accounts:lookup", requests[0].url.path)
        client.close()

    def test_remote_archive_urls_and_path_traversal_rejected(self):
        bad = [{"path": "/tmp/a.zip", "url": "https://attacker.example/gradio_api/file=/tmp/a.zip"},
               {"path": "/tmp/../a.zip"}, {"path": "/etc/a.zip"}]
        for value in bad:
            with self.assertRaises(local.InvalidImport):
                local.artifact_url(value, local.DEFAULT_SPACE)
        self.assertEqual(local.artifact_url({"path": "/tmp/a.zip"}, local.DEFAULT_SPACE),
                         local.DEFAULT_SPACE + "/gradio_api/file=/tmp/a.zip")

    def test_sse_errors_do_not_expose_secret_bodies(self):
        response = type("Response", (), {"iter_lines": lambda self: iter(
            ['event: error', 'data: "hf_supersecret"', ''])})()
        with self.assertRaises(local.InvalidImport) as caught:
            local.read_complete_event(response)
        self.assertNotIn("hf_supersecret", str(caught.exception))

    def test_firestore_lease_updates_use_atomic_version_precondition(self):
        requests = []
        client = httpx.Client(transport=httpx.MockTransport(
            lambda request: (requests.append(request), httpx.Response(200, json={}))[1]))
        store = local.EmulatorStore(local.local_settings(), client=client)
        reference = "users/local-user/quizImports/" + str(uuid.uuid4())
        self.assertTrue(store._patch(reference, {"status": "ready"}, "version1",
                                     remove=("leaseToken", "leaseUntil")))
        write = json.loads(requests[0].content)["writes"][0]
        self.assertEqual(write["currentDocument"], {"updateTime": "version1"})
        self.assertEqual(write["updateMask"]["fieldPaths"], ["status", "leaseToken", "leaseUntil"])
        self.assertTrue(str(requests[0].url).startswith("http://127.0.0.1:8080/"))
        client.close()

    def test_expired_import_stops_after_repeated_interruptions(self):
        settings = local.local_settings()
        store = local.EmulatorStore(settings, client=httpx.Client(transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json={}))))
        job_id = str(uuid.uuid4())
        reference = "users/local-user/quizImports/" + job_id
        data = {"id": job_id, "ownerUid": "local-user", "status": "reading-paper", "leaseUntil": 1,
                "attempts": settings.max_attempts,
                "paperPath": f"users/local-user/quiz-imports/{job_id}/paper.pdf"}
        with patch.object(store, "_read", return_value=(data, "version")), patch.object(store, "_patch", return_value=True) as update:
            self.assertIsNone(store.claim(reference))
        self.assertEqual(update.call_args.args[1]["status"], "failed")
        self.assertEqual(update.call_args.kwargs["remove"], ("leaseToken", "leaseUntil"))
        store.close()


class PreviewImportTests(unittest.TestCase):
    def setUp(self):
        job_id = str(uuid.uuid4())
        self.job = {"uid": "local-user", "id": job_id, "leaseToken": str(uuid.uuid4()),
                    "paperPath": f"users/local-user/quiz-imports/{job_id}/paper.pdf", "title": "Local test"}
        self.paper = "Q1. Which shape is shown?\n![Diagram](quiz-asset:paper-p1-img1)\nA. Circle\nB. Triangle\nAnswer Key\n1 B"
        output = io.BytesIO()
        Image.new("RGB", (10, 10), "white").save(output, "PNG")
        self.png = output.getvalue()

    def archive(self, names):
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as archive:
            for name, data in names:
                archive.writestr(name, data)
        return output.getvalue()

    def fake_store(self):
        job = self.job
        class Store:
            def __init__(self):
                self.images, self.stages = [], []
            def owned_update(self, _job, values):
                self.stages.append(values["status"])
            def load_pdf(self, _path):
                return b"%PDF-local-fixture", {}
            def save_image(self, _job, asset_id, content, page):
                self.images.append(content)
                return {"id": asset_id, "page": page,
                        "storagePath": f"users/{job['uid']}/quiz-imports/{job['id']}/assets/{job['leaseToken']}/{asset_id}.png"}
        return Store()

    def test_preview_source_is_revalidated_with_local_owner_and_original_diagram(self):
        store = self.fake_store()
        outputs = [{"parsing": {"warnings": []}}, self.paper, "", {}, ""]
        archive = self.archive([("quiz.json", "{}"), ("diagrams/paper-p1-img1.png", self.png)])
        models = type("Models", (), {"parse": lambda _self, documents, title: (outputs, archive)})()
        with patch.object(local, "validate_batch"):
            draft = local.parse_local_job(store, models, self.job)
        self.assertEqual(draft["source"]["paperPath"], self.job["paperPath"])
        self.assertEqual(draft["key"][0]["correctOptionIndex"], 1)
        self.assertTrue(draft["question"][0]["images"][0]["storagePath"].startswith(
            "users/local-user/quiz-imports/"))
        self.assertEqual(len(store.images), 1)
        self.assertIn("validating", store.stages)

    def test_archive_traversal_is_never_extracted(self):
        store = self.fake_store()
        archive = self.archive([("../escape.png", self.png)])
        models = type("Models", (), {"parse": lambda _self, documents, title:
            ([{}, self.paper, "", {}, ""], archive)})()
        with patch.object(local, "validate_batch"), self.assertRaises(local.InvalidImport):
            local.parse_local_job(store, models, self.job)
        self.assertEqual(store.images, [])


if __name__ == "__main__":
    unittest.main()
