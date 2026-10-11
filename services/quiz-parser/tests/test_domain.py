import copy
import unittest

from quiz_parser.domain import (
    InvalidImport, isolate_embedded_key, may_claim, owner_from_document_path,
    validate_draft, validate_explicit_question_coverage, validate_paths,
)

JOB_ID = "47f0efda-5988-4f7b-8b11-ab333191bd09"
PREFIX = f"users/alice/quiz-imports/{JOB_ID}/"


def example():
    return {"question": [
        {"id": "q1", "number": "1", "problem": "Find $x^2$.", "options": ["$1$", "$4$"], "imageIds": []},
        {"id": "q2", "number": "2", "problem": "Choose a value.", "options": ["A value", "Another value"], "imageIds": []},
    ], "key": [
        {"questionId": "q1", "correctOptionIndex": 1, "answerLabel": "B", "sourceText": "1 | B"},
        {"questionId": "q2", "correctOptionIndex": 0, "answerLabel": "A", "sourceText": "2 | A"},
    ]}


def validated(raw=None, assets=None, key_text="1 | B\n2 | A"):
    return validate_draft(raw or example(), uid="alice", job_id=JOB_ID, title="Math quiz",
                          paper_path=PREFIX + "paper.pdf", key_path=PREFIX + "answer-key.pdf",
                          assets=assets or [], key_text=key_text, model="test-model", warnings=[])


class DomainTests(unittest.TestCase):
    def test_grouping_preserves_math_option_order_and_key_mapping(self):
        draft = validated()
        self.assertEqual(draft["question"][0]["problem"], "Find $x^2$.")
        self.assertEqual(draft["question"][0]["options"], ["$1$", "$4$"])
        self.assertEqual(draft["key"][0], {"questionId": "q1", "correctOptionIndex": 1})
        self.assertNotIn("sourceText", draft["key"][0])

    def test_missing_key_never_produces_gradable_quiz(self):
        raw = example()
        raw["key"].pop()
        with self.assertRaisesRegex(InvalidImport, "every question"):
            validated(raw)

    def test_answer_without_verbatim_key_evidence_is_rejected(self):
        raw = example()
        raw["key"][0]["sourceText"] = "The answer must be B because of the equation."
        with self.assertRaises(InvalidImport):
            validated(raw)

    def test_wrong_question_evidence_is_rejected(self):
        raw = example()
        raw["key"][0]["sourceText"] = "2 | A"
        raw["key"][0]["answerLabel"] = "A"
        raw["key"][0]["correctOptionIndex"] = 0
        with self.assertRaisesRegex(InvalidImport, "original question number"):
            validated(raw)

    def test_q1_does_not_match_q11(self):
        raw = example()
        raw["key"][0]["sourceText"] = "Q11 B"
        with self.assertRaises(InvalidImport):
            validated(raw, key_text="Q11 B\n2 | A")

    def test_prefixed_key_labels_and_ambiguous_numeric_headers(self):
        raw = example()
        raw["key"][0]["sourceText"] = "Q1:B"
        self.assertEqual(validated(raw, key_text="Q1:B\n2 | A")["key"][0]["correctOptionIndex"], 1)
        raw["key"][0]["answerLabel"] = "2"
        raw["key"][0]["sourceText"] = "1 | 2"
        with self.assertRaises(InvalidImport):
            validated(raw, key_text="Question | 1 | 2\nAnswer | A | B\n2 | A")
        raw["key"][0]["sourceText"] = "Q1:2"
        self.assertEqual(validated(raw, key_text="Q1:2\n2 | A")["key"][0]["correctOptionIndex"], 1)

    def test_section_number_must_be_proved_by_key_quote(self):
        raw = example()
        raw["question"][0]["number"] = "Section A 1"
        with self.assertRaises(InvalidImport):
            validated(raw)
        raw["key"][0]["sourceText"] = "Section A 1 | B"
        self.assertEqual(validated(raw, key_text="Section A 1 | B\n2 | A")["key"][0]["correctOptionIndex"], 1)

    def test_conflicting_key_entries_are_rejected(self):
        with self.assertRaisesRegex(InvalidImport, "conflicting"):
            validated(key_text="1 | B\n1 | A\n2 | A")

    def test_wrong_label_index_and_boolean_index_are_rejected(self):
        for value in (0, True, -1, 9):
            raw = example()
            raw["key"][0]["correctOptionIndex"] = value
            with self.assertRaises(InvalidImport):
                validated(raw)

    def test_duplicate_unknown_keys_and_question_numbers_fail(self):
        for mutation in ("key", "number", "id"):
            raw = example()
            if mutation == "key":
                raw["key"][1]["questionId"] = "q1"
            else:
                raw["question"][1][mutation] = raw["question"][0][mutation]
            with self.assertRaises(InvalidImport):
                validated(raw)

    def test_diagram_references_are_preserved_at_owner_path(self):
        raw = example()
        raw["question"][0]["problem"] += " ![triangle](quiz-asset:paper-p1-img1)"
        asset = {"id": "paper-p1-img1", "page": 1, "storagePath": PREFIX + "assets/lease/image.png"}
        draft = validated(raw, [asset])
        self.assertEqual(draft["question"][0]["images"], [asset])
        with self.assertRaises(InvalidImport):
            validated(raw, [{**asset, "storagePath": asset["storagePath"].replace("alice", "bob")}])

    def test_missing_or_omitted_diagrams_fail(self):
        raw = example()
        raw["question"][0]["problem"] += " ![triangle](quiz-asset:missing)"
        with self.assertRaises(InvalidImport):
            validated(raw)
        asset = {"id": "unmatched", "page": 1, "storagePath": PREFIX + "assets/lease/image.png"}
        with self.assertRaisesRegex(InvalidImport, "matched"):
            validated(example(), [asset])

    def test_storage_paths_cannot_cross_owners_or_imports(self):
        validate_paths("alice", JOB_ID, PREFIX + "paper.pdf", PREFIX + "answer-key.pdf")
        for path in (PREFIX.replace("alice", "bob") + "paper.pdf", PREFIX + "../paper.pdf", "https://example.com/paper.pdf"):
            with self.assertRaises(InvalidImport):
                validate_paths("alice", JOB_ID, path, None)

    def test_document_path_is_validated_before_claim(self):
        self.assertEqual(owner_from_document_path(f"users/alice/quizImports/{JOB_ID}"), ("alice", JOB_ID))
        with self.assertRaises(InvalidImport):
            owner_from_document_path(f"organizations/alice/quizImports/{JOB_ID}")

    def test_embedded_key_is_isolated_from_question_options(self):
        paper, key = isolate_embedded_key("Q1. Example\n(A) first\n(B) second\n## Answer Key\n1 B")
        self.assertNotIn("first", key)
        self.assertEqual(key.strip(), "1 B")
        self.assertIn("(A)", paper)
        with self.assertRaises(InvalidImport):
            isolate_embedded_key("Q1. Example\n(A) first\n(B) second")
        with self.assertRaises(InvalidImport):
            isolate_embedded_key("Q1\nAnswer Key\n1 B\nAnswer Key\n2 A")

    def test_explicit_question_coverage_rejects_omission(self):
        with self.assertRaisesRegex(InvalidImport, "omitted"):
            validate_explicit_question_coverage("Question 1. First\nQ2. Second", [{"number": "1"}])
        validate_explicit_question_coverage("Question 1. First\nQ2. Second", [{"number": "1"}, {"number": "2"}])

    def test_queue_lease_recovery_and_retry_cap(self):
        self.assertTrue(may_claim({"status": "queued", "attempts": 0}, 100, 3))
        self.assertFalse(may_claim({"status": "reading-paper", "leaseUntil": 200}, 100, 3))
        self.assertTrue(may_claim({"status": "structuring", "leaseUntil": 99, "attempts": 1}, 100, 3))
        self.assertFalse(may_claim({"status": "structuring", "leaseUntil": 99, "attempts": 3}, 100, 3))
        self.assertFalse(may_claim({"status": "ready", "leaseUntil": 99}, 100, 3))


if __name__ == "__main__":
    unittest.main()
