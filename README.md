This is a note taking app but curated and designed for extensive usage by students/working professionals preparing for interviews.
Here we are trying to make Revisions-Easy!!!

To try the quiz flow locally, see [local quiz testing](docs/local-quizzes.md). The local setup uses Firebase emulators for accounts, documents and uploads, and server-side Gemini Flash for PDF parsing.

## Features
- PDF quizzes with supplied keys, GATE MCQ/MSQ/numeric questions, original math/diagram review, marks, attempts, and per-answer review. See [Google deployment](docs/google-quizzes.md); the earlier [HF prototype](docs/quizzes.md) remains available for small MCQ papers.
- Markdown editor for adding your notes, codes and math equations
- add multiple problems corresponding to one notes (like set of problems using similar solution)
- add tags to problems(easy, medium, hard, graphs, algebra etc.)
- add concepts and their explanation all seamlessly handled using firebase firestore
- No hassle login just use the google account logged in your browser to login to your notes
- Using **Leetcode**? Fetch the entire problem just by giving an url
- Use **AI** to summarizer to summarize problem descriptions
- Already making notes using excel?
    - we have got your back
    - create a new page(problem / concept) and upload the excel file and give the sheet name Boom! you are done
    - the entire content from the excel sheet will be used to create a notes page for you.
