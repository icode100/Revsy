"""Bounded Gemini Files/Generate Content API calls, with no automatic inference replay."""

import json
from contextlib import contextmanager
from contextvars import ContextVar
import math
import re
import ssl
import time
from urllib.parse import urlsplit

import httpx

from quiz_parser.domain import InvalidImport

BASE = "https://generativelanguage.googleapis.com"
MAX_RESPONSE = 8 * 1024 * 1024
MAX_JOB_SECONDS = 1680
_job_deadline = ContextVar("quiz_gemini_job_deadline", default=None)
DEADLINE_MESSAGE = "The quiz parsing time limit was reached. Completed extraction checkpoints were kept; split this paper by session before retrying."


def response_json(response, limit=MAX_RESPONSE, *, check_budget=None):
    if check_budget is not None:
        check_budget()
    if not 200 <= response.status_code < 300:
        messages = {400: "Gemini could not accept this PDF request. Check the model and API configuration.",
                    401: "The server's Gemini API key is invalid.",
                    403: "Gemini access is disabled for this API key or project.",
                    404: "The configured Gemini model is unavailable. Check GEMINI_MODEL.",
                    429: "Gemini's quota is exhausted. Wait for quota to reset before starting another import."}
        raise InvalidImport(messages.get(response.status_code,
            "Gemini is temporarily unavailable. Start a new import later."))
    chunks, size = [], 0
    for chunk in response.iter_bytes():
        if check_budget is not None:
            check_budget()
        size += len(chunk)
        if size > limit:
            raise InvalidImport("Gemini returned too much data. Split this paper into sessions.")
        chunks.append(chunk)
    try:
        data = json.loads(b"".join(chunks))
    except (ValueError, UnicodeError):
        raise InvalidImport("Gemini returned an unreadable response.") from None
    if not isinstance(data, dict):
        raise InvalidImport("Gemini returned an invalid response.")
    return data


class GeminiClient:
    def __init__(self, api_key, model="gemini-3.8-flash", *, client=None):
        if not isinstance(api_key, str) or not api_key.strip():
            raise ValueError("Set the server-only GEMINI_API_KEY in .env.deploy.local.")
        if not isinstance(model, str) or not re.fullmatch(r"gemini-[a-zA-Z0-9.-]{1,80}", model):
            raise ValueError("GEMINI_MODEL must name a Gemini model.")
        self.model = model
        self.headers = {"x-goog-api-key": api_key.strip()}
        self.client = client or httpx.Client(timeout=httpx.Timeout(900, connect=30),
            verify=ssl.create_default_context(), trust_env=False, follow_redirects=False)

    def close(self):
        self.client.close()

    def summarize(self, text):
        """One bounded text-only call for the existing authenticated note action."""
        generation = {"maxOutputTokens": 2048}
        if re.match(r"gemini-3(?:[.-]|$)", self.model):
            generation["thinkingConfig"] = {"thinkingLevel": "low"}
        else:
            generation["temperature"] = 0.7
        payload = {
            "systemInstruction": {"parts": [{"text":
                "Summarize this programming problem concisely. Preserve its problem statement, "
                "required inputs and outputs, constraints, and essential mathematical or code details. "
                "Do not solve the problem or invent missing information. Return the summary as Markdown."}]},
            "contents": [{"role": "user", "parts": [{"text": text}]}],
            "generationConfig": generation,
        }
        with self.processing_budget(45):
            with self.client.stream("POST", BASE + "/v1beta/models/" + self.model + ":generateContent",
                                    headers=self.headers, json=payload, timeout=self._timeout(45)) as response:
                result = response_json(response, 64_000, check_budget=self.check_budget)
            candidates = result.get("candidates")
            if (not isinstance(candidates, list) or len(candidates) != 1
                    or not isinstance(candidates[0], dict) or candidates[0].get("finishReason") != "STOP"):
                raise InvalidImport("Gemini did not finish the note summary.")
            content = candidates[0].get("content")
            parts = content.get("parts") if isinstance(content, dict) else None
            if (not isinstance(parts, list) or any(not isinstance(part, dict)
                    or ("text" in part and not isinstance(part["text"], str))
                    or ("thought" in part and type(part["thought"]) is not bool) for part in parts)):
                raise InvalidImport("Gemini returned an invalid note summary.")
            summary = "".join(part.get("text", "") for part in parts if not part.get("thought")).strip()
            if not summary or len(summary) > 20_000:
                raise InvalidImport("Gemini returned an invalid note summary.")
            self.check_budget()
            return summary

    @contextmanager
    def processing_budget(self, seconds=MAX_JOB_SECONDS):
        if (isinstance(seconds, bool) or not isinstance(seconds, (int, float))
                or not math.isfinite(seconds) or not 0 < seconds <= MAX_JOB_SECONDS):
            raise ValueError("The processing budget must be between zero and 1680 seconds.")
        deadline = time.monotonic() + seconds
        existing = _job_deadline.get()
        token = _job_deadline.set(min(existing, deadline) if existing is not None else deadline)
        try:
            self.check_budget()
            yield
        finally:
            _job_deadline.reset(token)

    def check_budget(self):
        deadline = _job_deadline.get()
        if deadline is not None and time.monotonic() >= deadline:
            raise InvalidImport(DEADLINE_MESSAGE)

    def _remaining(self, cap):
        deadline = _job_deadline.get()
        remaining = cap if deadline is None else min(cap, deadline - time.monotonic())
        if remaining <= 0:
            raise InvalidImport(DEADLINE_MESSAGE)
        return remaining

    def _timeout(self, cap=900):
        remaining = self._remaining(cap)
        # HTTPX timeouts are per phase; reserve pool/connect/write time rather
        # than assigning the whole remaining job budget independently to each.
        phase = min(30, remaining / 6)
        return httpx.Timeout(read=remaining - 3 * phase, connect=phase, write=phase, pool=phase)

    def upload(self, data, label):
        try:
            with self.client.stream("POST", BASE + "/upload/v1beta/files", headers={**self.headers,
                "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start",
                "X-Goog-Upload-Header-Content-Length": str(len(data)),
                "X-Goog-Upload-Header-Content-Type": "application/pdf"},
                json={"file": {"display_name": label}}, timeout=self._timeout()) as response:
                if not 200 <= response.status_code < 300:
                    response_json(response, check_budget=self.check_budget)
                upload_url = response.headers.get("x-goog-upload-url", "")
        except httpx.HTTPError:
            self.check_budget()
            raise InvalidImport("The Gemini connection ended before the PDF upload was confirmed. Start a new import later.") from None
        try:
            parsed = urlsplit(upload_url)
            port = parsed.port
        except ValueError:
            raise InvalidImport("Gemini returned an invalid upload endpoint.") from None
        if (parsed.scheme != "https" or parsed.hostname != "generativelanguage.googleapis.com"
                or parsed.username or parsed.password or port not in {None, 443}
                or parsed.fragment or not parsed.path.startswith("/upload/")):
            raise InvalidImport("Gemini returned an invalid upload endpoint.")
        try:
            with self.client.stream("POST", upload_url, headers={**self.headers,
                "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize",
                "Content-Type": "application/pdf"}, content=data, timeout=self._timeout()) as response:
                result = response_json(response, 64_000, check_budget=self.check_budget)
        except httpx.HTTPError:
            self.check_budget()
            raise InvalidImport("The Gemini connection ended before the PDF upload was confirmed. Start a new import later.") from None
        uploaded = result.get("file")
        if (not isinstance(uploaded, dict) or not isinstance(uploaded.get("name"), str)
                or not re.fullmatch(r"files/[A-Za-z0-9_-]+", uploaded["name"])):
            raise InvalidImport("Gemini did not confirm the uploaded PDF.")
        original_name = uploaded["name"]
        expected = BASE + "/v1beta/" + original_name
        try:
            for _ in range(90):
                self.check_budget()
                if (uploaded.get("name") != original_name or
                        ("uri" in uploaded and uploaded["uri"] != expected)):
                    raise InvalidImport("Gemini returned an invalid PDF reference.")
                state = uploaded.get("state")
                if state == "ACTIVE":
                    if uploaded.get("uri") != expected:
                        raise InvalidImport("Gemini returned an invalid PDF reference.")
                    return uploaded
                if state != "PROCESSING":
                    raise InvalidImport("Gemini could not process this uploaded PDF.")
                time.sleep(self._remaining(2))
                with self.client.stream("GET", expected, headers=self.headers, timeout=self._timeout(60)) as response:
                    uploaded = response_json(response, 64_000, check_budget=self.check_budget)
            raise InvalidImport("Gemini is still preparing this PDF. Start a new import later.")
        except Exception as error:
            self.delete({"name": original_name})
            if isinstance(error, httpx.HTTPError):
                self.check_budget()
                raise InvalidImport("The Gemini connection ended while preparing the PDF. Start a new import later.") from None
            raise

    def delete(self, uploaded):
        name = uploaded.get("name", "") if isinstance(uploaded, dict) else ""
        if not isinstance(name, str) or not re.fullmatch(r"files/[A-Za-z0-9_-]+", name):
            return
        try:
            self.client.delete(BASE + "/v1beta/" + name, headers=self.headers, timeout=self._timeout(15))
        except (httpx.HTTPError, InvalidImport):
            pass  # Gemini also expires temporary Files API uploads after 48 hours.

    def extract(self, uploaded, prompt, schema, *, output_tokens=32768):
        generation = {"maxOutputTokens": output_tokens,
            "responseMimeType": "application/json", "responseJsonSchema": schema}
        if re.match(r"gemini-3(?:[.-]|$)", self.model):
            generation["thinkingConfig"] = {"thinkingLevel": "low"}
        else:
            generation["temperature"] = 0
        payload = {"contents": [{"role": "user", "parts": [
            {"fileData": {"mimeType": "application/pdf", "fileUri": uploaded["uri"]}},
            {"text": prompt}]}],
            "generationConfig": generation}
        try:
            with self.client.stream("POST", BASE + "/v1beta/models/" + self.model + ":generateContent",
                                    headers=self.headers, json=payload, timeout=self._timeout()) as response:
                result = response_json(response, check_budget=self.check_budget)
        except httpx.HTTPError:
            self.check_budget()
            raise InvalidImport("The Gemini connection ended before extraction was confirmed. Check this import before starting another.") from None
        candidates = result.get("candidates")
        if (not isinstance(candidates, list) or len(candidates) != 1 or
                not isinstance(candidates[0], dict) or candidates[0].get("finishReason") != "STOP"):
            raise InvalidImport("Gemini did not finish the extraction. Split the paper into sessions; no partial quiz was saved.")
        content = candidates[0].get("content")
        parts = content.get("parts") if isinstance(content, dict) else None
        if (not isinstance(parts, list) or any(not isinstance(part, dict) or
                ("text" in part and not isinstance(part["text"], str)) or
                ("thought" in part and type(part["thought"]) is not bool) for part in parts)):
            raise InvalidImport("Gemini returned invalid extraction content. No partial quiz was saved.")
        text = "".join(part.get("text", "") for part in parts if not part.get("thought"))
        try:
            extracted = json.loads(text)
        except (ValueError, TypeError):
            raise InvalidImport("Gemini returned incomplete extraction JSON. No partial quiz was saved.") from None
        if not isinstance(extracted, dict):
            raise InvalidImport("Gemini returned an invalid extraction object.")
        usage = result.get("usageMetadata", {})
        if not isinstance(usage, dict):
            raise InvalidImport("Gemini returned invalid extraction metadata.")
        usage = {key: value for key, value in usage.items()
                 if key in {"promptTokenCount", "candidatesTokenCount", "thoughtsTokenCount", "totalTokenCount"}
                 and type(value) is int and value >= 0}
        self.check_budget()
        return extracted, usage
