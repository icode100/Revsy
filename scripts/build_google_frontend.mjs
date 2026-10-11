import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicFields = {
  apiKey: 'VITE_FIREBASE_API_KEY', authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID', storageBucket: 'VITE_FIREBASE_STORAGE_BUCKET',
  appId: 'VITE_FIREBASE_APP_ID', messagingSenderId: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
  measurementId: 'VITE_FIREBASE_MEASUREMENT_ID',
};
const required = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'appId'];
const systemFields = new Set(['path', 'pathext', 'systemroot', 'windir', 'comspec', 'temp', 'tmp',
  'userprofile', 'appdata', 'localappdata', 'home', 'processor_architecture', 'number_of_processors',
  'os', 'lang', 'lc_all', 'no_color', 'force_color']);
const assetExtensions = new Set(['.html', '.js', '.css', '.svg', '.png', '.jpg', '.jpeg', '.webp',
  '.gif', '.ico', '.woff', '.woff2', '.ttf', '.otf']);
const forbiddenText = ['demo-revsy', 'http://127.0.0.1:8001', 'http://localhost:8001',
  'http://127.0.0.1:9099', 'http://127.0.0.1:8080', 'http://127.0.0.1:9199',
  'GEMINI_API_KEY', 'HF_TOKEN', 'HF_INFERENCE_TOKEN'];

export function productionEnvironment(parent, config, expectedProject) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Use a public Firebase web config object.');
  for (const field of Object.keys(config)) {
    if (!Object.hasOwn(publicFields, field) && field !== 'databaseURL') throw new Error(`Unsupported public Firebase config field: ${field}`);
  }
  for (const field of required) {
    if (typeof config[field] !== 'string' || !config[field].trim()) throw new Error(`Public Firebase config requires ${field}.`);
  }
  if (!expectedProject || config.projectId !== expectedProject || config.projectId.startsWith('demo-')) {
    throw new Error('Public Firebase config must match the explicitly selected production project.');
  }
  if (!/^[A-Za-z0-9.-]+$/.test(config.authDomain) || !/^[A-Za-z0-9._-]+$/.test(config.storageBucket)) {
    throw new Error('Use production Firebase host and bucket names without protocols or paths.');
  }
  const env = Object.fromEntries(Object.entries(parent).filter(([key]) => systemFields.has(key.toLowerCase())));
  for (const [field, variable] of Object.entries(publicFields)) {
    const value = config[field] ?? '';
    if (typeof value !== 'string') throw new Error(`Public Firebase config field must be text: ${field}`);
    env[variable] = value.trim();
  }
  return { ...env, NODE_ENV: 'production', VITE_USE_FIREBASE_EMULATORS: 'false',
    VITE_QUIZ_PARSER_URL: '/api', VITE_QUIZ_PARSER_MODE: 'gemini', VITE_GOOGLE_API_KEY: '',
    REVSY_PUBLIC_FRONTEND_BUILD: 'validated' };
}

export function productionViteOptions(outDir, workspace = root) {
  return { root: workspace, configFile: path.join(workspace, 'vite.config.ts'), mode: 'production', logLevel: 'warn',
    envDir: false, build: { outDir, emptyOutDir: false, sourcemap: false } };
}

export function productionOutputPath(workspace, requested) {
  const allowed = path.join(workspace, '.deployment', 'google');
  const output = path.resolve(workspace, requested);
  const relative = path.relative(allowed, output);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('Use a fresh frontend output directory inside .deployment/google.');
  }
  return output;
}

async function artifactFiles(directory) {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.name.startsWith('.') || item.isSymbolicLink()) throw new Error('Frontend assets cannot include hidden files or symbolic links.');
    const filename = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...await artifactFiles(filename));
    else {
      if (!assetExtensions.has(path.extname(item.name).toLowerCase())) throw new Error(`Unexpected frontend asset type: ${path.extname(item.name)}`);
      files.push(filename);
    }
  }
  return files;
}

export async function verifyFrontendArtifacts(directory) {
  const files = await artifactFiles(directory);
  for (const filename of files) {
    if (!['.js', '.html', '.css'].includes(path.extname(filename))) continue;
    const text = await readFile(filename, 'utf8');
    if (forbiddenText.some(marker => text.includes(marker))) throw new Error('Frontend artifact contains local configuration or a server credential variable.');
  }
  return files.length;
}

function runNode(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env, windowsHide: true, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('Production frontend build failed.')));
  });
}

function within(parent, target) {
  const relative = path.relative(parent, target);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

async function main(args) {
  if (args[0] === '--internal-build') {
    if (process.env.REVSY_PUBLIC_FRONTEND_BUILD !== 'validated'
      || process.env.VITE_USE_FIREBASE_EMULATORS !== 'false'
      || process.env.VITE_GOOGLE_API_KEY !== '') throw new Error('Use the public-config frontend build entry point.');
    const output = productionOutputPath(root, args[1]);
    const { build } = await import('vite');
    await build(productionViteOptions(output));
    return;
  }
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--config', '--project', '--out-dir'].includes(args[index]) || !args[index + 1]) throw new Error('Use --config PUBLIC_JSON --project PROJECT_ID [--out-dir PATH].');
    options[args[index]] = args[index + 1];
  }
  if (!options['--config'] || !options['--project']) throw new Error('Use --config PUBLIC_JSON --project PROJECT_ID [--out-dir PATH].');
  const config = JSON.parse(await readFile(path.resolve(root, options['--config']), 'utf8'));
  const env = productionEnvironment(process.env, config, options['--project']);
  const output = productionOutputPath(root, options['--out-dir'] ?? '.deployment/google/frontend-dist');
  const allowed = path.join(root, '.deployment', 'google');
  await mkdir(allowed, { recursive: true });
  const actualAllowed = await realpath(allowed);
  if (!within(await realpath(root), actualAllowed)) throw new Error('Deployment output must remain inside this workspace.');
  await mkdir(path.dirname(output), { recursive: true });
  const actualParent = await realpath(path.dirname(output));
  if (!within(actualAllowed, actualParent)) throw new Error('Frontend output must remain inside .deployment/google.');
  try { await stat(output); throw new Error('Frontend output already exists. Select a fresh output directory.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Verify the only directory Vite copies wholesale before building.
  await artifactFiles(path.join(root, 'public'));
  await runNode([path.join(root, 'node_modules/typescript/bin/tsc'), '-b'], env);
  await mkdir(output);
  await runNode([fileURLToPath(import.meta.url), '--internal-build', output], env);
  const files = await verifyFrontendArtifacts(output);
  console.log(`Production frontend ready: ${path.relative(root, output)} (${files} public assets).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
