// Headless smoke (TEST-STRATEGY §4): launch the built app in a hidden window per locale, check every
// route, write one PNG per route, then prove no Electron process from this repo is left (M1-T12).
//   node scripts/smoke.mjs [--routes=title,hub] [--locale=fr|en|both] [--no-flow]
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, '.tmp', 'smoke');
const DEFAULT_ROUTES = [
  'title',
  'cartridges',
  'hub',
  'director/story',
  'director/visual',
  'director/movement',
  'director/movement?tab=enemies',
  'director/movement?tab=bosses',
  'director/level',
  'director/build',
  'director/build?fix=1',
  'settings',
  'history',
  'gallery',
  'play',
  'play?tune=1',
  'help',
  'first',
  'sample',
];

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const routes = (arg('routes') ?? DEFAULT_ROUTES.join(',')).split(',');
const localeArg = arg('locale') ?? 'fr';
const locales = localeArg === 'both' ? ['fr', 'en'] : [localeArg];
const flow = !process.argv.includes('--no-flow');

const gateLockJs = path.join(root, 'dist', 'electron', 'core', 'gate-lock.js');
if (!existsSync(path.join(root, 'dist', 'electron', 'main', 'main.js')) || !existsSync(gateLockJs)) {
  console.error('smoke: dist missing, run `npm run build` first');
  process.exit(1);
}
const { acquireGateLock, GateBusyError } = require(gateLockJs);

/** Electron processes whose executable lives in this repo's node_modules. */
function repoElectronPids() {
  const exeDir = path.dirname(electronPath).toLowerCase();
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress"],
      { encoding: 'utf8', windowsHide: true },
    ).trim();
    if (!out) return [];
    const list = [].concat(JSON.parse(out));
    return list.filter((p) => (p.ExecutablePath ?? '').toLowerCase().startsWith(exeDir)).map((p) => p.ProcessId);
  } catch {
    return [];
  }
}

function runOnce(locale) {
  const home = path.join(outDir, `home-${locale}`);
  rmSync(home, { recursive: true, force: true }); // our own temp profile from the previous run
  mkdirSync(home, { recursive: true });
  const out = path.join(outDir, `smoke-${locale}.json`);
  rmSync(out, { force: true });
  const args = ['.', `--smoke=${out}`, `--smoke-home=${home}`, `--smoke-route=${routes.join(',')}`, `--smoke-locale=${locale}`];
  if (flow) args.push('--smoke-flow');
  return new Promise((resolve) => {
    const child = spawn(electronPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
    const killer = setTimeout(() => {
      console.error('smoke: hard timeout, killing electron');
      child.kill();
    }, 180_000);
    child.on('exit', (code) => {
      clearTimeout(killer);
      const result = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { ok: false, error: 'no result file' };
      resolve({ locale, code, result });
    });
  });
}

let release = () => {};
try {
  release = await acquireGateLock(path.join(root, '.tmp', 'gate.lock'), 'smoke');
} catch (e) {
  console.error(e instanceof GateBusyError ? e.message : String(e));
  process.exit(3);
}

let allOk = true;
try {
  mkdirSync(outDir, { recursive: true });
  for (const locale of locales) {
    const { code, result } = await runOnce(locale);
    const ok = result.ok === true && code === 0;
    allOk &&= ok;
    console.log(`smoke[${locale}]: ${ok ? 'OK' : 'FAIL'} exit ${code}`);
    if (result.flow) console.log(`  flow: ${result.flow.steps.join(' ')}`);
    for (const r of result.routes ?? []) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.route} -> ${path.relative(root, r.png ?? '')} ${r.problems.join('; ')}`);
    if (result.keyApi) console.log(`  key api: ${result.keyApi.ok ? 'ok' : 'FAIL'} ${JSON.stringify(result.keyApi.keys)}`);
    if (result.consoleErrors?.length) console.log(`  console errors: ${JSON.stringify(result.consoleErrors)}`);
    if (result.error) console.log(`  error: ${result.error}`);
  }

  // M1-T12: process hygiene. Give Chromium helpers a moment to exit, then check.
  let left = repoElectronPids();
  for (let i = 0; i < 20 && left.length; i++) {
    await new Promise((r) => setTimeout(r, 500));
    left = repoElectronPids();
  }
  if (left.length) {
    allOk = false;
    console.error(`smoke: FAIL electron processes left behind: ${left.join(', ')} (killing them)`);
    for (const pid of left) {
      try {
        process.kill(pid);
      } catch {
        /* already gone */
      }
    }
  } else console.log('smoke: no electron process left (M1-T12 ok)');
} finally {
  release();
}
process.exit(allOk ? 0 : 1);
