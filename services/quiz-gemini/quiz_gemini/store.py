"""Immutable extraction checkpoints avoid paying again for completed phases."""

import json
from quiz_parser.domain import InvalidImport, canonical_job_id
from quiz_parser.firebase_store import FirebaseStore

MAX_CHECKPOINT_BYTES = 2 * 1024 * 1024


def checkpoint_path(job, name):
    if name not in {"key", "question"}:
        raise InvalidImport("Unknown extraction checkpoint.")
    path = job.get(name + "CheckpointPath")
    if path is None:
        return None
    prefix = f"users/{job['uid']}/quiz-imports/{job['id']}/assets/"
    if not isinstance(path, str) or not path.startswith(prefix):
        raise InvalidImport("An extraction checkpoint belongs to another import.")
    relative = path[len(prefix):].split("/")
    if len(relative) != 2 or relative[1] != name + "-extraction.json":
        raise InvalidImport("An extraction checkpoint belongs to another import.")
    try:
        canonical_job_id(relative[0])
    except InvalidImport:
        raise InvalidImport("The extraction checkpoint has an invalid lease folder.") from None
    return path


def decode_checkpoint(data):
    if len(data) > MAX_CHECKPOINT_BYTES:
        raise InvalidImport("The saved extraction checkpoint is too large.")
    try:
        value = json.loads(data)
    except (ValueError, UnicodeError):
        raise InvalidImport("The saved extraction checkpoint could not be read.") from None
    if (not isinstance(value, dict) or value.get("schemaVersion") != 1 or
            not isinstance(value.get("value"), dict) or not isinstance(value.get("usage"), dict)
            or not isinstance(value.get("model"), str)):
        raise InvalidImport("The saved extraction checkpoint is invalid.")
    return value


class GeminiStore(FirebaseStore):
    def load_checkpoint(self, job, name):
        path = checkpoint_path(job, name)
        if path is None:
            return None
        blob = self.bucket.blob(path)
        blob.reload(timeout=20)
        if not blob.size or blob.size > MAX_CHECKPOINT_BYTES:
            raise InvalidImport("The saved extraction checkpoint is invalid.")
        return decode_checkpoint(blob.download_as_bytes(timeout=30, if_generation_match=blob.generation))

    def save_checkpoint(self, job, name, value):
        if name not in {"key", "question"}:
            raise InvalidImport("Unknown extraction checkpoint.")
        canonical_job_id(job["leaseToken"])
        data = json.dumps(value, ensure_ascii=False).encode("utf-8")
        if len(data) > MAX_CHECKPOINT_BYTES:
            raise InvalidImport("The extraction checkpoint is too large. Split this paper by session.")
        self.owned_update(job, {})
        path = f"users/{job['uid']}/quiz-imports/{job['id']}/assets/{job['leaseToken']}/{name}-extraction.json"
        self.bucket.blob(path).upload_from_string(data, content_type="application/json", timeout=30, if_generation_match=0)
        self.owned_update(job, {name + "CheckpointPath": path})
        job[name + "CheckpointPath"] = path
