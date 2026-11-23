// npm run fetch:toolchain — official cc65 Windows snapshot, SHA-256 pinned (PLAN ADR-10, M2-T1).
// Extracts the NES subset into resources/toolchain/cc65 (gitignored, bundled by M5's packaging).
// The snapshot URL always serves the latest nightly: when it moves on, the SHA check fails and this
// script stops. Keep the pinned zip in resources/cache/ (gitignored) or point NBF_CC65_ZIP at it.
import { spawnSync } from 'node:child_process';
import { unzipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const CC65 = {
  url: 'https://sourceforge.net/projects/cc65/files/cc65-snapshot-win64.zip/download',
  sha256: 'e08ddb2908ceae3ab081aeb9dafd3c0b9f909d47c6e682442d6538b9284ee8da',
  version: 'cc65 V2.19 - Git 8d86ca7',
  licenseUrl: 'https://raw.githubusercontent.com/cc65/cc65/8d86ca7/LICENSE',
};

const root = path.resolve(import.meta.dirname, '..');
const cacheDir = path.join(root, 'resources', 'cache');
const cacheZip = path.join(cacheDir, `cc65-snapshot-win64-${CC65.sha256.slice(0, 12)}.zip`);
const dest = path.join(root, 'resources', 'toolchain', 'cc65');

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed: ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

mkdirSync(cacheDir, { recursive: true });
let zip;
const local = process.env.NBF_CC65_ZIP ?? (existsSync(cacheZip) ? cacheZip : null);
if (local) {
  zip = readFileSync(local);
  console.log(`fetch:toolchain: using ${local}`);
} else {
  console.log(`fetch:toolchain: downloading ${CC65.url}`);
  zip = await download(CC65.url);
}
const got = sha(zip);
if (got !== CC65.sha256) {
  console.error(`fetch:toolchain: SHA-256 mismatch\n  expected ${CC65.sha256}\n  got      ${got}\nThe nightly moved on. Re-pin deliberately (THIRD_PARTY.md + this file) after testing the new snapshot.`);
  process.exit(2);
}
if (!local || local !== cacheZip) writeFileSync(cacheZip, zip);

// extract (fflate, already an app dependency) into a temp folder, then copy the NES subset
const tmp = path.join(root, '.tmp', 'cc65-extract');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
for (const [name, data] of Object.entries(unzipSync(new Uint8Array(zip)))) {
  if (name.endsWith('/')) continue;
  const out = path.join(tmp, name);
  if (!out.startsWith(tmp + path.sep)) throw new Error('unsafe path in zip: ' + name);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, data);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(path.join(dest, 'bin'), { recursive: true });
for (const exe of ['cc65.exe', 'ca65.exe', 'ld65.exe']) cpSync(path.join(tmp, 'bin', exe), path.join(dest, 'bin', exe));
cpSync(path.join(tmp, 'include'), path.join(dest, 'include'), { recursive: true });
cpSync(path.join(tmp, 'asminc'), path.join(dest, 'asminc'), { recursive: true });
mkdirSync(path.join(dest, 'lib'), { recursive: true });
cpSync(path.join(tmp, 'lib', 'nes.lib'), path.join(dest, 'lib', 'nes.lib'));
mkdirSync(path.join(dest, 'cfg'), { recursive: true });
cpSync(path.join(tmp, 'cfg', 'nes.cfg'), path.join(dest, 'cfg', 'nes.cfg'));
rmSync(tmp, { recursive: true, force: true });

const license = path.join(root, 'resources', 'licenses', 'cc65-zlib.txt');
if (!existsSync(license)) {
  mkdirSync(path.dirname(license), { recursive: true });
  writeFileSync(license, await download(CC65.licenseUrl));
}
writeFileSync(path.join(dest, 'VERSION.json'), JSON.stringify({ ...CC65, fetchedAt: new Date().toISOString() }, null, 2) + '\n');

for (const exe of ['cc65', 'ca65', 'ld65']) {
  const r = spawnSync(path.join(dest, 'bin', `${exe}.exe`), ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  const out = `${r.stdout}${r.stderr}`.trim();
  if (r.status !== 0 || !out.includes('V2.19')) throw new Error(`${exe} --version failed: ${out}`);
  console.log(`  ${out}`);
}
console.log(`fetch:toolchain: NES subset in ${dest}`);
