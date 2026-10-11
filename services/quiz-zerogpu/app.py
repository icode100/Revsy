"""Gradio entry point for the free, explicitly bounded ZeroGPU route."""

import base64
import binascii
import hmac
import logging
import os

# Must precede Torch/Paddle imports: ZeroGPU emulates CUDA during model loading.
import spaces
import gradio as gr

from ocr import OCRRunner
from quiz_parser.domain import InvalidImport, MAX_PDF_BYTES
from quiz_zerogpu.demo import build_preview, read_upload, render_pages, validate_batch

logger = logging.getLogger("quiz_zerogpu")
runner = OCRRunner()


def infer_pages(image_batches):
    return [runner.parse_pages(images) for images in image_batches]


@spaces.GPU(duration=120)
def parse_preview(paper, key, title):
    try:
        paper_data, key_data = read_upload(paper), read_upload(key)
        if paper_data is None:
            raise InvalidImport("Upload a question paper PDF first.")
        documents = [paper_data] + ([key_data] if key_data is not None else [])
        validate_batch(documents)
        results = infer_pages([render_pages(data) for data in documents])
        return build_preview(paper_data, results[0], results[1] if key_data is not None else None,
                             title, output_root=archive.GRADIO_CACHE, key_data=key_data)
    except InvalidImport as error:
        raise gr.Error(str(error)) from error
    except Exception as error:
        logger.warning("Preview failed (%s)", type(error).__name__)
        # Do not expose upstream response bodies, local paths, or API secrets.
        raise gr.Error("OCR could not finish. The free GPU quota may be exhausted or the model unavailable. Check the Space logs and retry later.") from error


@spaces.GPU(duration=120)
def backend_ocr(encoded_documents, secret):
    expected = os.environ.get("QUIZ_OCR_TOKEN", "")
    if (not expected or not isinstance(secret, str) or len(secret) > 256 or
            not hmac.compare_digest(secret.encode(), expected.encode())):
        raise gr.Error("Unauthorized OCR request.")
    if (not isinstance(encoded_documents, list) or not 1 <= len(encoded_documents) <= 2 or
            any(not isinstance(value, str) or len(value) > (MAX_PDF_BYTES * 4 // 3 + 4)
                for value in encoded_documents)):
        raise gr.Error("Invalid PDF size.")
    try:
        documents = [base64.b64decode(value, validate=True) for value in encoded_documents]
        validate_batch(documents)
        return infer_pages([render_pages(data) for data in documents])
    except (InvalidImport, ValueError, binascii.Error) as error:
        raise gr.Error("Upload a valid PDF with at most 2 pages.") from error


with gr.Blocks(title="Revsy free quiz OCR preview", delete_cache=(3600, 3600)) as demo:
    gr.Markdown("# Revsy quiz OCR preview\nUpload a small MCQ paper and its explicit answer key. Maximum **2 pages total**. "
                "Use numbered questions with A, B, C… options. This tests extraction; it does not save to Firebase. "
                "Free ZeroGPU usage has a daily quota. Review all OCR before using a quiz.")
    with gr.Row():
        paper = gr.File(label="Question paper PDF", file_types=[".pdf"], type="filepath")
        key = gr.File(label="Answer key PDF (optional if included in paper)", file_types=[".pdf"], type="filepath")
    title = gr.Textbox(label="Quiz title", value="OCR preview", max_lines=1)
    button = gr.Button("Extract preview", variant="primary")
    status = gr.Textbox(label="Result", interactive=False)
    output = gr.JSON(label="Extracted quiz preview")
    with gr.Accordion("Inspect raw OCR", open=False):
        paper_text = gr.Textbox(label="Question paper OCR", lines=15)
        key_text = gr.Textbox(label="Answer key OCR", lines=8)
    archive = gr.File(label="Download preview JSON, OCR and original diagram crops")
    button.click(parse_preview, inputs=[paper, key, title],
                 outputs=[output, paper_text, key_text, archive, status], api_name="preview",
                 concurrency_limit=1, concurrency_id="ocr")
    # The browser never receives this secret. Only the authenticated CPU worker
    # uses this endpoint. Invalid callers consume their own HF quota and cannot
    # access the worker's quota without its private HF token.
    gr.Button(visible=False).click(backend_ocr,
        inputs=[gr.JSON(visible=False), gr.Textbox(visible=False)],
        outputs=gr.JSON(visible=False), api_name="backend_ocr", api_visibility="undocumented",
        concurrency_limit=1, concurrency_id="ocr")


if __name__ == "__main__":
    if os.environ.get("QUIZ_ENABLE_FIREBASE", "false").lower() == "true":
        from contextlib import asynccontextmanager
        from starlette.routing import Mount
        from quiz_parser.api import create_app
        from quiz_zerogpu.bootstrap import firebase_runtime

        settings, store, worker = firebase_runtime()

        @asynccontextmanager
        async def lifespan(_app):
            try:
                yield
            finally:
                worker.stop()

        demo.queue(max_size=8).launch(max_file_size="25mb", show_error=False,
            prevent_thread_lock=True, app_kwargs={"lifespan": lifespan})
        # Mounted child lifespans do not run automatically. The Gradio parent
        # owns the explicit durable worker lifecycle instead.
        intake = create_app(settings, store, run_worker=False)
        demo.app.router.routes.insert(0, Mount("/api", app=intake))
        worker.start()
        try:
            demo.block_thread()
        finally:
            worker.stop()
    else:
        demo.queue(max_size=8).launch(max_file_size="25mb", show_error=False)
