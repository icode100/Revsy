import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['src/domain/quiz-parser-url.ts'], bundle: true,
  write: false, platform: 'node', format: 'esm' });
const { resolveQuizParserUrl } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

test('Firebase Hosting uses the current HTTPS origin for its API rewrite', () => {
  for (const configured of ['/api', ' /api/ ']) {
    assert.equal(resolveQuizParserUrl(configured, false, 'https://revsy.web.app'), 'https://revsy.web.app/api');
  }
  assert.equal(resolveQuizParserUrl('/api', true, 'http://127.0.0.1:5173'), 'http://127.0.0.1:5173/api');
  assert.equal(resolveQuizParserUrl('/api', false), null);
  assert.equal(resolveQuizParserUrl('/api', false, 'http://revsy.example'), null);
});

test('absolute parser services retain HTTPS and development-only loopback restrictions', () => {
  assert.equal(resolveQuizParserUrl('https://service.run.app/', false), 'https://service.run.app');
  assert.equal(resolveQuizParserUrl('http://127.0.0.1:8001', true), 'http://127.0.0.1:8001');
  assert.equal(resolveQuizParserUrl('http://localhost:8001', true), 'http://localhost:8001');
  assert.equal(resolveQuizParserUrl('http://127.0.0.1:8001', false), null);
  assert.equal(resolveQuizParserUrl('http://service.example', true), null);
});

test('API bases cannot redirect bearer tokens using credentials, query strings, or arbitrary relative hosts', () => {
  for (const configured of [undefined, '', '//other.example/api', '/other', '/api?token=example',
    '/api#fragment', '/api/../other', 'https://user:password@service.example',
    'https://service.example?token=example', 'https://service.example#fragment', 'javascript:alert(1)']) {
    assert.equal(resolveQuizParserUrl(configured, false, 'https://revsy.web.app'), null);
  }
});
