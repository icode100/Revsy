"""Deterministically group clear MCQs; never solve or complete a missing key.

The free prototype supports numbered questions and consecutive A-H options.
Ambiguous layouts deliberately fail instead of producing a partial ready draft.
Use ``prepare_sources`` before ``structure_mcqs`` and shared draft validation,
or call ``structure_draft`` for that complete sequence.
"""

from dataclasses import dataclass
import re

from quiz_parser.domain import (
    ASSET_REF, InvalidImport, isolate_embedded_key, validate_draft,
    validate_explicit_question_coverage, validate_key_evidence,
)
from quiz_parser.ocr_text import normalize_html_tables


MODEL_NAME = "deterministic-mcq-v1"
MAX_TEXT_BYTES = 750_000
PAGE_MARKER = re.compile(r"^[ \t]*--- (?:Paper|Answer key) page \d{1,2} ---[ \t]*$", re.I | re.M)
QUESTION = re.compile(
    r"^[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*)?"
    r"(?:(?:Question[ \t]+|Q[ \t.]*)(?P<explicit>\d{1,4})(?![A-Za-z0-9])(?:[ \t]*[.):])?"
    r"|(?P<bare>\d{1,4})[.)](?=[ \t*]|$)"
    r"|\((?P<paren>\d{1,4})\)|\[(?P<bracket>\d{1,4})\]"
    r"|(?P<alone>\d{1,4})(?=[ \t]*$))"
    r"(?:\*\*)?(?:[ \t]|(?=$))", re.I | re.M,
)
SECTION = re.compile(
    r"^[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*)?(?P<section>Section[ \t]+[A-Za-z0-9]{1,12})"
    r"(?:\*\*)?[ \t:]*$", re.I | re.M,
)
OPTION = re.compile(
    r"(?<!\S)(?:\*\*)?(?:\((?P<paren>[A-Za-z])\)|\[(?P<bracket>[A-Za-z])\]"
    r"|(?P<bare>[A-Za-z])[.):])(?:\*\*)?"
)
PROTECTED = re.compile(
    r"```[^\n]*\n.*?```|`[^`\n]+`|!?\[[^\]\n]*\]\([^\)\n]+\)"
    r"|(?<!\\)\$\$.*?(?<!\\)\$\$|(?<!\\)\$.*?(?<!\\)\$"
    r"|\\\(.*?\\\)|\\\[.*?\\\]", re.S,
)
KEY_PAIR = re.compile(
    r"(?<![A-Za-z0-9])(?:(?P<section>Section[ \t]+[A-Za-z0-9]{1,12})[ \t]+)?"
    r"(?:Q(?:uestion)?[ .:-]*)?(?P<number>\d{1,4})(?![A-Za-z0-9])"
    r"[ \t|.:)=({\[\]_-]+(?P<label>[A-Ha-h])(?![A-Za-z0-9])", re.I,
)
KEY_HEADING = re.compile(r"^(?:#{1,6}\s*)?(?:\*\*)?(?:answer[ _-]*key|correct answers|answers)(?:\*\*)?\s*:?$", re.I)
KEY_TABLE_HEADER = re.compile(r"^(?:\s*\|?\s*(?:question|question number|q(?:uestion)?\s*no\.?|q)\s*\|\s*(?:answer|correct option)\s*\|?\s*)+$", re.I)
KEY_SEPARATORS = re.compile(r"^[\s|,;.:=()\[\]{}*_\-]*$")
KEY_IMAGE_LINE = re.compile(r"^(?:!\[[^\]\n]*\]\([^\)\n]+\)\s*)+$")


@dataclass(frozen=True)
class PreparedSources:
    paper_text: str
    key_text: str
    assets: list[dict]


def _checked_text(value: str, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise InvalidImport(f"The {label} contains no readable text.")
    if len(value.encode("utf-8")) > MAX_TEXT_BYTES:
        raise InvalidImport("The OCR text is too long. Split the paper into smaller PDFs.")
    return value


def prepare_sources(paper_text: str, key_text: str | None, assets: list[dict]) -> PreparedSources:
    """Normalize table cells and isolate embedded answers before question grouping.

    ``None`` means an embedded key. An empty separate key remains an error.
    Existing original asset records are passed through; key-only assets are
    excluded only when an explicit embedded Answer Key heading was isolated.
    """
    paper_text = normalize_html_tables(_checked_text(paper_text, "question paper"))
    if key_text is None:
        paper_text, key_text = isolate_embedded_key(paper_text)
        paper_refs = set(ASSET_REF.findall(paper_text))
        assets = [asset for asset in assets if asset.get("id") in paper_refs]
    else:
        key_text = normalize_html_tables(_checked_text(key_text, "answer key"))
    _checked_text(paper_text, "question paper")
    _checked_text(key_text, "answer key")
    return PreparedSources(paper_text, key_text, list(assets))


def _masked(text: str) -> str:
    # Preserve offsets and lines so labels inside math/code/links remain literal.
    return PROTECTED.sub(lambda m: re.sub(r"[^\n]", " ", m.group(0)), text)


def _number(match: re.Match) -> str:
    return next(value for value in match.groupdict().values() if value is not None)


def _options(body: str, number: str) -> tuple[str, list[str]]:
    masked = _masked(body)
    candidates = []
    for match in OPTION.finditer(masked):
        original = OPTION.match(body, match.start())
        if not original or original.end() != match.end():
            continue
        if match.group("bare"):
            before = body[body.rfind("\n", 0, match.start()) + 1:match.start()]
            # Bare "B." inside ordinary prose is not a dependable separator.
            if before.strip() and not re.search(r"[ \t]{2,}$", before):
                raise InvalidImport(f"Question {number} has ambiguous inline option labels. Use (A) / (B) labels.")
        candidates.append(match)
    labels = [_number(match).upper() for match in candidates]
    if not 2 <= len(labels) <= 8 or labels != list("ABCDEFGH"[:len(labels)]):
        raise InvalidImport(f"Question {number} needs consecutive, unique options labelled A to H.")
    problem = body[:candidates[0].start()].strip()
    options = [body[match.end():candidates[index + 1].start() if index + 1 < len(candidates) else len(body)].strip()
               for index, match in enumerate(candidates)]
    if not problem or any(not option for option in options):
        raise InvalidImport(f"Question {number} has an empty problem or answer option.")
    return problem, options


def _questions(paper_text: str) -> list[dict]:
    text = PAGE_MARKER.sub("", paper_text)
    masked = _masked(text)
    tokens = sorted([(m.start(), "question", m) for m in QUESTION.finditer(masked)
                     if (original := QUESTION.match(text, m.start())) and original.end() == m.end()] +
                    [(m.start(), "section", m) for m in SECTION.finditer(masked)
                     if (original := SECTION.match(text, m.start())) and original.end() == m.end()])
    questions, numbers, section = [], set(), ""
    first_question = next((start for start, kind, _ in tokens if kind == "question"), None)
    if first_question is None:
        raise InvalidImport("Free parsing needs clearly numbered questions, for example 1. or Q1.")
    if OPTION.search(_masked(text[:first_question])) or ASSET_REF.search(text[:first_question]):
        raise InvalidImport("Content before the first numbered question cannot be matched safely. Number every MCQ and diagram.")
    for index, (_, kind, match) in enumerate(tokens):
        if kind == "section":
            section = re.sub(r"\s+", " ", match.group("section"))
            continue
        number = ((section + " ") if section else "") + _number(match)
        if number in numbers:
            raise InvalidImport("Question numbers repeat. Use explicit section names in the paper and key.")
        numbers.add(number)
        body = text[match.end():tokens[index + 1][0] if index + 1 < len(tokens) else len(text)]
        problem, options = _options(body, number)
        questions.append({"id": f"q{len(questions) + 1}", "number": number,
                          "problem": problem, "options": options,
                          "imageIds": sorted(set(ASSET_REF.findall("\n".join([problem, *options]))))})
        if len(questions) > 200:
            raise InvalidImport("The PDF must contain between 1 and 200 MCQ questions.")
    return questions


def _keys(key_text: str, questions: list[dict]) -> list[dict]:
    by_number = {question["number"].casefold(): question for question in questions}
    seen, keys = set(), []
    for original_line in key_text.splitlines():
        line = original_line.strip()
        if not line or PAGE_MARKER.fullmatch(line) or KEY_HEADING.fullmatch(line) or KEY_IMAGE_LINE.fullmatch(line):
            continue
        if KEY_TABLE_HEADER.fullmatch(line) or ("|" in line and re.fullmatch(r"[\s|:\-]+", line)):
            continue
        matches = list(KEY_PAIR.finditer(line))
        remainder, last = [], 0
        for match in matches:
            remainder.append(line[last:match.start()])
            last = match.end()
        remainder.append(line[last:])
        if not matches or not all(KEY_SEPARATORS.fullmatch(part) for part in remainder):
            raise InvalidImport("The free parser needs clear numbered key rows, for example 1 B or Question | Answer. Ambiguous tables are unsupported.")
        if len(line) > 2000:
            raise InvalidImport("An answer-key row is too long. Put each numbered answer on its own line.")
        for match in matches:
            section = re.sub(r"\s+", " ", match.group("section") or "")
            number = ((section + " ") if section else "") + match.group("number")
            question = by_number.get(number.casefold())
            if question is None:
                raise InvalidImport("The supplied key refers to an unknown question number or section.")
            if question["id"] in seen:
                raise InvalidImport("The supplied key repeats or conflicts on a question number.")
            label = match.group("label").upper()
            option_index = ord(label) - ord("A")
            if option_index >= len(question["options"]):
                raise InvalidImport("The supplied key points to an option missing from its question.")
            validate_key_evidence(question["number"], label, line, key_text)
            keys.append({"questionId": question["id"], "correctOptionIndex": option_index,
                         "answerLabel": label, "sourceText": line})
            seen.add(question["id"])
    if len(keys) != len(questions):
        raise InvalidImport("The supplied answer key must have one answer for every question.")
    return sorted(keys, key=lambda entry: int(entry["questionId"][1:]))


def structure_mcqs(paper_text: str, key_text: str, assets: list[dict] | None = None) -> dict:
    """Return the existing model intermediate schema from prepared OCR sources.

    This function requires a separately isolated, table-normalized key. It does
    not infer answers, download assets, or write Firebase documents.
    """
    _checked_text(paper_text, "question paper")
    _checked_text(key_text, "answer key")
    questions = _questions(paper_text)
    if assets is not None:
        used = {asset_id for question in questions for asset_id in question["imageIds"]}
        available = {asset.get("id") for asset in assets}
        if used != available:
            raise InvalidImport("Source diagrams could not all be matched to their original questions.")
    # The shared coverage helper compares bare explicit numbers. Strip only the
    # deterministic section prefix for this check; retain full labels in records
    # and key evidence. Every detected section/question token was already parsed.
    coverage_questions = [{"number": re.sub(r"^Section[ \t]+[A-Za-z0-9]{1,12}[ \t]+", "", q["number"], flags=re.I)}
                          for q in questions]
    validate_explicit_question_coverage(paper_text, coverage_questions)
    return {"question": questions, "key": _keys(key_text, questions)}


def structure_draft(paper_text: str, key_text: str | None, *, uid: str, job_id: str,
                    title: str, paper_path: str, key_path: str | None,
                    assets: list[dict], model: str = MODEL_NAME,
                    warnings: list[str] | None = None) -> dict:
    """Prepare sources and apply the existing ownership/key/size validation."""
    if (key_path is None) != (key_text is None):
        raise InvalidImport("Answer-key source metadata does not match the supplied key text.")
    prepared = prepare_sources(paper_text, key_text, assets)
    raw = structure_mcqs(prepared.paper_text, prepared.key_text, prepared.assets)
    return validate_draft(raw, uid=uid, job_id=job_id, title=title,
                          paper_path=paper_path, key_path=key_path,
                          assets=prepared.assets, key_text=prepared.key_text, model=model,
                          warnings=["Review OCR text, math, diagrams, and answer-key alignment before saving.",
                                    *(warnings or [])])
