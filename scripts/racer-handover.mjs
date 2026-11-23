// npm run racer:handover (BLUMR-M2): the SEBRING release ROM and its cartridge sheets, with the same export
// code as BLUM (src/core/build/export.ts): release/handover/SEBRING.nes, SEBRING-PRG.bin, SEBRING-CHR.bin,
// « SEBRING - fiche cartouche.html », « SEBRING - cartridge sheet.html », SEBRING.dbg, plus the 5 tracks
// (SEBRING-pistes.json, the JSON the app loads), and the same ROM + tracks in resources/samples/SEBRING. Notices: only what the racer ROM contains (FamiStudio sound
// engine; the racer is pure ca65, no neslib / nesdoug / cc65 runtime, RACER-PLAN 9.1).
// Builds twice and refuses to write unless both builds are byte-identical (M2-T4). Holds .tmp/gate.lock.
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
const { buildRacer, readTrackFiles } = require(dist('racer/build-racer.js'));
const { exportFiles, loadNotices } = require(dist('build/export.js'));
const { sebringSample } = require(dist('racer/sebring-sample.js'));

let release = () => {};
try {
  release = await acquireGateLock(path.join(root, '.tmp', 'gate.lock'), 'racer:handover');
} catch (e) {
  console.error(e instanceof GateBusyError ? e.message : String(e));
  process.exit(3);
}
let code = 1;
try {
  const build = (n) => {
    const b = buildRacer(path.join(root, 'racer'), path.join(root, 'engine'), defaultToolchain(root), path.join(root, '.tmp', 'racer-handover', `build-${n}`));
    if (!b.ok) throw new Error('racer build failed\n' + b.log);
    return b;
  };
  const a = build(1);
  const b = build(2);
  if (!Buffer.from(a.rom).equals(Buffer.from(b.rom))) throw new Error('two builds differ: not byte-identical');
  const notices = loadNotices(path.join(root, 'resources', 'licenses')).filter((n) => n.name.startsWith('FamiStudio'));
  const dbg = readFileSync(path.join(root, '.tmp', 'racer-handover', 'build-1', 'sebring.dbg'), 'utf8');
  const out = exportFiles({ title: 'SEBRING', rom: a.rom, notices, appVersion: pkg.version, dbg });
  const hand = path.join(root, 'release', 'handover');
  mkdirSync(hand, { recursive: true });
  for (const f of out.files) writeFileSync(path.join(hand, f.name), f.bytes);
  const sample = JSON.stringify(sebringSample(readTrackFiles(path.join(root, 'racer'))), null, 2) + '\n';
  writeFileSync(path.join(hand, 'SEBRING-pistes.json'), sample);
  // the app's « Jeu d'exemple SEBRING » (resources/samples/SEBRING, shipped by electron-builder)
  const appSample = path.join(root, 'resources', 'samples', 'SEBRING');
  mkdirSync(appSample, { recursive: true });
  writeFileSync(path.join(appSample, 'SEBRING.nes'), a.rom);
  writeFileSync(path.join(appSample, 'SEBRING-pistes.json'), sample);
  const nes = out.facts.files[0];
  console.log(`racer:handover: ${out.files.length + 1} files -> ${path.relative(root, hand)}; SEBRING.nes ${nes.bytes} bytes, CRC32 ${nes.crc32}, SHA-1 ${nes.sha1}; kit ${a.assets.kitSource}`);
  code = 0;
} catch (e) {
  console.error(String(e?.stack ?? e));
} finally {
  release();
}
process.exit(code);
