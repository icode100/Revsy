# Full GATE quizzes on Google

The Google version uses Firebase Hosting for the existing Vite application,
Firebase Authentication for login, Firestore for quiz/import/attempt documents,
Firebase Storage for PDFs and original question-page images, and a CPU Cloud Run service
calling Gemini Flash. Cloud Tasks delivers durable processing requests. No
Hugging Face or GPU deployment is needed for this path.

The question paper may contain up to 200 pages, and a separate key may contain up
to 30 pages; each uploaded PDF remains limited to 25 MB. Saved quizzes contain
up to 200 questions. Supported kinds are single-answer MCQ, exact-set MSQ, and
numeric-answer questions with accepted ranges, including explicit alternative
ranges such as `0 to 0 OR 2 to 2`. Alternative numeric ranges are stored in
`additionalRanges` and remain separate; values between disjoint ranges are not
accepted. Session and section identify
question numbers that repeat across a combined paper. Review the extracted draft
before saving it; missing or ambiguous keys must be resolved explicitly.

Image-based options retain their original letter and use a neutral reference
such as "See option B in the original question page." The parser does not replace
them with an interpreted shape, chart, or logical classification. Expand the
stored original page to choose and verify these options.

Old MCQ quizzes keep schema version 1. New GATE quizzes use version 2. New
attempts include earned marks and maximum marks. MCQs apply the GATE one-third
penalty for incorrect answers; MSQ and numeric answers have no negative marking.
MSQ option sets are stored in Firestore maps (`{"optionIndices": [0, 2]}`),
because Firestore does not store arrays directly nested within arrays.

## Test locally first

Keep `GEMINI_API_KEY` in the ignored `.env.deploy.local` file. It is read by the
local server only. Continue using the local Firebase emulators and the demo
Firebase project from [the local quiz guide](local-quizzes.md). The Gemini server
can use the same local import URLs while Firestore and Storage remain local.
Gemini calls still go to Google's API and use the key's quota and billing plan.

Production Firebase configuration, active rules, IAM, and billing are not changed
by preparing or running these local tests. Any existing HF deployment remains
independent until an explicit production migration is approved.

The supplied `cs_2021.pdf` paper and `cs_merged_2021.pdf` answer key passed a real
local Gemini import: 130 questions across two sessions, comprising 68 MCQs,
26 MSQs, and 36 numeric-answer questions, with 200 total marks and 83 original
source-page images preserved. The question/key extraction, full coverage,
session alignment, and saved local draft were validated. This local result does
not constitute a production deployment.

## Prepare a reviewable deployment plan

Install Google Cloud CLI and Firebase CLI on the deployment machine. Obtain the
project number from the Google Cloud Console or this read-only command:

```powershell
gcloud projects describe revsy-c66e0 --format="value(projectNumber)"
```

The planner makes no API requests and executes no shell commands. It accepts
public resource identifiers as arguments; do not pass keys or private-account
files. First inspect the generated JSON:

```powershell
python scripts/deploy_quiz_google.py `
  --project revsy-c66e0 `
  --project-number YOUR_PROJECT_NUMBER `
  --bucket revsy-c66e0.firebasestorage.app `
  --frontend-origin https://revsy-c66e0.web.app
```

Add `--output-dir .deployment/google/review-001` to write a fresh, ignored
review package. This contains `plan.json`, public `runtime-env.yaml`, a Hosting
configuration, and an allowlisted container build context. It cannot replace an
existing output directory or write outside `.deployment/google`. Context files
are frozen and hashed; only the two Python runtime packages, named dependency
file, and Dockerfile are included. No repository `.env`, user PDFs, credentials,
node_modules, test artifacts, or HF service source is uploaded.

`us-central1` is the initial deployment region. Confirm the selected region's
Hosting rewrite support and existing Firestore/Storage data location before
approving a production plan. If changing the region, regenerate the package so
Cloud Run, Cloud Tasks, image registry, and Hosting rewrite all agree.

The plan separates inspection, setup, IAM, build, and release commands. Inspect
existing resources before running creation commands. A service with this name
must belong to Revsy; do not overwrite an unrelated service. Verify the returned
Cloud Run URL agrees with `PARSER_PUBLIC_URL` and `TASKS_AUDIENCE` before imports.
The planner predicts the documented [deterministic service URL](https://docs.cloud.google.com/run/docs/triggering/https-request).

## Production prerequisites and permissions

The project owner must enable Firebase Blaze billing and approve paid resource
creation separately. The planner does not link a billing account or enable Blaze.
Provision the Firebase Storage bucket in Firebase Console; a bucket name in an
environment file does not create a bucket. Enable only the APIs named in the
reviewed plan.

Create `revsy-gemini-api-key` in Secret Manager and add the Gemini API key securely
in Console. The deployment references an explicit version number, initially 1.
Never paste the key into terminal arguments or copy it into the Hosting build.
Google recommends [Secret Manager for Cloud Run secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets).

| Identity | Resource scope | Permission |
| --- | --- | --- |
| `revsy-quiz-runtime` | Project | `roles/datastore.user` for imports and leases; `roles/firebaseauth.viewer` for revoked-token checks. |
| `revsy-quiz-runtime` | Existing quiz Storage bucket | `roles/storage.objectUser`. |
| `revsy-quiz-runtime` | Gemini secret only | `roles/secretmanager.secretAccessor`. |
| `revsy-quiz-runtime` | Quiz queue only | `roles/cloudtasks.enqueuer`. |
| `revsy-quiz-runtime` | Dedicated task service account only | `roles/iam.serviceAccountUser` to select the OIDC identity. |
| Cloud Tasks service agent | Project | `roles/cloudtasks.serviceAgent`, normally granted when Cloud Tasks is enabled, supplies `iam.serviceAccounts.getOpenIdToken`. Verify this managed binding. |
| Cloud Tasks service agent | Dedicated task service account only | `roles/iam.serviceAccountUser` to select the delivery identity, as required for [authenticated task delivery](https://docs.cloud.google.com/tasks/docs/creating-http-target-tasks). This role alone does not mint tokens. |
| Actual build service account | Image repository only | `roles/artifactregistry.writer`. |
| Actual build service account | Actual source/log resources | Read staged source objects; write the chosen build logs destination. See the build identity checks below. |

Queue-scoped IAM is supported by [Cloud Tasks](https://docs.cloud.google.com/tasks/docs/reference/rest/v2/projects.locations.queues)
and [`gcloud tasks queues add-iam-policy-binding`](https://docs.cloud.google.com/sdk/gcloud/reference/tasks/queues/add-iam-policy-binding).
Check queue permissions against the queue resource; a failed project-level bulk
permission query does not establish a queue grant. The runtime's
[`roles/firebaseauth.viewer`](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseauth)
includes `firebaseauth.users.get`, which Firebase Admin needs for
`verify_id_token(..., check_revoked=True)`. Google OIDC verification fetches public
signing certificates; the runtime does not need a Token Creator grant.

Inspect the project IAM policy after Cloud Tasks is enabled and the queue exists.
Only its managed `service-PROJECT_NUMBER@gcp-sa-cloudtasks.iam.gserviceaccount.com`
identity should hold `roles/cloudtasks.serviceAgent`. If the expected binding is
missing, review restoring it on that managed identity before sending tasks;
do not substitute a broad Token Creator grant on the runtime or task identity.

Cloud Build's default identity [changed in 2024](https://docs.cloud.google.com/build/docs/cloud-build-service-account-updates)
and depends on this project's history and organization policy. The plan includes
`gcloud builds get-default-service-account --region=REGION` and uses that region
for the image build. Inspect the selected identity and actual build source/log
buckets before granting access. The builder needs repository image-write access
and `storage.objects.get` on staged source. Logs require write access to the
actual log bucket or `roles/logging.logWriter` when configured for Cloud Logging.
A [user-managed build identity](https://docs.cloud.google.com/build/docs/securing-builds/configure-user-specified-service-accounts)
must use Cloud Logging or a user-owned log bucket rather than Google's default
log bucket. The submitter needs build creation, service usage, source-upload
permissions, and permission to act as the selected identity where required.
If source/log buckets need creation, review those named resources explicitly;
do not grant project Editor or Storage Admin to bypass a build failure.

The deployment principal needs permissions to deploy Cloud Run, act as the
runtime identity, manage the explicitly reviewed resources/IAM bindings, build
images, and release Firebase Hosting. The existing Firebase Admin SDK account is
not used as the Cloud Run runtime identity. Cloud Run's Google APIs use its
attached identity through Application Default Credentials.

Deploying the existing image needs Cloud Run deployment permissions, access to
that image repository, and permission to act as the runtime identity.
`--allow-unauthenticated` also needs
[`run.services.setIamPolicy`](https://docs.cloud.google.com/run/docs/authenticating/public);
Cloud Run Developer alone is insufficient for that public-policy change. Hosting
`pinTag: true` reads and updates service traffic tags, so its release principal
needs `run.services.get` and `run.services.update` in addition to Firebase
Hosting release permissions. This is confirmed by the
[Firebase CLI's tag implementation](https://raw.githubusercontent.com/firebase/firebase-tools/master/src/hosting/runTags.ts).

Firebase Hosting/browser requests use Firebase ID tokens rather than Google IAM
tokens. The service is public at the infrastructure layer so these requests can
reach the application, which authenticates every job intake. The internal task
handler independently verifies its dedicated Google OIDC identity; guessed task
headers cannot authorize it.

## Hosting, rules, and private assets

Build the frontend with its normal public Firebase configuration plus:

```dotenv
VITE_QUIZ_PARSER_URL=/api
VITE_QUIZ_PARSER_MODE=gemini
VITE_USE_FIREBASE_EMULATORS=false
```

For a separate production build, save only the Firebase web app's public config
object in an ignored JSON file, then run:

```powershell
node scripts/build_google_frontend.mjs `
  --config .deployment/google/public-firebase-config.json `
  --project revsy-c66e0
```

This builds to a fresh `.deployment/google/frontend-dist`, disables env-file
loading, excludes server credentials from the build process, and overrides the
public Firebase values without editing `.env.local`. It checks the output for
local configuration and unexpected files. Set the reviewed Hosting configuration's
`public` directory to this output before releasing; the prepared planner config
initially points to the ordinary `dist` directory. `firebase/google/firebase.json` and
the generated Hosting config route `/api/**` to `revsy-quiz-parser`, then fall
back to `/index.html` for SPA routes. API responses are not cached. Hosting
release is `--only=hosting`; these configurations deliberately contain no
Firestore/Storage rule deployment entries.

Merge `firebase/quiz.firestore.rules` and `firebase/quiz.storage.rules` into the
active production rules while preserving existing notes, concepts, themes, and
public-page access. Compile and inspect the complete merged rules before an
explicit security-policy release. **Do not deploy emulator rules to production.**
The local rule file is a test configuration; the additive snippets are the
reviewed quiz changes. Publishing active security rules is an explicit operation
outside this Hosting-only deployment planner.

The ignored `.deployment/quiz/firestore-merged.rules` contains the latest schema
1/2 quiz block while preserving the downloaded non-quiz policy bytes. Its prior
inactive cloud ruleset was compiled from the older schema-1 draft and does not
validate this latest source. The current source needs a fresh compile and review
before any separately approved production rule release.

Add the Hosting domain to Firebase Authentication's authorized domains. Merge
its exact origin into the existing bucket CORS rather than replacing unrelated
entries. Original PDFs and source-page images remain in owner-specific Storage paths with
authenticated reads; they are not published as anonymous download URLs.

Cloud Tasks addresses a specific import document, so the Gemini service does not
need the old HF worker's collection-group polling indexes. Existing indexes
remain untouched.

## Cost and failure controls

The starting plan uses one CPU, 1 GiB memory, minimum zero instances, maximum one
instance, and [request-based billing](https://docs.cloud.google.com/run/docs/configuring/billing-settings).
Cloud Tasks permits one processing dispatch at a time, with three attempts and
bounded backoff. Cloud Run concurrency is four so lightweight API calls can run
alongside the processing request. No model download or warm GPU is maintained.

Each task performs its processing inside the request. Hosting only waits for the
enqueue response; task callbacks go directly to Cloud Run and use a 30-minute
deadline. Each worker has a separate 1,680-second (28-minute) processing budget.
Provider timeouts use the remaining budget; polling, response reads, stages, and
source-page rendering check it. The remaining two minutes allow terminal
Firestore writes and heartbeat shutdown before the infrastructure timeout.

Firestore leases guard duplicate delivery. Key and question extractions are
stored as immutable, owned checkpoints, so an interrupted task can reuse a
completed phase. Provider calls are not automatically replayed after API quota,
timeout, or ambiguous-response errors. Such errors are recorded for review;
starting another import makes new model calls. A durable task delivery retries
an interrupted lease and preserves completed checkpoints. If enqueueing fails
after import creation, the local worker can see the queued document, but Cloud
Run has no background queue reconciler. Use **Retry starting import** on a queued
import after ten seconds. This retries its existing UUID and PDF paths with a
fresh Firebase token, without reuploading; the deterministic task name prevents
duplicate task creation.
Checkpoint creation cannot make an unconfirmed model response reusable: a crash
before the result is durably saved can still require that phase to run again.
API usage and provider errors are attached to imports so failures can be reviewed
before another paper import.

Gemini inference, Cloud Run processing, Cloud Tasks, image builds/storage,
Firestore operations, and Storage usage can incur charges. Use project budgets,
billing alerts, Gemini API quota, and the parser's file/page/question limits to
control use. [Budget alerts do not cap spending](https://docs.cloud.google.com/billing/docs/how-to/budgets).
Minimum-zero and maximum-instance settings also do not create a monetary cap.

After approval, deploy the parser first, verify health and authenticated task
delivery, then release Hosting. Import a small fixture, save it, attempt each
question kind, and refresh history before importing the full GATE paper. Keep
the prior frontend deployment available until the Google path is verified.
