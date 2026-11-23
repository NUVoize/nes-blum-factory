// npm run package (PLAN §8, M5-T5): build, electron-builder `dir` for win-x64, then
// release/NES BLUM FACTORY/ zipped as release/NES-BLUM-FACTORY-<version>-win-x64.zip.
// Holds .tmp/gate.lock (one heavy job at a time on box-01).
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const release = path.join(root, 'release');
const folderName = pkg.productName;
const zipName = `NES-BLUM-FACTORY-${pkg.version}-win-x64.zip`;

const step = (label, cmd, args) => {
  console.log(`package: ${label}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (r.status !== 0) {
    console.error(`package: ${label} failed (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
};

if (!existsSync(path.join(root, 'resources', 'toolchain', 'cc65', 'bin', 'cc65.exe'))) {
  console.error('package: cc65 missing, run `npm run fetch:toolchain` first');
  process.exit(1);
}

const gateLockJs = path.join(root, 'dist', 'electron', 'core', 'gate-lock.js');
if (!existsSync(gateLockJs)) step('tsc -b', process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-b']);
const { acquireGateLock, GateBusyError } = require(gateLockJs);
let release_ = () => {};
try {
  release_ = await acquireGateLock(path.join(root, '.tmp', 'gate.lock'), 'package');
} catch (e) {
  console.error(e instanceof GateBusyError ? e.message : String(e));
  process.exit(3);
}

try {
  step('licences', process.execPath, [path.join(root, 'scripts', 'collect-licenses.mjs')]);
  step('tsc -b', process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-b']);
  step('vite build', process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', 'vite.config.mts']);
  // our own previous build outputs (release/ is gitignored and rebuilt every time)
  rmSync(path.join(release, 'builder'), { recursive: true, force: true });
  step('electron-builder', process.execPath, [path.join(root, 'node_modules', 'electron-builder', 'cli.js'), '--win', 'dir', '--x64', '--config', 'electron-builder.yml', '--publish', 'never']);
  const unpacked = path.join(release, 'builder', 'win-unpacked');
  const folder = path.join(release, folderName);
  rmSync(folder, { recursive: true, force: true });
  renameSync(unpacked, folder);
  const zip = path.join(release, zipName);
  rmSync(zip, { force: true });
  // Windows' bsdtar writes zip archives (-a picks the format from the .zip extension)
  execFileSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', zip, '-C', release, folderName], { stdio: 'inherit', windowsHide: true });
  // handover (MILESTONES M6): the one-page French guide sits next to the zip (read it before extracting)
  const hand = path.join(release, 'handover');
  mkdirSync(hand, { recursive: true });
  copyFileSync(path.join(root, 'docs', 'GUIDE-BLUM.html'), path.join(hand, 'Guide pour Blum.html'));
  const mb = (n) => `${(n / 1048576).toFixed(1)} MiB`;
  console.log(`package: OK ${path.relative(root, zip)} (${mb(statSync(zip).size)})`);
} finally {
  release_();
}
