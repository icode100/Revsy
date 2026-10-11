"""Offline intake, task identity and request-bound recovery tests."""

import json
from pathlib import Path
import sys
from types import ModuleType
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / ".test-deps"), str(ROOT / "services/quiz-parser"),
               str(ROOT / "services/quiz-gemini")]

from fastapi.testclient import TestClient
from quiz_gemini import app as runtime
from quiz_parser.domain import InvalidImport
from quiz_parser.settings import Settings

JOB_ID = "a6153d3d-a441-4cc5-9b5f-3aa380ff0088"
QUEUE = "projects/revsy-test/locations/us-central1/queues/revsy-quiz-imports"
IDENTITY = "revsy-quiz-tasks@revsy-test.iam.gserviceaccount.com"
AUDIENCE = "https://revsy-quiz-parser-123456789012.us-central1.run.app"


class Snapshot:
    def __init__(self, data):
        self.exists, self.data = data is not None, data

    def to_dict(self):
        return dict(self.data) if self.data is not None else None


class Node:
    def __init__(self, store, parts=()):
        self.store, self.parts = store, parts

    def collection(self, name):
        return Node(self.store, (*self.parts, name))

    def document(self, name):
        return Node(self.store, (*self.parts, name))

    @property
    def path(self):
        return "/".join(self.parts)

    def get(self):
        return Snapshot(self.store.documents.get(self.path))


class Store:
    def __init__(self):
        self.settings = Settings(bucket="demo-revsy.appspot.com", project_id="demo-revsy",
            paddle_url=AUDIENCE, hf_token="", structuring_model="Gemini",
            origins=("http://127.0.0.1:5173",))
        self.db = Node(self)
        self.documents, self.claims, self.events = {}, [], []
        self.claim_enabled = True

    def verify_token(self, value):
        if value != "firebase-test-token":
            raise InvalidImport("Invalid token")
        return "owner"

    def inspect_pdf(self, path):
        self.events.append(("inspect", path))

    def create_job(self, uid, payload):
        path = f"users/{uid}/quizImports/{payload['id']}"
        if path not in self.documents:
            self.documents[path] = {**payload, "ownerUid": uid, "status": "queued"}
        self.events.append(("create", path))
        return payload["id"]

    def claim(self, reference):
        self.claims.append(reference.path)
        data = self.documents.get(reference.path)
        if not self.claim_enabled or not data or data["status"] in {"ready", "failed"}:
            return None
        data["status"] = "reading-paper"
        return {**data, "uid": reference.parts[1], "reference": reference}


class Models:
    def __init__(self):
        self.closed = 0
        self.summaries = []

    def summarize(self, text):
        self.summaries.append(text)
        return "A concise problem statement and its constraints."

    def close(self):
        self.closed += 1


class Worker:
    def __init__(self, store, models):
        self.store, self.models = store, models
        self.started, self.stopped, self.calls = 0, 0, []
        self.final_status = "ready"

    def start(self):
        self.started += 1

    def stop(self):
        self.stopped += 1

    def process(self, job):
        self.calls.append(job)
        if self.final_status:
            self.store.documents[job["reference"].path]["status"] = self.final_status


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.store, self.models = Store(), Models()
        self.worker = Worker(self.store, self.models)
        self.patch = patch.object(runtime, "GeminiWorker", return_value=self.worker)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.claims = {"email": IDENTITY, "email_verified": True, "aud": AUDIENCE,
                       "iss": "https://accounts.google.com"}
        self.verifications = []

    def verifier(self, token, audience):
        self.verifications.append((token, audience))
        if token != "google-task-token":
            raise ValueError("Invalid signature")
        return self.claims

    def client(self, **kwargs):
        app = runtime.build_app(self.store.settings, self.store, self.models,
            task_identity=IDENTITY, task_audience=AUDIENCE, token_verifier=self.verifier, **kwargs)
        return TestClient(app)

    def payload(self):
        return {"id": JOB_ID, "title": "GATE test",
                "paperPath": f"users/owner/quiz-imports/{JOB_ID}/paper.pdf"}

    def seed_job(self, status="queued"):
        self.store.documents[f"users/owner/quizImports/{JOB_ID}"] = {
            **self.payload(), "ownerUid": "owner", "status": status}

    def process(self, client, **kwargs):
        return client.post("/internal/process", json={"uid": "owner", "id": JOB_ID},
                           headers={"Authorization": "Bearer google-task-token"}, **kwargs)

    def test_api_aliases_preserve_intake_authentication(self):
        with self.client() as client:
            for path in ("/jobs", "/api/jobs"):
                self.assertEqual(client.post(path, json=self.payload()).status_code, 401)
            for path in ("/health", "/api/health"):
                self.assertEqual(client.get(path).json(), {"status": "ok"})
        self.assertEqual(self.store.events, [])

    def test_note_summary_requires_valid_firebase_user_before_inference(self):
        with self.client() as client:
            for headers in ({}, {"Authorization": "Bearer expired-token"},
                            {"Authorization": "Bearer google-task-token"}):
                response = client.post("/api/notes/summarize", json={"text": "Find a pair."}, headers=headers)
                self.assertEqual(response.status_code, 401)
        self.assertEqual(self.models.summaries, [])
        self.assertEqual(self.store.events, [])

    def test_note_summary_preserves_return_shape_and_supports_hosting_and_local_routes(self):
        with self.client() as client:
            for path in ("/api/notes/summarize", "/notes/summarize"):
                response = client.post(path, json={"text": "Find a pair. n <= 1000."},
                    headers={"Authorization": "Bearer firebase-test-token"})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), {"summary": "A concise problem statement and its constraints."})
        self.assertEqual(self.models.summaries, ["Find a pair. n <= 1000."] * 2)
        self.assertEqual(self.worker.calls, [])
        self.assertEqual(self.store.documents, {})

    def test_invalid_summary_input_is_rejected_before_inference(self):
        headers = {"Authorization": "Bearer firebase-test-token"}
        with self.client() as client:
            for payload in ({"text": ""}, {"text": "  \n"}, {"text": "a" * 6001},
                            {"text": 123}, {"text": "Valid", "extra": True}, {}):
                self.assertEqual(client.post("/api/notes/summarize", json=payload, headers=headers).status_code, 422)
            self.assertEqual(client.post("/api/notes/summarize", content=b"x" * 8193, headers=headers).status_code, 413)
        self.assertEqual(self.models.summaries, [])

    def test_summary_provider_errors_and_invalid_results_do_not_expose_private_details(self):
        headers = {"Authorization": "Bearer firebase-test-token"}
        with self.client() as client:
            for value in (None, "", "x" * 20001):
                with patch.object(self.models, "summarize", return_value=value):
                    response = client.post("/api/notes/summarize", json={"text": "Find a pair."}, headers=headers)
                    self.assertEqual(response.status_code, 503)
            with patch.object(self.models, "summarize", side_effect=RuntimeError("private-api-key-detail")) as model:
                response = client.post("/api/notes/summarize", json={"text": "Find a pair."}, headers=headers)
                self.assertEqual(response.status_code, 503)
                self.assertNotIn("private-api-key-detail", response.text)
                self.assertEqual(model.call_count, 1)

    def test_enqueue_occurs_after_immutable_job_creation(self):
        calls = []
        def enqueue(uid, payload):
            calls.append((uid, payload, dict(self.store.documents)))
        with self.client(enqueuer=enqueue) as client:
            response = client.post("/api/jobs", json=self.payload(),
                headers={"Authorization": "Bearer firebase-test-token"})
        self.assertEqual(response.status_code, 202)
        self.assertIn(f"users/owner/quizImports/{JOB_ID}", calls[0][2])
        self.assertEqual(calls[0][0], "owner")

    def test_queue_failure_is_retryable_without_replacing_import(self):
        failures = [True, False]
        def enqueue(uid, payload):
            if failures.pop(0):
                raise RuntimeError("secret-provider-detail")
        with self.client(enqueuer=enqueue) as client:
            headers = {"Authorization": "Bearer firebase-test-token"}
            first = client.post("/api/jobs", json=self.payload(), headers=headers)
            self.assertEqual(first.status_code, 503)
            self.assertNotIn("secret-provider-detail", first.text)
            original = self.store.documents[f"users/owner/quizImports/{JOB_ID}"]
            second = client.post("/api/jobs", json=self.payload(), headers=headers)
            self.assertEqual(second.status_code, 202)
            self.assertIs(self.store.documents[f"users/owner/quizImports/{JOB_ID}"], original)
            self.assertEqual(original["status"], "queued")

    def test_cross_owner_pdf_is_rejected_before_store_or_enqueue(self):
        calls = []
        value = self.payload()
        value["paperPath"] = value["paperPath"].replace("users/owner/", "users/other/")
        with self.client(enqueuer=lambda *args: calls.append(args)) as client:
            response = client.post("/api/jobs", json=value,
                headers={"Authorization": "Bearer firebase-test-token"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.store.events, [])
        self.assertEqual(calls, [])

    def test_spoofed_task_headers_and_firebase_tokens_cannot_authenticate_handler(self):
        self.seed_job()
        with self.client() as client:
            for headers in ({"X-CloudTasks-TaskName": "trusted-looking"},
                            {"Authorization": "Bearer firebase-test-token"}):
                response = client.post("/internal/process", json={"uid": "owner", "id": JOB_ID}, headers=headers)
                self.assertEqual(response.status_code, 401)
        self.assertEqual(self.store.claims, [])

    def test_oidc_requires_exact_email_verified_audience_and_google_issuer(self):
        variants = [{"email": "other@revsy-test.iam.gserviceaccount.com"},
                    {"email_verified": False}, {"email_verified": "true"},
                    {"aud": "https://other.run.app"}, {"iss": "https://attacker.example"}]
        self.seed_job()
        with self.client() as client:
            original = dict(self.claims)
            for changes in variants:
                self.claims = {**original, **changes}
                self.assertEqual(self.process(client).status_code, 401)
        self.assertEqual(self.store.claims, [])

    def test_valid_oidc_processes_exact_import_once_and_acks_duplicate(self):
        self.seed_job()
        with self.client() as client:
            self.assertEqual(self.process(client).json(), {"status": "processed"})
            self.assertEqual(self.process(client).json(), {"status": "already-processed"})
        self.assertEqual(len(self.worker.calls), 1)
        self.assertEqual(self.store.claims, [f"users/owner/quizImports/{JOB_ID}"] * 2)
        self.assertEqual(self.verifications, [("google-task-token", AUDIENCE)] * 2)

    def test_active_lease_and_unpersisted_worker_result_retain_task(self):
        self.seed_job()
        with self.client() as client:
            self.store.claim_enabled = False
            self.assertEqual(self.process(client).status_code, 503)
            self.store.claim_enabled = True
            self.worker.final_status = None
            self.assertEqual(self.process(client).status_code, 503)
        self.assertEqual(self.store.documents[f"users/owner/quizImports/{JOB_ID}"]["status"], "reading-paper")

    def test_persisted_failure_and_missing_import_ack_without_repeated_inference(self):
        with self.client() as client:
            self.assertEqual(self.process(client).json(), {"status": "missing"})
            self.seed_job()
            self.worker.final_status = "failed"
            self.assertEqual(self.process(client).json(), {"status": "processed"})
            self.assertEqual(self.process(client).json(), {"status": "already-processed"})
        self.assertEqual(len(self.worker.calls), 1)

    def test_task_owner_uuid_and_body_are_bounded_before_claim(self):
        with self.client() as client:
            headers = {"Authorization": "Bearer google-task-token"}
            for payload in ({"uid": "../other", "id": JOB_ID},
                            {"uid": "owner", "id": "x" * 36}):
                self.assertEqual(client.post("/internal/process", json=payload, headers=headers).status_code, 400)
            self.assertEqual(client.post("/internal/process", json={"uid": "x" * 129, "id": JOB_ID}, headers=headers).status_code, 422)
            self.assertEqual(client.post("/internal/process", content=b"x" * 8193, headers=headers).status_code, 413)
        self.assertEqual(self.store.claims, [])

    def test_production_has_no_background_poller_and_closes_provider(self):
        with self.client():
            self.assertEqual(self.worker.started, 0)
        self.assertEqual(self.worker.stopped, 0)
        self.assertEqual(self.models.closed, 1)

    def test_local_worker_starts_and_stops_but_task_handler_stays_disabled(self):
        with self.client(local_worker=True) as client:
            self.assertEqual(self.worker.started, 1)
            self.assertEqual(self.process(client).status_code, 401)
        self.assertEqual(self.worker.stopped, 1)


class TaskEnqueuerTests(unittest.TestCase):
    def setUp(self):
        # Cloud SDK is not needed for offline contract tests. The enqueuer's
        # injected client records the exact Google request shape; tiny import
        # shims supply only the typed duration/AlreadyExists boundary.
        self.AlreadyExists = type("AlreadyExists", (Exception,), {})
        exceptions = ModuleType("google.api_core.exceptions")
        exceptions.AlreadyExists = self.AlreadyExists
        duration = ModuleType("google.protobuf.duration_pb2")
        duration.Duration = lambda *, seconds: type("Duration", (), {"seconds": seconds})()
        self.patch = patch.dict(sys.modules, {exceptions.__name__: exceptions, duration.__name__: duration})
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def client(self, error=None):
        calls = []
        class Client:
            def create_task(self, **kwargs):
                calls.append(kwargs)
                if error:
                    raise error
        return Client(), calls

    def test_exact_callback_oidc_deadline_and_owner_specific_deterministic_name(self):
        client, calls = self.client()
        enqueuer = runtime.TaskEnqueuer(QUEUE, IDENTITY, AUDIENCE, client=client)
        enqueuer("owner", {"id": JOB_ID})
        enqueuer("owner", {"id": JOB_ID})
        enqueuer("other-owner", {"id": JOB_ID})
        first = calls[0]
        self.assertEqual(first["parent"], QUEUE)
        self.assertEqual(first["timeout"], 15)
        task = first["task"]
        self.assertEqual(task["dispatch_deadline"].seconds, 1800)
        http = task["http_request"]
        self.assertEqual(http["url"], AUDIENCE + "/internal/process")
        self.assertEqual(http["oidc_token"], {"service_account_email": IDENTITY, "audience": AUDIENCE})
        self.assertEqual(json.loads(http["body"]), {"uid": "owner", "id": JOB_ID})
        self.assertEqual(task["name"], calls[1]["task"]["name"])
        self.assertNotEqual(task["name"], calls[2]["task"]["name"])

    def test_already_exists_is_idempotent_other_queue_errors_propagate(self):
        client, calls = self.client(self.AlreadyExists("existing"))
        runtime.TaskEnqueuer(QUEUE, IDENTITY, AUDIENCE, client=client)("owner", {"id": JOB_ID})
        self.assertEqual(len(calls), 1)
        client, _ = self.client(RuntimeError("unavailable"))
        with self.assertRaises(RuntimeError):
            runtime.TaskEnqueuer(QUEUE, IDENTITY, AUDIENCE, client=client)("owner", {"id": JOB_ID})

    def test_queue_project_identity_origin_and_job_id_are_validated(self):
        client, calls = self.client()
        for queue, identity, audience in (("not-a-resource", IDENTITY, AUDIENCE),
            (QUEUE, "tasks@another-project.iam.gserviceaccount.com", AUDIENCE),
            (QUEUE, IDENTITY, "https://example.com/internal/process")):
            with self.assertRaises(ValueError):
                runtime.TaskEnqueuer(queue, identity, audience, client=client)
        with self.assertRaises(InvalidImport):
            runtime.TaskEnqueuer(QUEUE, IDENTITY, AUDIENCE, client=client)("owner", {"id": "bad"})
        self.assertEqual(calls, [])

    def test_docker_uses_google_factory_not_legacy_imported_factory(self):
        dockerfile = (ROOT / "services/quiz-gemini/Dockerfile").read_text()
        self.assertIn("quiz_gemini.app:create_application --factory", dockerfile)
        self.assertNotIn("quiz_gemini.app:create_app --factory", dockerfile)


if __name__ == "__main__":
    unittest.main()
