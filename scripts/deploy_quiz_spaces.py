"""Upload the two prepared Docker Spaces without selecting paid hardware.

Install huggingface_hub separately and use --env-file .env.deploy.local,
configure HF_TOKEN, or log in with `hf auth login`.
Secrets are sent through the Hub API; never print or commit their contents.
"""

import argparse
import json
import os
from pathlib import Path
import secrets


DEPLOY_ENV_VARIABLES = {
    'HF_TOKEN', 'HF_INFERENCE_TOKEN', 'HF_NAMESPACE', 'FRONTEND_ORIGIN',
    'FIREBASE_PROJECT_ID', 'FIREBASE_STORAGE_BUCKET', 'FIREBASE_SERVICE_ACCOUNT_FILE',
    'GEMINI_API_KEY', 'GEMINI_MODEL', 'QUIZ_PARSER_PROVIDER',
}


def read_deploy_env(path):
    """Read literal single-line values without interpolation or executing content."""
    values = {}
    for number, line in enumerate(path.read_text(encoding='utf-8-sig').splitlines(), 1):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        key, separator, value = line.partition('=')
        key, value = key.strip(), value.strip()
        if not separator or key not in DEPLOY_ENV_VARIABLES or key in values:
            raise ValueError(f'Invalid or duplicate deployment setting on line {number}.')
        if value.startswith(('"', "'")):
            if len(value) < 2 or value[-1] != value[0]:
                raise ValueError(f'Unclosed quoted deployment setting on line {number}.')
            value = value[1:-1]
        values[key] = value
    return values


def main():
    env_parser = argparse.ArgumentParser(add_help=False)
    env_parser.add_argument('--env-file', type=Path)
    env_args, _ = env_parser.parse_known_args()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', type=Path,
                        help='Local deployment-only configuration; never uploaded to a Space.')
    deploy_env = {}
    if env_args.env_file:
        try:
            deploy_env = read_deploy_env(env_args.env_file)
        except OSError:
            parser.error('Cannot read the deployment environment file.')
        except ValueError as error:
            parser.error(str(error))
    account_default = deploy_env.get('FIREBASE_SERVICE_ACCOUNT_FILE') or None
    if account_default:
        account_default = Path(account_default).expanduser()
        if not account_default.is_absolute():
            account_default = env_args.env_file.resolve().parent / account_default
    for flag, name in (
        ('--namespace', 'HF_NAMESPACE'), ('--frontend-origin', 'FRONTEND_ORIGIN'),
        ('--firebase-project', 'FIREBASE_PROJECT_ID'), ('--firebase-bucket', 'FIREBASE_STORAGE_BUCKET'),
    ):
        default = deploy_env.get(name) or None
        parser.add_argument(flag, default=default, required=default is None)
    parser.add_argument('--service-account-file', default=account_default,
                        required=account_default is None, type=Path)
    parser.add_argument('--worker-name', default='revsy-quiz-parser')
    parser.add_argument('--ocr-name', default='revsy-paddleocr')
    parser.add_argument('--update-existing', action='store_true',
                        help='Update only existing Spaces carrying a matching Revsy service marker.')
    args = parser.parse_args()

    from urllib.parse import urlparse
    from huggingface_hub import HfApi, get_token, hf_hub_download

    origin = urlparse(args.frontend_origin)
    if (origin.scheme != 'https' or not origin.hostname or origin.username or origin.password
            or origin.path not in ('', '/') or origin.query or origin.fragment):
        parser.error('--frontend-origin must be an exact production HTTPS origin.')
    import re
    for value in (args.namespace, args.worker_name, args.ocr_name):
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,95}', value):
            parser.error('Namespace and Space names must be valid Hub identifiers.')
    if args.worker_name == args.ocr_name:
        parser.error('The worker and OCR service must have different Space names.')
    token = deploy_env.get('HF_TOKEN') or get_token()
    if not token:
        parser.error('Set HF_TOKEN in the deployment environment file or log in with hf auth login first.')
    service_account = json.loads(args.service_account_file.read_text(encoding='utf-8'))
    if service_account.get('type') != 'service_account' or service_account.get('project_id') != args.firebase_project:
        parser.error('The service-account file must belong to the selected Firebase project.')

    root = Path(__file__).resolve().parents[1]
    if args.service_account_file.resolve().is_relative_to(root):
        parser.error('Keep Firebase service-account credentials outside the repository.')
    paths = {'worker': root / 'services' / 'quiz-parser', 'ocr': root / 'services' / 'paddleocr-space'}
    if not all((path / 'Dockerfile').is_file() and (path / 'README.md').is_file() for path in paths.values()):
        parser.error('Both Docker Space packages must be present before deploying.')

    api = HfApi(token=token)
    worker_id = f'{args.namespace}/{args.worker_name}'
    ocr_id = f'{args.namespace}/{args.ocr_name}'
    # Public API Spaces authenticate every processing request themselves. A private
    # worker Space would require exposing an HF token to the frontend, which we avoid.
    service_kinds = {ocr_id: 'paddleocr', worker_id: 'quiz-parser'}
    existing = {}
    # Check every target before creating or updating anything. Unrelated Spaces must
    # never be overwritten, even when a deploy command accidentally reuses a name.
    for repo_id, kind in service_kinds.items():
        existing[repo_id] = api.repo_exists(repo_id=repo_id, repo_type='space')
        if existing[repo_id]:
            if not args.update_existing:
                parser.error(f'{repo_id} already exists. Select a new name or explicitly update a verified Revsy Space.')
            try:
                marker_path = hf_hub_download(repo_id=repo_id, repo_type='space', filename='revsy-service.json', token=token)
                marker = json.loads(Path(marker_path).read_text(encoding='utf-8'))
            except Exception:
                parser.error(f'{repo_id} is missing the expected Revsy service marker.')
            if marker != {'application': 'revsy', 'service': kind, 'schemaVersion': 1}:
                parser.error(f'{repo_id} belongs to a different service.')
            if getattr(api.space_info(repo_id=repo_id), 'private', False):
                parser.error(f'{repo_id} must expose its authenticated API publicly for this architecture.')
    for repo_id in service_kinds:
        if not existing[repo_id]:
            api.create_repo(repo_id=repo_id, repo_type='space', space_sdk='docker', private=False, exist_ok=False)
            directory = paths['ocr'] if repo_id == ocr_id else paths['worker']
            api.upload_file(repo_id=repo_id, repo_type='space',
                            path_or_fileobj=str(directory / 'revsy-service.json'),
                            path_in_repo='revsy-service.json',
                            commit_message='Identify Revsy service for safe deployment recovery')

    # Read the canonical host returned by Hub metadata; do not construct or guess it.
    ocr_info = api.space_info(repo_id=ocr_id)
    ocr_host = getattr(ocr_info, 'host', None)
    if not ocr_host:
        raise RuntimeError('Hub has not assigned an OCR Space host yet. Retry with --update-existing once it has.')
    ocr_url = ocr_host if ocr_host.startswith('https://') else f'https://{ocr_host}'
    shared_token = secrets.token_urlsafe(48)
    inference_token = deploy_env.get('HF_INFERENCE_TOKEN') or os.environ.get('HF_INFERENCE_TOKEN') or token
    api.add_space_secret(repo_id=ocr_id, key='PADDLEOCR_TOKEN', value=shared_token)
    api.add_space_variable(repo_id=ocr_id, key='FIREBASE_STORAGE_BUCKET', value=args.firebase_bucket)
    for key, value in {
        'FIREBASE_SERVICE_ACCOUNT_JSON': json.dumps(service_account),
        'HF_TOKEN': inference_token,
        'PADDLEOCR_TOKEN': shared_token,
    }.items():
        api.add_space_secret(repo_id=worker_id, key=key, value=value)
    for key, value in {
        'FIREBASE_PROJECT_ID': args.firebase_project,
        'FIREBASE_STORAGE_BUCKET': args.firebase_bucket,
        'ALLOWED_ORIGINS': args.frontend_origin.rstrip('/'),
        'PADDLEOCR_URL': ocr_url,
    }.items():
        api.add_space_variable(repo_id=worker_id, key=key, value=value)
    for repo_id, directory in ((ocr_id, paths['ocr']), (worker_id, paths['worker'])):
        api.upload_folder(repo_id=repo_id, repo_type='space', folder_path=str(directory),
                          allow_patterns=['Dockerfile', 'README.md', 'requirements.txt', '.dockerignore',
                                          'revsy-service.json', 'app.py', 'quiz_parser/*.py',
                                          'firestore.indexes.example.json'],
                          ignore_patterns=['.venv/**', '__pycache__/**', '**/__pycache__/**', '*.pyc',
                                           'tests/**', '.pytest_cache/**', '.env', '.env.*', '*.local',
                                           '*service-account*.json', '*firebase-adminsdk*.json',
                                           '*.pem', '*.key', '*.p12'],
                          commit_message='Deploy Revsy PDF quiz service')
    worker_info = api.space_info(repo_id=worker_id)
    worker_host = getattr(worker_info, 'host', None)
    print(f'Worker Space: https://huggingface.co/spaces/{worker_id}')
    print(f'OCR Space: https://huggingface.co/spaces/{ocr_id}')
    if worker_host:
        worker_url = worker_host if worker_host.startswith('https://') else f'https://{worker_host}'
        print(f'Set VITE_QUIZ_PARSER_URL={worker_url} after service health checks pass.')
    print('Hardware was not upgraded. Select a compatible GPU for OCR and keep the worker awake in Space Settings.')
    print('Merge the Firebase rule snippets and bucket CORS before enabling frontend uploads.')


if __name__ == '__main__':
    main()
