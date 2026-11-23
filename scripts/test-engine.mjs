// npm run test:engine — engine tier (TEST-STRATEGY §1): real cc65 builds + headless jsnes runs.
// Holds .tmp/gate.lock for the whole run (one heavy job at a time on box-01).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const gateLockJs = path.join(root, 'dist', 'electron', 'core', 'gate-lock.js');
if (!existsSync(gateLockJs)) {
  const tsc = spawnSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-b'], { cwd: root, stdio: 'inherit' });
  if (tsc.status !== 0) process.exit(tsc.status ?? 1);
}
const { acquireGateLock, GateBusyError } = require(gateLockJs);

if (!existsSync(path.join(root, 'resources', 'toolchain', 'cc65', 'bin', 'cc65.exe'))) {
  console.error('test:engine: cc65 missing, run `npm run fetch:toolchain` first');
  process.exit(1);
}

let release = () => {};
try {
  release = await acquireGateLock(path.join(root, '.tmp', 'gate.lock'), 'test:engine');
} catch (e) {
  console.error(e instanceof GateBusyError ? e.message : String(e));
  process.exit(3);
}
let code = 1;
try {
  const vitest = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
  const r = spawnSync(process.execPath, [vitest, 'run', '--config', 'vitest.engine.config.mts', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
  code = r.status ?? 1;
} finally {
  release();
}
process.exit(code);
