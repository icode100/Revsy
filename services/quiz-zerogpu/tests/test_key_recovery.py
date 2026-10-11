import io
from unittest.mock import Mock, patch
import unittest

from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject

from quiz_parser.domain import InvalidImport
from quiz_zerogpu.key_recovery import (
    MAX_PAGE_CHARACTERS, RECOVERY_WARNING, native_key_text, structure_with_key_recovery,
)
from quiz_zerogpu.structuring import structure_draft


JOB_ID = "47f0efda-5988-4f7b-8b11-ab333191bd09"
PREFIX = f"users/alice/quiz-imports/{JOB_ID}/"
PAPER = "1. Find $x^2$ for $x=2$.\n(A) $2$\n(B) $4$\n2. Pick a shape.\n(A) line\n(B) square\n(C) circle"
OPTIONS = {"uid": "alice", "job_id": JOB_ID, "title": "Recovered key",
           "paper_path": PREFIX + "paper.pdf", "key_path": PREFIX + "answer-key.pdf", "assets": []}


def pdf(lines=None, page_count=1):
    writer, output = PdfWriter(), io.BytesIO()
    for _ in range(page_count):
        page = writer.add_blank_page(width=300, height=300)
        if lines is not None:
            font = DictionaryObject({NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})
            page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"):
                DictionaryObject({NameObject("/F1"): writer._add_object(font)})})
            commands = ["BT /F1 14 Tf 30 260 Td"]
            for index, line in enumerate(lines):
                if index:
                    commands.append("0 -24 Td")
                safe = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
                commands.append(f"({safe}) Tj")
            commands.append("ET")
            stream = DecodedStreamObject()
            stream.set_data("\n".join(commands).encode("ascii"))
            page[NameObject("/Contents")] = writer._add_object(stream)
    writer.write(output)
    return output.getvalue()


def fake_document(character_count, text="1 B\n2 C", page_count=1):
    text_page = Mock()
    text_page.count_chars.return_value = character_count
    text_page.get_text_range.return_value = text
    page = Mock()
    page.get_textpage.return_value = text_page
    document = Mock()
    document.__len__ = Mock(return_value=page_count)
    document.__getitem__ = Mock(return_value=page)
    return document, page, text_page


class KeyRecoveryTests(unittest.TestCase):
    def test_real_digital_14_point_key_recovers_both_missing_ocr_rows(self):
        data = pdf(["Answer Key", "1 B", "2 C"])
        text = native_key_text(data)
        self.assertIn("1 B", text)
        self.assertIn("2 C", text)
        result = structure_with_key_recovery(PAPER, "Answer Key", key_data=data, **OPTIONS)
        self.assertEqual(result["key"], [{"questionId": "q1", "correctOptionIndex": 1},
                                         {"questionId": "q2", "correctOptionIndex": 2}])
        self.assertIn(RECOVERY_WARNING, result["parsing"]["warnings"])
        self.assertEqual(result["source"]["answerKeyPath"], PREFIX + "answer-key.pdf")

    def test_valid_ocr_key_does_not_read_or_override_native_pdf_text(self):
        with patch("quiz_zerogpu.key_recovery.native_key_text", side_effect=AssertionError("Must not extract")):
            result = structure_with_key_recovery(PAPER, "1 B\n2 C", key_data=pdf(["1 A", "2 A"]), **OPTIONS)
        self.assertNotIn(RECOVERY_WARNING, result["parsing"]["warnings"])
        self.assertEqual(result["key"][0]["correctOptionIndex"], 1)

    def test_missing_scanned_corrupt_or_incomplete_native_key_keeps_original_error(self):
        with self.assertRaises(InvalidImport) as original:
            structure_draft(PAPER, "Answer Key", **OPTIONS)
        for data in (None, pdf(), b"not a PDF", pdf(["1 B"]), pdf(["1 B", "2 C", "1 A"]), pdf(["11 B", "2 C"]), pdf(["1 C", "2 B"])):
            with self.subTest(data=data is None), self.assertRaises(InvalidImport) as raised:
                structure_with_key_recovery(PAPER, "Answer Key", key_data=data, **OPTIONS)
            self.assertEqual(str(raised.exception), str(original.exception))

    def test_native_answers_remain_bound_to_question_numbers_and_preserve_math_diagram(self):
        image = {"id": "paper-p1-img1", "page": 1, "storagePath": PREFIX + "assets/lease/plot.png"}
        paper = PAPER.replace("Find", "![plot](quiz-asset:paper-p1-img1) Find")
        warnings = ["Original diagram preserved."]
        result = structure_with_key_recovery(paper, "Answer Key", key_data=pdf(["Answer Key", "2 C", "1 B"]),
                                             **{**OPTIONS, "assets": [image], "warnings": warnings})
        self.assertEqual(result["question"][0]["images"], [image])
        self.assertEqual(result["question"][0]["options"], ["$2$", "$4$"])
        self.assertIn("$x^2$", result["question"][0]["problem"])
        self.assertEqual(result["key"][1]["correctOptionIndex"], 2)
        self.assertEqual(warnings, ["Original diagram preserved."])
        self.assertIn(RECOVERY_WARNING, result["parsing"]["warnings"])

    def test_ownership_and_missing_source_assets_cannot_be_bypassed(self):
        paper = PAPER.replace("Find", "![plot](quiz-asset:paper-p1-img1) Find")
        wrong_owner = {"id": "paper-p1-img1", "page": 1, "storagePath": PREFIX.replace("alice", "bob") + "assets/lease/plot.png"}
        for options in ({**OPTIONS, "paper_path": PREFIX.replace("alice", "bob") + "paper.pdf"},
                        {**OPTIONS, "assets": [wrong_owner]}, OPTIONS):
            with self.subTest(options=options["paper_path"]), self.assertRaises(InvalidImport):
                structure_with_key_recovery(paper, "Answer Key", key_data=pdf(["1 B", "2 C"]), **options)

    def test_embedded_key_and_inconsistent_separate_key_contract_never_use_fallback(self):
        with patch("quiz_zerogpu.key_recovery.native_key_text", side_effect=AssertionError("Must not extract")):
            embedded = {**OPTIONS, "key_path": None}
            with self.assertRaises(InvalidImport):
                structure_with_key_recovery(PAPER, None, key_data=pdf(["1 B", "2 C"]), **embedded)
            with self.assertRaises(InvalidImport):
                structure_with_key_recovery(PAPER, None, key_data=pdf(["1 B", "2 C"]), **OPTIONS)
            with self.assertRaises(InvalidImport):
                structure_with_key_recovery(PAPER, "Answer Key", key_data=pdf(["1 B", "2 C"]), **embedded)

    def test_character_limit_checked_before_native_text_all_handles_closed(self):
        document, page, text_page = fake_document(MAX_PAGE_CHARACTERS + 1)
        with self.assertRaises(InvalidImport):
            native_key_text(pdf(), document_factory=lambda _: document)
        text_page.get_text_range.assert_not_called()
        text_page.close.assert_called_once()
        page.close.assert_called_once()
        document.close.assert_called_once()

    def test_zero_character_scan_does_not_extract_and_lies_about_output_are_bounded(self):
        for count, text in ((0, ""), (10, "x" * (MAX_PAGE_CHARACTERS + 1))):
            document, page, text_page = fake_document(count, text)
            with self.subTest(count=count), self.assertRaises(InvalidImport):
                native_key_text(pdf(), document_factory=lambda _: document)
            if count == 0:
                text_page.get_text_range.assert_not_called()
            text_page.close.assert_called_once()
            page.close.assert_called_once()
            document.close.assert_called_once()

    def test_invalid_or_over_page_limit_pdf_never_constructs_pdfium_document(self):
        factory = Mock()
        for data in (pdf(page_count=3), b"not a PDF", "not bytes"):
            with self.subTest(data_type=type(data)), self.assertRaises(InvalidImport):
                native_key_text(data, document_factory=factory)
        factory.assert_not_called()

    def test_extraction_errors_are_sanitized_and_resources_closed(self):
        document, page, text_page = fake_document(10)
        text_page.get_text_range.side_effect = RuntimeError("private runtime details must not escape")
        with self.assertRaises(InvalidImport) as raised:
            native_key_text(pdf(), document_factory=lambda _: document)
        self.assertNotIn("private runtime", str(raised.exception))
        text_page.close.assert_called_once()
        page.close.assert_called_once()
        document.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
