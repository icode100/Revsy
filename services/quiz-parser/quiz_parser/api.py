"""Thin authenticated HTTP intake. Inference runs from the durable queue."""

from contextlib import asynccontextmanager
import logging

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field

from .domain import InvalidImport, bounded_text, validate_paths
from .firebase_store import FirebaseStore
from .pipeline import Models
from .settings import Settings
from .worker import Worker

logger = logging.getLogger("quiz_parser")
bearer = HTTPBearer(auto_error=False)


class JobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=36, max_length=36)
    title: str = Field(min_length=1, max_length=160)
    paperPath: str = Field(min_length=1, max_length=512)
    answerKeyPath: str | None = Field(default=None, max_length=512)


class BodyLimit:
    """Bound the actual ASGI request body, including chunked uploads."""

    def __init__(self, app, limit=8192):
        self.app, self.limit = app, limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] in {"GET", "OPTIONS"}:
            return await self.app(scope, receive, send)
        chunks, size = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            size += len(message.get("body", b""))
            if size > self.limit:
                await send({"type": "http.response.start", "status": 413,
                            "headers": [(b"content-type", b"application/json")]})
                await send({"type": "http.response.body", "body": b'{"detail":"Import request is too large."}'})
                return
            chunks.append(message.get("body", b""))
            if not message.get("more_body", False):
                break
        delivered = False

        async def buffered_receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": b"".join(chunks), "more_body": False}
            return await receive()

        await self.app(scope, buffered_receive, send)


def create_app(settings=None, store=None, *, run_worker=True, on_job=None):
    settings = settings or Settings.from_env()
    store = store or FirebaseStore(settings)
    worker = Worker(store, Models(settings))

    @asynccontextmanager
    async def lifespan(_):
        if run_worker:
            worker.start()
        try:
            yield
        finally:
            if run_worker:
                worker.stop()

    app = FastAPI(title="Revsy quiz parser", version="1.0.0", lifespan=lifespan)
    app.add_middleware(BodyLimit)
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.origins),
                       allow_credentials=False, allow_methods=["POST", "GET"],
                       allow_headers=["Authorization", "Content-Type"])

    def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
        if credentials is None or credentials.scheme.lower() != "bearer":
            raise HTTPException(401, "Sign in to upload a quiz.")
        try:
            return store.verify_token(credentials.credentials)
        except Exception as exc:
            raise HTTPException(401, "Your session expired. Sign in again.") from exc

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.post("/jobs", status_code=202)
    def create_job(request: JobRequest, uid: str = Depends(current_user)):
        payload = request.model_dump(exclude_none=True)
        try:
            payload["title"] = bounded_text(payload["title"], "Quiz title", 160)
            validate_paths(uid, request.id, request.paperPath, request.answerKeyPath)
            store.inspect_pdf(request.paperPath)
            if request.answerKeyPath:
                store.inspect_pdf(request.answerKeyPath)
            job_id = store.create_job(uid, payload)
            if on_job is not None:
                on_job(uid, payload)
            return {"id": job_id}
        except InvalidImport as exc:
            raise HTTPException(400, str(exc)) from exc
        except Exception as exc:
            logger.error("Import intake failed (%s)", type(exc).__name__)
            raise HTTPException(503, "The import service could not accept this upload. Please retry.") from exc

    return app
