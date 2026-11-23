// Dev-time only: MesenCE 2.2.1 (GPL-3.0) for the accurate test tier (PLAN ADR-6). Never shipped, never
// committed: installed in .tmp/tools/mesen (gitignored), portable mode, Lua file access on, one NES pad.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';

export const MESEN = {
  url: 'https://github.com/nesdev-org/MesenCE/releases/download/2.2.1/Mesen_2.2.1_Windows.zip',
  sha256: 'c19e10b3b3865eb0e86e4d01bf09a5027a4452081c04b5bd5b6cbbf76e346fd6',
};

const root = path.resolve(import.meta.dirname, '..');
const dest = process.env.NBF_MESEN_DIR ?? path.join(root, '.tmp', 'tools', 'mesen');
const cachedZip = path.join(root, '.tmp', 'dl', 'mesen.zip');

let zip;
if (existsSync(cachedZip)) zip = readFileSync(cachedZip);
else {
  console.log(`fetch:mesen: downloading ${MESEN.url}`);
  const res = await fetch(MESEN.url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  zip = Buffer.from(await res.arrayBuffer());
}
const got = createHash('sha256').update(zip).digest('hex');
if (got !== MESEN.sha256) {
  console.error(`fetch:mesen: SHA-256 mismatch: ${got}`);
  process.exit(2);
}
mkdirSync(dest, { recursive: true });
for (const [name, data] of Object.entries(unzipSync(new Uint8Array(zip)))) {
  if (name.endsWith('/')) continue;
  const out = path.join(dest, name);
  if (!out.startsWith(dest + path.sep)) throw new Error('unsafe path in zip: ' + name);
  writeFileSync(out, data);
}
// settings.json next to the exe = portable mode (nothing written to Documents). Lua gets file access
// so test scripts can write their results; port 1 gets a standard pad for emu.setInput.
writeFileSync(path.join(dest, 'settings.json'), JSON.stringify({ Debug: { ScriptWindow: { AllowIoOsAccess: true } }, Nes: { Port1: { Type: 'NesController' } } }) + '\n');
console.log(`fetch:mesen: ${path.join(dest, 'Mesen.exe')}`);
