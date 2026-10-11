import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const legacy = process.argv.includes('--hugging-face');
const args = process.argv.slice(2).filter((argument) => argument !== '--hugging-face');
const script = path.join(root, 'scripts', legacy ? 'run_local_quiz_parser.py' : 'run_local_gemini_parser.py');
const candidates = [
  process.env.REVSY_PYTHON,
  path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
  path.join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime',
    'dependencies', 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python'),
  'python3',
  'python',
].filter(Boolean);

const probe = 'import runpy,sys; runpy.run_path(sys.argv[1],run_name="revsy_dependency_check"); import uvicorn';
let python;
for (const candidate of [...new Set(candidates)]) {
  if (path.isAbsolute(candidate) && !existsSync(candidate)) continue;
  const result = spawnSync(candidate, ['-c', probe, script], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
    stdio: 'pipe',
  });
  if (result.status === 0) {
    python = candidate;
    break;
  }
}

if (!python) {
  console.error('A Python runtime with FastAPI, Uvicorn, httpx, Pillow, pypdf and pypdfium2 is required.');
  console.error('Set REVSY_PYTHON to your Python executable after installing the local parser dependencies.');
  process.exit(1);
}

const server = spawn(python, [script, ...args], {
  cwd: root,
  windowsHide: true,
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.kill(signal));
}
server.on('error', () => {
  console.error('The local quiz parser could not start.');
  process.exitCode = 1;
});
server.on('exit', (code) => {
  process.exitCode = code ?? 0;
});
