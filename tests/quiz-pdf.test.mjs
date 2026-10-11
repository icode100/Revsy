import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFDocument, PDFName } from 'pdf-lib';
import { build } from 'esbuild';

const temporary = await mkdtemp(path.join(tmpdir(), 'revsy-pdf-tests-'));

async function importCompiled(result, name) {
  const destination = path.join(temporary, name + '.mjs');
  await writeFile(destination, result.outputFiles[0].text);
  return import(pathToFileURL(destination).href);
}

const compiled = await build({ entryPoints: ['src/domain/quiz-pdf.ts'], bundle: true,
  write: false, platform: 'node', format: 'esm' });
const { inspectQuizPdf, validateQuizPdfFiles } = await importCompiled(compiled, 'domain');

async function pdf(pages, { encrypted = false } = {}) {
  const document = await PDFDocument.create();
  for (let index = 0; index < pages; index++) document.addPage([144, 144]);
  if (encrypted) {
    // The presence of an encryption dictionary must be rejected even when its
    // page tree can be read. This does not ask the client to decrypt the file.
    document.context.trailerInfo.Encrypt = document.context.register(document.context.obj({
      Filter: PDFName.of('Standard'), V: 1, R: 2, P: -4,
    }));
  }
  const bytes = await document.save({ useObjectStreams: true, addDefaultPage: false });
  return new File([bytes], `paper-${pages}.pdf`, { type: 'application/pdf' });
}

function registerDomainTests() {
test('counts pages from compressed PDF object streams rather than text markers', async () => {
  const file = await pdf(3);
  const source = Buffer.from(await file.arrayBuffer());
  assert.ok(source.includes(Buffer.from('/ObjStm')));
  assert.equal(inspectQuizPdf(file), inspectQuizPdf(file), 'selection and upload share the inspection');
  assert.equal(await inspectQuizPdf(file), 3);
});

test('free preflight accepts two pages embedded or split across paper and answer key', async () => {
  assert.deepEqual(await validateQuizPdfFiles(await pdf(2), null, 'zerogpu'),
    { paper: 2, answerKey: 0, total: 2 });
  assert.deepEqual(await validateQuizPdfFiles(await pdf(1), await pdf(1), 'zerogpu'),
    { paper: 1, answerKey: 1, total: 2 });
});

test('free limits reject oversized and combined PDFs with actual counts and the two-page limit', async () => {
  await assert.rejects(validateQuizPdfFiles(await pdf(31), null, 'zerogpu'),
    /contains 31 pages.*current free importer.*2 pages total/);
  await assert.rejects(validateQuizPdfFiles(await pdf(2), await pdf(1), 'zerogpu'),
    /3 pages total \(question paper: 2; answer key: 1\).*2 pages total/);
  await assert.rejects(validateQuizPdfFiles(await pdf(1), await pdf(3), 'zerogpu'),
    /4 pages total \(question paper: 1; answer key: 3\).*2 pages total/);
});

test('full imports retain the independent 30-page limit for each file', async () => {
  assert.deepEqual(await validateQuizPdfFiles(await pdf(30), await pdf(30), 'full'),
    { paper: 30, answerKey: 30, total: 60 });
  await assert.rejects(validateQuizPdfFiles(await pdf(31), null, 'full'),
    /question paper contains 31 pages.*30 pages/);
  await assert.rejects(validateQuizPdfFiles(await pdf(1), await pdf(31), 'full'),
    /answer key contains 31 pages.*30 pages/);
});

test('Gemini full-paper mode accepts 200 paper pages plus 30 key pages and enforces each bound', async () => {
  assert.deepEqual(await validateQuizPdfFiles(await pdf(200), await pdf(30), 'gemini'),
    { paper: 200, answerKey: 30, total: 230 });
  await assert.rejects(validateQuizPdfFiles(await pdf(201), null, 'gemini'),
    /contains 201 pages.*up to 200 pages/);
  await assert.rejects(validateQuizPdfFiles(await pdf(31), await pdf(31), 'gemini'),
    /answer key contains 31 pages.*30 pages/);
});

test('encrypted, zero-page and invalid PDFs receive actionable errors', async () => {
  await assert.rejects(inspectQuizPdf(await pdf(1, { encrypted: true })), /Password-protected/);
  await assert.rejects(inspectQuizPdf(await pdf(0)), /contains no pages/);
  await assert.rejects(inspectQuizPdf(new File(['not a PDF'], 'fake.pdf')), /not a valid PDF/);
  await assert.rejects(inspectQuizPdf(new File(['%PDF-1.7\n%%EOF'], 'broken.pdf')), /could not be opened/);
  await assert.rejects(inspectQuizPdf(new File([], 'empty.pdf')), /non-empty PDF/);
  await assert.rejects(inspectQuizPdf(new File(['%PDF-1.7'], 'wrong.txt')), /non-empty PDF/);
});

test('oversized files are rejected before reading their content', async () => {
  const file = { name: 'large.pdf', size: 25 * 1024 * 1024 + 1,
    slice: () => assert.fail('oversized file must not be read') };
  await assert.rejects(inspectQuizPdf(file), /up to 25 MB/);
});
}

const service = await build({ entryPoints: ['src/services/quiz.ts'], bundle: true,
  write: false, platform: 'node', format: 'esm', define: {
    'import.meta.env': JSON.stringify({ DEV: true, VITE_QUIZ_PARSER_MODE: 'zerogpu',
      VITE_QUIZ_PARSER_URL: 'http://127.0.0.1:8001' }),
  }, plugins: [{ name: 'isolate-firebase', setup(builder) {
    builder.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'firestore', namespace: 'test' }));
    builder.onResolve({ filter: /^firebase\/storage$/ }, () => ({ path: 'storage', namespace: 'test' }));
    builder.onResolve({ filter: /^\.\/firebase$/ }, () => ({ path: 'firebase', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ contents: path === 'firebase'
      ? 'export const auth = { currentUser: { uid: "alice" } }; export const db = {}; export const storage = {};'
      : path === 'storage'
        ? 'export function ref() {} export function getBlob() {} export function uploadBytesResumable() { globalThis.quizPdfUploadCalls++; throw new Error("Unexpected upload"); }'
        : 'export function collection() {} export function doc() {} export function getDoc() {} export function getDocs() {} export function onSnapshot() {} export function runTransaction() {}',
      loader: 'js' }));
  } }] });
const { createQuizImport } = await importCompiled(service, 'service');
registerDomainTests();
after(() => rm(temporary, { recursive: true, force: true }));

test('upload boundary rejects oversized or encrypted papers before Storage or parser requests', async () => {
  globalThis.quizPdfUploadCalls = 0;
  const originalFetch = globalThis.fetch;
  let requestCalls = 0;
  globalThis.fetch = () => { requestCalls++; assert.fail('rejected PDFs must not start a parser request'); };
  const user = { uid: 'alice', getIdToken: () => assert.fail('rejected PDFs must not request a token') };
  try {
    for (const [paper, answerKey, expected] of [
      [await pdf(31), null, /2 pages total/],
      [await pdf(2), await pdf(1), /3 pages total/],
      [await pdf(1), await pdf(1, { encrypted: true }), /Password-protected/],
    ]) {
      await assert.rejects(createQuizImport(user, 'Test quiz', paper, answerKey, () => {}), expected);
    }
    assert.equal(globalThis.quizPdfUploadCalls, 0);
    assert.equal(requestCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.quizPdfUploadCalls;
  }
});
