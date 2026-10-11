---
title: Revsy Private PaddleOCR
emoji: 📄
colorFrom: purple
colorTo: blue
sdk: docker
app_port: 7860
suggested_hardware: l4x1
startup_duration_timeout: 1h
---

# Revsy PaddleOCR GPU Space

This separate Docker Space runs the complete **PaddleOCR-VL-1.6** layout and recognition pipeline. It provides the private OCR backend for [the quiz parsing worker](../quiz-parser/README.md). The worker handles Firebase authentication, PDF/page checks, original diagrams, quiz JSON and the job queue; this service handles GPU inference.

## Deploy to Hugging Face

1. Create a new **Docker Space**. Copy this directory's `Dockerfile`, `app.py`, `requirements.txt` and `README.md` into the Space repository root. Copying the entire Revsy repository does not put the required Dockerfile at the Space root.
2. In the Space's Settings, add **Secret** `PADDLEOCR_TOKEN`: a random printable ASCII shared secret of at least 32 characters. Add **Variable** `FIREBASE_STORAGE_BUCKET`: the exact existing Firebase bucket name, for example `your-project.firebasestorage.app`, without `gs://`.
3. Select GPU hardware. The YAML suggests `l4x1` (one NVIDIA L4), but **does not provision hardware**. Select it in Settings and review Hugging Face's current charges and sleep settings. CPU Basic cannot run this GPU image/pipeline.
4. Wait for the image and models to load. Open `https://YOUR-SPACE-SUBDOMAIN.hf.space/health`. It returns HTTP 200 only when the native model API is ready. Initial model downloads can take time; caches are under `/home/user` and may be lost on restart.
5. In the **CPU quiz worker Space**, set `PADDLEOCR_URL=https://YOUR-SPACE-SUBDOMAIN.hf.space` and the **same Secret** `PADDLEOCR_TOKEN`. Both base origins and a URL ending in `/layout-parsing` are supported by the worker. The browser never receives this shared secret.

The GPU Space needs **no Firebase admin credentials**. The worker sends a short-lived GCS signed URL, or base64 PDF content when signing is unavailable. The proxy permits only the configured bucket's quiz import paths, downloads URL inputs without redirects, checks the PDF signature and size, then sends base64 content to the native pipeline. Native inference receives no signed URL or shared secret. Do not put Firebase service-account JSON, Google credentials, or HF tokens into this Space.

Hugging Face private Space infrastructure can add a separate authentication layer. This worker currently sends the OCR shared secret as its Authorization header. Use a Space endpoint reachable by the worker with this application's shared-secret gate; a HF-private Space that requires a HF bearer token needs an additional transport integration before it will work.

## Runtime and API

The official PaddleOCR NVIDIA image is used with its preinstalled inference dependencies. The build installs `paddlex --install serving`, then installs missing HTTP gateway packages without forcing older versions. Runtime uses UID/GID 1000 with writable home and cache directories. The build checks that this user can execute the installed PaddleX CLI.

The gateway on port 7860 starts this loopback-only native service:

```sh
paddlex --serve --pipeline PaddleOCR-VL-1.6 --host 127.0.0.1 --port 8081 --device gpu:0
```

Use the explicit `PaddleOCR-VL-1.6` pipeline registration: the generic `PaddleOCR-VL` registration can load the original v1 model. The upstream v1.6 configuration selects `PP-DocLayoutV3` and `PaddleOCR-VL-1.6-0.9B`. The public gateway exposes:

| Endpoint | Behavior |
| --- | --- |
| `GET /` and `GET /health` | HTTP 200 `ready`, or HTTP 503 `configuration_required`, `model_starting`, or `model_failed`. No credentials or request data are returned. |
| `POST /layout-parsing` | Requires `Authorization: Bearer PADDLEOCR_TOKEN`, `Content-Type: application/json`, `fileType: 0`, and `file` containing an allowed HTTPS URL or bare base64 PDF. |

The worker's boolean OCR options are supported, including `returnMarkdownImages`, `visualize`, `prettifyMarkdown` and layout/preprocessing flags. Unknown configuration overrides and non-PDF inputs are rejected. Request JSON is limited to 36 MiB, decoded/downloaded PDFs to 25 MiB, and streamed OCR responses to 80 MiB. The worker enforces the **30-page limit** before calling this service.

One process and one lock serialize PDF preparation and model requests. Waiting requests receive HTTP 429 with `Retry-After: 10` if the lock stays busy for five seconds. Source/body reads have a 60-second deadline; model inference has a 20-minute deadline. If native inference times out, is cancelled, or loses its connection, the service stops the native process group and reports `model_failed` until the Space restarts, preventing a disconnected inference from overlapping a new request.

Access logging and native stdout/stderr are disabled because upstream exception messages can contain signed source URLs. Errors returned by the gateway are sanitized. Model startup failure appears through `/health`; diagnose the image/CLI using a disposable sample PDF rather than customer signed URLs.

## Test without a GPU

From this directory, create an isolated Python environment, install `requirements.txt`, then run:

```sh
python -m unittest discover -s tests -v
```

Tests use stub native/source HTTP transports. They cover authentication before body parsing, owned-bucket signed URLs, base64 PDFs, request/response bounds, redirects, malformed JSON, sanitized errors, model readiness, serialized requests, busy responses and timeout behavior. They do not download PaddleOCR or access Firebase.

## GPU smoke test and reproducibility

The full GPU image has **not been built or started in the development environment**. The official image is large and there is no local GPU or connected HF deployment credential. After deploying, check `/health`, submit a small disposable MCQ PDF with math and a diagram, inspect the output's layout blocks/LaTeX, and import it through the worker to verify the complete flow.

After that GPU smoke test succeeds, record the installed PaddleOCR/PaddleX versions and replace the Dockerfile's moving `latest-nvidia-gpu` tag with the **actual tested image digest** (or an official exact version verified to include v1.6). No unverified digest is supplied here. Model initialization happens at runtime because Hugging Face Docker builds do not expose a GPU.

Deployment references: [PaddleOCR manual serving and Docker image](https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/PaddleOCR-VL.html), [official v1.6 pipeline configuration](https://github.com/PaddlePaddle/PaddleX/blob/release/3.7/paddlex/configs/pipelines/PaddleOCR-VL-1.6.yaml), [HF Docker Spaces](https://huggingface.co/docs/hub/spaces-sdks-docker), [HF GPU hardware](https://huggingface.co/docs/hub/spaces-gpus), and [HF YAML configuration](https://huggingface.co/docs/hub/spaces-config-reference).
