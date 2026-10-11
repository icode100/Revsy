"""Local Firebase emulators with server-side Gemini PDF extraction.

Only Gemini receives PDFs remotely. Firebase credentials are not loaded; every
database/storage/auth endpoint is loopback in the isolated demo- project.
"""

import argparse
from contextlib import asynccontextmanager
import json
import logging
import os
from pathlib import Path
import sys
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "scripts"), str(ROOT / "services" / "quiz-gemini")]
from run_local_quiz_parser import (EmulatorStore, LOCAL_BUCKET, LOCAL_PROJECT,
                                   bounded_response, local_settings)
from quiz_parser.domain import InvalidImport, canonical_job_id
from quiz_gemini.app import build_app
from quiz_gemini.provider import GeminiClient
from quiz_gemini.store import MAX_CHECKPOINT_BYTES, checkpoint_path, decode_checkpoint


class LocalGeminiStore(EmulatorStore):
    def load_checkpoint(self, job, name):
        path = checkpoint_path(job, name)
        if path is None:
            return None
        response = self.client.get(self._blob_url(path), headers=self.headers)
        response.raise_for_status()
        metadata = response.json()
        if (metadata.get("contentType") != "application/json" or
                not 0 < int(metadata.get("size", 0)) <= MAX_CHECKPOINT_BYTES):
            raise InvalidImport("The saved extraction checkpoint is invalid.")
        with self.client.stream("GET", self._blob_url(path), headers=self.headers,
                params={"alt": "media", "generation": metadata["generation"]}) as response:
            response.raise_for_status()
            return decode_checkpoint(bounded_response(response, MAX_CHECKPOINT_BYTES))

    def save_checkpoint(self, job, name, value):
        # Validate the checkpoint name before constructing any Storage path.
        checkpoint_path(job, name)
        canonical_job_id(job["leaseToken"])
        data = json.dumps(value, ensure_ascii=False).encode("utf-8")
        if len(data) > MAX_CHECKPOINT_BYTES:
            raise InvalidImport("The extraction checkpoint is too large. Split this paper by session.")
        self.owned_update(job, {})
        path = f"users/{job['uid']}/quiz-imports/{job['id']}/assets/{job['leaseToken']}/{name}-extraction.json"
        response = self.client.post(self.storage_url + "/v0/b/" + quote(self.settings.bucket, safe="") + "/o",
            params={"name": path, "ifGenerationMatch": "0"}, content=data,
            headers={**self.headers, "Content-Type": "application/json", "X-Goog-Upload-Protocol": "raw"})
        response.raise_for_status()
        self.owned_update(job, {name + "CheckpointPath": path})
        job[name + "CheckpointPath"] = path


def create_local_app(settings, store, models):
    app = build_app(settings, store, models, local_worker=True)
    base_lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(_app):
        try:
            async with base_lifespan(_app):
                yield
        finally:
            store.close()
    app.router.lifespan_context = lifespan
    return app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=ROOT / ".env.deploy.local")
    parser.add_argument("--project", default=LOCAL_PROJECT)
    parser.add_argument("--bucket", default=LOCAL_BUCKET)
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument("--auth-host", default="127.0.0.1:9099")
    parser.add_argument("--firestore-host", default="127.0.0.1:8080")
    parser.add_argument("--storage-host", default="127.0.0.1:9199")
    args = parser.parse_args()
    try:
        settings = local_settings(args.project, args.bucket)
        from deploy_quiz_spaces import read_deploy_env
        configured = read_deploy_env(args.env_file) if args.env_file.is_file() else {}
        key = os.environ.get("GEMINI_API_KEY") or configured.get("GEMINI_API_KEY")
        model = os.environ.get("GEMINI_MODEL") or configured.get("GEMINI_MODEL") or "gemini-3.8-flash"
        models = GeminiClient(key, model)
        store = LocalGeminiStore(settings, auth_host=args.auth_host,
            firestore_host=args.firestore_host, storage_host=args.storage_host)
        app = create_local_app(settings, store, models)
        import uvicorn
    except Exception as error:
        parser.error("Cannot start local Gemini parser (" + type(error).__name__ +
            "). Check Python dependencies, loopback emulator settings and server-only GEMINI_API_KEY.")
    logging.basicConfig(level=logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info", access_log=False)


if __name__ == "__main__":
    main()
