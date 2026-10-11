"""Firestore transactions are the only authority for queue ownership."""

from datetime import datetime, timedelta, timezone
import io
import json
import os
import time
import uuid

from .domain import (InvalidImport, LeaseLost, MAX_PDF_BYTES, PROCESSING_STATUSES,
                     may_claim, owner_from_document_path, validate_paths)


def now_ms() -> int:
    return int(time.time() * 1000)


class FirebaseStore:
    def __init__(self, settings):
        import firebase_admin
        from firebase_admin import credentials, firestore, storage
        if not firebase_admin._apps:
            certificate = None
            service_account_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
            if service_account_json:
                try:
                    certificate_data = json.loads(service_account_json)
                    if not isinstance(certificate_data, dict) or certificate_data.get("project_id") != settings.project_id:
                        raise ValueError("Project mismatch")
                    certificate = credentials.Certificate(certificate_data)
                except (ValueError, TypeError, KeyError) as exc:
                    raise RuntimeError("FIREBASE_SERVICE_ACCOUNT_JSON must be a valid service account for FIREBASE_PROJECT_ID.") from exc
            firebase_admin.initialize_app(certificate, options={
                "projectId": settings.project_id, "storageBucket": settings.bucket,
            })
        self.db = firestore.client()
        self.bucket = storage.bucket(settings.bucket)
        self.settings = settings
        self.transactional = firestore.transactional

    def verify_token(self, token: str) -> str:
        from firebase_admin import auth
        decoded = auth.verify_id_token(token, check_revoked=True)
        uid = decoded.get("uid")
        if not isinstance(uid, str) or "/" in uid:
            raise InvalidImport("Invalid Firebase account.")
        return uid

    def inspect_pdf(self, path: str):
        from google.api_core.exceptions import NotFound
        blob = self.bucket.blob(path)
        try:
            blob.reload(timeout=20)
            if not blob.size or blob.size > MAX_PDF_BYTES:
                raise InvalidImport("Each PDF must be nonempty and no larger than 25 MB.")
            if blob.content_type != "application/pdf":
                raise InvalidImport("Upload a PDF with the application/pdf content type.")
            header = blob.download_as_bytes(start=0, end=1023, if_generation_match=blob.generation, timeout=20)
            if not header.startswith(b"%PDF-"):
                raise InvalidImport("The uploaded file is not a valid PDF.")
        except NotFound as exc:
            raise InvalidImport("An uploaded PDF was not found. Upload it again.") from exc
        return blob

    def load_pdf(self, path: str) -> tuple[bytes, object]:
        blob = self.inspect_pdf(path)
        destination = io.BytesIO()
        blob.download_to_file(destination, if_generation_match=blob.generation, timeout=60)
        data = destination.getvalue()
        if not data or len(data) > MAX_PDF_BYTES or not data.startswith(b"%PDF-"):
            raise InvalidImport("The uploaded file is not a valid PDF under 25 MB.")
        return data, blob

    def signed_pdf_url(self, blob) -> str:
        return blob.generate_signed_url(
            version="v4", expiration=timedelta(minutes=20), method="GET",
            generation=blob.generation,
        )

    def create_job(self, uid: str, request: dict) -> str:
        job_id = request["id"]
        validate_paths(uid, job_id, request["paperPath"], request.get("answerKeyPath"))
        reference = self.db.document(f"users/{uid}/quizImports/{job_id}")

        @self.transactional
        def create(transaction):
            snapshot = reference.get(transaction=transaction)
            if snapshot.exists:
                existing = snapshot.to_dict()
                if any(existing.get(k) != request.get(k) for k in ("title", "paperPath", "answerKeyPath")):
                    raise InvalidImport("This import ID is already used. Start a new upload.")
                return job_id
            transaction.create(reference, {
                "id": job_id, "ownerUid": uid, "title": request["title"],
                "paperPath": request["paperPath"],
                **({"answerKeyPath": request["answerKeyPath"]} if request.get("answerKeyPath") else {}),
                "status": "queued", "message": "Waiting for the PDF parser…",
                "createdAt": now_ms(), "updatedAt": now_ms(), "attempts": 0,
            })
            return job_id

        return create(self.db.transaction())

    def candidates(self):
        from google.cloud.firestore_v1.base_query import FieldFilter
        # Single-field collection-group indexes suffice; transaction rechecks all state.
        queued = self.db.collection_group("quizImports").where(filter=FieldFilter("status", "==", "queued")).limit(20).stream()
        expired = self.db.collection_group("quizImports").where(filter=FieldFilter("leaseUntil", "<=", now_ms())).limit(20).stream()
        seen = set()
        for query in (queued, expired):
            for snapshot in query:
                if snapshot.reference.path not in seen:
                    seen.add(snapshot.reference.path)
                    yield snapshot.reference

    def claim(self, reference) -> dict | None:
        uid, job_id = owner_from_document_path(reference.path)
        token = str(uuid.uuid4())

        @self.transactional
        def claim_transaction(transaction):
            snapshot = reference.get(transaction=transaction)
            if not snapshot.exists:
                return None
            data = snapshot.to_dict()
            if data.get("id") != job_id or data.get("ownerUid") != uid:
                return None
            validate_paths(uid, job_id, data.get("paperPath"), data.get("answerKeyPath"))
            timestamp = now_ms()
            if not may_claim(data, timestamp, self.settings.max_attempts):
                if ((data.get("status") == "queued" or data.get("status") in PROCESSING_STATUSES) and
                        data.get("leaseUntil", 0) <= timestamp and data.get("attempts", 0) >= self.settings.max_attempts):
                    from google.cloud.firestore import DELETE_FIELD
                    transaction.update(reference, {"status": "failed", "message": "Parsing was interrupted repeatedly. Please upload a new import.",
                                                    "error": "Parsing was interrupted repeatedly. Please upload a new import.",
                                                    "leaseUntil": DELETE_FIELD, "leaseToken": DELETE_FIELD, "updatedAt": timestamp})
                return None
            fields = {"status": "reading-paper", "message": "Reading the question paper…",
                      "attempts": data.get("attempts", 0) + 1, "leaseToken": token,
                      "leaseUntil": timestamp + self.settings.lease_seconds * 1000, "updatedAt": timestamp}
            transaction.update(reference, fields)
            return {**data, **fields, "uid": uid, "reference": reference}

        return claim_transaction(self.db.transaction())

    def owned_update(self, job: dict, fields: dict, *, terminal: bool = False):
        reference = job["reference"]
        uid, job_id = owner_from_document_path(reference.path)
        if uid != job["uid"] or job_id != job["id"]:
            raise LeaseLost("Import owner changed.")

        @self.transactional
        def update(transaction):
            snapshot = reference.get(transaction=transaction)
            data = snapshot.to_dict() if snapshot.exists else {}
            if (data.get("ownerUid") != uid or data.get("leaseToken") != job["leaseToken"] or
                    data.get("status") not in PROCESSING_STATUSES or data.get("leaseUntil", 0) <= now_ms()):
                raise LeaseLost("The import lease expired.")
            values = {**fields, "updatedAt": now_ms()}
            if terminal:
                from google.cloud.firestore import DELETE_FIELD
                values.update({"leaseUntil": DELETE_FIELD, "leaseToken": DELETE_FIELD})
            else:
                values["leaseUntil"] = now_ms() + self.settings.lease_seconds * 1000
            transaction.update(reference, values)

        update(self.db.transaction())

    def save_image(self, job: dict, asset_id: str, content: bytes, page: int) -> dict:
        # Lease-specific paths prevent an old attempt from replacing a new attempt's assets.
        path = f"users/{job['uid']}/quiz-imports/{job['id']}/assets/{job['leaseToken']}/{asset_id}.png"
        self.owned_update(job, {})
        blob = self.bucket.blob(path)
        blob.upload_from_string(content, content_type="image/png", timeout=60)
        return {"id": asset_id, "storagePath": path, "page": page}
