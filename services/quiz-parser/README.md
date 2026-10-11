---
title: Revsy Quiz Parser
emoji: 📝
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 8080
---

# Revsy quiz parser

This separate CPU service accepts Firebase-authenticated imports, polls a durable Firestore queue, calls a full PaddleOCR-VL document pipeline, retains original diagrams in Firebase Storage, and groups the OCR output through Hugging Face Inference Providers. The Vercel frontend uploads PDFs directly to Storage and watches its Firestore import document. OCR jobs continue independently of browser requests.

PaddleOCR-VL-1.6 is an open-source model available on [Hugging Face](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6). Run its **full layout-parsing pipeline** rather than the vision-language component alone. Its [official deployment guide](https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/PaddleOCR-VL.html) describes `/layout-parsing`, PDF input, Markdown, and image crops. The worker requests plain Markdown and disables chart reinterpretation, document orientation changes, and unwarping to retain original diagram appearance.

The default grouping model is [Qwen/Qwen3-235B-A22B-Instruct-2507](https://huggingface.co/Qwen/Qwen3-235B-A22B-Instruct-2507), whose model card lists inference providers. `HF_STRUCTURING_MODEL` is configurable. The [Hugging Face chat API](https://huggingface.co/docs/inference-providers/tasks/chat-completion) supports the OpenAI-compatible router endpoint used here. Provider availability, rate limits, context/output limits, and billing depend on the selected account/provider. The worker does not assume one fixed provider is always available.

## Deploy the worker on Hugging Face

1. Create a **Docker Space** for the worker. Put the contents of this directory at the root of its Space repository, including this README's `sdk: docker` and `app_port: 8080` metadata. Its Dockerfile serves port 8080 with one coordinator process.
2. Deploy the separate [PaddleOCR GPU Space](../paddleocr-space/README.md). Set a long, randomly generated shared `PADDLEOCR_TOKEN` secret in both Spaces. Use the GPU Space's HTTPS app origin as the worker's `PADDLEOCR_URL`; the worker appends `/layout-parsing`.
3. Add these **Secrets** in worker Space Settings: `FIREBASE_SERVICE_ACCOUNT_JSON` (the entire JSON service-account credential for this Firebase project), `HF_TOKEN` (an HF token with Inference Providers permission), and `PADDLEOCR_TOKEN`. Credentials are read directly from JSON in memory; no credential file needs to be created in a Space. Do not place these in a public repository or any `VITE_*` variable.
4. Add these **Variables**: `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `PADDLEOCR_URL`, and `ALLOWED_ORIGINS` (comma-separated exact Vercel origins; add `http://localhost:5173` for local use). Optionally set `HF_STRUCTURING_MODEL`, `QUEUE_POLL_SECONDS=5`, `JOB_LEASE_SECONDS=180`, and `JOB_MAX_ATTEMPTS=3`.
5. Configure Firebase Storage and deploy the application's owner-scoped Firestore/Storage rules. The Admin service account needs Firestore access, bucket object read/write, and Firebase Authentication user-read permission for revoked-token verification. A service-account private key enables temporary signed PDF URLs; ADC credentials without signing fall back to the official Base64 PDF input.
6. Deploy the two single-field **collection-group indexes** for `quizImports.status` and `quizImports.leaseUntil`. Merge `firestore.indexes.example.json` into the existing project's index configuration. Wait for both indexes to finish building.
7. Verify `https://<worker-space-subdomain>.hf.space/health` returns `{"status":"ok"}`. Set the frontend's `VITE_QUIZ_PARSER_URL` to that worker origin and redeploy Vercel. Do a signed-in sample import and compare all extracted questions, math, diagrams, and answers with the source before saving.

[Docker Spaces](https://huggingface.co/docs/hub/spaces-sdks-docker) supplies runtime Secrets and supports a configured app port. The worker and GPU pipeline must remain running for continuous processing. [Basic Spaces sleep when inactive; upgraded hardware can remain awake](https://huggingface.co/docs/hub/spaces-gpus#configure-hardware-programmatically). Choose always-on hardware for production and leave sleep disabled. A sleeping demonstration Space leaves jobs queued until it wakes; Firestore still preserves them and recovers expired leases afterward. Neither Docker Space needs a persistent disk because PDFs, images, and queue state live in Firebase.

`PADDLE_IMAGE_HOSTS` is empty by default, so no arbitrary remote OCR image URL is downloaded. Prefer inline Base64 images from the Paddle service. If its image-return configuration uses remote URLs, set an exact hostname allowlist for its trusted storage service; the worker rejects private addresses, pins the verified public IP for the download, checks TLS against the original hostname, refuses redirects, and limits image sizes. If a safe image/crop is unavailable, it stores the original rendered PDF page and adds a review warning.

## Run locally

Use Python 3.12 or later from this directory:

```sh
python -m venv .venv
# Activate the environment using your shell's normal activation command.
python -m pip install -r requirements.txt
# Export the settings in .env.example; .env is documentation, not automatically loaded.
uvicorn quiz_parser.api:create_app --factory --host 0.0.0.0 --port 8080 --workers 1
python -m unittest discover -s tests -v
```

For a local credential file, use `GOOGLE_APPLICATION_CREDENTIALS` instead of `FIREBASE_SERVICE_ACCOUNT_JSON`. Container execution is `docker build -t revsy-quiz-parser .`, then `docker run --env-file .env -p 8080:8080 revsy-quiz-parser`. For a filepath credential, mount that file into the container at the exact configured path. Build the GPU pipeline separately using its own Dockerfile.

## API and saved data

`GET /health` returns a small liveness response. It does not validate external model credentials or report an inference-readiness guarantee.

`POST /jobs` requires `Authorization: Bearer <Firebase ID token>` and this JSON:

```json
{
  "id": "47f0efda-5988-4f7b-8b11-ab333191bd09",
  "title": "Math practice",
  "paperPath": "users/<authenticated-uid>/quiz-imports/47f0efda-5988-4f7b-8b11-ab333191bd09/paper.pdf",
  "answerKeyPath": "users/<authenticated-uid>/quiz-imports/47f0efda-5988-4f7b-8b11-ab333191bd09/answer-key.pdf"
}
```

The browser must finish uploading each PDF with `application/pdf` metadata first. Each is limited to 25 MB and 30 pages; encrypted PDFs fail with a friendly error. Paths must match the authenticated account and supplied UUID exactly. Omit `answerKeyPath` only if the paper has exactly one explicit standalone **Answer Key**, **Correct Answers**, or **Answers** heading followed by a key. Ordinary options in the question text cannot justify an answer.

The API returns `202 {"id":"..."}` after metadata/header validation. It creates `users/{uid}/quizImports/{id}` with epoch-millisecond timestamps and a flat `message`. Status follows `queued → reading-paper → reading-key (when separate) → storing-images → structuring → validating → ready`, or `failed`. A ready import contains the draft below. The frontend lets its owner inspect/edit that draft and saves the quiz separately.

```json
{
  "schemaVersion": 1,
  "title": "Math practice",
  "question": [{
    "id": "q1", "number": "1", "problem": "Find $x$.",
    "options": ["$1$", "$2$"],
    "images": [{"id": "paper-p1-img1", "page": 1,
      "storagePath": "users/<uid>/quiz-imports/<id>/assets/<lease>/paper-p1-img1.png"}]
  }],
  "key": [{"questionId": "q1", "correctOptionIndex": 0}],
  "source": {"paperPath": "users/<uid>/quiz-imports/<id>/paper.pdf"},
  "parsing": {"model": "PaddlePaddle/PaddleOCR-VL-1.6 + Qwen/...", "warnings": []}
}
```

Inline diagram markers are `![diagram](quiz-asset:paper-p1-img1)` in a problem or option. Assets may be shared across questions. Original source PDFs remain private in Storage for review. Crops and full-page fallbacks reproduce source pixels/vector rendering; diagrams are never redrawn by the grouping model.

Only single-correct-option MCQs are supported: 1–200 questions, 2–8 options each, and exactly one key entry per question. Keys require a verbatim source quote proving the original question number and answer label. Missing, conflicting, or ambiguous keys fail instead of generating answers. Numeric answer labels require explicit `Q1:2` rows or a `Question | Answer` column table; ambiguous horizontal number rows are rejected. Section numbering must also be explicit in quoted key evidence. Transposed/irregular key tables may need a clearer export. Explicit `Q1`/`Question 1` source labels are checked for omissions; unusual numbering still requires human comparison during review. The model prompt preserves LaTeX and option order, but OCR/model accuracy is not guaranteed. Quiz JSON must be smaller than 800,000 UTF-8 bytes.

## Operations

Workers claim jobs in a transaction, renew leases every 30 seconds, and recheck owner, status, lease token, and expiry before every write. Expired jobs are reclaimed with a new token, up to three attempts by default. Assets live under a lease-specific prefix so an interrupted worker cannot replace a recovery attempt's diagrams. User-facing errors omit upstream response bodies, tokens, and signed URLs. Failed imports require a new UUID/upload; duplicate identical intake is idempotent.

Restrict browser rule access to each owner's imports/quizzes and disallow browser writes to worker statuses/leases. Source uploads should be immutable per import. Worker polling consumes Firestore reads even when idle. Retention/cleanup for obsolete imports, failed-attempt assets, and retained source PDFs is a deployment policy; no automatic deletion is enabled here. Keep saved quizzes' referenced assets for as long as the quiz exists.

Before a production release, test a real paper/key against the deployed GPU Space and selected HF provider, verify Firebase owner isolation with a second account, and restart a worker during inference to confirm recovery. Local unit tests cover key grounding, question grouping/coverage, PDF limits, source images, SSRF boundaries, authentication, owner paths, and lease ownership; they use no paid inference calls.
