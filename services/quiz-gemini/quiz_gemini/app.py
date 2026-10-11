"""Firebase ID-token intake plus request-bound, Google-OIDC-protected task processing."""

from contextlib import asynccontextmanager
import hashlib
import json
import os
from urllib.parse import urlsplit

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from quiz_parser.api import bearer, create_app
from quiz_parser.domain import InvalidImport, canonical_job_id
from quiz_parser.settings import Settings
from .provider import GeminiClient
from .store import GeminiStore
from .worker import GeminiWorker


def https_origin(value):
    parsed = urlsplit(value)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.path not in {"", "/"} or parsed.query or parsed.fragment):
        raise ValueError("Production parser URLs must be exact HTTPS origins.")
    return value.rstrip("/")


class TaskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    uid: str = Field(min_length=1, max_length=128)
    id: str = Field(min_length=36, max_length=36)


class NoteSummaryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(strict=True, min_length=1, max_length=6000)

    @field_validator("text")
    @classmethod
    def nonblank_text(cls, value):
        if not value.strip():
            raise ValueError("Enter a problem description to summarize.")
        return value


class TaskEnqueuer:
    def __init__(self, queue, service_account, audience, *, client=None):
        import re
        if not re.fullmatch(r"projects/[a-z0-9-]+/locations/[a-z0-9-]+/queues/[A-Za-z0-9_-]+", queue):
            raise ValueError("CLOUD_TASKS_QUEUE must be a full queue resource name.")
        if not re.fullmatch(r"[A-Za-z0-9_-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com", service_account):
            raise ValueError("TASKS_SERVICE_ACCOUNT must be the task identity's email.")
        if queue.split("/")[1] != service_account.split("@", 1)[1].split(".", 1)[0]:
            raise ValueError("The task identity must belong to the Cloud Tasks queue's project.")
        self.queue, self.service_account, self.audience = queue, service_account, https_origin(audience)
        if client is None:
            from google.cloud import tasks_v2
            client = tasks_v2.CloudTasksClient()
        self.client = client

    def __call__(self, uid, payload):
        from google.api_core.exceptions import AlreadyExists
        from google.protobuf.duration_pb2 import Duration
        canonical_job_id(payload["id"])
        owner = hashlib.sha256(uid.encode("utf-8")).hexdigest()[:32]
        task = {"name": self.queue + "/tasks/import-" + owner + "-" + payload["id"],
                "http_request": {"http_method": "POST", "url": self.audience + "/internal/process",
                    "headers": {"Content-Type": "application/json"},
                    "body": json.dumps({"uid": uid, "id": payload["id"]}).encode("utf-8"),
                    "oidc_token": {"service_account_email": self.service_account, "audience": self.audience}},
                "dispatch_deadline": Duration(seconds=1800)}
        try:
            self.client.create_task(parent=self.queue, task=task, timeout=15)
        except AlreadyExists:
            pass  # Repeating intake never submits another expensive extraction.


def build_app(settings, store, models, *, enqueuer=None, task_identity=None, task_audience=None,
              token_verifier=None, local_worker=False):
    worker = GeminiWorker(store, models)
    app = create_app(settings, store, run_worker=False, on_job=enqueuer)
    # Hosting forwards /api unchanged; localhost keeps legacy /jobs and /health.
    for route in list(app.routes):
        if getattr(route, "path", None) in {"/jobs", "/health"}:
            app.add_api_route("/api" + route.path, route.endpoint, methods=list(route.methods),
                              status_code=route.status_code, include_in_schema=False)

    @asynccontextmanager
    async def lifespan(_app):
        if local_worker:
            worker.start()
        try:
            yield
        finally:
            if local_worker:
                worker.stop()
            models.close()
    app.router.lifespan_context = lifespan

    def note_user(credentials=Depends(bearer)):
        if credentials is None or credentials.scheme.lower() != "bearer":
            raise HTTPException(401, "Sign in to summarize a note.")
        try:
            return store.verify_token(credentials.credentials)
        except Exception:
            raise HTTPException(401, "Your session expired. Sign in again.") from None

    @app.post("/notes/summarize", include_in_schema=False)
    @app.post("/api/notes/summarize")
    def summarize_note(request: NoteSummaryRequest, _uid=Depends(note_user)):
        try:
            summary = models.summarize(request.text)
            if not isinstance(summary, str) or not summary.strip() or len(summary) > 20_000:
                raise ValueError("Invalid note summary")
            return {"summary": summary}
        except Exception:
            raise HTTPException(503, "Could not summarize right now. Please try again later.") from None

    def task_auth(credentials=Depends(bearer)):
        if (local_worker or not task_identity or not task_audience or credentials is None
                or credentials.scheme.lower() != "bearer"):
            raise HTTPException(401, "This endpoint requires the configured task identity.")
        try:
            if token_verifier:
                claims = token_verifier(credentials.credentials, task_audience)
            else:
                from google.auth.transport.requests import Request
                from google.oauth2.id_token import verify_oauth2_token
                claims = verify_oauth2_token(credentials.credentials, Request(), audience=task_audience)
            if (claims.get("email") != task_identity or claims.get("email_verified") is not True
                    or claims.get("aud") != task_audience or
                    claims.get("iss") not in {"accounts.google.com", "https://accounts.google.com"}):
                raise ValueError("Wrong task identity")
        except Exception:
            raise HTTPException(401, "The task identity could not be verified.") from None

    @app.post("/internal/process", dependencies=[Depends(task_auth)])
    def process_task(request: TaskRequest):
        try:
            canonical_job_id(request.id)
            if "/" in request.uid or request.uid in {".", ".."}:
                raise InvalidImport("Invalid task owner.")
            reference = store.db.collection("users").document(request.uid).collection("quizImports").document(request.id)
            job = store.claim(reference)
            if job is None:
                snapshot = reference.get()
                data = snapshot.to_dict() if snapshot.exists else None
                if data and data.get("status") in {"ready", "failed"}:
                    return {"status": "already-processed"}
                if not data:
                    return {"status": "missing"}
                raise HTTPException(503, "This import has an active parsing lease. Retry later.")
            worker.process(job)
            snapshot = reference.get()
            data = snapshot.to_dict() if snapshot.exists else None
            if not data or data.get("status") not in {"ready", "failed"}:
                # The worker may stop after losing its lease or failing to save
                # a terminal update. Cloud Tasks must retain the delivery so it
                # can recover after the lease expires; there is no cloud poller.
                raise HTTPException(503, "Parsing has not reached a saved result. Retry later.")
            return {"status": "processed"}
        except InvalidImport as error:
            raise HTTPException(400, str(error)) from None
    return app


def create_application():
    project = os.environ["FIREBASE_PROJECT_ID"]
    bucket = os.environ["FIREBASE_STORAGE_BUCKET"]
    origins = tuple(https_origin(origin.strip()) for origin in
        os.environ.get("ALLOWED_ORIGINS", os.environ.get("FRONTEND_ORIGIN", "")).split(",") if origin.strip())
    if not origins:
        raise ValueError("Configure an exact frontend origin.")
    audience = https_origin(os.environ["TASKS_AUDIENCE"])
    if https_origin(os.environ.get("PARSER_PUBLIC_URL", audience)) != audience:
        raise ValueError("The task audience and parser URL must refer to the same service.")
    settings = Settings(bucket=bucket, project_id=project, paddle_url="https://generativelanguage.googleapis.com",
                        hf_token="", structuring_model="Gemini", origins=origins)
    models = GeminiClient(os.environ["GEMINI_API_KEY"], os.environ.get("GEMINI_MODEL", "gemini-3.8-flash"))
    store = GeminiStore(settings)
    enqueuer = TaskEnqueuer(os.environ["CLOUD_TASKS_QUEUE"], os.environ["TASKS_SERVICE_ACCOUNT"], audience)
    return build_app(settings, store, models, enqueuer=enqueuer,
                     task_identity=enqueuer.service_account, task_audience=audience)
