"""Run quiz imports against local Firebase emulators and the free HF preview.

No production Firebase credential is loaded. Every Firebase endpoint must be
loopback and the project must use Firebase's demo- prefix. The HF token stays
in this server process; PDFs are sent to the configured public OCR Space.
"""

import argparse
import base64
from contextlib import asynccontextmanager
import io
import json
import logging
import os
from pathlib import Path
import re
import ssl
import subprocess
import sys
import threading
import time
from urllib.parse import quote, unquote, urlsplit
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "services" / "quiz-parser"),
               str(ROOT / "services" / "quiz-zerogpu")]
if (ROOT / ".test-deps").is_dir():
    sys.path.insert(0, str(ROOT / ".test-deps"))

from quiz_parser.domain import (InvalidImport, LeaseLost, MAX_PDF_BYTES,
                                PROCESSING_STATUSES, may_claim,
                                owner_from_document_path, validate_paths)
from quiz_parser.firebase_store import now_ms
from quiz_parser.pipeline import checked_png
from quiz_parser.settings import Settings
from quiz_parser.worker import Heartbeat, Worker
from quiz_zerogpu.demo import validate_batch
from quiz_zerogpu.integration import checked_space_url
from quiz_zerogpu.key_recovery import structure_with_key_recovery

logger = logging.getLogger("revsy_local_quiz")
DEFAULT_SPACE = "https://icode100-revsy-quiz-zerogpu.hf.space"
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
LOCAL_PROJECT = "demo-revsy"
LOCAL_BUCKET = LOCAL_PROJECT + ".appspot.com"


def emulator_origin(value):
    """Accept an explicit host:port on loopback; never resolve arbitrary DNS."""
    try:
        parsed = urlsplit("http://" + value)
        valid = (parsed.hostname in {"127.0.0.1", "localhost", "::1"} and
                 parsed.port is not None and 1 <= parsed.port <= 65535 and
                 not parsed.username and not parsed.password and
                 not parsed.path and not parsed.query and not parsed.fragment)
    except (ValueError, TypeError):
        valid = False
    if not valid:
        raise ValueError("Firebase emulator endpoints must be loopback host:port values.")
    return "http://" + value


def local_settings(project=LOCAL_PROJECT, bucket=LOCAL_BUCKET):
    if not re.fullmatch(r"demo-[a-z0-9][a-z0-9-]{1,40}", project):
        raise ValueError("Local testing requires a demo- Firebase project.")
    if bucket != project + ".appspot.com":
        raise ValueError("The local Storage bucket must belong to the demo project.")
    return Settings(bucket=bucket, project_id=project, paddle_url=DEFAULT_SPACE,
                    hf_token="local-only", structuring_model="numbered MCQs",
                    origins=("http://localhost:5173", "http://127.0.0.1:5173"),
                    poll_seconds=1, lease_seconds=180, max_attempts=3)


def encode_value(value):
    if value is None:
        return {"nullValue": None}
    if type(value) is bool:
        return {"booleanValue": value}
    if type(value) is int:
        return {"integerValue": str(value)}
    if type(value) is float:
        return {"doubleValue": value}
    if isinstance(value, str):
        return {"stringValue": value}
    if isinstance(value, list):
        return {"arrayValue": {"values": [encode_value(item) for item in value]}}
    if isinstance(value, dict):
        return {"mapValue": {"fields": {key: encode_value(item) for key, item in value.items()}}}
    raise ValueError("Unsupported local Firestore value.")


def decode_value(value):
    if "integerValue" in value:
        return int(value["integerValue"])
    for key in ("stringValue", "booleanValue", "doubleValue", "nullValue"):
        if key in value:
            return value[key]
    if "arrayValue" in value:
        return [decode_value(item) for item in value["arrayValue"].get("values", [])]
    if "mapValue" in value:
        return {key: decode_value(item) for key, item in value["mapValue"].get("fields", {}).items()}
    raise ValueError("Unsupported local Firestore response.")


class EmulatorStore:
    """Small REST adapter with update-time preconditions for import leases."""

    def __init__(self, settings, *, auth_host="127.0.0.1:9099",
                 firestore_host="127.0.0.1:8080", storage_host="127.0.0.1:9199",
                 client=None):
        local_settings(settings.project_id, settings.bucket)
        self.settings = settings
        self.auth_url = emulator_origin(auth_host)
        self.firestore_url = emulator_origin(firestore_host)
        self.storage_url = emulator_origin(storage_host)
        self.documents = (self.firestore_url + "/v1/projects/" + settings.project_id +
                          "/databases/(default)/documents")
        self.name_prefix = "projects/" + settings.project_id + "/databases/(default)/documents/"
        self.lock = threading.RLock()
        if client is None:
            import httpx
            client = httpx.Client(timeout=30, trust_env=False, follow_redirects=False)
        self.client = client
        self.headers = {"Authorization": "Bearer owner"}

    def close(self):
        self.client.close()

    def verify_token(self, token):
        # Reject production ID tokens before calling even the local emulator.
        try:
            if not isinstance(token, str) or len(token) > 8192:
                raise ValueError
            header, payload, signature = token.split(".")
            def part(value):
                return json.loads(base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)))
            claims = part(payload)
            if (part(header).get("alg") != "none" or signature or
                    claims.get("aud") != self.settings.project_id or
                    claims.get("iss") != "https://securetoken.google.com/" + self.settings.project_id or
                    claims.get("exp", 0) <= time.time()):
                raise ValueError
            response = self.client.post(self.auth_url +
                "/identitytoolkit.googleapis.com/v1/accounts:lookup?key=local-emulator-key",
                json={"idToken": token})
            response.raise_for_status()
            users = response.json().get("users", [])
            uid = claims.get("sub")
            if (len(users) != 1 or users[0].get("localId") != uid or
                    users[0].get("disabled") or not isinstance(uid, str) or
                    not uid or "/" in uid):
                raise ValueError
            return uid
        except Exception:
            raise InvalidImport("Sign in with a local emulator account.") from None

    def _path(self, reference):
        owner_from_document_path(reference)
        return self.documents + "/" + quote(reference, safe="/")

    def _read(self, reference):
        response = self.client.get(self._path(reference), headers=self.headers)
        if response.status_code == 404:
            return None, None
        response.raise_for_status()
        value = response.json()
        data = {key: decode_value(item) for key, item in value.get("fields", {}).items()}
        return data, value.get("updateTime")

    def _patch(self, reference, values, version, *, remove=()):
        fields = {key: encode_value(value) for key, value in values.items()}
        write = {"update": {"name": self.name_prefix + reference, "fields": fields},
                 "updateMask": {"fieldPaths": [*values, *remove]},
                 "currentDocument": {"updateTime": version}}
        response = self.client.post(self.documents + ":commit", headers=self.headers,
                                    json={"writes": [write]})
        if response.status_code in {409, 412}:
            return False
        response.raise_for_status()
        return True

    def create_job(self, uid, request):
        validate_paths(uid, request["id"], request["paperPath"], request.get("answerKeyPath"))
        reference = f"users/{uid}/quizImports/{request['id']}"
        with self.lock:
            existing, _ = self._read(reference)
            if existing is not None:
                if any(existing.get(key) != request.get(key) for key in ("title", "paperPath", "answerKeyPath")):
                    raise InvalidImport("This import ID is already used. Start a new upload.")
                return request["id"]
            data = {**request, "ownerUid": uid, "status": "queued",
                    "message": "Waiting for the local parser…", "createdAt": now_ms(),
                    "updatedAt": now_ms(), "attempts": 0}
            response = self.client.post(self.documents + f"/users/{quote(uid, safe='')}/quizImports",
                headers=self.headers, params={"documentId": request["id"]},
                json={"fields": {key: encode_value(value) for key, value in data.items()}})
            response.raise_for_status()
            return request["id"]

    def candidates(self):
        response = self.client.post(self.documents + ":runQuery", headers=self.headers,
            json={"structuredQuery": {"from": [{"collectionId": "quizImports", "allDescendants": True}]}})
        response.raise_for_status()
        for item in response.json():
            document = item.get("document")
            if not document:
                continue
            name = document.get("name", "")
            if not name.startswith(self.name_prefix):
                continue
            reference = name[len(self.name_prefix):]
            data = {key: decode_value(value) for key, value in document.get("fields", {}).items()}
            expired = (data.get("status") == "queued" or data.get("status") in PROCESSING_STATUSES) and data.get("leaseUntil", 0) <= now_ms()
            if may_claim(data, now_ms(), self.settings.max_attempts) or expired:
                yield reference

    def claim(self, reference):
        uid, job_id = owner_from_document_path(reference)
        with self.lock:
            data, version = self._read(reference)
            if data is None or data.get("ownerUid") != uid or data.get("id") != job_id:
                return None
            validate_paths(uid, job_id, data.get("paperPath"), data.get("answerKeyPath"))
            if not may_claim(data, now_ms(), self.settings.max_attempts):
                if ((data.get("status") == "queued" or data.get("status") in PROCESSING_STATUSES) and
                        data.get("leaseUntil", 0) <= now_ms() and data.get("attempts", 0) >= self.settings.max_attempts):
                    self._patch(reference, {"status": "failed", "updatedAt": now_ms(),
                        "message": "Local parsing was interrupted repeatedly. Start a new import.",
                        "error": "Local parsing was interrupted repeatedly. Start a new import."}, version,
                        remove=("leaseToken", "leaseUntil"))
                return None
            values = {"status": "reading-paper", "message": "Reading the local paper…",
                      "leaseToken": str(uuid.uuid4()), "leaseUntil": now_ms() + self.settings.lease_seconds * 1000,
                      "attempts": data.get("attempts", 0) + 1, "updatedAt": now_ms()}
            if not self._patch(reference, values, version):
                return None
            return {**data, **values, "uid": uid, "reference": reference}

    def owned_update(self, job, values, *, terminal=False):
        reference = job["reference"]
        uid, job_id = owner_from_document_path(reference)
        with self.lock:
            for _ in range(3):
                data, version = self._read(reference)
                if (not data or uid != job["uid"] or job_id != job["id"] or
                        data.get("ownerUid") != uid or data.get("leaseToken") != job["leaseToken"] or
                        data.get("status") not in PROCESSING_STATUSES or data.get("leaseUntil", 0) <= now_ms()):
                    raise LeaseLost("The local import lease expired.")
                fields = {**values, "updatedAt": now_ms()}
                if not terminal:
                    fields["leaseUntil"] = now_ms() + self.settings.lease_seconds * 1000
                if self._patch(reference, fields, version,
                               remove=("leaseUntil", "leaseToken") if terminal else ()):
                    return
            raise LeaseLost("The local import changed concurrently.")

    def _blob_url(self, path):
        return self.storage_url + "/v0/b/" + quote(self.settings.bucket, safe="") + "/o/" + quote(path, safe="")

    def inspect_pdf(self, path):
        response = self.client.get(self._blob_url(path), headers=self.headers)
        if response.status_code == 404:
            raise InvalidImport("An uploaded local PDF was not found. Upload it again.")
        response.raise_for_status()
        metadata = response.json()
        if not 0 < int(metadata.get("size", 0)) <= MAX_PDF_BYTES or metadata.get("contentType") != "application/pdf":
            raise InvalidImport("Each upload must be a PDF under 25 MB.")
        return metadata

    def load_pdf(self, path):
        metadata = self.inspect_pdf(path)
        with self.client.stream("GET", self._blob_url(path), headers=self.headers,
                                params={"alt": "media"}) as response:
            response.raise_for_status()
            data = bounded_response(response, MAX_PDF_BYTES)
        if not data.startswith(b"%PDF-"):
            raise InvalidImport("The local upload is not a PDF.")
        return data, metadata

    def save_image(self, job, asset_id, content, page):
        self.owned_update(job, {})
        path = f"users/{job['uid']}/quiz-imports/{job['id']}/assets/{job['leaseToken']}/{asset_id}.png"
        response = self.client.post(self.storage_url + "/v0/b/" + quote(self.settings.bucket, safe="") + "/o",
            params={"name": path}, content=content,
            headers={**self.headers, "Content-Type": "image/png", "X-Goog-Upload-Protocol": "raw"})
        response.raise_for_status()
        return {"id": asset_id, "storagePath": path, "page": page}


def bounded_response(response, limit):
    chunks, total = [], 0
    for chunk in response.iter_bytes():
        total += len(chunk)
        if total > limit:
            raise InvalidImport("The OCR response exceeded the local test limit.")
        chunks.append(chunk)
    return b"".join(chunks)


def artifact_url(value, space):
    if not isinstance(value, dict) or not isinstance(value.get("path"), str):
        raise InvalidImport("OCR did not return its diagram archive.")
    path = value["path"]
    if (not path.startswith("/tmp/") or not path.endswith(".zip") or
            "\x00" in path or "\\" in path or ".." in path.split("/")):
        raise InvalidImport("OCR returned an invalid archive path.")
    url = value.get("url") or space + "/gradio_api/file=" + quote(path, safe="/")
    if isinstance(url, str) and url.startswith("/gradio_api/file="):
        url = space + url
    try:
        parsed = urlsplit(url)
        valid = (parsed.scheme == "https" and parsed.hostname == urlsplit(space).hostname and
                 not parsed.username and not parsed.password and parsed.port in {None, 443} and
                 not parsed.fragment and parsed.path.startswith("/gradio_api/file=") and
                 unquote(parsed.path[len("/gradio_api/file="):]) == path and len(url) <= 4096)
    except (ValueError, TypeError):
        valid = False
    if not valid:
        raise InvalidImport("OCR returned an invalid archive URL.")
    return url


def read_complete_event(response, timeout=900):
    started, event, data, size = time.monotonic(), "", [], 0
    for line in response.iter_lines():
        size += len(line.encode("utf-8"))
        if size > MAX_RESPONSE_BYTES or time.monotonic() - started > timeout:
            raise InvalidImport("The OCR response exceeded the local test limit.")
        if line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:].lstrip())
        elif not line:
            if event == "error":
                raise InvalidImport("Free OCR failed or its daily GPU quota is exhausted. Wait for the Space to be ready or quota to reset, then start a new import.")
            if event == "complete":
                result = json.loads("\n".join(data))
                if not isinstance(result, list) or len(result) != 5:
                    raise InvalidImport("OCR returned incomplete preview data.")
                return result
            event, data = "", []
    raise InvalidImport("The OCR connection ended before a result was returned.")


def network_proxy(*, windows_fallback=False):
    configured = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    if configured:
        return configured
    if windows_fallback and sys.platform == "win32":
        command = "[Console]::Write([System.Net.WebRequest]::DefaultWebProxy.GetProxy([Uri]'https://huggingface.co').AbsoluteUri)"
        route = subprocess.check_output(["powershell.exe", "-NoProfile", "-Command", command],
            creationflags=subprocess.CREATE_NO_WINDOW, timeout=10).decode().strip()
        return route if route.rstrip("/") != "https://huggingface.co" else None
    return None


class PreviewClient:
    def __init__(self, token, *, space=DEFAULT_SPACE, client=None):
        if not token:
            raise ValueError("Configure the server-only HF_TOKEN in .env.deploy.local.")
        self.space = checked_space_url(space)
        self.headers = {"Authorization": "Bearer " + token}
        self.owns_client = client is None
        if client is None:
            import httpx
            client = httpx.Client(proxy=network_proxy(), verify=ssl.create_default_context(),
                                  timeout=60, trust_env=False, follow_redirects=False)
        self.client = client

    def close(self):
        self.client.close()

    def parse(self, documents, title):
        validate_batch(documents)
        names = ["paper.pdf", "answer-key.pdf"][:len(documents)]
        import httpx
        try:
            paths = self._upload(names, documents)
        except (httpx.ConnectError, httpx.ConnectTimeout):
            # Only retry the pre-inference upload. A submitted GPU request must
            # never be replayed automatically and spend the quota twice.
            proxy = network_proxy(windows_fallback=True)
            if not self.owns_client or not proxy:
                raise
            self.client.close()
            self.client = httpx.Client(proxy=proxy, verify=ssl.create_default_context(),
                                        timeout=60, trust_env=False, follow_redirects=False)
            paths = self._upload(names, documents)
        if (not isinstance(paths, list) or len(paths) != len(documents) or any(
                not isinstance(path, str) or not path.startswith("/tmp/") or not path.endswith(".pdf") or
                "\x00" in path or "\\" in path or ".." in path.split("/") for path in paths)):
            raise InvalidImport("OCR returned invalid upload metadata.")
        files = [{"path": path, "orig_name": name, "mime_type": "application/pdf",
                  "meta": {"_type": "gradio.FileData"}} for name, path in zip(names, paths)]
        with self.client.stream("POST", self.space + "/gradio_api/call/preview", headers=self.headers,
            json={"data": [files[0], files[1] if len(files) == 2 else None, title]}) as response:
            response.raise_for_status()
            queued = json.loads(bounded_response(response, 8192))
        event_id = queued.get("event_id") if isinstance(queued, dict) else None
        if not isinstance(event_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", event_id):
            raise InvalidImport("OCR did not return a valid queue ID.")
        with self.client.stream("GET", self.space + "/gradio_api/call/preview/" + event_id,
                                headers=self.headers) as response:
            response.raise_for_status()
            outputs = read_complete_event(response)
        if not isinstance(outputs[1], str) or not isinstance(outputs[2], str):
            raise InvalidImport("OCR did not return source text.")
        with self.client.stream("GET", artifact_url(outputs[3], self.space), headers=self.headers) as response:
            response.raise_for_status()
            archive = bounded_response(response, MAX_ARCHIVE_BYTES)
        return outputs, archive

    def _upload(self, names, documents):
        with self.client.stream("POST", self.space + "/gradio_api/upload", headers=self.headers,
            files=[("files", (name, data, "application/pdf")) for name, data in zip(names, documents)]) as response:
            response.raise_for_status()
            return json.loads(bounded_response(response, 8192))


def parse_local_job(store, models, job):
    validate_paths(job["uid"], job["id"], job["paperPath"], job.get("answerKeyPath"))
    store.owned_update(job, {"status": "reading-paper", "message": "Checking local PDFs against the free 2-page limit…"})
    paper, _ = store.load_pdf(job["paperPath"])
    key = None
    if job.get("answerKeyPath"):
        store.owned_update(job, {"status": "reading-key", "message": "Reading the supplied local answer key…"})
        key, _ = store.load_pdf(job["answerKeyPath"])
    documents = [paper] + ([key] if key is not None else [])
    validate_batch(documents)
    store.owned_update(job, {"status": "reading-paper", "message": "Reading questions and equations with free Hugging Face OCR…"})
    outputs, archive_data = models.parse(documents, job["title"])
    store.owned_update(job, {"status": "storing-images", "message": "Saving original diagram crops in local object storage…"})
    assets = []
    try:
        with zipfile.ZipFile(io.BytesIO(archive_data)) as archive:
            entries = archive.infolist()
            if len(entries) > 203 or len({entry.filename for entry in entries}) != len(entries):
                raise InvalidImport("OCR returned an invalid diagram archive.")
            total = sum(entry.file_size for entry in entries)
            if total > MAX_ARCHIVE_BYTES:
                raise InvalidImport("The diagram archive is too large.")
            for entry in entries:
                if entry.filename in {"quiz.json", "paper-ocr.md", "key-ocr.md"}:
                    continue
                match = re.fullmatch(r"diagrams/(paper-p([12])-img([1-9][0-9]*))\.png", entry.filename)
                if not match or entry.file_size > 15 * 1024 * 1024:
                    raise InvalidImport("OCR returned an invalid diagram archive.")
                content = checked_png(archive.read(entry))
                assets.append(store.save_image(job, match[1], content, int(match[2])))
    except (zipfile.BadZipFile, RuntimeError, OSError):
        raise InvalidImport("OCR returned an unreadable diagram archive.") from None
    store.owned_update(job, {"status": "structuring", "message": "Organizing questions and matching the supplied answers…"})
    warnings = outputs[0].get("parsing", {}).get("warnings", []) if isinstance(outputs[0], dict) else []
    if not isinstance(warnings, list) or any(not isinstance(value, str) for value in warnings):
        warnings = []
    store.owned_update(job, {"status": "validating", "message": "Checking diagrams, questions and supplied key evidence…"})
    draft = structure_with_key_recovery(outputs[1], outputs[2] if key is not None else None,
        key_data=key, uid=job["uid"], job_id=job["id"], title=job["title"],
        paper_path=job["paperPath"], key_path=job.get("answerKeyPath"), assets=assets,
        model="PaddlePaddle/PaddleOCR-VL-1.6 + numbered MCQs (local emulators)", warnings=warnings)
    draft["parsing"]["warnings"] = list(dict.fromkeys(draft["parsing"]["warnings"]))
    return draft


class LocalWorker(Worker):
    def process(self, job):
        heartbeat = Heartbeat(self.store, job)
        heartbeat.start()
        try:
            draft = parse_local_job(self.store, self.models, job)
            heartbeat.stop()
            if heartbeat.lost:
                raise LeaseLost("The local lease heartbeat stopped.")
            self.store.owned_update(job, {"status": "ready", "message": "Ready to review and save locally.",
                                          "draft": draft}, terminal=True)
        except LeaseLost:
            logger.info("Local import stopped after losing its lease")
        except Exception as error:
            heartbeat.stop()
            message = str(error) if isinstance(error, InvalidImport) else "Free OCR could not finish. The Space may be starting or busy. Check its quota, then start a new import."
            try:
                self.store.owned_update(job, {"status": "failed", "message": message, "error": message}, terminal=True)
            except Exception:
                logger.error("Could not persist local import failure")
            logger.warning("Local import failed (%s)", type(error).__name__)
        finally:
            heartbeat.stop()


def create_local_app(settings, store, models):
    from quiz_parser.api import create_app
    worker = LocalWorker(store, models)
    app = create_app(settings, store, run_worker=False)

    @asynccontextmanager
    async def lifespan(_app):
        worker.start()
        try:
            yield
        finally:
            worker.stop()
            models.close()
            store.close()

    app.router.lifespan_context = lifespan
    return app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=ROOT / ".env.deploy.local")
    parser.add_argument("--project", default=LOCAL_PROJECT)
    parser.add_argument("--bucket", default=LOCAL_BUCKET)
    parser.add_argument("--space-url", default=DEFAULT_SPACE)
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument("--auth-host", default="127.0.0.1:9099")
    parser.add_argument("--firestore-host", default="127.0.0.1:8080")
    parser.add_argument("--storage-host", default="127.0.0.1:9199")
    args = parser.parse_args()
    try:
        settings = local_settings(args.project, args.bucket)
        from deploy_quiz_spaces import read_deploy_env
        token = os.environ.get("HF_TOKEN") or read_deploy_env(args.env_file).get("HF_TOKEN")
        if not token:
            parser.error("Set the server-only HF_TOKEN in .env.deploy.local before starting local quiz imports.")
        models = PreviewClient(token, space=args.space_url)
        store = EmulatorStore(settings, auth_host=args.auth_host,
                              firestore_host=args.firestore_host, storage_host=args.storage_host)
        app = create_local_app(settings, store, models)
        import uvicorn
    except Exception as error:
        parser.error("Cannot start local quiz parser (" + type(error).__name__ +
                     "). Check dependencies, local emulator settings and server-only HF_TOKEN.")
    logging.basicConfig(level=logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info", access_log=False)


if __name__ == "__main__":
    main()
