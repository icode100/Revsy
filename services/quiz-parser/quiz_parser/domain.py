"""Validation shared by the HTTP boundary, durable queue, and model output."""

import json
import re
import uuid
from typing import Any

MAX_PDF_BYTES = 25 * 1024 * 1024
MAX_PAGES = 30
MAX_DOCUMENT_BYTES = 800_000
PROCESSING_STATUSES = (
    "reading-paper", "reading-key", "storing-images", "structuring", "validating"
)
SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
ASSET_REF = re.compile(r"quiz-asset:([A-Za-z0-9_-]{1,80})")


class InvalidImport(ValueError):
    """A safe, actionable error which may be shown to the document owner."""


class LeaseLost(RuntimeError):
    """Another worker owns this import now; the previous worker must stop."""


def canonical_job_id(value: str) -> str:
    try:
        parsed = uuid.UUID(value)
    except (ValueError, TypeError, AttributeError) as exc:
        raise InvalidImport("The import ID must be a UUID.") from exc
    if str(parsed) != value:
        raise InvalidImport("The import ID must be a lowercase, hyphenated UUID.")
    return value


def validate_paths(uid: str, job_id: str, paper_path: str, key_path: str | None) -> None:
    canonical_job_id(job_id)
    if not uid or "/" in uid or uid in {".", ".."}:
        raise InvalidImport("Invalid account ID.")
    prefix = f"users/{uid}/quiz-imports/{job_id}/"
    if paper_path != prefix + "paper.pdf":
        raise InvalidImport("Upload the question paper to this account's import folder.")
    if key_path is not None and key_path != prefix + "answer-key.pdf":
        raise InvalidImport("Upload the answer key to this account's import folder.")


def owner_from_document_path(path: str) -> tuple[str, str]:
    parts = path.split("/")
    if len(parts) != 4 or parts[0] != "users" or parts[2] != "quizImports":
        raise InvalidImport("Invalid import document path.")
    canonical_job_id(parts[3])
    if not parts[1] or parts[1] in {".", ".."}:
        raise InvalidImport("Invalid import owner.")
    return parts[1], parts[3]


def may_claim(data: dict, now_ms: int, max_attempts: int) -> bool:
    status = data.get("status")
    if status != "queued" and status not in PROCESSING_STATUSES:
        return False
    if status in PROCESSING_STATUSES and data.get("leaseUntil", 0) > now_ms:
        return False
    return data.get("attempts", 0) < max_attempts


def bounded_text(value: Any, label: str, maximum: int = 20_000) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise InvalidImport(f"{label} is missing or too long. Check the source PDF.")
    return value.strip()


def normalized_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def isolate_embedded_key(paper_text: str) -> tuple[str, str]:
    """Options in the question paper must never count as answer-key evidence."""
    headings = list(re.finditer(
        r"^[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*)?(?:answer[ \t_-]*key|correct[ \t]+answers|answers)(?:\*\*)?[ \t:]*$",
        paper_text, re.IGNORECASE | re.MULTILINE,
    ))
    if len(headings) != 1:
        raise InvalidImport("Upload a separate answer-key PDF, or add one explicit Answer Key section to the paper.")
    heading = headings[0]
    questions, key = paper_text[:heading.start()], paper_text[heading.end():]
    if not questions.strip() or not key.strip():
        raise InvalidImport("The embedded Answer Key section is empty or ambiguous.")
    return questions, key


def validate_key_evidence(number: str, label: str, evidence: str, key_text: str) -> None:
    # A quote from Q11 cannot justify Q1, and a quote from Q1 A cannot justify Q1 B.
    source_number = re.sub(r"^(?:question|q)[ .:-]*", "", number, flags=re.I).strip()
    number_pattern = r"[ \t]+".join(re.escape(part) for part in source_number.split())
    pair_pattern = (r"(?<![A-Za-z0-9])(?:Q(?:uestion)?[ .:-]*)?" + number_pattern +
                    r"(?![A-Za-z0-9])(?:[ \t|.:)=({\[\]_-]+)" +
                    r"(?P<label>[A-Ha-h1-8])(?![A-Za-z0-9])")
    matches = list(re.finditer(pair_pattern, evidence, re.I))
    if not matches or any(match.group("label").upper() != label.upper() for match in matches):
        raise InvalidImport("An answer-key quote does not match its original question number and answer.")
    source_matches = list(re.finditer(pair_pattern, key_text, re.I))
    if any(match.group("label").upper() != label.upper() for match in source_matches):
        raise InvalidImport("The supplied key contains conflicting answers for a question number.")
    if label.isdigit():
        # A horizontal header `Question | 1 | 2` cannot justify q1 -> option 2.
        # Numeric answers need an explicit Q1:2 row or a Question | Answer column table.
        column_header = bool(re.search(r"^[ \t|]*(?:question|q(?:uestion)?[ \t]+number)[ \t|]+(?:answer|correct[ \t]+option)[ \t|]*$", key_text, re.I | re.M))
        row_pattern = (r"^[ \t|]*(?P<prefix>Q(?:uestion)?[ .:-]*)?" + number_pattern +
                       r"[ \t|.:)=({\[\]_-]+" + re.escape(label) + r"[ \t|.)}\]]*$")
        rows = [match for line in key_text.splitlines() if (match := re.match(row_pattern, line, re.I))]
        if not rows or not any(match.group("prefix") or column_header for match in rows):
            raise InvalidImport("Numeric answer labels need clear Q1:2 rows or a Question / Answer column table.")


def validate_explicit_question_coverage(paper_text: str, questions: list[dict]) -> None:
    """When explicit Q/Question labels exist, fail if the structurer drops one."""
    explicit = re.findall(r"^[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*)?(?:Question[ \t]+|Q[ .]*)(\d{1,4})(?!\d)",
                          paper_text, re.I | re.MULTILINE)
    if explicit and len(explicit) == len(set(explicit)):
        output_numbers = {re.sub(r"^(?:question|q)[ .:-]*", "", question["number"], flags=re.I).strip()
                          for question in questions}
        if not set(explicit).issubset(output_numbers):
            raise InvalidImport("Some explicitly numbered questions were omitted. Try a smaller or clearer PDF.")


def parse_model_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```json") and text.endswith("```"):
        text = text[7:-3].strip()
    elif text.startswith("```") and text.endswith("```"):
        text = text[3:-3].strip()
    try:
        result = json.loads(text)
    except (json.JSONDecodeError, TypeError) as exc:
        raise InvalidImport("The model returned incomplete JSON. Try a smaller PDF.") from exc
    if not isinstance(result, dict):
        raise InvalidImport("The model did not return a quiz object.")
    return result


def validate_draft(raw: dict, *, uid: str, job_id: str, title: str,
                   paper_path: str, key_path: str | None, assets: list[dict],
                   key_text: str, model: str, warnings: list[str]) -> dict:
    validate_paths(uid, job_id, paper_path, key_path)
    prefix = f"users/{uid}/quiz-imports/{job_id}/"
    asset_map = {}
    for asset in assets:
        if (not isinstance(asset.get("id"), str) or not SAFE_ID.fullmatch(asset["id"]) or
                not isinstance(asset.get("storagePath"), str) or
                not asset["storagePath"].startswith(prefix + "assets/") or
                ".." in asset["storagePath"].split("/") or
                type(asset.get("page")) is not int or not 1 <= asset["page"] <= 30):
            raise InvalidImport("A source image has an invalid storage path.")
        if asset["id"] in asset_map:
            raise InvalidImport("Source image IDs must be unique.")
        asset_map[asset["id"]] = {
            name: asset[name] for name in ("id", "storagePath", "page")
        }

    questions = raw.get("question")
    if not isinstance(questions, list) or not 1 <= len(questions) <= 200:
        raise InvalidImport("The PDF must contain between 1 and 200 MCQ questions.")
    result_questions, by_id, numbers = [], {}, set()
    for question in questions:
        if not isinstance(question, dict):
            raise InvalidImport("The model returned an invalid question.")
        question_id = question.get("id", "")
        if not isinstance(question_id, str) or not SAFE_ID.fullmatch(question_id) or question_id in by_id:
            raise InvalidImport("Each question needs a unique ID.")
        number = bounded_text(question.get("number"), "Question number", 80)
        if number in numbers:
            raise InvalidImport("Question numbers repeat. Include their section names.")
        numbers.add(number)
        problem = bounded_text(question.get("problem"), "Question text")
        options = question.get("options")
        if not isinstance(options, list) or not 2 <= len(options) <= 8:
            raise InvalidImport("Each question must have 2 to 8 options.")
        options = [bounded_text(option, "An answer option") for option in options]
        referenced = set(ASSET_REF.findall("\n".join([problem, *options])))
        explicit_ids = question.get("imageIds", [])
        if not isinstance(explicit_ids, list) or any(not isinstance(a, str) for a in explicit_ids):
            raise InvalidImport("The model returned invalid image references.")
        referenced.update(explicit_ids)
        if len(referenced) > 30:
            raise InvalidImport("A question contains too many source images.")
        if not referenced.issubset(asset_map):
            raise InvalidImport("A question references an image that could not be preserved.")
        record = {"id": question_id, "number": number, "problem": problem,
                  "options": options, "images": [asset_map[a] for a in sorted(referenced)]}
        result_questions.append(record)
        by_id[question_id] = record

    entries = raw.get("key")
    if not isinstance(entries, list) or len(entries) != len(result_questions):
        raise InvalidImport("The supplied answer key must have one answer for every question.")
    keys, seen = [], set()
    normalized_key = normalized_text(key_text)
    for entry in entries:
        if not isinstance(entry, dict):
            raise InvalidImport("The answer key contains an invalid entry.")
        question_id = entry.get("questionId")
        if not isinstance(question_id, str) or question_id not in by_id or question_id in seen:
            raise InvalidImport("The answer key has duplicate or unknown question numbers.")
        index = entry.get("correctOptionIndex")
        if type(index) is not int or not 0 <= index < len(by_id[question_id]["options"]):
            raise InvalidImport("The key must identify exactly one valid option per question.")
        # Require verbatim evidence from the uploaded key; generated solutions are rejected.
        evidence = entry.get("sourceText")
        label = entry.get("answerLabel")
        if (not isinstance(evidence, str) or not evidence.strip() or len(evidence) > 2000 or
                normalized_text(evidence) not in normalized_key or
                not isinstance(label, str) or not re.fullmatch(r"[A-H1-8a-h]", label)):
            raise InvalidImport("An answer could not be traced to the supplied key. Review the key PDF.")
        label_index = int(label) - 1 if label.isdigit() else ord(label.upper()) - ord("A")
        if label_index != index or not re.search(r"(?<![A-Za-z0-9])" + re.escape(label) + r"(?![A-Za-z0-9])", evidence, re.I):
            raise InvalidImport("An extracted answer disagrees with its source key label.")
        validate_key_evidence(by_id[question_id]["number"], label, evidence, key_text)
        seen.add(question_id)
        keys.append({"questionId": question_id, "correctOptionIndex": index})

    # A diagram must not disappear silently during question grouping.
    used_assets = {image["id"] for question in result_questions for image in question["images"]}
    omitted = set(asset_map) - used_assets
    if omitted:
        raise InvalidImport("Some source diagrams could not be matched to a question. Try a clearer PDF.")
    source = {"paperPath": paper_path}
    if key_path is not None:
        source["answerKeyPath"] = key_path
    draft = {"schemaVersion": 1, "title": bounded_text(title, "Quiz title", 160),
             "question": result_questions, "key": keys, "source": source,
             "parsing": {"model": model, "warnings": warnings[:20]}}
    if len(json.dumps(draft, ensure_ascii=False).encode("utf-8")) >= MAX_DOCUMENT_BYTES:
        raise InvalidImport("The extracted quiz is too large. Split it into smaller PDFs.")
    return draft
