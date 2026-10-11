"""Offline, conservative additive Firebase planning. No credentials or network.

Call these functions only with previously downloaded non-secret source/metadata.
Deployment must independently compile/test merged rules and recheck remote state.
"""

import copy
import json
import re
from urllib.parse import urlsplit


class UnsafeMerge(ValueError):
    pass


def mask_comments_and_strings(source):
    if not isinstance(source, str) or len(source.encode("utf-8")) > 1_000_000:
        raise UnsafeMerge("Rules source is missing or exceeds the supported size.")
    characters, index = list(source), 0

    def blank(start, end):
        for position in range(start, end):
            if source[position] not in "\r\n":
                characters[position] = " "

    while index < len(source):
        if source.startswith("//", index):
            end = source.find("\n", index)
            end = len(source) if end == -1 else end
            blank(index, end)
            index = end
        elif source.startswith("/*", index):
            end = source.find("*/", index + 2)
            if end == -1:
                raise UnsafeMerge("Rules contain an unclosed block comment.")
            end += 2
            blank(index, end)
            index = end
        elif source[index] in "\"'":
            start, quote = index, source[index]
            index += 1
            while index < len(source):
                if source[index] == "\\":
                    index += 2
                elif source[index] == quote:
                    index += 1
                    blank(start, index)
                    break
                else:
                    index += 1
            else:
                raise UnsafeMerge("Rules contain an unclosed quoted string.")
        else:
            index += 1
    return "".join(characters)


def closing_brace(code, opening):
    depth = 0
    for index in range(opening, len(code)):
        if code[index] == "{":
            depth += 1
        elif code[index] == "}":
            depth -= 1
            if depth == 0:
                return index
            if depth < 0:
                break
    raise UnsafeMerge("Rules wrapper braces are unbalanced.")


def overlapping_recursive_paths(code):
    paths = re.findall(r"\bmatch\s+((?:/[A-Za-z0-9_.-]+|/\{[A-Za-z_]\w*(?:=\*\*)?\})+)\s*\{", code)
    result = []
    for path in paths:
        if "=**}" not in path:
            continue
        prefix = path.split("=**}", 1)[0].rsplit("/", 1)[0]
        segments = re.findall(r"/([^/]+)", prefix)
        # An ancestor recursive match could bypass every new quiz allow condition.
        if not segments or (segments[0] == "users" and (len(segments) <= 2 or
                segments[2].startswith("{") or segments[2] in {"quizImports", "quizzes", "quiz-imports"})):
            result.append(path)
        elif segments and segments[0].startswith("{"):
            result.append(path)
    return result


def merge_quiz_rules(source, snippet, service):
    if service not in {"firestore", "storage"}:
        raise UnsafeMerge("Unknown Firebase service.")
    marker_start = f"// BEGIN REVSY QUIZ RULES {service.upper()} V1"
    marker_end = f"// END REVSY QUIZ RULES {service.upper()} V1"
    code = mask_comments_and_strings(source)
    service_name = "cloud.firestore" if service == "firestore" else "firebase.storage"
    services = list(re.finditer(r"\bservice\s+" + re.escape(service_name) + r"\s*\{", code))
    if len(services) != 1:
        raise UnsafeMerge("Expected exactly one matching Firebase service wrapper.")
    service_open = services[0].end() - 1
    service_close = closing_brace(code, service_open)
    body = code[service_open + 1:service_close]
    wrapper_pattern = (r"\bmatch\s+/databases/\{(?P<variable>[A-Za-z_]\w*)\}/documents\s*\{"
                       if service == "firestore" else
                       r"\bmatch\s+/b/\{(?P<variable>[A-Za-z_]\w*)\}/o\s*\{")
    wrappers = list(re.finditer(wrapper_pattern, body))
    if len(wrappers) != 1:
        raise UnsafeMerge("Expected one database/bucket root match wrapper.")
    opening = service_open + 1 + wrappers[0].end() - 1
    closing = closing_brace(code, opening)
    wrapper_body = code[opening + 1:closing]
    outside_quiz_block = wrapper_body
    if marker_start in source or marker_end in source:
        if source.count(marker_start) != 1 or source.count(marker_end) != 1:
            raise UnsafeMerge("Existing quiz rule markers are ambiguous.")
        start, end = source.index(marker_start), source.index(marker_end) + len(marker_end)
        if not opening < start < end < closing:
            raise UnsafeMerge("Existing quiz markers are outside the expected root wrapper.")
        outside_quiz_block = (wrapper_body[:start - opening - 1] +
                              " " * (end - start) + wrapper_body[end - opening - 1:])
    overlapping = overlapping_recursive_paths(outside_quiz_block)
    if overlapping:
        raise UnsafeMerge("Recursive match paths may override quiz protection; review before merging: " + ", ".join(overlapping))
    # Existing root variables may have another name; preserve all old source verbatim.
    if service == "firestore":
        snippet = snippet.replace("$(database)", "$(" + wrappers[0].group("variable") + ")")
    if marker_start in source or marker_end in source:
        if source.count(marker_start) != 1 or source.count(marker_end) != 1:
            raise UnsafeMerge("Existing quiz rule markers are ambiguous.")
        current = source.split(marker_start, 1)[1].split(marker_end, 1)[0]
        if "\n".join(line.strip() for line in current.strip().splitlines()) != "\n".join(line.strip() for line in snippet.strip().splitlines()):
            raise UnsafeMerge("Existing marked quiz rules differ; review an explicit update.")
        return source
    if re.search(r"\bmatch\s+[^\n;]*\b(?:quizImports|quizzes|quiz-imports)\b", wrapper_body):
        raise UnsafeMerge("Quiz paths already have rules; inspect and merge them manually.")
    line_start = source.rfind("\n", 0, closing) + 1
    insertion = line_start if not source[line_start:closing].strip() else closing
    indentation = source[line_start:closing] if insertion == line_start else "  "
    indentation += "  "
    block = "\n".join(indentation + line if line else "" for line in
                      [marker_start, *snippet.strip().splitlines(), marker_end])
    return source[:insertion] + block + "\n" + source[insertion:]


def merge_bucket_cors(existing, frontend_origin):
    try:
        parsed = urlsplit(frontend_origin)
        port = parsed.port
    except (TypeError, ValueError) as exc:
        raise UnsafeMerge("The frontend origin is invalid.") from exc
    if (parsed.scheme not in {"https", "http"} or not parsed.hostname or parsed.username or parsed.password or
            parsed.path not in {"", "/"} or parsed.query or parsed.fragment or
            (parsed.scheme == "http" and parsed.hostname not in {"localhost", "127.0.0.1"})):
        raise UnsafeMerge("Use an exact HTTPS frontend origin (or local development origin).")
    if not isinstance(existing, list) or any(not isinstance(entry, dict) for entry in existing):
        raise UnsafeMerge("Existing bucket CORS must be a list of configurations.")
    entry = {"origin": [frontend_origin.rstrip("/")], "method": ["GET", "HEAD"],
             "maxAgeSeconds": 3600,
             "responseHeader": ["Content-Type", "Content-Length", "Content-Disposition"]}
    merged = copy.deepcopy(existing)
    canonical = lambda item: json.dumps(item, sort_keys=True)
    if not any(canonical(item) == canonical(entry) for item in merged):
        merged.append(entry)
    return merged


def merge_single_field_group_index(field, field_name):
    if field_name not in {"status", "leaseUntil"}:
        raise UnsafeMerge("Only the two quiz queue fields may be changed.")
    if not isinstance(field, dict) or not field.get("name", "").endswith("/collectionGroups/quizImports/fields/" + field_name):
        raise UnsafeMerge("Field metadata does not belong to the intended quiz queue field.")
    config = field.get("indexConfig", {})
    if not isinstance(config.get("indexes"), list):
        raise UnsafeMerge("Fetch the effective ancestor index configuration before merging this field.")
    writable = {"queryScope", "apiScope", "fields", "density", "multikey", "shardCount", "unique", "searchIndexOptions"}
    indexes = [{key: copy.deepcopy(value) for key, value in index.items() if key in writable}
               for index in config["indexes"]]
    requested = {"queryScope": "COLLECTION_GROUP", "fields": [{"fieldPath": field_name, "order": "ASCENDING"}]}
    if not any(index.get("queryScope") == "COLLECTION_GROUP" and
               index.get("fields") == requested["fields"] and
               index.get("apiScope", "ANY_API") == "ANY_API"
               for index in indexes):
        indexes.append(requested)
    # Call field.patch with updateMask=indexConfig only, so unrelated TTL is retained.
    return {"name": field["name"], "indexConfig": {"indexes": indexes}}
