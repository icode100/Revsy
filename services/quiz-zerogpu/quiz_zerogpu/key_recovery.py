"""Recover missed digital answer-key rows from bounded original PDF text.

OCR remains the first input. Native text is only a fallback for a supplied
separate key, and it must pass the entire existing source-grounded validator.
No answers are inferred, and scanned/ambiguous keys retain the original error.
"""

from quiz_parser.domain import InvalidImport
from quiz_parser.ocr_text import normalize_html_tables
from quiz_parser.pipeline import validated_pdf

from .structuring import MAX_TEXT_BYTES, structure_draft


MAX_KEY_PAGES = 2
MAX_PAGE_CHARACTERS = 100_000
MAX_KEY_CHARACTERS = MAX_KEY_PAGES * MAX_PAGE_CHARACTERS
RECOVERY_WARNING = (
    "The supplied answer key was recovered from original PDF text because OCR missed or could not read its rows. "
    "Review every recovered answer against the source key before saving."
)


def native_key_text(data: bytes, *, document_factory=None) -> str:
    """Read text without rendering/network access and close every PDFium handle."""
    try:
        if not isinstance(data, bytes):
            raise InvalidImport("The answer key PDF is invalid.")
        page_count = validated_pdf(data)
        if page_count > MAX_KEY_PAGES:
            raise InvalidImport("The free answer-key recovery supports at most 2 pages.")
        if document_factory is None:
            import pypdfium2
            document_factory = pypdfium2.PdfDocument
        document = document_factory(data)
        try:
            if len(document) != page_count:
                raise InvalidImport("The answer-key PDF page count is inconsistent.")
            pages, total = [], 0
            for page_index in range(page_count):
                page = document[page_index]
                try:
                    text_page = page.get_textpage()
                    try:
                        count = text_page.count_chars()
                        if type(count) is not int or not 0 <= count <= MAX_PAGE_CHARACTERS:
                            raise InvalidImport("The answer-key PDF contains too much text to recover safely.")
                        if not count:
                            continue
                        text = text_page.get_text_range(index=0, count=count)
                        if not isinstance(text, str) or len(text) > MAX_PAGE_CHARACTERS:
                            raise InvalidImport("The answer-key PDF contains too much text to recover safely.")
                        total += len(text)
                        if total > MAX_KEY_CHARACTERS:
                            raise InvalidImport("The answer-key PDF contains too much text to recover safely.")
                        pages.append(text)
                    finally:
                        text_page.close()
                finally:
                    page.close()
        finally:
            document.close()
        text = normalize_html_tables("\n".join(pages))
        if not text.strip():
            raise InvalidImport("The supplied key PDF has no readable native text.")
        if len(text.encode("utf-8")) > MAX_TEXT_BYTES:
            raise InvalidImport("The answer-key PDF contains too much text to recover safely.")
        return text
    except InvalidImport:
        raise
    except Exception:
        # Native parser exceptions can contain local/runtime details. The caller
        # keeps the original safe OCR error when recovery does not succeed.
        raise InvalidImport("The original answer-key PDF text could not be recovered.") from None


def structure_with_key_recovery(paper_text: str, key_text: str | None, *,
                                key_data: bytes | None = None, **structure_draft_kwargs) -> dict:
    """Use native separate-key text only after OCR structuring has failed."""
    try:
        return structure_draft(paper_text, key_text, **structure_draft_kwargs)
    except InvalidImport as original_error:
        # Preserve the embedded-key and source metadata contracts unchanged.
        if key_data is None or key_text is None or not structure_draft_kwargs.get("key_path"):
            raise
        try:
            recovered = native_key_text(key_data)
            recovery_kwargs = dict(structure_draft_kwargs)
            recovery_kwargs["warnings"] = [RECOVERY_WARNING, *(structure_draft_kwargs.get("warnings") or [])]
            return structure_draft(paper_text, recovered, **recovery_kwargs)
        except InvalidImport:
            # Failed recovery cannot downgrade ownership, completeness, diagram
            # coverage or key evidence validation, or manufacture a ready draft.
            raise original_error from None
