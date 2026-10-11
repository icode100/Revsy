---
title: Revsy Quiz ZeroGPU
emoji: 📝
colorFrom: blue
colorTo: purple
sdk: gradio
sdk_version: 6.30.0
python_version: 3.12
app_file: app.py
license: apache-2.0
short_description: MCQ PDF previews with math and original diagrams
---

This free ZeroGPU prototype uses the full PaddleOCR-VL-1.6 **Transformers**
pipeline for layout, text and math. Native Paddle CUDA subprocesses do not run
unchanged on ZeroGPU. Models load at startup after `import spaces`; inference
runs only inside `@spaces.GPU`, without PaddleX background GPU queues.

The preview accepts **at most two pages combined**, including the answer key.
Questions must have explicit numbers and consecutive A–H option labels. The
supplied key must explicitly identify every answer. If OCR misses rows in a
separate digital key, bounded extraction from the PDF's existing text is tried
with the same strict validation, and the draft carries a recovery warning.
Scanned keys still require readable OCR. Ambiguous layouts, missing
answers and inconsistent numbering are rejected, with raw OCR available for
inspection. No paid Inference Providers endpoint is called.

The preview does not write Firebase data. The downloadable ZIP includes JSON,
OCR text and diagram crops rendered from the original PDF. Object paths in the
preview JSON are temporary placeholders; the integrated worker writes real
owned object paths only after Firebase Storage is configured. Preview files
are temporary and the Gradio cache expires after one hour.

Free personal accounts in good standing can host two ZeroGPU Gradio Spaces.
An authenticated free account has five GPU minutes per daily quota window;
API calls with a server token consume that token owner's quota. This is suitable
for testing small papers and does not provide continuous production capacity.
No PRO subscription or paid hardware is selected by the deployment helper.

Deploy with `scripts/deploy_quiz_zerogpu.py --env-file .env.deploy.local` from
the parent Revsy repository. The helper uploads only explicit source files,
including the shared `quiz_parser` package. Keep deployment tokens and Firebase
Admin keys in secrets, never in this public repository. A separate
`QUIZ_OCR_TOKEN` protects the worker-only OCR endpoint.

The integrated Firebase mode also needs the existing quiz rules, Storage bucket,
bucket CORS and Firestore queue indexes. Do not point the production frontend at
this service until those prerequisites and a real source-PDF test pass.

References: [ZeroGPU](https://huggingface.co/docs/hub/spaces-zerogpu),
[PaddleOCR-VL](https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/PaddleOCR-VL.html).
