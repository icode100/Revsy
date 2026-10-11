/** Starts only the isolated demo-revsy Firebase emulators. */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tools = join(root, '.deployment', 'local-tools');
const cli = join(tools, 'firebase-cli', 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
const javaDirectory = join(tools, 'java');
const javaFile = process.platform === 'win32' ? 'java.exe' : 'java';
const bundledHome = existsSync(javaDirectory)
  ? readdirSync(javaDirectory).map(name => join(javaDirectory, name))
    .find(candidate => existsSync(join(candidate, 'bin', javaFile)))
  : undefined;
const javaHome = bundledHome ?? process.env.JAVA_HOME;
const java = javaHome ? join(javaHome, 'bin', javaFile) : 'java';

if (process.argv.length > 2) {
  throw new Error('This launcher accepts no overrides and always uses the local demo-revsy project.');
}
if (!existsSync(cli)) {
  throw new Error('Install local tools first: npm install --prefix .deployment/local-tools/firebase-cli --no-save --package-lock=false firebase-tools@15.33.0');
}
const javaVersion = spawnSync(java, ['-version'], { encoding: 'utf8' });
const major = Number(`${javaVersion.stdout ?? ''}${javaVersion.stderr ?? ''}`.match(/version\s+"(\d+)/)?.[1]);
if (javaVersion.status !== 0 || !Number.isInteger(major) || major < 21) {
  throw new Error('Firebase emulators require Java 21+. Set JAVA_HOME or extract a portable JDK into .deployment/local-tools/java.');
}

for (const port of [4000, 4400, 4500, 8080, 9099, 9150, 9199]) {
  await new Promise((accept, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`Local emulator port ${port} is already in use. Stop that emulator or app before starting this session.`)));
    server.listen(port, '127.0.0.1', () => server.close(accept));
  });
}

const data = join(root, '.deployment', 'local-firebase-data');
const cache = join(tools, 'emulator-cache');
mkdirSync(cache, { recursive: true });
const environment = {
  ...process.env,
  FIREBASE_EMULATORS_PATH: cache,
  ...(javaHome ? { JAVA_HOME: javaHome, PATH: `${join(javaHome, 'bin')}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}` } : {}),
};
delete environment.GOOGLE_APPLICATION_CREDENTIALS;
delete environment.FIREBASE_TOKEN;
delete environment.FIREBASE_SERVICE_ACCOUNT_JSON;
delete environment.FIREBASE_SERVICE_ACCOUNT_FILE;

const args = [
  cli, 'emulators:start', '--project', 'demo-revsy',
  '--config', join(root, 'firebase', 'local', 'firebase.json'),
  '--only', 'auth,firestore,storage', '--export-on-exit', data,
];
if (existsSync(join(data, 'firebase-export-metadata.json'))) args.push('--import', data);
console.log('Starting local Firebase project demo-revsy. Emulator UI: http://127.0.0.1:4000');
const child = spawn(process.execPath, args, {
  cwd: join(root, 'firebase', 'local'), env: environment, stdio: 'inherit', shell: false,
});
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', (code, signal) => { process.exitCode = signal ? 1 : (code ?? 1); });
process.on('SIGINT', () => {
  // Windows sends console Ctrl+C to both processes. kill('SIGINT') on Windows
  // forcibly terminates the CLI before it can export data and stop its JARs.
  if (process.platform !== 'win32') child.kill('SIGINT');
});
process.on('SIGTERM', () => {
  if (process.platform === 'win32') {
    console.error('Use Ctrl+C in this terminal to export local data and stop the emulators cleanly.');
  } else {
    child.kill('SIGTERM');
  }
});
