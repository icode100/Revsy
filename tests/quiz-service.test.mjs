import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporary = await mkdtemp(path.join(tmpdir(), 'revsy-service-tests-'));
const compiled = await build({ entryPoints: ['src/services/quiz.ts'], bundle: true,
  write: false, platform: 'node', format: 'esm', define: {
    'import.meta.env': JSON.stringify({ DEV: true, VITE_QUIZ_PARSER_MODE: 'gemini',
      VITE_QUIZ_PARSER_URL: 'http://127.0.0.1:8001' }),
  }, plugins: [{ name: 'isolate-firebase', setup(builder) {
    builder.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'firestore', namespace: 'test' }));
    builder.onResolve({ filter: /^firebase\/storage$/ }, () => ({ path: 'storage', namespace: 'test' }));
    builder.onResolve({ filter: /^\.\/firebase$/ }, () => ({ path: 'firebase', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ contents: path === 'firebase'
      ? 'export const auth = {currentUser:{uid:"alice"}}; export const db = {}; export const storage = {};'
      : path === 'storage'
        ? 'export function ref(){} export function getBlob(){} export function uploadBytesResumable(){globalThis.quizServiceTestState.uploads++;throw new Error("Unexpected upload");}'
        : `export function collection(){} export function onSnapshot(){}
           export function doc(_db,...parts){return {id:parts.at(-1),path:parts.join('/')}}
           function snap(data,id='stored'){return {id,exists:()=>!!data,data:()=>data}}
           export async function getDoc(ref){const state=globalThis.quizServiceTestState;return snap(ref.path.includes('/quizImports/')?state.pendingImport:state.quiz,ref.id)}
           export async function getDocs(){return {docs:globalThis.quizServiceTestState.attempts.map(data=>snap(data,data.id))}}
           export async function runTransaction(_db,callback){return callback({get:async(ref)=>snap(globalThis.quizServiceTestState.existingAttempt,ref.id),set:(ref,data)=>globalThis.quizServiceTestState.writes.push({ref,data}),update:()=>{}})}`, loader: 'js' }));
  } }] });
const destination = path.join(temporary, 'service.mjs');
await writeFile(destination, compiled.outputFiles[0].text);
const { saveQuizAttempt, getQuizAttempts, retryQuizImport } = await import(pathToFileURL(destination).href);
after(() => rm(temporary, { recursive: true, force: true }));

const quizId = '47f0efda-5988-4f7b-8b11-ab333191bd09';
function gateQuiz() {
  return { schemaVersion: 2, id: quizId, createdAt: 1, title: 'GATE fixture',
    question: [
      { id: 'q1', number: '1', problem: 'Choose one accepted alternative.', options: ['A', 'B', 'C'], images: [], kind: 'mcq', session: 'Session 1', section: 'CS', marks: 2 },
      { id: 'q2', number: '2', problem: 'Choose both correct choices.', options: ['A', 'B', 'C'], images: [], kind: 'msq', session: 'Session 1', section: 'CS', marks: 2 },
      { id: 'q3', number: '3', problem: 'Enter five.', options: [], images: [], kind: 'nat', session: 'Session 1', section: 'CS', marks: 1 },
    ], key: [
      { questionId: 'q1', kind: 'mcq', acceptedOptionIndices: [0, 1] },
      { questionId: 'q2', kind: 'msq', correctOptionIndices: [0, 2] },
      { questionId: 'q3', kind: 'nat', minValue: '4.9', maxValue: '5.1' },
    ], source: { paperPath: `users/alice/quiz-imports/${quizId}/paper.pdf` },
    parsing: { model: 'Fixture only', warnings: [] } };
}

function state(quiz = gateQuiz()) {
  return globalThis.quizServiceTestState = { quiz, writes: [], attempts: [], uploads: 0 };
}

test('GATE attempt stores MSQ selections as Firestore-safe maps and reloads mixed answers with marks', async () => {
  const current = state();
  const attempt = await saveQuizAttempt('alice', current.quiz, [1, [0, 2], '5.00'], 'attempt-1');
  assert.deepEqual(attempt.answers, [1, [0, 2], '5.00']);
  assert.equal(attempt.score, 5);
  assert.equal(attempt.maxScore, 5);
  const stored = current.writes[0].data;
  assert.deepEqual(stored.answers, [1, { optionIndices: [0, 2] }, '5.00']);
  assert.ok(!stored.answers.some(Array.isArray), 'Firestore must never receive nested answer arrays');
  assert.ok(Object.values(stored).every(value => value !== undefined));
  current.attempts = [stored];
  assert.deepEqual((await getQuizAttempts('alice', quizId))[0], attempt);
  current.existingAttempt = stored;
  assert.deepEqual(await saveQuizAttempt('alice', current.quiz, [1, [0, 2], '5.00'], 'attempt-1'), attempt);
  assert.equal(current.writes.length, 1, 'retry keeps the original immutable attempt');
});

test('legacy attempt wire format and score remain unchanged', async () => {
  const current = state({ schemaVersion: 1, id: quizId, createdAt: 1, title: 'Legacy fixture',
    question: [{ id: 'q1', number: '1', problem: 'Choose B.', options: ['A', 'B'], images: [] }],
    key: [{ questionId: 'q1', correctOptionIndex: 1 }],
    source: { paperPath: `users/alice/quiz-imports/${quizId}/paper.pdf` }, parsing: { model: 'Fixture', warnings: [] } });
  const attempt = await saveQuizAttempt('alice', current.quiz, [1], 'legacy-attempt');
  assert.equal(attempt.correct, 1);
  assert.ok(!('score' in attempt));
  assert.ok(!('maxScore' in current.writes[0].data));
  current.attempts = [current.writes[0].data];
  assert.deepEqual((await getQuizAttempts('alice', quizId))[0].answers, [1]);
});

test('stored answer maps with extra fields or malformed selections are rejected', async () => {
  const current = state();
  await saveQuizAttempt('alice', current.quiz, [1, [0, 2], '5'], 'invalid-wire');
  for (const invalid of [{ optionIndices: [0, 2], extra: true }, { optionIndices: [0, 0] }, { arbitrary: [0, 2] }]) {
    current.attempts = [{ ...current.writes[0].data, answers: [1, invalid, '5'] }];
    await assert.rejects(getQuizAttempts('alice', quizId));
  }
});

test('queued import retry reuses its owned paths and identifier without uploading another PDF', async () => {
  const current = state();
  const prefix = `users/alice/quiz-imports/${quizId}/`;
  current.pendingImport = { status: 'queued', title: 'GATE fixture', paperPath: prefix + 'paper.pdf', answerKeyPath: prefix + 'answer-key.pdf' };
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  globalThis.window = { setTimeout, clearTimeout };
  const requests = [];
  let tokens = 0;
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true };
  };
  try {
    assert.equal(await retryQuizImport({ uid: 'alice', getIdToken: async () => { tokens++; return 'test-token'; } }, quizId), quizId);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://127.0.0.1:8001/jobs');
    assert.deepEqual(JSON.parse(requests[0].options.body), { id: quizId, title: 'GATE fixture', paperPath: prefix + 'paper.pdf', answerKeyPath: prefix + 'answer-key.pdf' });
    assert.equal(tokens, 1);
    assert.equal(current.uploads, 0);
    current.pendingImport.status = 'reading-paper';
    await assert.rejects(retryQuizImport({ uid: 'alice' }, quizId), /Only an import waiting/);
    assert.equal(requests.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
