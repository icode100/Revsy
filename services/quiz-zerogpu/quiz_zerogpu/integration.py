"""Durable Firebase imports using the bounded free Gradio GPU endpoint.

This adapter never sends storage URLs or uses Inference Providers. Both owned
PDFs are downloaded and checked before the single queued GPU request.
"""

import base64
import binascii
import json
import logging
import re
from urllib.parse import urlsplit

from quiz_parser.domain import InvalidImport, LeaseLost, MAX_PDF_BYTES, validate_paths
from quiz_parser.ocr_text import normalize_html_tables
from quiz_parser.pipeline import Models, OriginalPages, preserve_paper, validated_pdf
from quiz_parser.worker import Heartbeat, Worker

from .demo import validate_batch
from .structuring import MODEL_NAME, structure_mcqs
from .key_recovery import structure_with_key_recovery

logger = logging.getLogger("quiz_zerogpu")
MAX_FREE_RESPONSE_BYTES = 8 * 1024 * 1024


def checked_space_url(value: str) -> str:
    """Require the canonical public HF host configured by the deployment owner."""
    try:
        parsed = urlsplit(value)
        valid = (parsed.scheme == "https" and parsed.hostname and
                 re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.hf\.space", parsed.hostname) and
                 not parsed.username and not parsed.password and parsed.port in {None, 443} and
                 parsed.path in {"", "/"} and not parsed.query and not parsed.fragment)
    except (ValueError, TypeError):
        valid = False
    if not valid:
        raise RuntimeError("QUIZ_SPACE_URL must be the canonical HTTPS Hugging Face Space host.")
    return "https://" + parsed.hostname


class FreeModels(Models):
    def __init__(self, settings, *, space_url=None, ocr_secret=None,
                 client_factory=None, request_timeout=900):
        super().__init__(settings)
        self.space_url = checked_space_url(space_url or settings.paddle_url)
        self.ocr_secret = ocr_secret if ocr_secret is not None else settings.paddle_token
        if not self.ocr_secret or not settings.hf_token:
            raise RuntimeError("Configure server-only HF_TOKEN and QUIZ_OCR_TOKEN for Firebase quiz imports.")
        if not 120 <= request_timeout <= 1800:
            raise RuntimeError("The free OCR request timeout is outside supported limits.")
        self.client_factory = client_factory
        self.request_timeout = request_timeout
        self._client = None

    def _get_client(self):
        if self._client is None:
            factory = self.client_factory
            if factory is None:
                from gradio_client import Client
                factory = Client
            self._client = factory(self.space_url, token=self.settings.hf_token,
                                   verbose=False, max_workers=1, download_files=False,
                                   ssl_verify=True, analytics_enabled=False,
                                   httpx_kwargs={"timeout": self.request_timeout, "trust_env": False})
        return self._client

    def ocr_documents(self, documents: list[bytes]) -> list[list[dict]]:
        # Validate before even constructing the client: imports beyond the free
        # limit must consume neither GPU time nor an authenticated queue request.
        validate_batch(documents)
        counts = [validated_pdf(data) for data in documents]
        payload = [base64.b64encode(data).decode("ascii") for data in documents]
        queued = None
        try:
            queued = self._get_client().submit(payload, self.ocr_secret, api_name="/backend_ocr")
            result = queued.result(timeout=self.request_timeout)
        except Exception as error:
            if queued is not None:
                try:
                    queued.cancel()
                except Exception:
                    pass
            # Never expose Gradio exception bodies (which may contain request
            # inputs/secrets), and never automatically resubmit a quota failure.
            lowered = str(error).lower()
            if any(word in lowered for word in ("quota", "illegal duration", "gpu duration", "daily limit")):
                raise InvalidImport("The free Hugging Face GPU quota is exhausted or cannot cover this request. Wait for the quota to reset, then start a new import.") from None
            raise InvalidImport("Free OCR could not finish. The Space may be starting, busy, or unavailable. Check its status, then start a new import.") from None
        try:
            if not isinstance(result, list) or len(result) != len(documents):
                raise InvalidImport("Free OCR did not return every uploaded document.")
            if len(json.dumps(result, ensure_ascii=False, allow_nan=False).encode("utf-8")) > MAX_FREE_RESPONSE_BYTES:
                raise InvalidImport("The free OCR response is too large. Split the paper into smaller PDFs.")
            for pages, count in zip(result, counts):
                if not isinstance(pages, list) or len(pages) != count:
                    raise InvalidImport("Free OCR did not return every PDF page.")
                for page in pages:
                    if (not isinstance(page, dict) or not isinstance(page.get("markdown"), dict) or
                            not isinstance(page["markdown"].get("text"), str) or
                            not isinstance(page.get("prunedResult", {}), dict)):
                        raise InvalidImport("Free OCR returned invalid page data.")
            return result
        except InvalidImport:
            raise
        except (TypeError, ValueError, OverflowError) as error:
            raise InvalidImport("Free OCR returned invalid page data.") from error

    def ocr(self, pdf_input: str) -> list[dict]:
        if not isinstance(pdf_input, str) or len(pdf_input) > MAX_PDF_BYTES * 4 // 3 + 4:
            raise InvalidImport("Free OCR accepts only a bounded PDF encoded as base64.")
        try:
            data = base64.b64decode(pdf_input, validate=True)
        except (ValueError, binascii.Error) as error:
            raise InvalidImport("Free OCR accepts PDF bytes rather than remote URLs.") from error
        return self.ocr_documents([data])[0]

    def image(self, value: str) -> bytes:
        # Original PDF crops/full pages provide the source of every diagram.
        # In particular, arbitrary image URLs from OCR are never downloaded.
        if isinstance(value, str) and value.startswith(("https://", "http://")):
            raise InvalidImport("Free OCR diagrams must come from the original PDF.")
        return super().image(value)

    def structure(self, paper_text: str, key_text: str, assets: list[dict]) -> dict:
        return structure_mcqs(paper_text, key_text, assets)

    def close(self):
        if self._client is not None:
            self._client.close()


def parse_free_job(store, models: FreeModels, job: dict) -> dict:
    """Preflight all sources and complete the existing source-grounded schema."""
    validate_paths(job["uid"], job["id"], job["paperPath"], job.get("answerKeyPath"))

    def stage(status, message):
        store.owned_update(job, {"status": status, "message": message})

    stage("reading-paper", "Checking the paper and answer key against the free 2-page limit…")
    paper_data, _ = store.load_pdf(job["paperPath"])
    documents = [paper_data]
    key_data = None
    if job.get("answerKeyPath"):
        stage("reading-key", "Checking the supplied answer key…")
        key_data, _ = store.load_pdf(job["answerKeyPath"])
        documents.append(key_data)
    validate_batch(documents)
    stage("reading-paper", "Reading questions, equations, and the supplied key with free OCR…")
    results = models.ocr_documents(documents)
    key_text = None
    if job.get("answerKeyPath"):
        key_text = "\n".join(normalize_html_tables(page["markdown"]["text"]) for page in results[1])
    stage("storing-images", "Preserving original diagrams in object storage…")
    warnings = ["Free OCR supports clear numbered MCQs with consecutive A–H options and explicit numbered key rows."]
    original = OriginalPages(paper_data)
    try:
        paper_text, assets = preserve_paper(results[0], original, models, store, job, warnings)
    finally:
        original.close()
    stage("structuring", "Organizing numbered MCQs and matching the supplied answers…")
    stage("validating", "Checking question coverage, diagrams, and answer-key entries…")
    return structure_with_key_recovery(paper_text, key_text, key_data=key_data,
                           uid=job["uid"], job_id=job["id"],
                           title=job["title"], paper_path=job["paperPath"],
                           key_path=job.get("answerKeyPath"), assets=assets,
                           model="PaddlePaddle/PaddleOCR-VL-1.6 + " + MODEL_NAME,
                           warnings=warnings)


class FreeWorker(Worker):
    """Keep Firestore leases/recovery, but fail quota errors without retries."""

    def process(self, job):
        heartbeat = Heartbeat(self.store, job)
        heartbeat.start()
        try:
            draft = parse_free_job(self.store, self.models, job)
            heartbeat.stop()
            if heartbeat.lost:
                raise LeaseLost("The lease heartbeat stopped.")
            self.store.owned_update(job, {"status": "ready", "message": "Ready to review and save.",
                                          "draft": draft}, terminal=True)
        except LeaseLost:
            logger.info("Import %s stopped after losing its lease", job["id"])
        except Exception as error:
            heartbeat.stop()
            message = str(error) if isinstance(error, InvalidImport) else "Free parsing could not finish. Check the service configuration and start a new import."
            try:
                self.store.owned_update(job, {"status": "failed", "message": message,
                                              "error": message}, terminal=True)
            except LeaseLost:
                pass
            except Exception:
                logger.error("Could not persist failure for import %s; its lease will recover", job["id"])
            logger.warning("Import %s failed (%s)", job["id"], type(error).__name__)
        finally:
            heartbeat.stop()

    def stop(self):
        self.stop_event.set()
        # Parent Gradio startup can fail before the worker thread starts. Its
        # lifespan cleanup still needs to be safe in that case and on repeats.
        if self.thread.ident is not None:
            self.thread.join(timeout=5)
        self.models.close()
