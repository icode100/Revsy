import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporary = await mkdtemp(path.join(tmpdir(), 'revsy-note-ai-tests-'));
async function summaryModule(label, env) {
  const compiled = await build({ entryPoints: ['src/services/ai.ts'], bundle: true,
    write: false, platform: 'node', format: 'esm', define: {
      'import.meta.env': JSON.stringify({ DEV: false, ...env }),
    }, plugins: [{ name: 'isolate-summary-dependencies', setup(builder) {
    builder.onResolve({ filter: /^\.\/firebase$/ }, () => ({ path: 'firebase', namespace: 'test' }));
    builder.onResolve({ filter: /^@langchain\/(google-genai|core\/prompts)$/ }, ({ path }) => ({ path, namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({
      contents: path === 'firebase'
        ? 'export const auth = { get currentUser(){return globalThis.noteAiTestState.user} };'
        : path === '@langchain/google-genai'
          ? 'export class ChatGoogleGenerativeAI { constructor(config){globalThis.noteAiTestState.models.push(config);} }'
          : `export const ChatPromptTemplate={fromMessages(messages){
              globalThis.noteAiTestState.prompts.push(messages);
              return {pipe(){return {async invoke(input){globalThis.noteAiTestState.invocations.push(input);return globalThis.noteAiTestState.legacyResponse;}}}};
            }};`, loader: 'js',
    }));
  } }] });
  const destination = path.join(temporary, label + '.mjs');
  await writeFile(destination, compiled.outputFiles[0].text);
  return import(pathToFileURL(destination).href);
}
const { summarizeText } = await summaryModule('gemini', { VITE_QUIZ_PARSER_MODE: 'gemini',
  VITE_QUIZ_PARSER_URL: '/api', VITE_GOOGLE_API_KEY: 'legacy-public-test-key' });
const legacy = await summaryModule('legacy', { VITE_GOOGLE_API_KEY: 'legacy-public-test-key' });
const hfLegacy = await summaryModule('hf-legacy', { VITE_QUIZ_PARSER_MODE: 'zerogpu',
  VITE_QUIZ_PARSER_URL: 'https://example.hf.space', VITE_GOOGLE_API_KEY: 'legacy-public-test-key' });
const unconfiguredLegacy = await summaryModule('unconfigured-legacy', {});
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
after(async () => {
  globalThis.fetch = originalFetch;
  globalThis.window = originalWindow;
  await rm(temporary, { recursive: true, force: true });
});

function state(response = { status: 200, body: { summary: 'Find a pair. n <= 1000.' } }) {
  const current = globalThis.noteAiTestState = {
    user: { uid: 'alice', getIdToken: async () => 'firebase-test-token' }, calls: [], timers: [], cleared: [],
    models: [], prompts: [], invocations: [], legacyResponse: { content: 'Original note summary.' },
  };
  globalThis.window = { location: { origin: 'https://revsy-c66e0.web.app' },
    setTimeout: (callback, delay) => { current.timers.push({ callback, delay }); return 1; },
    clearTimeout: timer => current.cleared.push(timer),
  };
  globalThis.fetch = async (url, options) => {
    current.calls.push({ url, options });
    return { status: response.status, ok: response.status >= 200 && response.status < 300,
      json: async () => response.body };
  };
  return current;
}

test('existing summary action returns text from authenticated same-origin API without a browser Gemini key', async () => {
  const current = state();
  assert.equal(await summarizeText('Find a pair. n <= 1000.'), 'Find a pair. n <= 1000.');
  assert.equal(current.calls.length, 1);
  assert.equal(current.calls[0].url, 'https://revsy-c66e0.web.app/api/notes/summarize');
  assert.equal(current.calls[0].options.headers.Authorization, 'Bearer firebase-test-token');
  assert.deepEqual(JSON.parse(current.calls[0].options.body), { text: 'Find a pair. n <= 1000.' });
  assert.equal(current.timers[0].delay, 50_000);
  assert.deepEqual(current.cleared, [1]);
  assert.deepEqual(current.models, [], 'explicit Gemini mode must not instantiate the browser model');
});

test('old note configuration keeps its legacy model settings and does not require a quiz server', async () => {
  const current = state();
  current.user = null;
  const description = 'a'.repeat(7000);
  assert.equal(await legacy.summarizeText(description), 'Original note summary.');
  assert.deepEqual(current.models, [{ model: 'gemini-2.0-flash-lite', temperature: 0.7,
    maxRetries: 2, apiKey: 'legacy-public-test-key' }]);
  assert.deepEqual(current.invocations, [{ input: description }]);
  assert.match(current.prompts[0][0][1], /problem statement and its constraints/);
  assert.deepEqual(current.calls, []);
});

test('Hugging Face quiz configuration retains legacy note summary and content handling', async () => {
  const current = state();
  current.legacyResponse = { content: ['First', { text: 'Second' }, { type: 'other' }] };
  assert.equal(await hfLegacy.summarizeText('Problem'), 'First Second ');
  assert.equal(current.models.length, 1);
  assert.deepEqual(current.calls, [], 'HF quiz endpoint must never receive a note-summary request');
});

test('an absent optional legacy key does not fail module loading and errors only when summary is requested', async () => {
  const current = state();
  await assert.rejects(unconfiguredLegacy.summarizeText('Problem'), /Configure the Google API key/);
  assert.deepEqual(current.models, []);
  assert.deepEqual(current.calls, []);
});

test('signed-out users, empty descriptions, and oversized bodies make no model request', async () => {
  let current = state();
  current.user = null;
  await assert.rejects(summarizeText('Problem'), /Sign in/);
  assert.equal(current.calls.length, 0);
  for (const text of [' ', 'a'.repeat(6001), '界'.repeat(3000)]) {
    current = state();
    await assert.rejects(summarizeText(text), /description/);
    assert.equal(current.calls.length, 0);
  }
});

test('account changes during token acquisition or response discard the summary', async () => {
  let current = state();
  current.user.getIdToken = async () => { current.user = { uid: 'bob' }; return 'old-token'; };
  await assert.rejects(summarizeText('Problem'), /Sign in/);
  assert.equal(current.calls.length, 0);
  current = state();
  globalThis.fetch = async () => {
    current.user = { uid: 'bob' };
    return { status: 200, ok: true, json: async () => ({ summary: 'Private old-user text.' }) };
  };
  await assert.rejects(summarizeText('Problem'), /Sign in/);
  assert.deepEqual(current.cleared, [1]);
});

test('expired sessions, provider failures, and malformed responses give safe errors without replay', async () => {
  for (const response of [{ status: 401, body: { secret: 'private-server-detail' } },
    { status: 503, body: { secret: 'private-server-detail' } },
    { status: 200, body: { summary: '' } }, { status: 200, body: null }]) {
    const current = state(response);
    await assert.rejects(summarizeText('Problem'), error => !error.message.includes('private-server-detail'));
    assert.equal(current.calls.length, 1);
    assert.deepEqual(current.cleared, [1]);
  }
  const current = state();
  globalThis.fetch = async () => { throw new TypeError('private-network-detail'); };
  await assert.rejects(summarizeText('Problem'), /did not respond/);
  assert.deepEqual(current.cleared, [1]);
});
