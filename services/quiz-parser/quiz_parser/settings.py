"""Server-only settings. No inference or Firebase Admin secrets enter the browser."""

from dataclasses import dataclass
import os
from urllib.parse import urlparse


def csv_env(name: str) -> tuple[str, ...]:
    return tuple(v.strip() for v in os.environ.get(name, "").split(",") if v.strip())


@dataclass(frozen=True)
class Settings:
    bucket: str
    project_id: str
    paddle_url: str
    hf_token: str
    structuring_model: str
    origins: tuple[str, ...]
    image_hosts: tuple[str, ...] = ()
    paddle_token: str = ""
    poll_seconds: int = 5
    lease_seconds: int = 180
    max_attempts: int = 3

    @classmethod
    def from_env(cls) -> "Settings":
        settings = cls(
            bucket=os.environ.get("FIREBASE_STORAGE_BUCKET", ""),
            project_id=os.environ.get("FIREBASE_PROJECT_ID", ""),
            paddle_url=os.environ.get("PADDLEOCR_URL", "").rstrip("/"),
            hf_token=os.environ.get("HF_TOKEN", ""),
            structuring_model=os.environ.get("HF_STRUCTURING_MODEL", "Qwen/Qwen3-235B-A22B-Instruct-2507"),
            origins=csv_env("ALLOWED_ORIGINS"),
            image_hosts=csv_env("PADDLE_IMAGE_HOSTS"),
            paddle_token=os.environ.get("PADDLEOCR_TOKEN", ""),
            poll_seconds=int(os.environ.get("QUEUE_POLL_SECONDS", "5")),
            lease_seconds=int(os.environ.get("JOB_LEASE_SECONDS", "180")),
            max_attempts=int(os.environ.get("JOB_MAX_ATTEMPTS", "3")),
        )
        if not all((settings.bucket, settings.project_id, settings.paddle_url, settings.hf_token, settings.origins)):
            raise RuntimeError("Configure Firebase, PaddleOCR, Hugging Face, and ALLOWED_ORIGINS before starting the service.")
        parsed = urlparse(settings.paddle_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            raise RuntimeError("PADDLEOCR_URL must be a server-controlled HTTP(S) endpoint.")
        if "*" in settings.origins or any(urlparse(origin).scheme not in {"http", "https"} for origin in settings.origins):
            raise RuntimeError("ALLOWED_ORIGINS must contain exact HTTP(S) origins.")
        if not 1 <= settings.poll_seconds <= 60 or not 90 <= settings.lease_seconds <= 900 or not 1 <= settings.max_attempts <= 5:
            raise RuntimeError("Queue settings are outside supported limits.")
        return settings
