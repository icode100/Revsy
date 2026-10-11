import unittest

from quiz_parser.domain import InvalidImport
from quiz_parser.ocr_text import normalize_html_tables
from test_domain import example, validated


class OcrTableTests(unittest.TestCase):
    def test_column_key_table_keeps_rows_and_proves_answers(self):
        html = "<table><tr><th>Question</th><th>Answer</th></tr><tr><td>1</td><td>B</td></tr><tr><td>2</td><td>A</td></tr></table>"
        normalized = normalize_html_tables(html)
        self.assertIn("| Question | Answer |\n| 1 | B |\n| 2 | A |", normalized)
        self.assertEqual(validated(key_text=normalized)["key"][0]["correctOptionIndex"], 1)

    def test_transposed_header_does_not_become_numeric_answer_evidence(self):
        html = "<table><tr><td>Question</td><td>1</td><td>2</td></tr><tr><td>Answer</td><td>A</td><td>B</td></tr></table>\n2 | A"
        raw = example()
        raw["key"][0].update({"sourceText": "1 | 2", "answerLabel": "2"})
        with self.assertRaises(InvalidImport):
            validated(raw, key_text=normalize_html_tables(html))

    def test_cell_latex_and_rowspans_are_retained(self):
        html = "Before<table><tr><td rowspan='2'>Q1</td><td>$x^2$ &amp; $\\frac{1}{2}$</td></tr><tr><td>B</td></tr></table>After"
        result = normalize_html_tables(html)
        self.assertIn("| Q1 | $x^2$ & $\\frac{1}{2}$ |", result)
        self.assertIn("| Q1 | B |", result)
        self.assertTrue(result.startswith("Before"))
        self.assertTrue(result.endswith("After"))


if __name__ == "__main__":
    unittest.main()
