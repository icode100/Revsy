"""Private PDF-only gateway to the complete PaddleOCR-VL pipeline."""
import asyncio
import base64
import binascii
from contextlib import asynccontextmanager
from dataclasses import dataclass
import json
import logging
import os
import re
import secrets
import signal
from urllib.parse import unquote, urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
import httpx

MAX_REQUEST_BYTES = 36 * 1024 * 1024
MAX_PDF_BYTES = 25 * 1024 * 1024
MAX_RESPONSE_BYTES = 80 * 1024 * 1024
MODEL_TIMEOUT_SECONDS = 20 * 60
BODY_TIMEOUT_SECONDS = 60
QUEUE_WAIT_SECONDS = 5
NATIVE_ORIGIN = "http://127.0.0.1:8081"
NATIVE_COMMAND = (
    "paddlex", "--serve", "--pipeline", "PaddleOCR-VL-1.6",
    "--host", "127.0.0.1", "--port", "8081", "--device", "gpu:0",
)
BOOLEAN_OPTIONS = {
    "useDocOrientationClassify", "useDocUnwarping", "useLayoutDetection",
    "useChartRecognition", "useSealRecognition", "useOcrForImageBlock",
    "formatBlockContent", "returnMarkdownImages", "visualize",
    "prettifyMarkdown", "showFormulaNumber", "restructurePages",
    "mergeLayoutBlocks", "mergeTables", "relevelTitles",
}
SOURCE_PATH = re.compile(
    r"users/([^/]{1,128})/quiz-imports/[A-Za-z0-9_-]{1,80}/(?:paper|answer-key)\.pdf"
)


@dataclass(frozen=True)
class Settings:
    token: str
    bucket: str

    @classmethod
    def from_env(cls):
        return cls(os.getenv("PADDLEOCR_TOKEN", ""), os.getenv("FIREBASE_STORAGE_BUCKET", ""))

    def configured(self):
        return (
            32 <= len(self.token) <= 1024
            and self.token.isascii()
            and all(33 <= ord(character) <= 126 for character in self.token)
            and re.fullmatch(r"[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]", self.bucket) is not None
        )


def authenticate(request: Request, settings: Settings):
    if not settings.configured():
        raise HTTPException(503, "Configure the OCR shared secret and Firebase bucket before use.")
    header = request.headers.get("authorization", "")
    scheme, _, supplied = header.partition(" ")
    if scheme.lower() != "bearer" or len(supplied) > 1024 or not secrets.compare_digest(
        supplied.encode("utf-8"), settings.token.encode("ascii")
    ):
        raise HTTPException(401, "A valid OCR service token is required.", headers={"WWW-Authenticate": "Bearer"})


def validate_source_url(value: str, bucket: str):
    if len(value) > 8192 or any(ord(character) < 32 for character in value) or "\\" in value:
        raise HTTPException(400, "Invalid PDF source URL.")
    try:
        url = urlsplit(value)
        port = url.port
    except ValueError:
        raise HTTPException(400, "Invalid PDF source URL.") from None
    if url.scheme != "https" or url.username or url.password or url.fragment or port not in (None, 443):
        raise HTTPException(400, "Only HTTPS PDF URLs from the configured bucket are allowed.")
    path = unquote(url.path)
    if url.hostname == "storage.googleapis.com":
        prefix = f"/{bucket}/"
        source = path[len(prefix):] if path.startswith(prefix) else ""
    elif url.hostname == f"{bucket}.storage.googleapis.com":
        source = path.lstrip("/")
    elif url.hostname == "firebasestorage.googleapis.com":
        prefix = f"/v0/b/{bucket}/o/"
        source = path[len(prefix):] if path.startswith(prefix) else ""
    else:
        source = ""
    match = SOURCE_PATH.fullmatch(source)
    if match is None or match[1] in {".", ".."} or "\\" in source or any(ord(character) < 32 for character in source):
        raise HTTPException(400, "The PDF must be a quiz import in the configured Firebase bucket.")


def validate_payload(payload, settings: Settings):
    if not isinstance(payload, dict) or set(payload) - ({"file", "fileType"} | BOOLEAN_OPTIONS):
        raise HTTPException(400, "Provide a PDF file and supported OCR options as a JSON object.")
    if type(payload.get("fileType")) is not int or payload["fileType"] != 0:
        raise HTTPException(400, "This service accepts PDFs only (fileType: 0).")
    source = payload.get("file")
    if not isinstance(source, str) or not source:
        raise HTTPException(400, "Provide a signed PDF URL or base64 PDF content.")
    for option in BOOLEAN_OPTIONS & set(payload):
        if type(payload[option]) is not bool:
            raise HTTPException(400, "OCR options must be booleans.")
    if source.startswith("https://"):
        validate_source_url(source, settings.bucket)
    else:
        if len(source) > 4 * ((MAX_PDF_BYTES + 2) // 3):
            raise HTTPException(413, "PDF content exceeds 25 MB.")
        try:
            decoded = base64.b64decode(source, validate=True)
        except (ValueError, binascii.Error):
            raise HTTPException(400, "Provide a valid base64 PDF or allowed signed URL.") from None
        if len(decoded) > MAX_PDF_BYTES:
            raise HTTPException(413, "PDF content exceeds 25 MB.")
        if not decoded or b"%PDF-" not in decoded[:1024]:
            raise HTTPException(400, "The supplied content is not a PDF.")
    return payload


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def reject_constant(_value):
    raise ValueError("Nonstandard JSON constant")


async def stop_native(process):
    if not process or process.returncode is not None:
        return
    # PaddleX may spawn inference children. Stop its entire isolated process group.
    def send_signal(value):
        try:
            if hasattr(os, "killpg"):
                os.killpg(process.pid, value)
            elif value == signal.SIGTERM:
                process.terminate()
            else:
                process.kill()
        except ProcessLookupError:
            pass
    send_signal(signal.SIGTERM)
    try:
        await asyncio.wait_for(process.wait(), 15)
    except asyncio.TimeoutError:
        send_signal(signal.SIGKILL)
        await process.wait()


async def read_payload(request: Request, settings: Settings):
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
        raise HTTPException(415, "Send application/json.")
    if request.headers.get("content-encoding", "identity").lower() != "identity":
        raise HTTPException(415, "Compressed request bodies are not accepted.")
    length = request.headers.get("content-length")
    if length is not None:
        try:
            size = int(length)
        except ValueError:
            raise HTTPException(400, "Invalid request length.") from None
        if size < 0:
            raise HTTPException(400, "Invalid request length.")
        if size > MAX_REQUEST_BYTES:
            raise HTTPException(413, "JSON request exceeds 36 MB.")
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_REQUEST_BYTES:
            raise HTTPException(413, "JSON request exceeds 36 MB.")
        body.extend(chunk)
    try:
        payload = json.loads(body, object_pairs_hook=unique_object, parse_constant=reject_constant)
    except (ValueError, UnicodeError, RecursionError):
        raise HTTPException(400, "Send a valid JSON object without duplicate keys.") from None
    return validate_payload(payload, settings)


def create_app(settings: Settings | None = None, *, transport=None, source_transport=None, launch_native=True):
    @asynccontextmanager
    async def lifespan(application):
        application.state.settings = settings or Settings.from_env()
        application.state.model_lock = asyncio.Lock()
        application.state.native_process = None
        application.state.launch_failed = False
        logging.getLogger("httpx").setLevel(logging.WARNING)
        logging.getLogger("httpcore").setLevel(logging.WARNING)
        async with httpx.AsyncClient(
            base_url=NATIVE_ORIGIN, transport=transport, trust_env=False, follow_redirects=False,
            timeout=httpx.Timeout(MODEL_TIMEOUT_SECONDS, connect=5),
        ) as client, httpx.AsyncClient(
            transport=source_transport, trust_env=False, follow_redirects=False,
            timeout=httpx.Timeout(30, connect=10), headers={"Accept-Encoding": "identity"},
        ) as source_client:
            application.state.client = client
            application.state.source_client = source_client
            if launch_native and application.state.settings.configured():
                child_env = dict(os.environ)
                for name in ("PADDLEOCR_TOKEN", "FIREBASE_SERVICE_ACCOUNT_JSON", "GOOGLE_APPLICATION_CREDENTIALS"):
                    child_env.pop(name, None)
                try:
                    # Native libraries can print source URLs in errors; suppress native output.
                    application.state.native_process = await asyncio.create_subprocess_exec(
                        *NATIVE_COMMAND, stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.DEVNULL, env=child_env,
                        start_new_session=True,
                    )
                except OSError:
                    application.state.launch_failed = True
            try:
                yield
            finally:
                await stop_native(application.state.native_process)

    application = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    async def readiness():
        if not application.state.settings.configured():
            return "configuration_required"
        process = application.state.native_process
        if application.state.launch_failed or process and process.returncode is not None:
            return "model_failed"
        try:
            response = await application.state.client.get("/openapi.json", timeout=3)
            if response.status_code == 200:
                return "ready"
        except httpx.HTTPError:
            pass
        return "model_starting"

    @application.get("/")
    @application.get("/health")
    async def health():
        status = await readiness()
        return JSONResponse(
            {"service": "Revsy PaddleOCR-VL", "ready": status == "ready", "status": status},
            status_code=200 if status == "ready" else 503,
            headers={"Cache-Control": "no-store"},
        )

    async def forward(payload):
        try:
            async with application.state.client.stream("POST", "/layout-parsing", json=payload) as upstream:
                if upstream.status_code != 200:
                    raise HTTPException(502, "The OCR pipeline could not process this PDF.")
                body = bytearray()
                async for chunk in upstream.aiter_bytes():
                    if len(body) + len(chunk) > MAX_RESPONSE_BYTES:
                        raise HTTPException(502, "The OCR output is too large. Split the PDF into smaller files.")
                    body.extend(chunk)
                try:
                    result = json.loads(body)
                except (ValueError, UnicodeError, RecursionError):
                    raise HTTPException(502, "The OCR pipeline returned an invalid response.") from None
                if not isinstance(result, dict):
                    raise HTTPException(502, "The OCR pipeline returned an invalid response.")
                if result.get("errorCode") != 0 or not isinstance(result.get("result"), dict):
                    raise HTTPException(502, "The OCR pipeline could not process this PDF.")
                return Response(bytes(body), media_type="application/json", headers={"Cache-Control": "no-store"})
        except httpx.TimeoutException:
            application.state.launch_failed = True
            await stop_native(application.state.native_process)
            raise HTTPException(504, "OCR processing timed out. Split the PDF into smaller files.") from None
        except asyncio.CancelledError:
            application.state.launch_failed = True
            await asyncio.shield(stop_native(application.state.native_process))
            raise
        except httpx.HTTPError:
            application.state.launch_failed = True
            await stop_native(application.state.native_process)
            raise HTTPException(502, "The OCR pipeline is unavailable. Check its health and retry.") from None

    async def resolve_source(payload):
        if not payload["file"].startswith("https://"):
            return payload
        # Never let the native downloader follow a redirect or print a signed URL.
        try:
            async with application.state.source_client.stream("GET", payload["file"]) as source:
                if source.status_code != 200:
                    raise HTTPException(502, "The PDF source is unavailable or its signed URL has expired.")
                length = source.headers.get("content-length")
                if length is not None:
                    try:
                        size = int(length)
                    except ValueError:
                        raise HTTPException(502, "The PDF source returned an invalid response.") from None
                    if size < 0:
                        raise HTTPException(502, "The PDF source returned an invalid response.")
                    if size > MAX_PDF_BYTES:
                        raise HTTPException(413, "PDF content exceeds 25 MB.")
                body = bytearray()
                async for chunk in source.aiter_bytes():
                    if len(body) + len(chunk) > MAX_PDF_BYTES:
                        raise HTTPException(413, "PDF content exceeds 25 MB.")
                    body.extend(chunk)
                if not body or b"%PDF-" not in body[:1024]:
                    raise HTTPException(400, "The supplied content is not a PDF.")
                return {**payload, "file": base64.b64encode(body).decode("ascii")}
        except httpx.HTTPError:
            raise HTTPException(502, "The PDF source could not be downloaded. Retry with a fresh signed URL.") from None

    @application.post("/layout-parsing")
    async def layout_parsing(request: Request):
        authenticate(request, application.state.settings)
        if await readiness() != "ready":
            raise HTTPException(503, "The OCR model is not ready. Check /health and retry.")
        try:
            await asyncio.wait_for(application.state.model_lock.acquire(), QUEUE_WAIT_SECONDS)
        except asyncio.TimeoutError:
            raise HTTPException(429, "The OCR model is busy. Retry shortly.", headers={"Retry-After": "10"}) from None
        try:
            try:
                payload = await asyncio.wait_for(read_payload(request, application.state.settings), BODY_TIMEOUT_SECONDS)
                payload = await asyncio.wait_for(resolve_source(payload), BODY_TIMEOUT_SECONDS)
            except asyncio.TimeoutError:
                raise HTTPException(408, "The PDF upload timed out. Retry the request.") from None
            try:
                return await asyncio.wait_for(forward(payload), MODEL_TIMEOUT_SECONDS)
            except asyncio.TimeoutError:
                # A disconnected native request can continue using the GPU. Fail closed
                # until the Space restarts instead of overlapping another inference.
                application.state.launch_failed = True
                await stop_native(application.state.native_process)
                raise HTTPException(504, "OCR processing timed out. Split the PDF into smaller files.") from None
        finally:
            application.state.model_lock.release()

    return application


app = create_app()
