import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { Link } from 'react-router-dom';
import { validateQuizDraft } from '../domain/quiz';
import DraftEditor from './quiz/DraftEditor';
import QuizPlayer from './quiz/QuizPlayer';
import { ErrorNotice } from './quiz/controls';
import { errorMessage, inputStyle, primaryButton, secondaryButton, useAlive } from './quiz/helpers';
import type { QuizPdfPageCounts } from '../domain/quiz-pdf';
import {
  createQuizImport,
  isFreeQuizParser,
  isQuizParserConfigured,
  quizParserMode,
  retryQuizImport,
  subscribeQuizImports,
  subscribeQuizzes,
  validatePdfFiles,
} from '../services/quiz';
import type { QuizDocument, QuizImport } from '../types/quiz';

const stages: QuizImport['status'][] = ['queued', 'reading-paper', 'reading-key', 'storing-images', 'structuring', 'validating', 'ready'];
const stageLabels: Record<QuizImport['status'], string> = {
  queued: 'Queued for parsing',
  'reading-paper': 'Reading questions and math',
  'reading-key': 'Reading the answer key',
  'storing-images': 'Saving original diagrams',
  structuring: 'Organizing questions and options',
  validating: 'Checking the quiz',
  ready: 'Ready for your review',
  failed: 'Import needs attention',
};

function ImportProgress({ job, user }: { job: QuizImport; user: User }) {
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [restartNotice, setRestartNotice] = useState<string | null>(null);
  const alive = useAlive();
  const completed = job.status === 'ready' || job.status === 'failed';
  const stage = stages.indexOf(job.status);
  useEffect(() => {
    setRetryAvailable(false);
    if (job.status !== 'queued') return;
    const timer = window.setTimeout(() => setRetryAvailable(true), Math.max(0, job.createdAt + 10_000 - Date.now()));
    return () => window.clearTimeout(timer);
  }, [job.status, job.createdAt]);
  const restart = async () => {
    if (restarting) return;
    setRestarting(true);
    setRestartError(null);
    setRestartNotice(null);
    try {
      await retryQuizImport(user, job.id);
      if (alive.current) setRestartNotice('Start request sent. Progress will update automatically.');
    } catch (error) {
      if (alive.current) setRestartError(errorMessage(error));
    } finally {
      if (alive.current) setRestarting(false);
    }
  };
  return (
    <article className="rounded-2xl border border-gray-200 p-4 dark:border-white/10">
      <div className="flex items-center gap-3">
        {!completed && <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-purple-200 border-t-purple-600 motion-reduce:animate-none" aria-hidden="true" />}
        <div className="min-w-0 flex-1"><h3 className="truncate font-bold">{job.title}</h3><p className="mt-1 text-sm text-gray-600 dark:text-neutral-400" role="status">{stageLabels[job.status]}</p></div>
      </div>
      {!completed && <><div className="mt-4 flex gap-1" aria-hidden="true">{stages.slice(0, -1).map((item, index) => <span key={item} className={`h-1.5 flex-1 rounded-full ${index <= stage ? 'bg-purple-500' : 'bg-gray-200 dark:bg-neutral-700'} ${index === stage ? 'animate-pulse motion-reduce:animate-none' : ''}`} />)}</div><p className="mt-2 text-xs text-gray-500">This import is saved. You can return here to check its progress.</p></>}
      {job.message && job.message !== job.error && <p className="mt-3 text-sm text-gray-600 dark:text-neutral-400">{job.message}</p>}
      {job.error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{job.error}</p>}
      {job.status === 'queued' && retryAvailable && <div className="mt-4 space-y-3"><p className="text-xs text-gray-500">If parsing has not started, resend the start request using the PDFs already uploaded.</p><button type="button" className={secondaryButton} disabled={restarting} onClick={() => void restart()}>{restarting ? 'Starting import…' : 'Retry starting import'}</button><ErrorNotice message={restartError} />{restartNotice && <p role="status" className="text-sm text-purple-700 dark:text-purple-300">{restartNotice}</p>}</div>}
    </article>
  );
}

function QuizWorkspace({ user }: { user: User }) {
  const [title, setTitle] = useState('');
  const [paper, setPaper] = useState<File | null>(null);
  const [answerKey, setAnswerKey] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [checkingPdfs, setCheckingPdfs] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfPages, setPdfPages] = useState<QuizPdfPageCounts | null>(null);
  const [imports, setImports] = useState<QuizImport[]>([]);
  const [quizzes, setQuizzes] = useState<QuizDocument[]>([]);
  const [importsLoading, setImportsLoading] = useState(true);
  const [quizzesLoading, setQuizzesLoading] = useState(true);
  const [importsError, setImportsError] = useState<string | null>(null);
  const [quizzesError, setQuizzesError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [editingJob, setEditingJob] = useState<QuizImport | null>(null);
  const [activeQuiz, setActiveQuiz] = useState<QuizDocument | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const paperInput = useRef<HTMLInputElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const activePanel = useRef<HTMLDivElement>(null);
  const alive = useAlive();
  const uploadLock = useRef(false);
  const configured = isQuizParserConfigured();
  const freeParser = isFreeQuizParser();
  const parserMode = quizParserMode();
  const gateParser = parserMode === 'gemini';

  useEffect(() => {
    let active = true;
    setPdfError(null);
    setPdfPages(null);
    if (!paper) {
      setCheckingPdfs(false);
      return;
    }
    setCheckingPdfs(true);
    validatePdfFiles(paper, answerKey).then(counts => {
      if (active) setPdfPages(counts);
    }, error => {
      if (active) setPdfError(errorMessage(error));
    }).finally(() => {
      if (active) setCheckingPdfs(false);
    });
    return () => { active = false; };
  }, [paper, answerKey, parserMode]);

  useEffect(() => {
    let active = true;
    setImportsLoading(true);
    setQuizzesLoading(true);
    setImportsError(null);
    setQuizzesError(null);
    let stopImports = () => {};
    let stopQuizzes = () => {};
    try {
      stopImports = subscribeQuizImports(user.uid, data => {
        if (!active) return;
        setImports(data);
        setImportsLoading(false);
      }, err => {
        if (!active) return;
        setImportsError(errorMessage(err));
        setImportsLoading(false);
      });
    } catch (err) { setImportsError(errorMessage(err)); setImportsLoading(false); }
    try {
      stopQuizzes = subscribeQuizzes(user.uid, data => {
        if (!active) return;
        setQuizzes(data);
        setQuizzesLoading(false);
      }, err => {
        if (!active) return;
        setQuizzesError(errorMessage(err));
        setQuizzesLoading(false);
      });
    } catch (err) { setQuizzesError(errorMessage(err)); setQuizzesLoading(false); }
    return () => { active = false; stopImports(); stopQuizzes(); };
  }, [user.uid, refresh]);

  useEffect(() => {
    if (editingJob || activeQuiz) activePanel.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  }, [editingJob, activeQuiz]);

  const reviewDraft = (job: QuizImport) => {
    try {
      const draft = validateQuizDraft(job.draft, user.uid);
      setEditingJob({ ...job, draft });
      setActiveQuiz(null);
      setImportsError(null);
    } catch (err) { setImportsError(`This imported draft could not be opened. ${errorMessage(err)}`); }
  };

  const upload = async (event: FormEvent) => {
    event.preventDefault();
    if (!paper || !title.trim() || !configured || uploadLock.current) return;
    uploadLock.current = true;
    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);
    setNotice(null);
    try {
      await validatePdfFiles(paper, answerKey);
      if (!alive.current) return;
      await createQuizImport(user, title.trim(), paper, answerKey, progress => {
        if (alive.current) setUploadProgress(Math.max(0, Math.min(100, progress)));
      });
      if (!alive.current) return;
      setTitle('');
      setPaper(null);
      setAnswerKey(null);
      if (paperInput.current) paperInput.current.value = '';
      if (keyInput.current) keyInput.current.value = '';
      setNotice('PDFs uploaded. Follow the parsing stages below, then review the draft before saving.');
    } catch (err) {
      if (alive.current) setUploadError(errorMessage(err));
    } finally {
      uploadLock.current = false;
      if (alive.current) setUploading(false);
    }
  };
  const unsavedImports = imports.filter(job => !job.savedQuizId);
  return (
    <div className="space-y-8">
      <div className="grid items-start gap-6 lg:grid-cols-[1.05fr_1fr]">
        <section className="glass-panel rounded-3xl p-5 sm:p-8" aria-labelledby="upload-heading">
          <h2 id="upload-heading" className="text-2xl font-black">Create a quiz from a PDF</h2><p className="mt-3 text-sm leading-6 text-gray-600 dark:text-neutral-400">Upload your question paper and answer key. We’ll extract the questions, math and diagrams so you can review them before practicing.</p>
          {gateParser && <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-neutral-400">Full papers of up to <strong>200 pages</strong> are supported, with up to <strong>30 pages in the answer key</strong>. MCQ, multiple-select and numerical questions retain their session, section and marks. Longer papers are processed in sections; progress appears below. Check the extracted draft against the preserved original pages.</p>}
          {freeParser && <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-neutral-400">Our current free importer supports up to <strong>2 pages total, including the answer key</strong>. Use numbered questions with options labelled consecutively from A, up to H. Daily parsing capacity is limited; if importing is unavailable, try again later.</p>}
          {!configured && <div role="status" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-200">PDF importing is not available here yet. Ask the site administrator to enable quiz imports. Saved quizzes can still be attempted below.</div>}
          <form className="mt-6 space-y-5" onSubmit={upload}>
            <label className="block text-sm font-bold">Quiz title<input className={`${inputStyle} mt-2`} placeholder="e.g. Physics practice paper" value={title} disabled={uploading || !configured} maxLength={160} onChange={event => setTitle(event.target.value)} required /></label>
            <label className="block text-sm font-bold">Question paper PDF<input ref={paperInput} type="file" accept="application/pdf,.pdf" className={`${inputStyle} mt-2 cursor-pointer file:mr-3 file:rounded-lg file:border-0 file:bg-purple-100 file:px-3 file:py-2 file:font-semibold file:text-purple-800 dark:file:bg-purple-950 dark:file:text-purple-200`} disabled={uploading || !configured} onChange={event => { const selected = event.target.files?.[0] ?? null; setPaper(selected); setUploadError(null); if (selected && !title.trim()) setTitle(selected.name.replace(/\.pdf$/i, '').slice(0, 160)); }} required /></label>
            <label className="block text-sm font-bold">Answer key PDF <span className="font-normal text-gray-500">(optional if included in the paper)</span><input ref={keyInput} type="file" accept="application/pdf,.pdf" className={`${inputStyle} mt-2 cursor-pointer file:mr-3 file:rounded-lg file:border-0 file:bg-purple-100 file:px-3 file:py-2 file:font-semibold file:text-purple-800 dark:file:bg-purple-950 dark:file:text-purple-200`} disabled={uploading || !configured} onChange={event => { setAnswerKey(event.target.files?.[0] ?? null); setUploadError(null); }} /></label>
            <p className="text-xs leading-5 text-gray-500 dark:text-neutral-400">PDFs only · Maximum 25 MB per file · {gateParser ? '200 paper pages / 30 answer-key pages · MCQ, MSQ and numerical answers' : freeParser ? '2 pages total, including the answer key · Single-answer MCQs with 2–8 options' : '30 pages per file · Single-answer MCQs with 2–8 options'} · A complete answer key is required. Extraction accuracy can vary; review the draft against your original paper.</p>
            {checkingPdfs && <p role="status" className="text-sm text-gray-500 dark:text-neutral-400">Checking PDF page counts…</p>}
            {pdfPages && <p role="status" className="text-sm text-gray-500 dark:text-neutral-400">Question paper: {pdfPages.paper} {pdfPages.paper === 1 ? 'page' : 'pages'}{answerKey ? ` · Answer key: ${pdfPages.answerKey} ${pdfPages.answerKey === 1 ? 'page' : 'pages'}` : ''} · {pdfPages.total} total</p>}
            <ErrorNotice message={pdfError ?? uploadError} />
            {uploading && <div role="status" aria-live="polite"><div className="mb-2 flex items-center gap-2 text-sm font-semibold"><span className="h-4 w-4 animate-spin rounded-full border-2 border-purple-200 border-t-purple-600 motion-reduce:animate-none" aria-hidden="true" />{uploadProgress === 0 ? 'Validating and preparing PDFs…' : uploadProgress < 100 ? `Uploading PDFs… ${Math.round(uploadProgress)}%` : 'Starting the parser…'}</div><progress className="h-2 w-full accent-purple-600" max={100} value={uploadProgress} aria-label="PDF upload progress" /></div>}
            <button className={primaryButton} type="submit" disabled={!configured || uploading || checkingPdfs || !!pdfError || !pdfPages || !paper || !title.trim()}>{uploading ? 'Importing…' : 'Upload and build quiz'}</button>
          </form>
          {notice && <p role="status" className="mt-4 text-sm leading-6 text-purple-700 dark:text-purple-300">{notice}</p>}
        </section>
        <section className="glass-panel rounded-3xl p-5 sm:p-8" aria-labelledby="imports-heading">
          <div className="flex items-center justify-between gap-3"><h2 id="imports-heading" className="text-2xl font-black">Your imports</h2><button type="button" className={secondaryButton} onClick={() => setRefresh(value => value + 1)} disabled={uploading}>Refresh</button></div>
          <p className="mt-3 text-sm text-gray-500 dark:text-neutral-400">Progress updates automatically. Return here to resume a ready draft.</p>
          <div className="mt-5 space-y-4"><ErrorNotice message={importsError} />{importsLoading && <p role="status" className="animate-pulse text-sm text-gray-500">Loading imports…</p>}{!importsLoading && !importsError && !unsavedImports.length && <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-neutral-700">Your PDF imports will appear here.</div>}{unsavedImports.map(job => <div key={job.id}><ImportProgress job={job} user={user} />{job.status === 'ready' && job.draft && <button type="button" className={`${secondaryButton} mt-3 w-full`} onClick={() => reviewDraft(job)}>Review and save draft</button>}</div>)}</div>
        </section>
      </div>
      <section className="glass-panel rounded-3xl p-5 sm:p-8" aria-labelledby="library-heading">
        <h2 id="library-heading" className="text-2xl font-black">Saved quizzes</h2><p className="mt-2 text-sm text-gray-500 dark:text-neutral-400">Attempt a quiz, check each answer and track your practice.</p>
        <div className="mt-5"><ErrorNotice message={quizzesError} />{quizzesLoading && <p role="status" className="animate-pulse text-sm text-gray-500">Loading quizzes…</p>}{!quizzesLoading && !quizzesError && !quizzes.length && <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-neutral-700">Save your first imported quiz to start practicing.</div>}</div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{quizzes.map(quiz => <article key={quiz.id} className="flex flex-col rounded-2xl border border-gray-200 p-5 dark:border-white/10"><h3 className="break-words font-black">{quiz.title}</h3><p className="mb-5 mt-2 text-sm text-gray-500">{quiz.question.length} questions · {new Date(quiz.createdAt).toLocaleDateString()}</p><button type="button" className={`${secondaryButton} mt-auto`} onClick={() => { setActiveQuiz(quiz); setEditingJob(null); }}>Open quiz</button></article>)}</div>
      </section>
      <div ref={activePanel} className="scroll-mt-24">
        {editingJob?.draft && <DraftEditor key={editingJob.id} job={editingJob} userId={user.uid} onClose={() => setEditingJob(null)} onSaved={quiz => { setEditingJob(null); setActiveQuiz(quiz); setNotice('Quiz saved. You can attempt it below.'); }} />}
        {activeQuiz && <QuizPlayer key={activeQuiz.id} quiz={activeQuiz} userId={user.uid} onClose={() => setActiveQuiz(null)} />}
      </div>
    </div>
  );
}

export default function QuizPage({ user }: { user: User | null; theme?: 'dark' | 'light' }) {
  return (
    <main className="app-bg min-h-screen">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true"><div className="blob-base blob-purple opacity-25 dark:opacity-15" /><div className="blob-base blob-cyan opacity-25 dark:opacity-15" /></div>
      <div className="relative z-10 mx-auto max-w-7xl px-4 pb-20 pt-28 sm:px-6">
        <Link to="/" className="mb-6 inline-flex rounded-lg py-2 text-sm font-semibold text-gray-600 transition hover:text-purple-600 dark:text-neutral-400 dark:hover:text-purple-300">← Dashboard</Link>
        <div className="mb-10"><p className="mb-3 text-sm font-bold uppercase tracking-widest text-purple-600 dark:text-purple-400">Practice from your papers</p><h1 className="text-brand text-4xl font-black tracking-tight sm:text-6xl">Quizzes</h1><p className="mt-4 max-w-2xl leading-7 text-gray-600 dark:text-neutral-400">Turn your question papers into quizzes. Practice at your pace and review every answer.</p></div>
        {user ? <QuizWorkspace key={user.uid} user={user} /> : <section className="glass-panel rounded-3xl p-8 text-center"><h2 className="text-xl font-bold">Sign in to use quizzes</h2><p className="mt-3 text-sm text-gray-600 dark:text-neutral-400">Use the sign-in button in the header to import papers, save quizzes and keep your attempt history.</p></section>}
      </div>
    </main>
  );
}
