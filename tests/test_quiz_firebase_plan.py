import copy
import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from quiz_firebase_plan import UnsafeMerge, merge_bucket_cors, merge_quiz_rules, merge_single_field_group_index


FIRESTORE = """rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // A comment with unmatched braces { }
    match /notes/{noteId} { allow read: if resource.data.title == '}'; }
  }
}
"""
SNIPPET = "match /users/{userId}/quizImports/{id} { allow read: if request.auth.uid == userId; }"


class FirebasePlanTests(unittest.TestCase):
    def test_additive_rule_merge_retains_old_source_and_is_idempotent(self):
        merged = merge_quiz_rules(FIRESTORE, SNIPPET, "firestore")
        self.assertIn("match /notes/{noteId} { allow read: if resource.data.title == '}'; }", merged)
        self.assertEqual(merged.count(SNIPPET), 1)
        self.assertEqual(merge_quiz_rules(merged, SNIPPET, "firestore"), merged)

    def test_root_variable_rename_only_affects_inserted_snippet(self):
        source = FIRESTORE.replace("{database}", "{db}")
        snippet = "match /users/{uid}/quizzes/{id} { allow read: if get(/databases/$(database)/documents/users/$(uid)).data != null; }"
        merged = merge_quiz_rules(source, snippet, "firestore")
        self.assertIn("/databases/$(db)/documents", merged)
        self.assertIn("match /databases/{db}/documents", merged)
        self.assertEqual(merge_quiz_rules(merged, snippet, "firestore"), merged)

    def test_broad_overlapping_grants_are_refused(self):
        for path in ("/{document=**}", "/users/{uid}/{document=**}", "/{collection}/{document=**}",
                     "/users/{uid}/{collection}/{document=**}"):
            source = FIRESTORE.replace("// A comment", f"match {path} {{ allow read, write: if true; }}\n    // A comment")
            with self.assertRaisesRegex(UnsafeMerge, "Recursive"):
                merge_quiz_rules(source, SNIPPET, "firestore")

    def test_unrelated_recursive_scope_is_preserved(self):
        source = FIRESTORE.replace("/notes/{noteId}", "/notes/{noteId}/{document=**}")
        self.assertIn("/notes/{noteId}/{document=**}", merge_quiz_rules(source, SNIPPET, "firestore"))

    def test_existing_quiz_paths_and_unknown_wrappers_are_refused(self):
        for source in (FIRESTORE.replace("/notes/{noteId}", "/users/{uid}/quizzes/{id}"),
                       FIRESTORE.replace("/documents", "/unknown"), "service cloud.firestore {"):
            with self.assertRaises(UnsafeMerge):
                merge_quiz_rules(source, SNIPPET, "firestore")

    def test_storage_merge_uses_bucket_wrapper(self):
        source = "service firebase.storage { match /b/{bucket}/o { match /notes/{id} { allow read: if true; } } }"
        snippet = "match /users/{uid}/quiz-imports/{id}/{file} { allow read: if request.auth.uid == uid; }\nmatch /users/{uid}/quiz-imports/{id}/assets/{path=**} { allow read: if request.auth.uid == uid; }"
        merged = merge_quiz_rules(source, snippet, "storage")
        self.assertIn("match /notes/{id}", merged)
        self.assertIn("BEGIN REVSY QUIZ RULES STORAGE", merged)
        self.assertEqual(merge_quiz_rules(merged, snippet, "storage"), merged)

    def test_cors_merge_keeps_existing_entries_and_does_not_mutate_input(self):
        existing = [{"origin": ["https://existing.example"], "method": ["GET", "PUT"], "maxAgeSeconds": 123}]
        before = copy.deepcopy(existing)
        merged = merge_bucket_cors(existing, "https://revsy.example")
        self.assertEqual(merged[0], before[0])
        self.assertEqual(existing, before)
        self.assertEqual(merge_bucket_cors(merged, "https://revsy.example"), merged)
        for origin in ("*", "https://revsy.example/path", "https://user:secret@revsy.example", "http://public.example"):
            with self.assertRaises(UnsafeMerge):
                merge_bucket_cors(existing, origin)

    def test_index_merge_keeps_effective_collection_and_array_indexes(self):
        field = {"name": "projects/demo/databases/(default)/collectionGroups/quizImports/fields/status",
                 "ttlConfig": {"state": "ACTIVE"},
                 "indexConfig": {"usesAncestorConfig": True, "indexes": [
                     {"queryScope": "COLLECTION", "fields": [{"fieldPath": "status", "order": "ASCENDING"}], "state": "READY"},
                     {"queryScope": "COLLECTION", "fields": [{"fieldPath": "status", "arrayConfig": "CONTAINS"}]}]}}
        before = copy.deepcopy(field)
        update = merge_single_field_group_index(field, "status")
        self.assertEqual(field, before)
        self.assertEqual(len(update["indexConfig"]["indexes"]), 3)
        self.assertNotIn("state", update["indexConfig"]["indexes"][0])
        self.assertNotIn("ttlConfig", update)
        self.assertEqual(merge_single_field_group_index(update, "status"), update)

    def test_index_merge_refuses_unfetched_ancestor_and_wrong_collection(self):
        for field in ({"name": "projects/demo/databases/(default)/collectionGroups/quizImports/fields/status", "indexConfig": {"usesAncestorConfig": True}},
                      {"name": "projects/demo/databases/(default)/collectionGroups/notes/fields/status", "indexConfig": {"indexes": []}}):
            with self.assertRaises(UnsafeMerge):
                merge_single_field_group_index(field, "status")


if __name__ == "__main__":
    unittest.main()
