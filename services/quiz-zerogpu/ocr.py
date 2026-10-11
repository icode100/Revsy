"""Full-page, all-PyTorch PaddleOCR-VL 1.6 runner for a Gradio ZeroGPU Space.

Construct OCRRunner at app startup, after importing spaces. Call parse_pages only
inside the app's @spaces.GPU function. PDF rendering and original diagram crops
belong to the CPU parser, outside that GPU function.
"""

from __future__ import annotations

from copy import deepcopy
import math
import threading
from typing import Any

import numpy as np
from PIL import Image

MAX_PAGES = 2
MAX_PAGE_PIXELS = 6_000_000
MAX_PAGE_EDGE = 3_000
MAX_BLOCKS = 256
MAX_PAGE_TEXT = 100_000
MAX_NEW_TOKENS = 2_048
MAX_CROP_PIXELS = 1_003_520
IMAGE_LABELS = frozenset({"image", "chart", "figure", "picture", "header_image", "footer_image", "seal"})
MODEL_NAME = "PaddleOCR-VL-1.6 (Transformers + PP-DocLayoutV3)"


class OCRLimitError(ValueError):
    """The small ZeroGPU experiment cannot safely return a complete page."""


def _pipeline_config(config: dict) -> dict:
    config = deepcopy(config)
    config.update(batch_size=1, use_queues=False, use_doc_preprocessor=False,
                  use_layout_detection=True, use_chart_recognition=False,
                  use_seal_recognition=False, format_block_content=False,
                  markdown_ignore_labels=[], layout_prep_cpu_workers=0)
    layout = config["SubModules"]["LayoutDetection"]
    layout.update(batch_size=1, engine="transformers",
                  engine_config={"dtype": "float32", "trust_remote_code": False})
    # Layout postprocessing currently converts its float tensors to NumPy.
    # Keep it float32; bfloat16 is appropriate only for the VLM generation model.
    vlm = config["SubModules"]["VLRecognition"]
    vlm.update(batch_size=1, engine="transformers",
               engine_config={"dtype": "bfloat16", "trust_remote_code": False,
                              "attn_implementation": "sdpa"})
    return config


def _guard_generation(predictor: Any) -> None:
    """Fail on token exhaustion before PaddleX discards generation metadata.

    This deliberately uses the pinned PaddleX 3.7 predictor interface. It wraps
    its generation method, never model placement or CUDA execution. An upstream
    interface change fails at startup rather than silently losing page text.
    """
    original_generate = predictor.generate
    generation_config = predictor.infer.generation_config
    eos = generation_config.eos_token_id
    eos_ids = {eos} if isinstance(eos, int) else set(eos or [])
    if not eos_ids:
        eos = getattr(predictor.processor.tokenizer, "eos_token_id", None)
        eos_ids = {eos} if isinstance(eos, int) else set(eos or [])

    def checked_generate(model_inputs, generate_kwargs):
        # Forced EOS at the length cap would conceal truncation; disable it.
        options = {**generate_kwargs, "do_sample": False, "forced_eos_token_id": None}
        output = original_generate(model_inputs, options)
        if hasattr(output, "sequences"):
            sequences = output.sequences
        else:
            sequences = output
        prompts = model_inputs["input_ids"]
        if len(sequences) != len(prompts):
            raise OCRLimitError("The OCR model returned an incomplete batch. Try a simpler page.")
        token_limit = options["max_new_tokens"]
        for prompt, sequence in zip(prompts, sequences):
            generated = sequence[len(prompt):]
            if len(generated) >= token_limit:
                # Sampling is disabled and the predictor uses one item per batch.
                # A final EOS at the boundary is complete; absence means cutoff.
                last_token = int(generated[-1].item() if hasattr(generated[-1], "item") else generated[-1])
                if last_token not in eos_ids:
                    raise OCRLimitError("An OCR block reached the token limit. Split the paper into smaller pages and retry.")
        return output

    predictor.generate = checked_generate


def normalize_page(result: Any, page_index: int, image: Image.Image) -> dict:
    """Return the CPU parser's native page contract, without regenerated images."""
    envelope = result.json
    data = envelope.get("res") if isinstance(envelope, dict) else None
    if not isinstance(data, dict):
        raise OCRLimitError("The OCR model returned an unreadable page.")
    width, height = data.get("width"), data.get("height")
    if width != image.width or height != image.height:
        # Preprocessing/coordinate changes would make original-PDF crops wrong.
        raise OCRLimitError("The OCR page dimensions changed. Original diagram coordinates cannot be verified.")
    blocks = data.get("parsing_res_list")
    if not isinstance(blocks, list) or not blocks or len(blocks) > MAX_BLOCKS:
        raise OCRLimitError("The page has no readable blocks or is too complex for this experiment.")
    normalized, pieces = [], []
    text_length = 0
    for index, block in enumerate(blocks):
        if not isinstance(block, dict):
            raise OCRLimitError("The OCR model returned an invalid layout block.")
        label, content, bbox = block.get("block_label"), block.get("block_content"), block.get("block_bbox")
        if not isinstance(label, str) or not isinstance(content, str):
            raise OCRLimitError("The OCR model returned invalid page text.")
        if (not isinstance(bbox, (tuple, list)) or len(bbox) != 4 or
                any(isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) for value in bbox)):
            raise OCRLimitError("The OCR model returned invalid diagram coordinates.")
        x1, y1, x2, y2 = bbox
        if not (0 <= x1 < x2 <= width and 0 <= y1 < y2 <= height):
            raise OCRLimitError("The OCR model returned diagram coordinates outside the original page.")
        # Retain block positions/indices: bbox_for_path('__layout_block_N') in
        # the existing parser crops the original PDF using this exact index.
        normalized.append({"block_label": label, "block_content": content,
                           "block_bbox": list(bbox), "block_id": index,
                           "block_order": block.get("block_order")})
        if label.lower() in IMAGE_LABELS:
            pieces.append(f"![Source diagram](__layout_block_{index})")
        elif content.strip():
            pieces.append(content.strip())
        text_length += len(content)
        if text_length > MAX_PAGE_TEXT:
            raise OCRLimitError("The OCR page text is too long. Use a simpler page.")
    text = "\n\n".join(pieces)
    if not text.strip():
        raise OCRLimitError("No question text could be read from this page.")
    return {
        "prunedResult": {"width": width, "height": height, "page_index": page_index,
                         "parsing_res_list": normalized},
        "markdown": {"text": text, "images": {}},
    }


class OCRRunner:
    """Load both Torch models at startup; inference stays in the calling thread."""

    def __init__(self, *, pipeline: Any = None):
        self._lock = threading.Lock()
        if pipeline is None:
            # Required BEFORE torch/model loading: ZeroGPU emulates CUDA model
            # placement outside GPU-decorated functions during app startup.
            import spaces  # noqa: F401
            from paddleocr import PaddleOCRVL
            from paddlex.inference import load_pipeline_config

            config = _pipeline_config(load_pipeline_config("PaddleOCR-VL-1.6"))
            # "gpu" maps to torch's dynamic "cuda" device. A fixed gpu:0
            # index is unsafe when ZeroGPU assigns a different device per call.
            pipeline = PaddleOCRVL(paddlex_config=config, pipeline_version="v1.6",
                                   engine="transformers", device="gpu",
                                   use_queues=False, use_doc_orientation_classify=False,
                                   use_doc_unwarping=False, use_layout_detection=True,
                                   use_chart_recognition=False, format_block_content=False,
                                   markdown_ignore_labels=[])
            # AutoParallel forwards this attribute to the single GPU pipeline.
            _guard_generation(pipeline.paddlex_pipeline.vl_rec_model)
        self._pipeline = pipeline

    def parse_pages(self, images: list[Image.Image]) -> list[dict]:
        """Run 1–2 pre-rendered pages inside the app's @spaces.GPU allocation."""
        if not isinstance(images, list) or not 1 <= len(images) <= MAX_PAGES:
            raise OCRLimitError("The free experiment accepts at most two pages per import, including the answer key.")
        for image in images:
            if not isinstance(image, Image.Image):
                raise OCRLimitError("Render the PDF into page images before requesting GPU time.")
            if (image.width < 1 or image.height < 1 or image.width * image.height > MAX_PAGE_PIXELS or
                    max(image.size) > MAX_PAGE_EDGE):
                raise OCRLimitError("A rendered PDF page is too large. Render at a lower resolution.")
        if not self._lock.acquire(blocking=False):
            raise OCRLimitError("The OCR model is already reading another paper. Retry after it finishes.")
        try:
            pages = []
            # Single-page calls avoid cross-page table merging and bound memory.
            for index, image in enumerate(images):
                # PaddleX's page reader expects OpenCV BGR arrays, not PIL RGB.
                bgr = np.asarray(image.convert("RGB"))[:, :, ::-1].copy()
                results = list(self._pipeline.predict(
                    input=bgr, use_queues=False, use_doc_orientation_classify=False,
                    use_doc_unwarping=False, use_layout_detection=True,
                    use_chart_recognition=False, format_block_content=False,
                    markdown_ignore_labels=[], max_new_tokens=MAX_NEW_TOKENS,
                    max_pixels=MAX_CROP_PIXELS))
                if len(results) != 1:
                    raise OCRLimitError("The OCR model did not return exactly one result per original page.")
                pages.append(normalize_page(results[0], index, image))
            return pages
        finally:
            self._lock.release()
