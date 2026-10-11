import type { User } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, onSnapshot, runTransaction } from 'firebase/firestore';
import { getBlob, ref, uploadBytesResumable } from 'firebase/storage';
import { auth, db, storage } from './firebase';
import { gradeQuiz, MAX_PDF_BYTES, validateQuizAttempt, validateQuizDraft } from '../domain/quiz';
import { validateQuizPdfFiles, type QuizParserMode } from '../domain/quiz-pdf';
import { resolveQuizParserUrl } from '../domain/quiz-parser-url';
import type { QuizAnswer, QuizAttempt, QuizDocument, QuizDraft, QuizImport } from '../types/quiz';

function requireOwner(userId: string) {
  if (!auth.currentUser || auth.currentUser.uid !== userId) {
    throw new Error('Sign in to your account to continue.');
  }
}

function parserUrl(): string | null {
  return resolveQuizParserUrl(import.meta.env.VITE_QUIZ_PARSER_URL, import.meta.env.DEV,
    typeof window === 'undefined' ? undefined : window.location?.origin);
}

export function isQuizParserConfigured() { return parserUrl() !== null; }

export function quizParserMode(): QuizParserMode {
  const mode = import.meta.env.VITE_QUIZ_PARSER_MODE;
  return mode === 'gemini' || mode === 'full' ? mode : 'zerogpu';
}

export function isFreeQuizParser() { return quizParserMode() === 'zerogpu'; }

export function validatePdfFiles(paper: File, answerKey: File | null) {
  return validateQuizPdfFiles(paper, answerKey, quizParserMode());
}

function uploadPdf(userId: string, storagePath: string, file: File, onProgress: (bytes: number) => void) {
  requireOwner(userId);
  return new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(ref(storage, storagePath), file, { contentType: 'application/pdf' });
    task.on('state_changed', (snapshot) => {
      if (auth.currentUser?.uid !== userId) { task.cancel(); return; }
      onProgress(snapshot.bytesTransferred);
    }, reject, () => resolve());
  });
}

export async function createQuizImport(
  user: User, title: string, paper: File, key: File | null, onProgress: (percent: number) => void,
): Promise<string> {
  requireOwner(user.uid);
  const url = parserUrl();
  if (!url) throw new Error('PDF parsing has not been configured for this deployment.');
  if (!title.trim() || title.trim().length > 160) throw new Error('Enter a title of up to 160 characters.');
  await validatePdfFiles(paper, key);
  const id = crypto.randomUUID();
  const prefix = `users/${user.uid}/quiz-imports/${id}/`;
  const total = paper.size + (key?.size ?? 0);
  onProgress(0);
  await uploadPdf(user.uid, `${prefix}paper.pdf`, paper, bytes => onProgress(Math.floor(100 * bytes / total)));
  if (key) {
    await uploadPdf(user.uid, `${prefix}answer-key.pdf`, key,
      bytes => onProgress(Math.floor(100 * (paper.size + bytes) / total)));
  }
  return postQuizJob(user, url, { id, title: title.trim(), paperPath: `${prefix}paper.pdf`,
    ...(key ? { answerKeyPath: `${prefix}answer-key.pdf` } : {}) });
}

export async function retryQuizImport(user: User, id: string): Promise<string> {
  requireOwner(user.uid);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error('Invalid PDF import.');
  const url = parserUrl();
  if (!url) throw new Error('PDF parsing has not been configured for this deployment.');
  const snapshot = await getDoc(doc(db, 'users', user.uid, 'quizImports', id));
  requireOwner(user.uid);
  if (!snapshot.exists() || snapshot.data().status !== 'queued') throw new Error('Only an import waiting to start can be retried.');
  const data = snapshot.data();
  const prefix = `users/${user.uid}/quiz-imports/${id}/`;
  if (data.paperPath !== `${prefix}paper.pdf`
    || data.answerKeyPath !== undefined && data.answerKeyPath !== `${prefix}answer-key.pdf`
    || typeof data.title !== 'string' || !data.title.trim() || data.title.length > 160) {
    throw new Error('This import does not contain valid uploaded PDF paths. Start a new import.');
  }
  return postQuizJob(user, url, { id, title: data.title, paperPath: data.paperPath,
    ...(data.answerKeyPath ? { answerKeyPath: data.answerKeyPath } : {}) });
}

async function postQuizJob(user: User, url: string, payload: {
  id: string; title: string; paperPath: string; answerKeyPath?: string;
}): Promise<string> {
  requireOwner(user.uid);
  const token = await user.getIdToken();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${url}/jobs`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : null;
      throw new Error(typeof detail === 'string' ? detail : 'The parser could not start this import. Please try again.');
    }
    requireOwner(user.uid);
    return payload.id;
  } catch (error) {
    if (error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError')) {
      throw new Error('Could not confirm the parsing request. Check your imports below before uploading again.');
    }
    throw error;
  } finally { window.clearTimeout(timeout); }
}

export function subscribeQuizImports(
  userId: string, onData: (data: QuizImport[]) => void, onError: (error: Error) => void,
) {
  requireOwner(userId);
  return onSnapshot(collection(db, 'users', userId, 'quizImports'), snapshot => {
    if (auth.currentUser?.uid !== userId) return;
    onData(snapshot.docs.map(item => ({ ...item.data(), id: item.id }) as QuizImport)
      .sort((a, b) => b.createdAt - a.createdAt));
  }, onError);
}

export function subscribeQuizzes(
  userId: string, onData: (data: QuizDocument[]) => void, onError: (error: Error) => void,
) {
  requireOwner(userId);
  return onSnapshot(collection(db, 'users', userId, 'quizzes'), snapshot => {
    if (auth.currentUser?.uid !== userId) return;
    try {
      onData(snapshot.docs.map(item => ({ ...validateQuizDraft(item.data(), userId),
        id: item.id, createdAt: Number(item.data().createdAt) }))
        .sort((a, b) => b.createdAt - a.createdAt));
    } catch (error) { onError(error instanceof Error ? error : new Error('Could not load quizzes.')); }
  }, onError);
}

export async function saveQuiz(userId: string, input: QuizDraft, importId: string): Promise<QuizDocument> {
  requireOwner(userId);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(importId)) throw new Error('Invalid PDF import.');
  const draft = validateQuizDraft(input, userId);
  if (draft.source.paperPath !== `users/${userId}/quiz-imports/${importId}/paper.pdf`) {
    throw new Error('The quiz does not match this PDF import.');
  }
  const quizRef = doc(db, 'users', userId, 'quizzes', importId);
  const importRef = doc(db, 'users', userId, 'quizImports', importId);
  return runTransaction(db, async transaction => {
    const imported = await transaction.get(importRef);
    const existing = await transaction.get(quizRef);
    if (existing.exists()) {
      return { ...validateQuizDraft(existing.data(), userId), id: existing.id, createdAt: existing.data().createdAt };
    }
    if (!imported.exists() || imported.data().status !== 'ready') {
      throw new Error('Wait for this PDF import to finish before saving.');
    }
    requireOwner(userId);
    const quiz: QuizDocument = { ...draft, id: importId, createdAt: Date.now() };
    transaction.set(quizRef, quiz);
    transaction.update(importRef, { savedQuizId: importId });
    return quiz;
  });
}

export async function saveQuizAttempt(
  userId: string, quiz: QuizDocument, answers: QuizAnswer[], attemptId: string = crypto.randomUUID(),
): Promise<QuizAttempt> {
  requireOwner(userId);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(attemptId)) throw new Error('Invalid attempt ID.');
  const validated = validateQuizDraft(quiz, userId);
  const grade = gradeQuiz(validated, answers);
  const attemptRef = doc(db, 'users', userId, 'quizzes', quiz.id, 'attempts', attemptId);
  const attempt: QuizAttempt = { id: attemptRef.id, quizId: quiz.id, answers: structuredClone(answers),
    correct: grade.correct, total: grade.total, submittedAt: Date.now(),
    ...('score' in grade ? { score: grade.score, maxScore: grade.maxScore } : {}) };
  return runTransaction(db, async transaction => {
    const existing = await transaction.get(attemptRef);
    requireOwner(userId);
    if (existing.exists()) {
      return validateQuizAttempt({ ...decodedAttempt(existing.data()), id: existing.id }, validated, quiz.id);
    }
    // Firestore permits maps within an array, but rejects nested arrays. Keep
    // MSQ selections as a small map on the wire and normalize them on reads.
    transaction.set(attemptRef, { ...attempt, answers: attempt.answers.map(answer =>
      Array.isArray(answer) ? { optionIndices: answer } : answer) });
    return attempt;
  });
}

function decodedAttempt(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('This stored attempt could not be read.');
  const data = input as Record<string, unknown>;
  const answers = Array.isArray(data.answers) ? data.answers.map(answer => {
    if (answer && typeof answer === 'object' && !Array.isArray(answer)
      && Object.keys(answer).length === 1 && 'optionIndices' in answer) return answer.optionIndices;
    return answer;
  }) : data.answers;
  return { ...data, answers };
}

export async function getQuizAttempts(userId: string, quizId: string): Promise<QuizAttempt[]> {
  requireOwner(userId);
  const quizSnapshot = await getDoc(doc(db, 'users', userId, 'quizzes', quizId));
  if (!quizSnapshot.exists()) throw new Error('This quiz is no longer available.');
  const quiz = validateQuizDraft(quizSnapshot.data(), userId);
  const snapshot = await getDocs(collection(db, 'users', userId, 'quizzes', quizId, 'attempts'));
  requireOwner(userId);
  return snapshot.docs.map(item => validateQuizAttempt({ ...decodedAttempt(item.data()), id: item.id }, quiz, quizId))
    .sort((a, b) => b.submittedAt - a.submittedAt);
}

export async function getQuizAssetBlob(storagePath: string): Promise<Blob> {
  const uid = auth.currentUser?.uid;
  if (!uid || !storagePath.startsWith(`users/${uid}/quiz-imports/`) || /[\\?#]/.test(storagePath)
    || storagePath.split('/').some(part => part === '..' || part === '.' || part === '')) {
    throw new Error('This PDF or diagram is not available to this account.');
  }
  const blob = await getBlob(ref(storage, storagePath), MAX_PDF_BYTES);
  requireOwner(uid);
  return blob;
}
