"""Offline Google deployment planner. Never authenticates or executes commands.

The optional output is a fresh, allowlisted build context under .deployment.
No environment file, credential file, user PDF, or existing cloud policy is read.
Production billing, IAM changes, security rules and releases require a separate
review. This script has intentionally no --deploy or --execute switch.
"""

import argparse
from dataclasses import asdict, dataclass
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
SERVICE = "revsy-quiz-parser"
QUEUE = "revsy-quiz-imports"
REGISTRY = "revsy-quiz"
SECRET = "revsy-gemini-api-key"


class PlanError(ValueError):
    pass


@dataclass(frozen=True)
class Config:
    project: str
    project_number: str
    bucket: str
    frontend_origin: str
    region: str = "us-central1"
    model: str = "gemini-3.8-flash"
    secret_version: str = "1"

    @property
    def runtime_email(self):
        return f"revsy-quiz-runtime@{self.project}.iam.gserviceaccount.com"

    @property
    def task_email(self):
        return f"revsy-quiz-tasks@{self.project}.iam.gserviceaccount.com"

    @property
    def service_url(self):
        return f"https://{SERVICE}-{self.project_number}.{self.region}.run.app"


def validate(config):
    if not re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]", config.project):
        raise PlanError("Use a valid Google project ID.")
    if not re.fullmatch(r"[1-9][0-9]{5,19}", config.project_number):
        raise PlanError("Provide the Google project number, not a credential.")
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]", config.bucket):
        raise PlanError("Provide the existing Firebase Storage bucket name.")
    if not re.fullmatch(r"[a-z]+(?:-[a-z]+)+[1-9][0-9]?", config.region):
        raise PlanError("Use a Google region name, such as us-central1.")
    if not re.fullmatch(r"gemini-[a-z0-9.-]{1,80}", config.model):
        raise PlanError("Use a Gemini model identifier.")
    if not re.fullmatch(r"[1-9][0-9]{0,9}", config.secret_version):
        raise PlanError("Pin an explicit numeric Secret Manager version.")
    try:
        origin = urlsplit(config.frontend_origin)
        port = origin.port
    except ValueError as error:
        raise PlanError("Use an exact HTTPS frontend origin.") from error
    hostname_valid = bool(origin.hostname) and all(
        re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
        for label in (origin.hostname or "").split("."))
    if (origin.scheme != "https" or not hostname_valid or port not in {None, 443}
            or origin.username or origin.password or origin.path or origin.query
            or origin.fragment or any(c.isspace() for c in config.frontend_origin)):
        raise PlanError("Use an exact HTTPS frontend origin with no path.")


def source_files(root=ROOT):
    """Read only the two runtime packages and named container dependencies."""
    root = root.resolve()
    result = {}
    fixed = {"Dockerfile": "services/quiz-gemini/Dockerfile",
             "services/quiz-gemini/requirements.txt": "services/quiz-gemini/requirements.txt"}
    for target, relative in fixed.items():
        path = root / relative
        if not path.is_file() or not path.resolve().is_relative_to(root):
            raise PlanError("A required runtime source is missing or resolves outside the repository.")
        result[target] = path.read_bytes()
    for directory in ("services/quiz-parser/quiz_parser", "services/quiz-gemini/quiz_gemini"):
        package = root / directory
        if not (package / "__init__.py").is_file():
            raise PlanError("Both runtime Python packages must exist before preparing a deployment.")
        for path in sorted(package.glob("*.py")):
            if not path.resolve().is_relative_to(root) or path.stat().st_size > 1_000_000:
                raise PlanError("A runtime source is outside the repository or too large.")
            result[path.relative_to(root).as_posix()] = path.read_bytes()
    # The stage never contains other repository files, so Cloud Build cannot
    # accidentally upload ignored environment files or uploaded question papers.
    result[".gcloudignore"] = b"**/__pycache__/**\n**/*.pyc\n"
    result[".dockerignore"] = b"**/__pycache__/**\n**/*.pyc\n"
    return result


def source_digest(files):
    digest = hashlib.sha256()
    for name, content in sorted(files.items()):
        digest.update(name.encode("utf-8") + b"\0" + content + b"\0")
    return digest.hexdigest()


def hosting_config(config):
    # Hosting only. Never point production Firebase deploy at emulator rules.
    return {"hosting": {
        "public": "../../../dist",
        "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
        "headers": [{"source": "/api/**", "headers": [
            {"key": "Cache-Control", "value": "private, no-store"}]}],
        "rewrites": [
            {"source": "/api/**", "run": {"serviceId": SERVICE,
             "region": config.region, "pinTag": True}},
            {"source": "**", "destination": "/index.html"}
        ]}}


def plan(config, files, output_dir):
    validate(config)
    output_dir = output_dir.resolve()
    digest = source_digest(files)
    image = f"{config.region}-docker.pkg.dev/{config.project}/{REGISTRY}/parser:{digest[:16]}"
    project_arg = f"--project={config.project}"
    location_arg = f"--location={config.region}"
    region_arg = f"--region={config.region}"
    runtime_member = f"serviceAccount:{config.runtime_email}"
    queue_path = f"projects/{config.project}/locations/{config.region}/queues/{QUEUE}"
    environment = {
        "FIREBASE_PROJECT_ID": config.project,
        "FIREBASE_STORAGE_BUCKET": config.bucket,
        "FRONTEND_ORIGIN": config.frontend_origin,
        "GEMINI_MODEL": config.model,
        "CLOUD_TASKS_QUEUE": queue_path,
        "TASKS_SERVICE_ACCOUNT": config.task_email,
        "TASKS_AUDIENCE": config.service_url,
        "PARSER_PUBLIC_URL": config.service_url,
    }
    entries = []

    def add(stage, purpose, *args):
        entries.append({"stage": stage, "purpose": purpose, "argv": list(args)})

    add("inspect", "Verify selected project number and owner before changing resources.",
        "gcloud", "projects", "describe", config.project, "--format=json(projectId,projectNumber)")
    add("inspect", "Inspect existing bucket location and CORS; preserve unrelated entries.",
        "gcloud", "storage", "buckets", "describe", f"gs://{config.bucket}", "--format=json")
    add("inspect", "Check for an existing service; never overwrite an unrelated service.",
        "gcloud", "run", "services", "describe", SERVICE, project_arg, region_arg, "--format=export")
    add("setup", "Enable reviewed APIs after the owner has enabled Firebase Blaze billing.",
        "gcloud", "services", "enable", "run.googleapis.com", "cloudbuild.googleapis.com",
        "artifactregistry.googleapis.com", "cloudtasks.googleapis.com", "secretmanager.googleapis.com",
        "firestore.googleapis.com", "storage.googleapis.com", "identitytoolkit.googleapis.com",
        "iam.googleapis.com", project_arg)
    for name in ("revsy-quiz-runtime", "revsy-quiz-tasks"):
        add("setup", "Create a dedicated service identity if it does not already exist.",
            "gcloud", "iam", "service-accounts", "create", name, project_arg)
    add("setup", "Create the named image repository if it does not already exist.",
        "gcloud", "artifacts", "repositories", "create", REGISTRY,
        "--repository-format=docker", location_arg, project_arg)
    add("setup", "Create only the key secret container; add the key version securely in Secret Manager Console.",
        "gcloud", "secrets", "create", SECRET, "--replication-policy=automatic", project_arg)
    add("setup", "Create a single-dispatch queue with bounded retries.",
        "gcloud", "tasks", "queues", "create", QUEUE, location_arg, project_arg,
        "--max-concurrent-dispatches=1", "--max-dispatches-per-second=1", "--max-attempts=3",
        "--min-backoff=180s", "--max-backoff=600s", "--max-retry-duration=7200s")
    add("inspect", "Verify the managed Cloud Tasks service agent retains its project service-agent role before task delivery.",
        "gcloud", "projects", "get-iam-policy", config.project, "--format=json")
    add("inspect", "Identify the actual regional build service account; do not assume the legacy Cloud Build identity.",
        "gcloud", "builds", "get-default-service-account", project_arg, region_arg)
    for role in ("roles/datastore.user", "roles/firebaseauth.viewer"):
        add("iam", "Grant the runtime the Firestore data or revoked-token lookup permission.",
            "gcloud", "projects", "add-iam-policy-binding", config.project,
            f"--member={runtime_member}", f"--role={role}")
    add("iam", "Grant object access only on the selected Firebase Storage bucket.",
        "gcloud", "storage", "buckets", "add-iam-policy-binding", f"gs://{config.bucket}",
        f"--member={runtime_member}", "--role=roles/storage.objectUser")
    add("iam", "Grant Gemini secret access on this secret only.",
        "gcloud", "secrets", "add-iam-policy-binding", SECRET, project_arg,
        f"--member={runtime_member}", "--role=roles/secretmanager.secretAccessor")
    add("iam", "Allow only this runtime to enqueue in the quiz queue.",
        "gcloud", "tasks", "queues", "add-iam-policy-binding", QUEUE, location_arg, project_arg,
        f"--member={runtime_member}", "--role=roles/cloudtasks.enqueuer")
    add("iam", "Allow the runtime to select only the dedicated task identity for OIDC.",
        "gcloud", "iam", "service-accounts", "add-iam-policy-binding", config.task_email,
        project_arg, f"--member={runtime_member}", "--role=roles/iam.serviceAccountUser")
    add("iam", "Allow the managed Cloud Tasks agent to select this identity; its project service-agent role supplies token minting.",
        "gcloud", "iam", "service-accounts", "add-iam-policy-binding", config.task_email,
        project_arg, f"--member=serviceAccount:service-{config.project_number}@gcp-sa-cloudtasks.iam.gserviceaccount.com",
        "--role=roles/iam.serviceAccountUser")
    add("build", "Upload only the frozen allowlisted runtime context to Cloud Build.",
        "gcloud", "builds", "submit", str(output_dir / "context"), project_arg, region_arg,
        f"--tag={image}")
    add("release", "Deploy CPU request-based processing; Firebase ID tokens protect public API and OIDC protects task handler.",
        "gcloud", "run", "deploy", SERVICE, project_arg, region_arg, f"--image={image}",
        f"--service-account={config.runtime_email}", "--cpu=1", "--memory=1Gi",
        "--min-instances=0", "--max-instances=1", "--concurrency=4", "--timeout=1800s",
        "--cpu-throttling", "--port=8080", "--allow-unauthenticated",
        f"--env-vars-file={output_dir / 'runtime-env.yaml'}",
        f"--set-secrets=GEMINI_API_KEY={SECRET}:{config.secret_version}",
        "--labels=app=revsy,component=quiz-parser")
    add("inspect", "Verify the returned service URL matches task audience and callback URL before uploading PDFs.",
        "gcloud", "run", "services", "describe", SERVICE, project_arg, region_arg,
        "--format=value(status.url)")
    add("hosting", "Release the already-built SPA and its API rewrite; no Firestore or Storage rules publish.",
        "firebase", "deploy", "--only=hosting", project_arg,
        f"--config={output_dir / 'hosting' / 'firebase.json'}")
    return {
        "mode": "plan-only", "config": asdict(config), "sourceSha256": digest,
        "buildContextFiles": sorted(files), "image": image, "serviceUrl": config.service_url,
        "runtimeEnvironment": environment, "commands": entries,
        "manualPrerequisites": [
            "Owner approval of Firebase Blaze billing, paid resources, IAM, and public API release.",
            "A provisioned Firebase Storage bucket and reviewed additive Storage/Firestore rules.",
            "Gemini key stored as the pinned Secret Manager version; never placed in VITE_* or build args.",
            "Verify region is supported by Firebase Hosting rewrites and compatible with data location needs.",
            "Verify the managed Cloud Tasks agent has roles/cloudtasks.serviceAgent on the project; Service Account User alone does not mint OIDC tokens.",
            "Inspect Cloud Build's selected service account; scope image write to this repository and source/log access to the actual build buckets or configured Cloud Logging.",
            "Verify the build submitter can create builds, use enabled services, upload source and act as the selected build identity when required.",
            "Verify the release principal can act as the runtime, deploy Cloud Run and set its public IAM policy; Hosting pinTag also requires Cloud Run get/update permissions.",
            "Build SPA with VITE_QUIZ_PARSER_URL=/api, VITE_QUIZ_PARSER_MODE=gemini and emulators disabled.",
            "Add the Hosting domain to Firebase Authentication authorized domains and merged bucket CORS.",
            "Review cost budget alerts; budget alerts do not cap charges.",
        ],
    }


def write_plan(result, files, output_dir, root=ROOT):
    """Never erase an old context or write outside the ignored deployment folder."""
    output_dir = output_dir.resolve()
    allowed = (root.resolve() / ".deployment" / "google").resolve()
    if output_dir == allowed or not output_dir.is_relative_to(allowed):
        raise PlanError("Write output to a fresh child directory of .deployment/google.")
    if output_dir.exists():
        raise PlanError("Output already exists. Choose a fresh directory so the reviewed context is immutable.")
    for name, content in files.items():
        path = output_dir / "context" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    (output_dir / "plan.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    env_yaml = "\n".join(f"{name}: {json.dumps(value)}" for name, value in result["runtimeEnvironment"].items())
    (output_dir / "runtime-env.yaml").write_text(env_yaml + "\n", encoding="utf-8")
    directory = output_dir / "hosting"
    directory.mkdir()
    config = Config(**result["config"])
    # dist lives at repository root; path depth can vary with output directory.
    import os
    hosting = hosting_config(config)
    hosting["hosting"]["public"] = Path(os.path.relpath(root / "dist", directory)).as_posix()
    (directory / "firebase.json").write_text(json.dumps(hosting, indent=2) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--project-number", required=True)
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--frontend-origin", required=True)
    parser.add_argument("--region", default="us-central1")
    parser.add_argument("--model", default="gemini-3.8-flash")
    parser.add_argument("--secret-version", default="1")
    parser.add_argument("--output-dir", type=Path,
                        help="Optional fresh child directory of .deployment/google; no command execution.")
    args = parser.parse_args()
    config = Config(args.project, args.project_number, args.bucket, args.frontend_origin,
                    args.region, args.model, args.secret_version)
    try:
        validate(config)
        files = source_files()
        destination = args.output_dir or ROOT / ".deployment" / "google" / source_digest(files)[:16]
        result = plan(config, files, destination)
        if args.output_dir:
            write_plan(result, files, destination)
        print(json.dumps(result, indent=2))
    except (PlanError, OSError) as error:
        parser.exit(2, f"Cannot prepare deployment plan: {error}\n")


if __name__ == "__main__":
    main()
