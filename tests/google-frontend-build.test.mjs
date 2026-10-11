import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveConfig } from 'vite';
import { productionEnvironment, productionOutputPath, productionViteOptions, verifyFrontendArtifacts } from '../scripts/build_google_frontend.mjs';

const temporary = await mkdtemp(path.join(tmpdir(), 'revsy-production-frontend-'));
after(() => rm(temporary, { recursive: true, force: true }));
const config = { apiKey: 'public-firebase-browser-key', authDomain: 'revsy-prod.firebaseapp.com',
  projectId: 'revsy-prod', storageBucket: 'revsy-prod.firebasestorage.app', appId: '1:123456789:web:app' };

test('production build accepts only public Firebase config and excludes process secrets and demo overrides', () => {
  const parent = { PATH: 'node-bin', GEMINI_API_KEY: 'secret-fixture', HF_TOKEN: 'hf-fixture',
    VITE_GEMINI_API_KEY: 'misnamed-secret', VITE_FIREBASE_PROJECT_ID: 'demo-revsy', VITE_USE_FIREBASE_EMULATORS: 'true' };
  const env = productionEnvironment(parent, config, 'revsy-prod');
  assert.equal(env.PATH, 'node-bin');
  assert.equal(env.VITE_FIREBASE_PROJECT_ID, 'revsy-prod');
  assert.equal(env.VITE_USE_FIREBASE_EMULATORS, 'false');
  assert.equal(env.VITE_GOOGLE_API_KEY, '');
  assert.equal(env.VITE_QUIZ_PARSER_URL, '/api');
  assert.equal(env.VITE_QUIZ_PARSER_MODE, 'gemini');
  for (const key of ['GEMINI_API_KEY', 'HF_TOKEN', 'VITE_GEMINI_API_KEY']) assert.ok(!(key in env));
  assert.equal(parent.VITE_FIREBASE_PROJECT_ID, 'demo-revsy', 'caller environment remains unchanged');
  assert.throws(() => productionEnvironment(parent, { ...config, GEMINI_API_KEY: 'secret-fixture' }, 'revsy-prod'), /Unsupported/);
  assert.throws(() => productionEnvironment(parent, { ...config, projectId: 'demo-revsy' }, 'demo-revsy'), /production project/);
  assert.throws(() => productionEnvironment(parent, config, 'different-project'), /production project/);
  assert.throws(() => productionEnvironment(parent, { ...config, apiKey: '' }, 'revsy-prod'), /requires apiKey/);
});

test('installed Vite ignores local env files in the production build configuration', async () => {
  await writeFile(path.join(temporary, '.env.local'), 'VITE_FIREBASE_PROJECT_ID=demo-revsy\nVITE_GEMINI_API_KEY=secret-fixture\n');
  const resolved = await resolveConfig({ ...productionViteOptions(path.join(temporary, 'dist'), temporary), configFile: false }, 'build');
  assert.equal(resolved.envDir, false);
  assert.ok(!('VITE_GEMINI_API_KEY' in resolved.env));
  assert.notEqual(resolved.env.VITE_FIREBASE_PROJECT_ID, 'demo-revsy');
});

test('frontend outputs stay under their isolated deployment folder and reject private files or local settings', async () => {
  const output = productionOutputPath(temporary, '.deployment/google/frontend-dist');
  assert.equal(output, path.join(temporary, '.deployment/google/frontend-dist'));
  for (const requested of ['dist', '.deployment/google', '.deployment/google/../../outside']) {
    assert.throws(() => productionOutputPath(temporary, requested), /fresh frontend output/);
  }
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'index.html'), '<div>Revsy</div>');
  assert.equal(await verifyFrontendArtifacts(output), 1);
  const privateFile = path.join(output, 'paper.pdf');
  await writeFile(privateFile, 'PDF fixture');
  await assert.rejects(verifyFrontendArtifacts(output), /asset type/);
  await rm(privateFile);
  await writeFile(path.join(output, 'app.js'), 'const project = "demo-revsy";');
  await assert.rejects(verifyFrontendArtifacts(output), /local configuration/);
});
