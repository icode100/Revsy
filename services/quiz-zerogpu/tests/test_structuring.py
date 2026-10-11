import unittest

from quiz_parser.domain import InvalidImport, validate_draft
from quiz_zerogpu.structuring import prepare_sources, structure_draft, structure_mcqs


JOB_ID = "47f0efda-5988-4f7b-8b11-ab333191bd09"
PREFIX = f"users/alice/quiz-imports/{JOB_ID}/"
PAPER = """Sample exam
1. Find $x^2$ when $x=2$.
(A) $2$
(B) $4$
2. Select a shape.
[A] Triangle [B] Square [C] Circle [D] Line
"""
KEY = "1 B\n2 A"


def draft(paper=PAPER, key=KEY, assets=None, uid="alice"):
    return structure_draft(paper, key, uid=uid, job_id=JOB_ID, title="Math quiz",
                           paper_path=PREFIX + "paper.pdf",
                           key_path=PREFIX + "answer-key.pdf" if key is not None else None,
                           assets=assets or [])


def asset(asset_id="paper-p1-img1", uid="alice"):
    return {"id": asset_id, "storagePath": PREFIX.replace("alice", uid) + "assets/lease/" + asset_id + ".png", "page": 1}


class StructuringTests(unittest.TestCase):
    def test_numbered_and_inline_choices_preserve_math_order_and_keys(self):
        result = draft()
        self.assertEqual(result["question"][0]["problem"], "Find $x^2$ when $x=2$.")
        self.assertEqual(result["question"][0]["options"], ["$2$", "$4$"])
        self.assertEqual(result["question"][1]["options"], ["Triangle", "Square", "Circle", "Line"])
        self.assertEqual(result["key"], [{"questionId": "q1", "correctOptionIndex": 1},
                                         {"questionId": "q2", "correctOptionIndex": 0}])
        self.assertEqual(result["source"]["answerKeyPath"], PREFIX + "answer-key.pdf")

    def test_question_prefixes_and_markdown_option_labels(self):
        paper = "## **Question 1.** Which value?\n**(A)** first\n**(B)** second\nQ.2) Another value?\nA. left\nB. right"
        result = draft(paper)
        self.assertEqual([q["number"] for q in result["question"]], ["1", "2"])
        self.assertEqual(result["question"][0]["options"], ["first", "second"])

    def test_wrapped_numbers_and_bare_inline_choices(self):
        paper = "(1) First?\nA) yes  B) no\n[2] Second?\n(A) left (B) right"
        self.assertEqual(draft(paper)["question"][0]["options"], ["yes", "no"])

    def test_ocr_number_blocks_on_separate_lines_and_lowercase_choices(self):
        paper = "1\nFind $x^2$.\n(a) $2$\n(b) $4$\n2.\nChoose a value.\n[A] first [B] second"
        result = draft(paper)
        self.assertEqual([q["number"] for q in result["question"]], ["1", "2"])
        self.assertEqual(result["question"][0]["problem"], "Find $x^2$.")
        self.assertEqual(result["question"][0]["options"], ["$2$", "$4$"])

    def test_explicit_section_question_numbers_retain_coverage_and_evidence(self):
        paper = "Section A\nQ1. First?\n(A) one\n(B) two\nSection B\nQ2. Second?\n(A) yes\n(B) no"
        result = draft(paper, "Section A 1 B\nSection B 2 A")
        self.assertEqual([q["number"] for q in result["question"]], ["Section A 1", "Section B 2"])

    def test_math_labels_and_question_numbers_do_not_split_content(self):
        paper = """Q1. Use $f(A)=(A)+(B)$ and
$$
2. x = (A)+(B)
$$
and \\(g(A)=(A)\\).
(A) $\\frac{1}{2}$
(B) $\\sqrt{4}$
Q2. Pick one.
(A) one
(B) two
"""
        result = draft(paper)
        self.assertIn("2. x = (A)+(B)", result["question"][0]["problem"])
        self.assertEqual(result["question"][0]["options"], ["$\\frac{1}{2}$", "$\\sqrt{4}$"])

    def test_diagram_position_and_exact_ids_in_problem_and_options(self):
        paper = PAPER.replace("when $x=2$.", "when $x=2$. ![plot (A)](quiz-asset:paper-p1-img1)")
        paper = paper.replace("[A] Triangle", "[A] Triangle ![shape](quiz-asset:paper-p1-img10)")
        result = draft(paper, assets=[asset(), asset("paper-p1-img10")])
        self.assertEqual(result["question"][0]["images"], [asset()])
        self.assertEqual(result["question"][1]["images"], [asset("paper-p1-img10")])
        self.assertIn("![shape](quiz-asset:paper-p1-img10)", result["question"][1]["options"][0])

    def test_missing_unmatched_and_wrong_owner_diagrams_fail(self):
        with self.assertRaises(InvalidImport):
            draft(PAPER.replace("Find", "![plot](quiz-asset:paper-p1-img1) Find"))
        with self.assertRaises(InvalidImport):
            draft(assets=[asset()])
        with self.assertRaises(InvalidImport):
            draft(PAPER.replace("Find", "![plot](quiz-asset:paper-p1-img1) Find"), assets=[asset(uid="bob")])

    def test_embedded_key_isolated_and_key_diagram_never_in_draft(self):
        paper = PAPER.replace("Find", "![plot](quiz-asset:paper-p1-img1) Find")
        paper += "\n## Answer Key\n1 B\n2 A\n"
        # A key image remains storage source metadata but cannot enter quiz questions.
        paper += "![answer key table](quiz-asset:key-only)\n"
        result = draft(paper, None, [asset(), asset("key-only")])
        self.assertNotIn("key-only", str(result))
        # Image references supply no answers; the visible key rows remain required.
        prepared = prepare_sources(paper, None, [asset(), asset("key-only")])
        self.assertEqual(prepared.assets, [asset()])
        self.assertNotIn("answer key table", prepared.paper_text)
        self.assertEqual(draft(paper.replace("![answer key table](quiz-asset:key-only)\n", ""), None, [asset(), asset("key-only")])["question"][0]["images"], [asset()])

    def test_absent_empty_or_ambiguous_embedded_key_fails(self):
        for paper in (PAPER, PAPER + "\nAnswer Key\n", PAPER + "\nAnswer Key\n1 B\nAnswer Key\n2 A"):
            with self.assertRaises(InvalidImport):
                draft(paper, None)
        with self.assertRaises(InvalidImport):
            draft(key="")

    def test_html_column_key_keeps_original_cell_pairing(self):
        key = "<table><tr><th>Question</th><th>Answer</th></tr><tr><td>1</td><td>B</td></tr><tr><td>2</td><td>A</td></tr></table>"
        self.assertEqual(draft(key=key)["key"][0]["correctOptionIndex"], 1)
        prepared = prepare_sources(PAPER, key, [])
        raw = structure_mcqs(prepared.paper_text, prepared.key_text, prepared.assets)
        self.assertEqual(raw["key"][0]["sourceText"], "| 1 | B |")
        validate_draft(raw, uid="alice", job_id=JOB_ID, title="Quiz", paper_path=PREFIX + "paper.pdf",
                       key_path=PREFIX + "answer-key.pdf", assets=[], key_text=prepared.key_text,
                       model="test", warnings=[])

    def test_wide_key_rows_and_out_of_order_entries_preserve_pairing(self):
        key = "| Question | Answer | Question | Answer |\n|---|---|---|---|\n| 2 | A | 1 | B |"
        self.assertEqual(draft(key=key)["key"][0]["correctOptionIndex"], 1)
        self.assertEqual(draft(key="Q2:A, Q1:B")["key"][1]["correctOptionIndex"], 0)

    def test_missing_unknown_duplicate_conflicting_and_numeric_keys_fail(self):
        for key in ("1 B", "1 B\n2 A\n3 A", "1 B\n1 B\n2 A", "1 B\n1 A\n2 A", "Q11 B\n2 A", "1 2\n2 1", "1 C\n2 A"):
            with self.subTest(key=key), self.assertRaises(InvalidImport):
                draft(key=key)

    def test_transposed_key_or_prose_cannot_spoof_evidence(self):
        for key in ("| Question | 1 | 2 |\n| Answer | B | A |", "The answer might be 1 B\n2 A", "1 B and 2 A"):
            with self.subTest(key=key), self.assertRaises(InvalidImport):
                draft(key=key)

    def test_section_numbers_require_same_section_in_supplied_key(self):
        paper = "Section A\n1. First?\n(A) one\n(B) two\nSection B\n1. Second?\n(A) yes\n(B) no"
        result = draft(paper, "Section A 1 B\nSection B 1 A")
        self.assertEqual([q["number"] for q in result["question"]], ["Section A 1", "Section B 1"])
        for key in ("1 B\n1 A", "Section A\n1 B\nSection B\n1 A", "Section A 1 B\nSection C 1 A"):
            with self.subTest(key=key), self.assertRaises(InvalidImport):
                draft(paper, key)

    def test_duplicate_questions_and_missing_option_blocks_cannot_be_dropped(self):
        for paper in (PAPER.replace("2. Select", "1. Select"), PAPER + "\nQ3. Missing options.", PAPER.replace("[C] Circle", "[D] Circle")):
            with self.subTest(paper=paper), self.assertRaises(InvalidImport):
                draft(paper)

    def test_unnumbered_initial_mcq_and_shared_unassigned_diagram_fail(self):
        for prefix in ("Unnumbered question?\n(A) one\n(B) two\n", "![shared](quiz-asset:paper-p1-img1)\n"):
            with self.assertRaises(InvalidImport):
                draft(prefix + PAPER, assets=[asset()] if "quiz-asset:" in prefix else [])

    def test_page_metadata_removed_without_losing_multiline_options(self):
        paper = "--- Paper page 1 ---\nQ1. First?\n(A) first line\ncontinued $x^2$\n--- Paper page 2 ---\n(B) second line\nQ2. Next?\n(A) third\n(B) fourth"
        result = draft(paper)
        self.assertEqual(result["question"][0]["options"][0], "first line\ncontinued $x^2$")
        self.assertNotIn("Paper page", str(result["question"]))

    def test_ambiguous_bare_inline_labels_and_empty_options_fail(self):
        for paper in ("1. First? A. yes B. no\n2. Next?\n(A) one\n(B) two", PAPER.replace("(A) $2$", "(A)")):
            with self.assertRaises(InvalidImport):
                draft(paper)

    def test_option_max_and_question_max_fail_without_truncation(self):
        too_many_options = PAPER.replace("(B) $4$", "(B) $4$\n(C) 3\n(D) 4\n(E) 5\n(F) 6\n(G) 7\n(H) 8\n(I) 9")
        # I is outside A-H and must not silently become part of option H.
        with self.assertRaises(InvalidImport):
            draft(too_many_options)
        paper = "\n".join(f"{i}. Question?\n(A) yes\n(B) no" for i in range(1, 202))
        with self.assertRaises(InvalidImport):
            draft(paper, "\n".join(f"{i} A" for i in range(1, 202)))


if __name__ == "__main__":
    unittest.main()
