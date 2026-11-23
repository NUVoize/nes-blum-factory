// npm run legend:handover (BLUMZ-M1): THE LEGEND OF BLUM vertical slice ROM and its cartridge sheets, with
// the same export code as BLUM and SEBRING (src/core/build/export.ts): release/handover/LEGEND-OF-BLUM-SLICE.nes,
// -PRG.bin, -CHR.bin, « fiche cartouche », « cartridge sheet », .dbg, and (BLUMZ-F2) the same ROM in
// resources/samples/LEGEND for the app's « Jeu d'exemple THE LEGEND OF BLUM (début) » (the gift's « Jeu LEGEND OF
// BLUM » folder copies the handover files, scripts/gift.mjs). Notices: only what the ROM contains
// (FamiStudio sound engine; the RPG engine is pure ca65, no neslib / nesdoug / cc65 runtime).
// Builds twice and refuses to write unless both builds are byte-identical. Holds .tmp/gate.lock.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const tsc = spawnSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-b'], { cwd: root, stdio: 'inherit' });
if (tsc.status !== 0) process.exit(tsc.status ?? 1);
const dist = (p) => path.join(root, 'dist', 'electron', 'core', ...p.split('/'));
const { acquireGateLock, GateBusyError } = require(dist('gate-lock.js'));
const { defaultToolchain } = require(dist('build/engine-build.js'));
const { buildLegend } = require(dist('rpg/legend/build.js'));
const { exportFiles, loadNotices } = require(dist('build/export.js'));

const SLICE_TITLE = 'LEGEND-OF-BLUM-SLICE';

let release = () => {};
try {
  release = await acquireGateLock(path.join(root, '.tmp', 'gate.lock'), 'legend:handover');
} catch (e) {
  console.error(e instanceof GateBusyError ? e.message : String(e));
  process.exit(3);
}
let code = 1;
try {
  const build = (n) => {
    const b = buildLegend(path.join(root, 'rpg'), path.join(root, 'engine'), defaultToolchain(root), path.join(root, '.tmp', 'legend-handover', `build-${n}`));
    if (!b.ok) throw new Error('legend build failed\n' + b.log);
    return b;
  };
  const a = build(1);
  const b = build(2);
  if (!Buffer.from(a.rom).equals(Buffer.from(b.rom))) throw new Error('two builds differ: not byte-identical');
  const notices = loadNotices(path.join(root, 'resources', 'licenses')).filter((n) => n.name.startsWith('FamiStudio'));
  const dbg = readFileSync(path.join(root, '.tmp', 'legend-handover', 'build-1', 'legend.dbg'), 'utf8');
  const out = exportFiles({ title: SLICE_TITLE, rom: a.rom, notices, appVersion: pkg.version, dbg });
  const hand = path.join(root, 'release', 'handover');
  mkdirSync(hand, { recursive: true });
  for (const f of out.files) writeFileSync(path.join(hand, f.name), f.bytes);
  // the app's sample (resources/samples/LEGEND, shipped by electron-builder)
  const appSample = path.join(root, 'resources', 'samples', 'LEGEND');
  mkdirSync(appSample, { recursive: true });
  writeFileSync(path.join(appSample, `${SLICE_TITLE}.nes`), a.rom);
  const nes = out.facts.files[0];
  console.log(`legend:handover: ${out.files.length} files -> ${path.relative(root, hand)}; ${nes.name} ${nes.bytes} bytes, CRC32 ${nes.crc32}, SHA-1 ${nes.sha1}`);
  code = 0;
} catch (e) {
  console.error(String(e?.stack ?? e));
} finally {
  release();
}
process.exit(code);
