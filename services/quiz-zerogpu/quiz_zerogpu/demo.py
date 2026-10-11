"""Bounded PDF preparation and an isolated, non-persistent OCR preview."""

import io
import json
from pathlib import Path
import tempfile
import uuid
import zipfile

from quiz_parser.domain import InvalidImport, MAX_PDF_BYTES
from quiz_parser.pipeline import (Models, OriginalPages,
                                  preserve_paper, validated_pdf)
from .structuring import MODEL_NAME
from .key_recovery import structure_with_key_recovery

MAX_FREE_PAGES = 2
FREE_PAGE_MESSAGE = "Our current free OCR preview supports at most 2 pages total, including the answer key. Upload a smaller excerpt."


def read_upload(path: str | None) -> bytes | None:
    if not path:
        return None
    with Path(path).open("rb") as source:
        data = source.read(MAX_PDF_BYTES + 1)
    validated_pdf(data, max_pages=MAX_FREE_PAGES, page_limit_message=FREE_PAGE_MESSAGE)
    return data


def validate_batch(documents: list[bytes]) -> int:
    count = sum(validated_pdf(data, max_pages=MAX_FREE_PAGES,
                              page_limit_message=FREE_PAGE_MESSAGE) for data in documents)
    if not documents or count > MAX_FREE_PAGES:
        raise InvalidImport(FREE_PAGE_MESSAGE)
    return count


def render_pages(data: bytes):
    """Use the original PDF raster; never synthesize a diagram."""
    import pypdfium2
    document = pypdfium2.PdfDocument(data)
    images = []
    try:
        for page in document:
            try:
                width, height = page.get_size()
                scale = min(2, (6_000_000 / (width * height)) ** 0.5,
                            3000 / max(width, height))
                bitmap = page.render(scale=scale)
                try:
                    images.append(bitmap.to_pil().convert("RGB").copy())
                finally:
                    bitmap.close()
            finally:
                page.close()
    finally:
        document.close()
    return images


class PreviewStore:
    def __init__(self):
        self.images = {}

    def save_image(self, job, asset_id, content, page):
        path = f"users/{job['uid']}/quiz-imports/{job['id']}/assets/{job['leaseToken']}/{asset_id}.png"
        self.images[path] = content
        return {"id": asset_id, "storagePath": path, "page": page}


class PreviewModels(Models):
    def image(self, _value):
        raise InvalidImport("Use the original PDF crop for preview diagrams.")


def build_preview(paper_data: bytes, paper_pages: list[dict], key_pages: list[dict] | None,
                  title: str = "OCR preview", *, output_root=None, key_data=None):
    job_id, lease = str(uuid.uuid4()), str(uuid.uuid4())
    job = {"uid": "preview", "id": job_id, "leaseToken": lease}
    prefix = f"users/preview/quiz-imports/{job_id}/"
    store, warnings = PreviewStore(), []
    original = OriginalPages(paper_data)
    try:
        # Source crops are preferred; no network images are accepted by this model.
        paper_text, assets = preserve_paper(paper_pages, original, PreviewModels(None), store, job, warnings)
    finally:
        original.close()
    key_text = None if key_pages is None else "\n".join(page["markdown"]["text"] for page in key_pages)
    try:
        draft = structure_with_key_recovery(paper_text, key_text, key_data=key_data,
                                uid="preview", job_id=job_id,
                                title=title.strip() or "OCR preview", paper_path=prefix + "paper.pdf",
                                key_path=prefix + "answer-key.pdf" if key_pages is not None else None,
                                assets=assets, warnings=warnings,
                                model="PaddlePaddle/PaddleOCR-VL-1.6 + " + MODEL_NAME)
        status = "Preview extracted. Check every question, equation, diagram and key. Nothing has been saved to Firebase."
    except InvalidImport as error:
        draft = {"error": str(error), "question": [], "key": []}
        status = str(error) + " The raw OCR is shown below for inspection. Nothing has been saved to Firebase."
    # Only locally generated names are written to the ZIP. Paths from the OCR are
    # never treated as filesystem names or URLs. The preview includes no PDF data.
    destination = Path(tempfile.mkdtemp(prefix="revsy-preview-", dir=output_root)) / "quiz-preview.zip"
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("quiz.json", json.dumps(draft, ensure_ascii=False, indent=2))
        archive.writestr("paper-ocr.md", paper_text)
        archive.writestr("key-ocr.md", key_text or "")
        for asset in assets:
            archive.writestr("diagrams/" + asset["id"] + ".png", store.images[asset["storagePath"]])
    return draft, paper_text, key_text or "", str(destination), status
