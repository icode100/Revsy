import copy
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from quiz_parser.domain import LeaseLost
from quiz_parser.firebase_store import FirebaseStore
from test_domain import JOB_ID, PREFIX


class Snapshot:
    exists = True

    def __init__(self, data):
        self.data = data

    def to_dict(self):
        return copy.deepcopy(self.data)


class Reference:
    path = f"users/alice/quizImports/{JOB_ID}"

    def __init__(self, data):
        self.data = data

    def get(self, transaction=None):
        return Snapshot(self.data)


class Transaction:
    def update(self, ref, fields):
        ref.data.update(fields)


def store():
    result = object.__new__(FirebaseStore)
    result.settings = SimpleNamespace(max_attempts=3, lease_seconds=180)
    result.db = SimpleNamespace(transaction=Transaction)
    result.transactional = lambda function: function
    return result


def initial():
    return {"id": JOB_ID, "ownerUid": "alice", "paperPath": PREFIX + "paper.pdf",
            "title": "Quiz", "status": "queued", "attempts": 0}


class QueueTests(unittest.TestCase):
    @patch("quiz_parser.firebase_store.now_ms", return_value=1000)
    def test_claim_rechecks_owner_and_does_not_claim_active_job(self, _):
        database = store()
        reference = Reference({**initial(), "ownerUid": "bob"})
        self.assertIsNone(database.claim(reference))
        self.assertEqual(reference.data["status"], "queued")
        reference = Reference({**initial(), "status": "structuring", "leaseUntil": 1001})
        self.assertIsNone(database.claim(reference))

    @patch("quiz_parser.firebase_store.now_ms", return_value=1000)
    def test_expired_job_gets_new_lease_and_old_worker_cannot_write(self, _):
        database = store()
        reference = Reference({**initial(), "status": "structuring", "leaseUntil": 999,
                               "leaseToken": "old", "attempts": 1})
        new_job = database.claim(reference)
        self.assertEqual(new_job["attempts"], 2)
        self.assertNotEqual(new_job["leaseToken"], "old")
        self.assertEqual(reference.data["leaseUntil"], 181000)
        old_job = {**new_job, "leaseToken": "old"}
        with self.assertRaises(LeaseLost):
            database.owned_update(old_job, {"status": "ready", "draft": {}})
        self.assertNotIn("draft", reference.data)
        database.owned_update(new_job, {"status": "structuring"})
        self.assertEqual(reference.data["status"], "structuring")

    @patch("quiz_parser.firebase_store.now_ms", return_value=1000)
    def test_owner_change_blocks_even_a_matching_lease(self, _):
        database = store()
        reference = Reference(initial())
        job = database.claim(reference)
        reference.data["ownerUid"] = "bob"
        with self.assertRaises(LeaseLost):
            database.owned_update(job, {"draft": {}})

    @patch("quiz_parser.firebase_store.now_ms", return_value=1000)
    def test_expired_lease_cannot_be_renewed_after_expiration(self, _):
        database = store()
        reference = Reference(initial())
        job = database.claim(reference)
        reference.data["leaseUntil"] = 999
        with self.assertRaises(LeaseLost):
            database.owned_update(job, {})


if __name__ == "__main__":
    unittest.main()
