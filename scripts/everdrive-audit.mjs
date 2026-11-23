// node scripts/everdrive-audit.mjs — BLUMEV-M: real-hardware audit of the 3 gift ROMs for an EverDrive (N8 / N8 Pro).
// Mesen 2 copies in .tmp/everdrive/ (dev only, from .tmp/tools/mesen):
//   strict       random internal RAM, random mapper power-on state, random CPU/PPU alignment, PPU $2000/$2006
//                scroll glitches, OAM row corruption, OAM decay, sprite evaluation bug (MMC3 rev B, the default)
//   strict-reva  same + the game database forced read-only with an MMC3A chip entry for each ROM (rev A IRQs:
//                Mesen only takes the chip from its database, and only for iNES 1.0 headers, so the runs use
//                the iNES 1.0 copies of scripts/everdrive-header.mjs, the files that go on the SD card)
//   det-reva     default settings + the MMC3A entries, against the plain .tmp/tools/mesen (rev B): same seed,
//                zero RAM, fixed alignment, so both runs must give the same screen hashes frame for frame
// Each run plays tests/mesen/hw-audit.lua (monkey pad, random WRAM, one soft reset) and must show: 0 MMC3 latch 0,
// banks in range, $8000 mode bits 0, $A001 = $80 only, no write-only/open-bus access, no code below $8000, no
// uninitialised read other than the ones listed in ALLOWED (checked by hand, see the BLUMEV-M report).
//   node scripts/everdrive-audit.mjs [--frames=18000] [--roms=BLUM,SEBRING,LEGEND]
// Output: .tmp/everdrive/audit.json (+ shots). Holds .tmp/gate.lock.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { GIFT_ROMS, ines1Copy, crc32 } from './everdrive-header.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const arg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const FRAMES = Number(arg('frames') ?? 18000);
const only = (arg('roms') ?? 'BLUM,SEBRING,LEGEND').split(',');
const base = path.join(root, '.tmp', 'tools', 'mesen');
const work = path.join(root, '.tmp', 'everdrive');
if (!existsSync(path.join(base, 'Mesen.exe'))) {
  console.error('everdrive-audit: Mesen not found, run `node scripts/fetch-mesen.mjs` (dev only)');
  process.exit(4);
}
const { acquireGateLock, GateBusyError } = require(path.join(root, 'dist', 'electron', 'core', 'gate-lock.js'));
let release = () => {};
try {
  release = await acquireGateLock(path.join(root, '.tmp', 'gate.lock'), 'everdrive-audit');
} catch (e) {
  console.error(e instanceof GateBusyError ? e.message : String(e));
  process.exit(3);
}

const STRICT = {
  Region: 'Ntsc', RamPowerOnState: 'Random', RandomizeMapperPowerOnState: true, RandomizeCpuPpuAlignment: true,
  EnablePpuOamRowCorruption: true, EnablePpu2000ScrollGlitch: true, EnablePpu2006ScrollGlitch: true, EnableOamDecay: true,
  EnablePpuSpriteEvalBug: true, DisablePaletteRead: false, DisablePpu2004Reads: false, DisableOamAddrBug: false, DisableGameDatabase: false,
};
// Uninitialised reads checked by hand (BLUMEV-M report, section audit): key = rom:kind:PC label.
// BLUM reads the live tuning block magic ($7E00-$7E04) before deciding to keep it (soft reset) or copy the ROM
// defaults; LEGEND reads both save slots and checks magic, version and a 16-bit sum before trusting them.
const ALLOWED = {
  BLUM: [{ kind: 'wram', lo: 0x7e00, hi: 0x7e04 }],
  LEGEND: [{ kind: 'wram', lo: 0x6000, hi: 0x61ff }],
  SEBRING: [],
};

const roms = GIFT_ROMS.filter((r) => only.includes(r.id)).map((r) => {
  const src = readFileSync(path.join(root, 'release', 'handover', r.file));
  const ines1 = ines1Copy(src);
  const file = path.join(work, 'roms', `${r.id}.nes`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, ines1);
  const body = ines1.subarray(16);
  return { ...r, path: file, prgBanks: src[4] * 2, chrBanks: src[5] * 8, crcAll: crc32(body), crcPrg: crc32(body.subarray(0, src[4] * 16384)) };
});

function dbLine(crc, r) {
  return `${crc.toString(16).toUpperCase().padStart(8, '0')},NesNtsc,NES-TKROM,,MMC3A,4,${r.prgBanks * 8},${r.chrBanks},0,${r.battery ? 0 : 8},${r.battery ? 8 : 0},${r.battery ? 1 : 0},v,1,,0,,`;
}
function setupMesen(name, settings, reva) {
  const dir = path.join(work, `mesen-${name}`);
  if (!existsSync(path.join(dir, 'Mesen.exe'))) cpSync(base, dir, { recursive: true });
  rmSync(path.join(dir, 'Saves'), { recursive: true, force: true });
  writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ Debug: { ScriptWindow: { AllowIoOsAccess: true } }, Nes: { Port1: { Type: 'NesController' }, ...settings } }));
  const db = path.join(dir, 'MesenNesDB.txt');
  if (existsSync(db)) execFileSync('attrib', ['-R', db]);
  const pristine = readFileSync(path.join(base, 'MesenNesDB.txt'), 'utf8').replace(/\s*$/, '\n');
  writeFileSync(db, reva ? pristine + roms.flatMap((r) => [dbLine(r.crcAll, r), dbLine(r.crcPrg, r)]).join('\n') + '\n' : pristine);
  if (reva) execFileSync('attrib', ['+R', db]); // Mesen re-extracts its database at start unless read-only
  return path.join(dir, 'Mesen.exe');
}
const mesens = {
  strict: setupMesen('strict', STRICT, false),
  'strict-reva': setupMesen('strict-reva', STRICT, true),
  det: setupMesen('det', {}, false),
  'det-reva': setupMesen('det-reva', {}, true),
};

const lua = readFileSync(path.join(root, 'tests', 'mesen', 'hw-audit.lua'), 'utf8');
const fwd = (p) => p.replace(/\\/g, '/');
function run(rom, mode, seed, randomWram) {
  const out = path.join(work, 'runs', `${rom.id}-${mode}-${seed}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  rmSync(out, { force: true });
  const shots = path.join(work, 'shots', `${rom.id}-${mode}-${seed}`);
  mkdirSync(path.dirname(shots), { recursive: true });
  const cfg = `local CFG = { out = "${fwd(out)}", frames = ${FRAMES}, seed = ${seed}, randomWram = ${randomWram}, softReset = true, right = ${rom.id === 'BLUM' ? 60 : 30}, prgBanks = ${rom.prgBanks}, chrBanks = ${rom.chrBanks}, shots = { 600, 3000, ${Math.floor(FRAMES / 2)}, ${FRAMES - 60} }, shotPrefix = "${fwd(shots)}" }\n`;
  const script = path.join(work, 'runs', `hw-audit-${rom.id}-${mode}-${seed}.lua`);
  writeFileSync(script, cfg + lua);
  const exe = mesens[mode];
  const t0 = Date.now();
  const r = spawnSync(exe, ['--testrunner', `--timeout=${Math.ceil(FRAMES / 20) + 120}`, rom.path, script], { cwd: path.dirname(exe), encoding: 'utf8', windowsHide: true, timeout: (Math.ceil(FRAMES / 20) + 200) * 1000 });
  if (r.status !== 0 || !existsSync(out)) throw new Error(`${rom.id} ${mode}: Mesen exit ${r.status} ${r.stdout ?? ''}${r.stderr ?? ''}`);
  const res = JSON.parse(readFileSync(out, 'utf8'));
  res.ms = Date.now() - t0;
  return res;
}

function judge(rom, res) {
  const problems = [];
  const allowed = ALLOWED[rom.id] ?? [];
  const uninit = Object.entries(res.uninit).map(([k, v]) => {
    const [kind, pc, addr] = k.split(':');
    return { kind, pc, addr, ...v };
  });
  const real = uninit.filter((u) => !u.store && !allowed.some((a) => a.kind === u.kind && parseInt(u.addr, 16) >= a.lo && parseInt(u.addr, 16) <= a.hi));
  if (real.length) problems.push(`uninitialised reads: ${real.slice(0, 8).map((u) => `${u.kind} ${u.addr} @${u.pc} bytes ${u.op.toString(16).padStart(6, '0')}`).join(', ')}${real.length > 8 ? ` (+${real.length - 8})` : ''}`);
  if (res.latch0) problems.push(`MMC3 latch 0 written ${res.latch0} times`);
  if (Object.keys(res.badBank).length) problems.push(`banks out of range ${Object.keys(res.badBank).join(' ')}`);
  if (Object.keys(res.mode8000).some((m) => m !== '00')) problems.push(`$8000 mode bits ${Object.keys(res.mode8000).join(' ')}`);
  if (Object.keys(res.a001).some((v) => v !== '80')) problems.push(`$A001 values ${Object.keys(res.a001).join(' ')}`);
  if (res.busCount) problems.push(`bus: ${Object.entries(res.bus).slice(0, 6).map(([k, n]) => `${k} x${n}`).join(', ')}`);
  if (res.ramExec) problems.push(`${res.ramExec} instructions executed below $8000`);
  if (res.nmiGapMax > 120) problems.push(`${res.nmiGapMax} frames without NMI (hang?)`);
  if (res.probeMagic !== rom.magic) problems.push(`probe magic ${JSON.stringify(res.probeMagic)} (crash?)`);
  return { problems, uninitAllowed: uninit.filter((u) => !real.includes(u)).length, uninitStores: uninit.filter((u) => u.store).length };
}

const report = { frames: FRAMES, date: new Date().toISOString(), roms: [], ok: true };
try {
  for (const rom of roms) {
    const entry = { id: rom.id, file: rom.file, crcAll: rom.crcAll.toString(16), runs: [] };
    for (const [mode, seed] of [['strict', 1], ['strict', 2], ['strict-reva', 3]]) {
      const res = run(rom, mode, seed, true);
      const j = judge(rom, res);
      entry.runs.push({ mode, seed, ms: res.ms, lag: res.lag, irqHist: res.irqHist, latches: res.latches, nmiGapMax: res.nmiGapMax, ...j });
      console.log(`${rom.id} ${mode} seed ${seed}: ${j.problems.length ? 'PROBLEMS ' + j.problems.join(' | ') : 'ok'} (${res.ms} ms, irq/frame ${JSON.stringify(res.irqHist)}, lag ${res.lag})`);
      if (j.problems.length) report.ok = false;
    }
    const a = run(rom, 'det', 7, false);
    const b = run(rom, 'det-reva', 7, false);
    const diff = a.hashes.findIndex((h, i) => h !== b.hashes[i]);
    entry.revAB = { hashes: a.hashes.length, firstDiff: diff, same: diff < 0 && a.hashes.length === b.hashes.length, irqA: b.irqHist, irqB: a.irqHist };
    console.log(`${rom.id} det rev B vs rev A: ${entry.revAB.same ? `same ${a.hashes.length} screen hashes` : `DIFFERENT from hash ${diff} (frame ${(diff + 1) * 30})`}`);
    if (!entry.revAB.same) report.ok = false;
    report.roms.push(entry);
  }
} finally {
  release();
}
writeFileSync(path.join(work, 'audit.json'), JSON.stringify(report, null, 1));
console.log(report.ok ? 'everdrive-audit: OK' : 'everdrive-audit: PROBLEMS');
process.exit(report.ok ? 0 : 1);
