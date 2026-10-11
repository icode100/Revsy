from types import SimpleNamespace
import unittest

from fastapi.testclient import TestClient
from quiz_parser.api import create_app
from test_domain import JOB_ID, PREFIX


class FakeStore:
    def __init__(self):
        self.inspected, self.created = [], []

    def verify_token(self, token):
        if token != "valid-session":
            raise ValueError("private Firebase exception body")
        return "alice"

    def inspect_pdf(self, path):
        self.inspected.append(path)

    def create_job(self, uid, payload):
        self.created.append((uid, payload))
        return payload["id"]


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.store = FakeStore()
        self.client = TestClient(create_app(SimpleNamespace(origins=("https://revsy.example",)),
                                           self.store, run_worker=False))
        self.payload = {"id": JOB_ID, "title": "Math", "paperPath": PREFIX + "paper.pdf"}
        self.headers = {"Authorization": "Bearer valid-session"}

    def test_health_and_authenticated_intake(self):
        self.assertEqual(self.client.get("/health").json(), {"status": "ok"})
        response = self.client.post("/jobs", json=self.payload, headers=self.headers)
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json(), {"id": JOB_ID})
        self.assertEqual(self.store.created[0][0], "alice")

    def test_authentication_and_cross_owner_paths_precede_storage_access(self):
        self.assertEqual(self.client.post("/jobs", json=self.payload).status_code, 401)
        response = self.client.post("/jobs", json=self.payload, headers={"Authorization": "Bearer expired"})
        self.assertEqual(response.status_code, 401)
        self.assertNotIn("private", response.text)
        response = self.client.post("/jobs", json={**self.payload, "paperPath": self.payload["paperPath"].replace("alice", "bob")}, headers=self.headers)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.store.inspected, [])

    def test_request_size_and_cors_allowlist(self):
        self.assertEqual(self.client.post("/jobs", content="x" * 9000, headers=self.headers).status_code, 413)
        response = self.client.options("/jobs", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
        self.assertNotIn("access-control-allow-origin", response.headers)
        response = self.client.options("/jobs", headers={"Origin": "https://revsy.example", "Access-Control-Request-Method": "POST"})
        self.assertEqual(response.headers["access-control-allow-origin"], "https://revsy.example")


if __name__ == "__main__":
    unittest.main()
