# PDF quizzes

To test before deploying Firebase changes, use [the local quiz setup](local-quizzes.md).

The **Quizzes** dashboard tab and navigation item open `/quizzes`. A signed-in user uploads an MCQ paper PDF and an optional separate answer-key PDF. An embedded key needs one explicit **Answer Key**, **Correct Answers**, or **Answers** heading. The page shows upload progress and parsing stages, then an editable question/option/key draft with source downloads. Users review the extraction before saving, attempt the saved quiz, and review their answers against the supplied key. Saved quizzes are immutable so earlier attempts retain the same questions and answers.

The default model route is the [free Gradio ZeroGPU prototype](../services/quiz-zerogpu/README.md). It uses PaddleOCR-VL-1.6 through its Transformers pipeline for layout, equations and text, then deterministic question/key structuring. It does not call paid Hugging Face Inference Providers or generate solutions. Original diagrams are cropped from the source PDF.

This route supports **at most two pages combined**, including the answer key, with a maximum of 25 MB per PDF. Use clearly numbered questions (`1.`, `Q1.`, `Question 1.`, or a number on its own line) and consecutive A–H option labels. `(A)` and `[A]` labels can appear inline; bare `A.` labels should begin a line or have clear spacing. Every question needs 2–8 options and exactly one supplied answer. Key rows such as `1 B` or a **Question | Answer** column table are supported. Missing/duplicate/conflicting answers, ambiguous layouts, transposed key tables and numeric option labels are rejected. Repeated question numbers require explicit section names in both the paper and key. Always review OCR math and diagram placement.

Eligible free personal accounts can host up to two ZeroGPU Gradio Spaces without PRO: the email must be verified and the account older than 30 days. Authenticated free accounts have **five GPU minutes per daily quota window**; anonymous visitors have less. Server API calls use the server token owner's quota. This is a small-paper prototype with queueing and quota limits. See [current ZeroGPU eligibility and quotas](https://huggingface.co/docs/hub/spaces-zerogpu).

If OCR misses answer rows in a separate digital key, the parser tries bounded extraction from that PDF's existing text. The recovered key must pass the same question-number, answer-label and ownership checks; the draft explicitly warns that PDF text recovery was used. A scanned key without readable text must still be recognized by OCR. The parser never supplies missing answers by solving questions.

## Deploy the free preview

The standalone preview accepts local PDF uploads and returns draft JSON, raw OCR and a ZIP of original diagram crops. It does not write Firebase documents or objects. Storage paths in preview JSON are temporary placeholders.

1. Install `huggingface_hub` in the Python environment used for deployment.
2. Copy [.env.deploy.example](../.env.deploy.example) to `.env.deploy.local`. Set `HF_TOKEN` to a [Hugging Face write token](https://huggingface.co/docs/hub/security-tokens) and check `HF_NAMESPACE`. Firebase settings are unnecessary in preview mode; the helper does not read an Admin key unless `--enable-firebase` is supplied.
3. Run the helper below. It creates a public **Gradio** Space on **ZeroGPU** only, uploads an explicit runtime-file allowlist, and configures a generated `QUIZ_OCR_TOKEN` to protect the worker OCR API. It uploads no Firebase or HF token as a runtime credential in preview mode.

```powershell
python scripts/deploy_quiz_zerogpu.py --env-file .env.deploy.local
```

For the already-created `icode100/revsy-quiz-zerogpu` Space, or later retries and updates, add `--update-existing`:

```powershell
python scripts/deploy_quiz_zerogpu.py --env-file .env.deploy.local --update-existing
```

The helper verifies the existing `revsy-service.json` marker, public Gradio SDK, and actual/requested ZeroGPU hardware before changing anything. Unrelated Spaces and paid hardware are refused. A marker is published immediately after creating a new Space so interrupted uploads can be recovered safely. The helper never upgrades existing hardware. Inspect the Space build/runtime status and test one small paper before relying on the preview.

## Enable Firebase imports in the app

Free ZeroGPU hosting does **not** remove Firebase's separate storage requirement: [Cloud Storage for Firebase requires the Blaze plan](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024), although no-cost usage allowances can still apply. A configured bucket name alone does not create a bucket. The standalone preview can be used without Firebase Storage.

1. Enable Cloud Storage for Firebase in the existing project and select its actual bucket. Keep `VITE_FIREBASE_STORAGE_BUCKET` set to that exact name. New default buckets generally use `PROJECT_ID.firebasestorage.app`; do not infer or silently replace an existing bucket name. Uploads go directly to Firebase Storage, avoiding large request bodies in Vercel Functions.
2. Merge [quiz.firestore.rules](../firebase/quiz.firestore.rules) and [quiz.storage.rules](../firebase/quiz.storage.rules) into the **existing** project rules. These are additive snippets. Preserve notes, concepts, public pages and themes. Review overlapping wildcard grants: a narrow rule cannot revoke access granted by a broader match. Browser clients create owned quizzes/attempts and mark reviewed imports saved; only the Admin worker processes imports and writes diagrams.
3. Merge the production frontend origin and needed development origins into the bucket's existing CORS configuration. [quiz.storage.cors.json](../firebase/quiz.storage.cors.json) is a template; replace its placeholder before applying it, for example with `gcloud storage buckets update gs://YOUR_BUCKET --cors-file=...`. Authenticated `getBlob` reads enforce Firebase rules, and temporary object URLs display source PDFs and diagrams. No persistent public download tokens are generated.
4. Add the `quizImports` collection-group indexes for `status` and `leaseUntil`, preserving existing effective single-field indexes. See [firestore.indexes.example.json](../services/quiz-parser/firestore.indexes.example.json). The worker polls a durable Firestore queue, holds bounded leases, and recovers interrupted jobs when the Space is running. A sleeping Space pauses processing; source PDFs and queue documents remain in Firebase.
5. Configure `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FRONTEND_ORIGIN` and `FIREBASE_SERVICE_ACCOUNT_FILE` in `.env.deploy.local`. Download the Admin JSON from **Firebase Console → Project settings → Service accounts → Generate New Private Key** ([official setup](https://firebase.google.com/docs/admin/setup)). Keep the complete JSON **outside the repository**; put only its local path in the deployment file. Use an exact production HTTPS origin. Local HTTP origins such as `http://localhost:5173` can be added to the server `ALLOWED_ORIGINS` setting for development.
6. Explicitly enable the integrated worker after those prerequisites are ready:

```powershell
python scripts/deploy_quiz_zerogpu.py --env-file .env.deploy.local --update-existing --enable-firebase
```

This sets `QUIZ_ENABLE_FIREBASE=true` and the canonical `QUIZ_SPACE_ID`/`QUIZ_SPACE_URL`, and supplies `FIREBASE_SERVICE_ACCOUNT_JSON`, `HF_TOKEN` and `QUIZ_OCR_TOKEN` as **server secrets**. The HF token authenticates the Gradio OCR request and uses its owner's free GPU quota; no Inference Providers permission or structuring model is required. Secrets and the deployment file are never uploaded as public source or prefixed with `VITE_`.

7. Set `VITE_QUIZ_PARSER_URL` in Vercel to **the canonical Space origin followed by `/api`**, using the host returned by the deployment helper, then redeploy the frontend:

```dotenv
VITE_QUIZ_PARSER_URL=https://CANONICAL-SPACE-HOST.hf.space/api
VITE_QUIZ_PARSER_MODE=zerogpu
```

The browser sends a Firebase ID token to this HTTP API; the Firestore worker calls the protected Gradio OCR API with server secrets. `QUIZ_SPACE_URL` itself is the bare canonical origin, **without `/api`**. Verify `/api/health` and a complete authenticated import before enabling uploads for other users. If the frontend parser URL is missing, imports are unavailable while saved quizzes remain usable.

8. Test a real paper plus key within the two-page total limit. Check original diagram crops, equations, option order, missing-key rejection, sign-out, refresh during parsing, saved attempts and answer review. Quota failures become failed imports without automatically retrying GPU work; wait for quota reset before starting a new import. Plan retention for abandoned uploads and failed/reclaimed-job assets; keep objects referenced by saved quizzes. Source objects are not deleted automatically.

Runtime access and deployment permissions are separate. Index changes need `datastore.indexes.update`, and bucket CORS updates need `storage.buckets.get/update`. An administrator may need to enable the relevant APIs. Do not grant broad project ownership to a runtime account to bypass a deployment failure. The [offline Firebase planner](../scripts/quiz_firebase_plan.py) preserves existing rules, CORS and effective indexes and refuses ambiguous merges. Preserve the active release pointer, compile merged rules and recheck that pointer before publishing. If `projects:test` is unavailable, [creating an inactive Ruleset](https://firebase.google.com/docs/reference/rules/rest/v1/projects.rulesets/create) validates syntax and semantics without activating it; authorization behavior needs separate verification.

## Larger-paper Docker alternative

The original [PaddleOCR Docker service](../services/paddleocr-space/README.md) and [quiz-parser worker](../services/quiz-parser/README.md) remain available for larger papers and an instruction-model structuring stage. This route allows up to 30 pages and 25 MB **per PDF**, up to 200 questions and 2–8 options. It requires compatible GPU hosting plus a long-running CPU worker and a configured Hugging Face Inference Providers token/model. It is separate from the free ZeroGPU route.

After configuring the same Firebase prerequisites and deployment file, use:

```powershell
python scripts/deploy_quiz_spaces.py --env-file .env.deploy.local
```

The script uploads two Docker Spaces and generates their shared `PADDLEOCR_TOKEN`; `--update-existing` requires matching service markers. It does not select paid hardware. [Docker/CPU Space account eligibility](https://huggingface.co/docs/hub/spaces-overview), GPU hardware costs and provider usage must be checked separately. Set a deliberate sleep policy for paid GPU hardware and keep the durable CPU worker running when continuous processing is required. A request-only Vercel Function does not provide this queue worker lifecycle.

For this alternative, set `VITE_QUIZ_PARSER_URL` to the separate worker's HTTPS **base origin** and `VITE_QUIZ_PARSER_MODE=full`, as documented in its guide. Its API is not mounted under the free prototype's `/api` path. Keep `FIREBASE_SERVICE_ACCOUNT_JSON`, `HF_TOKEN` and `PADDLEOCR_TOKEN` server-only. Prefer a separate `HF_INFERENCE_TOKEN` allowing [Inference Providers calls](https://huggingface.co/docs/inference-providers/index). Source changes alone do not provision external models, buckets, rules or indexes.

## Data

`users/{uid}/quizImports/{importId}` contains processing status, messages, draft JSON, and eventually `savedQuizId`. `users/{uid}/quizzes/{importId}` contains the reviewed quiz. `users/{uid}/quizzes/{importId}/attempts/{attemptId}` contains selected option indices, grade, and submission time. Firebase Storage objects live below `users/{uid}/quiz-imports/{importId}/`.

The quiz payload follows the requested `question` and `key` structure:

```json
{
  "schemaVersion": 1,
  "title": "Practice paper",
  "question": [{
    "id": "q1", "number": "1",
    "problem": "Solve $x^2 = 4$.",
    "options": ["$2$", "$4$"], "images": []
  }],
  "key": [{"questionId": "q1", "correctOptionIndex": 0}],
  "source": {"paperPath": "users/UID/quiz-imports/IMPORT/paper.pdf"},
  "parsing": {"model": "PaddleOCR-VL-1.6 + deterministic MCQs", "warnings": []}
}
```

Keys use question IDs and zero-based option indices, so a differently ordered supplied key cannot shift grading by array position. Text uses Markdown and LaTeX, rendered by the app's existing math libraries. Diagrams use `![diagram](quiz-asset:ASSET_ID)` and owned object metadata; image base64 is never stored in Firestore. Quiz JSON must be smaller than 800,000 UTF-8 bytes, leaving room below Firestore's 1 MiB document limit. The review step is required because OCR remains fallible.

This is personal practice: the account owner can review the supplied key, and browser-side grades are not intended for a high-stakes exam system.

## Verification

Run `npm run build`, `npm run test:quiz`, and targeted ESLint on changed frontend files. With the Python runtime dependencies available, run the free-service unit tests without allocating a GPU:

```powershell
$env:PYTHONPATH="services/quiz-parser;services/quiz-zerogpu"
python -m unittest discover -s services/quiz-zerogpu/tests -v
```

The original worker README describes its own validation tests. A live saved import requires Firebase Storage, rules, CORS, indexes and the configured Space; a standalone OCR preview does not.

## References

- [ZeroGPU eligibility, compatibility and daily quotas](https://huggingface.co/docs/hub/spaces-zerogpu)
- [PaddleOCR-VL pipeline documentation](https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/PaddleOCR-VL.html)
- [PaddleOCR-VL-1.6 on Hugging Face](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6)
- [Firebase Storage billing requirements](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024)
- [Firebase direct resumable uploads](https://firebase.google.com/docs/storage/web/upload-files)
- [Firebase authenticated blob downloads and CORS](https://firebase.google.com/docs/storage/web/download-files)
- [Firestore document limits](https://firebase.google.com/docs/firestore/quotas)
- [Vercel Function limits](https://vercel.com/docs/functions/limitations)
