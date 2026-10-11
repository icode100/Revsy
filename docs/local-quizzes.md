# Local quiz testing

The app, authentication, Firestore documents and object storage run locally under the isolated `demo-revsy` project. Gemini Flash reads the uploaded PDFs through Google's API, and results are saved in the local emulators. These API calls use the key's quota and billing plan; they are remote even though the app is local. No production Firebase credentials or rule updates are needed.

The ignored `.env.local` configures the development app:

```dotenv
VITE_USE_FIREBASE_EMULATORS=true
VITE_FIREBASE_API_KEY=demo-revsy
VITE_FIREBASE_AUTH_DOMAIN=demo-revsy.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=demo-revsy
VITE_FIREBASE_STORAGE_BUCKET=demo-revsy.appspot.com
VITE_FIREBASE_APP_ID=1:123456789:web:local-revsy
VITE_GOOGLE_API_KEY=
VITE_QUIZ_PARSER_URL=http://127.0.0.1:8001
VITE_QUIZ_PARSER_MODE=gemini
```

The local parser reads `GEMINI_API_KEY` and optional `GEMINI_MODEL` from `.env.deploy.local` or its process environment. Keep the key server-side, without a `VITE_` prefix. The default model is `gemini-3.8-flash`. Existing note summaries use the same parser service and require Firebase sign-in; no browser Gemini key is needed.

```dotenv
GEMINI_API_KEY=YOUR_SERVER_KEY
GEMINI_MODEL=gemini-3.8-flash
QUIZ_PARSER_PROVIDER=gemini
```

## Start the services

From the repository directory, run these commands in three terminals and leave them running:

```powershell
npm run firebase:local
```

```powershell
npm run quiz-parser:local
```

```powershell
npm run dev:local
```

Open [the local app](http://127.0.0.1:5173/quizzes). The [Firebase Emulator UI](http://127.0.0.1:4000) shows local accounts, documents and stored files. The parser's health endpoint is `http://127.0.0.1:8001/health`.

The launcher uses isolated Firebase CLI and Java 21 installations under `.deployment/local-tools`; these have been installed in this workspace. It never selects a production Firebase project. The parser wrapper selects an available Python runtime; set `REVSY_PYTHON` to choose a different interpreter. Its Python packages are installed locally in ignored directories. For another Python environment, install `scripts/local-quiz-requirements.txt` with that interpreter's `pip install -r` command.

## Try a quiz

1. Use **Sign In** and create an email/password account. This account exists only in the local Auth emulator; use a test password.
2. Open **Quizzes**, enter a title, and select the question paper. Select an additional PDF if the key is separate.
3. Start parsing and wait for the extraction draft. Gemini supports **200 paper pages and 30 separate key pages**, with a 25 MB limit per file and 200 questions per quiz.
4. Review the extracted questions, LaTeX, types, sessions, sections, marks and supplied keys. MCQs can accept alternatives; MSQs require the exact option set; numeric questions accept inclusive ranges. Expand original question pages to inspect scanned equations and diagrams. Make corrections and save the quiz.
5. Attempt the quiz, submit it, review each answer, then refresh to check the saved quiz and attempt history.

For the prepared example, select `.deployment/quiz/free-sample.pdf`. It contains two questions and an embedded answer key; correct choices are **B** and **C**. To test separate uploads, use `.deployment/quiz/free-paper.pdf` and `.deployment/quiz/free-key.pdf` instead.

The parser reads the supplied key separately from the questions and rejects incomplete coverage. It saves completed extraction checkpoints to avoid repeating those phases after a server interruption. Quota failures are shown on the import; wait for quota to reset before starting a new one. A queued import can use **Retry starting import** without uploading files again. Saving, attempting and reviewing an already parsed quiz work without another API request.

To use the older two-page Hugging Face prototype, set `VITE_QUIZ_PARSER_MODE=zerogpu`, restart Vite, and run `npm run quiz-parser:local -- --hugging-face`. That route needs `HF_TOKEN` server-side and supports only schema 1 MCQs. Stop the Gemini worker before starting it on the same port.

## Stop and return to normal development

Press Ctrl+C in each service terminal. The Firebase launcher exports local data to `.deployment/local-firebase-data` on a clean shutdown and imports that data next time. Keep this folder if you want to preserve local quizzes.

When returning to your normal Firebase configuration, replace or move `.env.local` and restart Vite. Vite gives `.env.local` precedence over `.env`. The emulator flag fails closed in a production build; remove local demo settings before using the production frontend.
