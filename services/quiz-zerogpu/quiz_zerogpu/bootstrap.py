"""Server-only configuration for optional Firebase integration."""

import os
from urllib.parse import urlsplit

from quiz_parser.settings import Settings
from .integration import FreeModels, FreeWorker, checked_space_url


def firebase_settings(environ=None):
    values = os.environ if environ is None else environ
    origins = tuple(dict.fromkeys(value.strip().rstrip("/") for value in
                    values.get("ALLOWED_ORIGINS", "").split(",") if value.strip()))
    for origin in origins:
        try:
            parsed = urlsplit(origin)
            valid = (parsed.hostname and (parsed.scheme == "https" or
                     (parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"})) and
                     not parsed.username and not parsed.password and parsed.path in {"", "/"} and
                     not parsed.query and not parsed.fragment and "*" not in origin)
            _ = parsed.port
        except ValueError:
            valid = False
        if not valid:
            raise RuntimeError("ALLOWED_ORIGINS must contain exact HTTPS origins or HTTP localhost origins.")
    settings = Settings(bucket=values.get("FIREBASE_STORAGE_BUCKET", "").strip(),
                        project_id=values.get("FIREBASE_PROJECT_ID", "").strip(),
                        paddle_url=checked_space_url(values.get("QUIZ_SPACE_URL", "")),
                        hf_token=values.get("HF_TOKEN", "").strip(),
                        structuring_model="deterministic numbered MCQs",
                        origins=origins, paddle_token=values.get("QUIZ_OCR_TOKEN", "").strip())
    if not all((settings.bucket, settings.project_id, settings.hf_token, settings.paddle_token, settings.origins)):
        raise RuntimeError("Configure Firebase, server HF/OCR secrets and ALLOWED_ORIGINS before enabling imports.")
    return settings


def firebase_runtime():
    from quiz_parser.firebase_store import FirebaseStore
    settings = firebase_settings()
    store = FirebaseStore(settings)
    models = FreeModels(settings)
    return settings, store, FreeWorker(store, models)
