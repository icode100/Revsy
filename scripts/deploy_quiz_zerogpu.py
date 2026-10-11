"""Deploy the bounded Gradio prototype using free ZeroGPU hardware only.

Default mode uploads no Firebase or Hugging Face credentials to the Space.
Use --enable-firebase only after Storage, rules, CORS and queue indexes work.
This script never requests a hardware upgrade on an existing Space.
"""

import argparse
from dataclasses import dataclass
import json
from pathlib import Path
import re
import secrets
from urllib.parse import urlsplit

try:
    from .deploy_quiz_spaces import read_deploy_env
except ImportError:  # Also support `python scripts/deploy_quiz_zerogpu.py`.
    from deploy_quiz_spaces import read_deploy_env


MARKER = {"application": "revsy", "service": "quiz-zerogpu", "schemaVersion": 1}
ZERO_HARDWARE = "zero-a10g"
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$")


class DeploymentError(ValueError):
    """A deployment failure safe to display without exposing credentials."""


@dataclass(frozen=True)
class DeployConfig:
    namespace: str
    space_name: str = "revsy-quiz-zerogpu"
    update_existing: bool = False
    enable_firebase: bool = False
    firebase_project: str | None = None
    firebase_bucket: str | None = None
    frontend_origin: str | None = None

    @property
    def repo_id(self) -> str:
        return f"{self.namespace}/{self.space_name}"


def exact_https_origin(value: str) -> str:
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except (TypeError, ValueError) as error:
        raise DeploymentError("Use an exact production HTTPS origin.") from error
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or port not in {None, 443} or parsed.path not in {"", "/"} or parsed.query or parsed.fragment):
        raise DeploymentError("Use an exact production HTTPS origin.")
    return value.rstrip("/")


def canonical_space_url(host: str | None) -> str:
    if not isinstance(host, str) or not host:
        raise DeploymentError("Hub has not assigned a Space host. Retry with --update-existing once it has.")
    value = host if "://" in host else "https://" + host
    origin = exact_https_origin(value)
    if not urlsplit(origin).hostname.endswith(".hf.space"):
        raise DeploymentError("Hub returned an unexpected Space host; deployment stopped.")
    return origin


def validate_config(config: DeployConfig, service_account: dict | None) -> None:
    if not all(IDENTIFIER.fullmatch(value or "") for value in (config.namespace, config.space_name)):
        raise DeploymentError("Namespace and Space name must be valid Hub identifiers.")
    if config.enable_firebase:
        if (not isinstance(config.firebase_project, str) or
                not re.fullmatch(r"[a-z][a-z0-9-]{4,61}", config.firebase_project) or
                not isinstance(config.firebase_bucket, str) or
                not re.fullmatch(r"[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]", config.firebase_bucket)):
            raise DeploymentError("Firebase mode needs a valid project ID and Storage bucket name.")
        exact_https_origin(config.frontend_origin)
        if (not isinstance(service_account, dict) or service_account.get("type") != "service_account"
                or service_account.get("project_id") != config.firebase_project
                or not isinstance(service_account.get("private_key"), str)
                or not service_account.get("private_key")
                or not isinstance(service_account.get("client_email"), str)
                or not service_account.get("client_email")):
            raise DeploymentError("The service-account file must belong to the selected Firebase project.")


def load_service_account(path: Path | None, root: Path, project: str | None) -> dict:
    if path is None:
        raise DeploymentError("Firebase mode requires --service-account-file.")
    path = path.expanduser().resolve()
    if path.is_relative_to(root.resolve()):
        raise DeploymentError("Keep Firebase service-account credentials outside the repository.")
    try:
        account = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as error:
        raise DeploymentError("Cannot read a valid external service-account JSON file.") from error
    if not isinstance(account, dict) or account.get("project_id") != project:
        raise DeploymentError("The service-account file must belong to the selected Firebase project.")
    return account


def upload_operations(root: Path, operation_add) -> list:
    """Freeze only the named runtime files; never upload a repository folder."""
    root = root.resolve()
    space = root / "services" / "quiz-zerogpu"
    parser = root / "services" / "quiz-parser" / "quiz_parser"
    paths = [(name, space / name) for name in ("app.py", "ocr.py", "README.md", "requirements.txt", "revsy-service.json")]
    for package, directory in (("quiz_zerogpu", space / "quiz_zerogpu"), ("quiz_parser", parser)):
        if not (directory / "__init__.py").is_file():
            raise DeploymentError("Both runtime Python packages must be present before deployment.")
        paths.extend((f"{package}/{path.name}", path) for path in sorted(directory.glob("*.py")))
    operations = []
    for target, path in paths:
        if not path.is_file() or not path.resolve().is_relative_to(root):
            raise DeploymentError("A required runtime source is missing or points outside the repository.")
        if path.stat().st_size > 1_000_000:
            raise DeploymentError("A runtime source file exceeds the deployment limit.")
        content = path.read_bytes()
        if target == "revsy-service.json":
            try:
                marker = json.loads(content)
            except ValueError as error:
                raise DeploymentError("The local ZeroGPU service marker is invalid.") from error
            if marker != MARKER:
                raise DeploymentError("The local ZeroGPU service marker does not match this service.")
        if target == "README.md" and not re.search(rb"^sdk:[ \t]*gradio[ \t]*\r?$", content, re.M):
            raise DeploymentError("The Space README must select sdk: gradio.")
        operations.append(operation_add(path_in_repo=target, path_or_fileobj=content))
    return operations


def verify_existing(api, config: DeployConfig, marker_loader):
    if not config.update_existing:
        raise DeploymentError("Space already exists. Use a new name or --update-existing for a verified Revsy Space.")
    try:
        marker = marker_loader(config.repo_id)
    except Exception as error:
        raise DeploymentError("Existing Space is missing a valid Revsy ZeroGPU service marker.") from error
    if marker != MARKER:
        raise DeploymentError("Existing Space belongs to a different service.")
    info = api.space_info(repo_id=config.repo_id)
    if getattr(info, "sdk", None) != "gradio" or getattr(info, "private", False):
        raise DeploymentError("Existing Space must be a public Gradio Space with an authenticated backend API.")
    runtime = api.get_space_runtime(repo_id=config.repo_id)
    actual, requested = getattr(runtime, "hardware", None), getattr(runtime, "requested_hardware", None)
    # During build, hardware can be None; requested ZeroGPU still proves the
    # selected free hardware. Any paid actual/requested hardware is refused.
    if (actual not in {None, ZERO_HARDWARE} or requested not in {None, ZERO_HARDWARE}
            or (actual is None and requested is None)):
        raise DeploymentError("Existing Space is not configured exclusively for free ZeroGPU hardware.")
    return info


def deploy(api, config: DeployConfig, root: Path, *, token: str, operation_add,
           marker_loader, zero_hardware=ZERO_HARDWARE, service_account: dict | None = None,
           token_factory=secrets.token_urlsafe) -> dict:
    """Execute a prevalidated deployment; caller owns authorization and token."""
    if not token:
        raise DeploymentError("Log in with hf auth login or provide HF_TOKEN in a deployment environment file.")
    if zero_hardware != ZERO_HARDWARE:
        raise DeploymentError("This helper only supports free ZeroGPU hardware.")
    validate_config(config, service_account)
    operations = upload_operations(root, operation_add)
    exists = api.repo_exists(repo_id=config.repo_id, repo_type="space")
    if exists:
        info = verify_existing(api, config, marker_loader)
    else:
        api.create_repo(repo_id=config.repo_id, repo_type="space", space_sdk="gradio",
                        space_hardware=zero_hardware, private=False, exist_ok=False)
        # Publish the recovery identity immediately. A failed secret/source
        # upload can then be retried without ever overwriting unrelated Spaces.
        api.upload_file(repo_id=config.repo_id, repo_type="space",
                        path_in_repo="revsy-service.json", path_or_fileobj=json.dumps(MARKER).encode("utf-8"),
                        commit_message="Identify Revsy ZeroGPU service for safe deployment recovery")
        info = api.space_info(repo_id=config.repo_id)
    url = canonical_space_url(getattr(info, "host", None))
    shared_token = token_factory(48)
    if not isinstance(shared_token, str) or len(shared_token) < 32:
        raise DeploymentError("Could not generate a sufficiently strong backend OCR secret.")
    api.add_space_secret(repo_id=config.repo_id, key="QUIZ_OCR_TOKEN", value=shared_token)
    variables = {"QUIZ_ENABLE_FIREBASE": "true" if config.enable_firebase else "false",
                 "QUIZ_SPACE_ID": config.repo_id, "QUIZ_SPACE_URL": url}
    if config.enable_firebase:
        api.add_space_secret(repo_id=config.repo_id, key="FIREBASE_SERVICE_ACCOUNT_JSON", value=json.dumps(service_account))
        api.add_space_secret(repo_id=config.repo_id, key="HF_TOKEN", value=token)
        variables.update({"FIREBASE_PROJECT_ID": config.firebase_project,
                          "FIREBASE_STORAGE_BUCKET": config.firebase_bucket,
                          "ALLOWED_ORIGINS": exact_https_origin(config.frontend_origin)})
    for key, value in variables.items():
        api.add_space_variable(repo_id=config.repo_id, key=key, value=value)
    commit = {"repo_id": config.repo_id, "repo_type": "space", "operations": operations,
              "commit_message": "Deploy Revsy free ZeroGPU quiz prototype"}
    # Avoid overwriting a concurrently published source update when metadata has
    # a current revision. Hardware is never requested or altered after creation.
    if getattr(info, "sha", None):
        commit["parent_commit"] = info.sha
    api.create_commit(**commit)
    return {"repo_id": config.repo_id, "url": url, "firebase_enabled": config.enable_firebase}


def main(argv=None):
    env_parser = argparse.ArgumentParser(add_help=False)
    env_parser.add_argument("--env-file", type=Path)
    env_args, _ = env_parser.parse_known_args(argv)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path)
    try:
        values = read_deploy_env(env_args.env_file) if env_args.env_file else {}
    except (OSError, ValueError):
        parser.error("Cannot read a valid deployment environment file.")
    parser.add_argument("--namespace", default=values.get("HF_NAMESPACE"), required=not values.get("HF_NAMESPACE"))
    parser.add_argument("--space-name", default="revsy-quiz-zerogpu")
    parser.add_argument("--update-existing", action="store_true")
    parser.add_argument("--enable-firebase", action="store_true")
    parser.add_argument("--firebase-project", default=values.get("FIREBASE_PROJECT_ID"))
    parser.add_argument("--firebase-bucket", default=values.get("FIREBASE_STORAGE_BUCKET"))
    parser.add_argument("--frontend-origin", default=values.get("FRONTEND_ORIGIN"))
    account_path = Path(values["FIREBASE_SERVICE_ACCOUNT_FILE"]).expanduser() if values.get("FIREBASE_SERVICE_ACCOUNT_FILE") else None
    if account_path and not account_path.is_absolute():
        account_path = env_args.env_file.resolve().parent / account_path
    parser.add_argument("--service-account-file", type=Path, default=account_path)
    args = parser.parse_args(argv)
    root = Path(__file__).resolve().parents[1]
    try:
        from huggingface_hub import CommitOperationAdd, HfApi, SpaceHardware, get_token, hf_hub_download
        token = values.get("HF_TOKEN") or get_token()
        if not token:
            raise DeploymentError("Set HF_TOKEN in the deployment environment file or log in with hf auth login.")
        account = load_service_account(args.service_account_file, root, args.firebase_project) if args.enable_firebase else None
        config = DeployConfig(namespace=args.namespace, space_name=args.space_name, update_existing=args.update_existing,
                              enable_firebase=args.enable_firebase, firebase_project=args.firebase_project,
                              firebase_bucket=args.firebase_bucket, frontend_origin=args.frontend_origin)

        def marker_loader(repo_id):
            path = hf_hub_download(repo_id=repo_id, repo_type="space", filename="revsy-service.json", token=token)
            return json.loads(Path(path).read_text(encoding="utf-8"))

        result = deploy(HfApi(token=token), config, root, token=token, operation_add=CommitOperationAdd,
                        marker_loader=marker_loader, zero_hardware=SpaceHardware.ZERO_A10G, service_account=account)
    except DeploymentError as error:
        parser.error(str(error))
    except Exception as error:
        # API responses can include requests or credential configuration. Show
        # only the exception type; never dump request bodies or private values.
        parser.error(f"Deployment did not finish ({type(error).__name__}). No paid hardware was selected; retry only the verified Revsy Space.")
    print(f"Space: https://huggingface.co/spaces/{result['repo_id']}")
    print(f"Canonical API origin: {result['url']}")
    print("Free ZeroGPU hardware only; no existing hardware setting was changed.")
    print("Firebase mode enabled; verify health and a real PDF before frontend integration." if result["firebase_enabled"]
          else "Preview mode enabled; no Firebase or HF token was uploaded as a runtime credential.")


if __name__ == "__main__":
    main()
