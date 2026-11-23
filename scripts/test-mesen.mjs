// npm run test:mesen — accurate tier (TEST-STRATEGY §1, PLAN ADR-6): MesenCE 2.2.1 headless test runner
// (`--testrunner`, Lua, exit code from emu.stop) on the same ROMs and input policy as the jsnes tier.
// Mesen is a dev-time tool: `node scripts/fetch-mesen.mjs` installs it in .tmp/tools/mesen (portable),
// or set NBF_MESEN to a Mesen.exe whose folder holds a portable settings.json.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const mesen = process.env.NBF_MESEN ?? path.join(root, '.tmp', 'tools', 'mesen', 'Mesen.exe');
if (!existsSync(mesen)) {
  console.error(`test:mesen: Mesen not found (${mesen}). Run \`node scripts/fetch-mesen.mjs\` (dev only).`);
  console.error('Without it, M2-T10 is the manual Conductor check (TEST-STRATEGY §1.1).');
  process.exit(4);
}
const dist = (p) => path.join(root, 'dist', 'electron', 'core', ...p.split('/'));
if (!existsSync(dist('gate-lock.js')) || !existsSync(dist('build/engine-build.js'))) {
  console.error('test:mesen: dist missing, run `npm run build` first');
  process.exit(1);
}
const { acquireGateLock, GateBusyError } = require(dist('gate-lock.js'));
const { buildRom, defaultToolchain } = require(dist('build/engine-build.js'));
const { demoDocs } = require(dist('engine-data/demo.js'));
const { DEFAULT_CARTRIDGE } = require(dist('schema/project.js'));
const { DEFAULT_STORY } = require(dist('schema/story.js'));
const { DEFAULT_PHYSICS } = require(dist('schema/physics.js'));
const { DEFAULT_AUDIO } = require(dist('schema/misc.js'));
const { FEATURE_LEVELS } = require(dist('engine-data/feature-levels.js'));
const { makeSampleBlum } = require(dist('sample/blum.js'));
const { pricesSchema } = require(dist('llm/prices.js'));

const work = path.join(root, '.tmp', 'mesen');
const shots = path.join(work, 'shots');
const DEMO_JUMPS = [230, 300, 360, 490, 640];

function mesenPids() {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='Mesen.exe'\" | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress"], { encoding: 'utf8', windowsHide: true }).trim();
    if (!out) return [];
    return [].concat(JSON.parse(out)).filter((p) => (p.ExecutablePath ?? '').toLowerCase() === path.resolve(mesen).toLowerCase()).map((p) => p.ProcessId);
  } catch {
    return [];
  }
}

function demoProject() {
  return { 'cartridge.json': DEFAULT_CARTRIDGE, 'story.json': { ...DEFAULT_STORY, title: 'BLUM DEMO' }, 'physics.json': DEFAULT_PHYSICS, 'audio/library.json': DEFAULT_AUDIO, ...demoDocs() };
}

function build(name, emit = {}) {
  const r = buildRom({ docs: demoProject(), engineDir: path.join(root, 'engine'), toolchain: defaultToolchain(root), workDir: path.join(work, 'build', name), emit });
  if (!r.ok) throw new Error(`build ${name} failed: ${r.issues.map((i) => i.fr).join(' | ')}`);
  const rom = path.join(work, 'roms', `${name}.nes`);
  mkdirSync(path.dirname(rom), { recursive: true });
  writeFileSync(rom, r.rom);
  return rom;
}

const luaPath = (p) => p.replace(/\\/g, '/');

/** Runs one Lua test in Mesen; returns the parsed result lines. */
function runLua(test, rom, cfg) {
  const runDir = path.join(work, 'run');
  mkdirSync(runDir, { recursive: true });
  const out = path.join(runDir, `${test}-${path.basename(rom, '.nes')}.jsonl`);
  rmSync(out, { force: true });
  const cfgLua = `local CFG = { out = "${luaPath(out)}", shots = "${luaPath(shots)}", jumps = { ${(cfg.jumps ?? []).join(', ')} }, jumpFrames = 22, playFrom = 0, maxFrames = ${cfg.maxFrames}, frames = ${cfg.frames ?? 0}${cfg.extraLua ?? ''} }\n`;
  const lib = readFileSync(path.join(root, 'tests', 'mesen', 'lib.lua'), 'utf8');
  const body = readFileSync(path.join(root, 'tests', 'mesen', `${test}.lua`), 'utf8');
  const script = path.join(runDir, `${test}.lua`);
  writeFileSync(script, `${cfgLua}local R = (function()\n${lib}\nend)()\n${body}\n`);
  const t0 = Date.now();
  const r = spawnSync(mesen, ['--testrunner', `--timeout=${cfg.timeoutS ?? 120}`, rom, script], { cwd: path.dirname(mesen), encoding: 'utf8', timeout: ((cfg.timeoutS ?? 120) + 30) * 1000, windowsHide: true });
  const ms = Date.now() - t0;
  if (r.status !== 0) throw new Error(`${test}: Mesen exit ${r.status} after ${ms} ms ${r.stdout ?? ''}${r.stderr ?? ''}`);
  if (!existsSync(out)) throw new Error(`${test}: no result file`);
  console.log(`  ${test} on ${path.basename(rom)}: ${ms} ms`);
  return readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const BUTTON = { A: 1, B: 2, SELECT: 4, START: 8, UP: 16, DOWN: 32, LEFT: 64, RIGHT: 128 };
const results = [];
function check(id, name, ok, detail) {
  results.push({ id, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name}${detail ? ` — ${detail}` : ''}`);
}

let release = () => {};
try {
  release = await acquireGateLock(path.join(root, '.tmp', 'gate.lock'), 'test:mesen');
} catch (e) {
  console.error(e instanceof GateBusyError ? e.message : String(e));
  process.exit(3);
}
const before = new Set(mesenPids());
try {
  mkdirSync(shots, { recursive: true });
  // NBF_MESEN_ONLY=<trace name>: only that M6 trace (used while choosing a stage script)
  const only = process.env.NBF_MESEN_ONLY ?? '';
  if (!only) {
  const demo = build('demo');
  const stress = build('demo-stress', { bankStress: true });

  // M2-T10
  const t10 = runLua('m2-t10', demo, { jumps: DEMO_JUMPS, maxFrames: 1500 });
  const s = t10.find((l) => l.kind === 'summary');
  const v = t10.filter((l) => l.kind === 'violation');
  check('M2-T10', 'boot to title', s.titleMagic === 'BLUM' && s.titleState === 1, `magic ${s.titleMagic}, state ${s.titleState}`);
  check('M2-T10', 'Start -> play', s.playAt > 0, `play at frame ${s.playAt}`);
  check('M2-T10', 'probe frame counter advances', s.frameAt300 - s.frameAt200 === 100, `${s.frameAt200} -> ${s.frameAt300}`);
  check('M2-T10', 'no PPU write while rendering', s.violations === 0 && s.checked > 0, `${s.violations} of ${s.checked} writes${v.length ? ' ' + JSON.stringify(v) : ''}`);
  check('M2-T10', 'demo stage cleared, 0 lag frames (same outcome as jsnes)', s.endState === 5 && s.lag === 0, `end state ${s.endState}, event ${s.endEvent}, x ${s.endX}, lag ${s.lag}`);

  // M2-T16
  const FRAMES = 600;
  const normal = runLua('m2-t16', demo, { jumps: DEMO_JUMPS, maxFrames: 2000, frames: FRAMES });
  const stressed = runLua('m2-t16', stress, { jumps: DEMO_JUMPS, maxFrames: 2000, frames: FRAMES });
  const nf = normal.filter((l) => l.kind === 'f');
  const sf = stressed.filter((l) => l.kind === 'f');
  const lines = nf.flatMap((f) => f.s);
  const perFrame2005 = nf.every((f) => f.s.length === 2);
  const minL = Math.min(...lines);
  const maxL = Math.max(...lines);
  check('M2-T16', 'HUD split scanline stable over 600 frames', nf.length === FRAMES && perFrame2005 && maxL - minL <= 1, `${nf.length} frames, $2005 on lines ${minL}-${maxL}`);
  const chr = nf.flatMap((f) => f.c);
  const chrOk = chr.length === FRAMES && chr.every((c) => Math.floor(c / 1000) === 31 && c % 1000 >= 257 && c % 1000 <= 320);
  check('M2-T16', 'BG bank switch inside line 31 hblank (dots 257-320)', chrOk, `${Math.min(...chr.map((c) => c % 1000))}-${Math.max(...chr.map((c) => c % 1000))}`);
  const errs = sf.reduce((m, f) => Math.max(m, f.err), 0);
  check('M2-T16', 'bank-stress ROM: no bank mismatch seen by the main loop', sf.length === FRAMES && errs === 0, `${errs} errors`);
  const silent = (fr) => {
    for (let i = 0; i + 60 <= fr.length; i += 60) if (fr.slice(i, i + 60).reduce((n, f) => n + f.a, 0) === 0) return i;
    return -1;
  };
  check('M2-T16', 'music keeps playing under bank stress (APU writes every second)', silent(sf) < 0 && silent(nf) < 0, `${sf.reduce((n, f) => n + f.a, 0)} APU writes`);
  const firstDiff = nf.findIndex((f, i) => sf[i]?.h !== f.h);
  check('M2-T16', 'bank-stress ROM frames identical to the normal ROM', firstDiff < 0, firstDiff < 0 ? `${FRAMES} frames` : `first difference at play frame ${firstDiff}`);
  const lag = Math.max(...nf.map((f) => f.lag), ...sf.map((f) => f.lag));
  check('M2-T16', '0 lag frames on both ROMs', lag === 0, `max lag ${lag}`);

  for (const f of ['mesen-title.png', 'mesen-play.png']) if (existsSync(path.join(shots, f))) copyFileSync(path.join(shots, f), path.join(work, f));

  // M4-T11: replay the jsnes feature-level traces (written by `npm run test:engine`, tests/engine/m4-engine.test.ts)
  const traceDir = path.join(root, '.tmp', 'm4-traces');
  const traces = existsSync(traceDir) ? readdirSync(traceDir).filter((f) => f.endsWith('.json')).sort() : [];
  check('M4-T11', 'feature-level traces present (run test:engine first)', traces.length >= 11, `${traces.length} traces`);
  for (const file of traces) {
    const t = JSON.parse(readFileSync(path.join(traceDir, file), 'utf8'));
    const r = buildRom({ docs: FEATURE_LEVELS[t.name](), engineDir: path.join(root, 'engine'), toolchain: defaultToolchain(root), workDir: path.join(work, 'build', `m4-${t.name}`) });
    if (!r.ok) throw new Error(`build ${t.name} failed: ${r.issues.map((i) => i.fr).join(' | ')}`);
    const sha = createHash('sha1').update(r.rom).digest('hex');
    if (sha !== t.romSha1) {
      check('M4-T11', `${t.name}: same ROM as the jsnes run`, false, 'trace is stale: run npm run test:engine first');
      continue;
    }
    const rom = path.join(work, 'roms', `m4-${t.name}.nes`);
    writeFileSync(rom, r.rom);
    const entries = [];
    for (const run of t.inputs) {
      const m = run.b.reduce((acc, b) => acc | BUTTON[b], 0);
      if (m) for (let k = 0; k < run.n; k++) entries.push(`[${run.f + k}]=${m}`);
    }
    const shot = path.join(shots, `mesen-m4-${t.name}.png`);
    const out = runLua('m4-replay', rom, { maxFrames: t.frames + 600, timeoutS: 120, extraLua: `, replay = true, endFrame = ${t.endFrame}, shot = "${luaPath(shot)}", inputs = { ${entries.join(', ')} }` });
    const end = out.find((l) => l.kind === 'end');
    const keys = ['state', 'event', 'hp', 'lives', 'px', 'py', 'bossHp', 'enemies', 'kills', 'bossPhase'];
    const diff = keys.filter((k) => end?.[k] !== t.end[k]);
    const lagOk = t.name === 'stress' ? true : (end?.lag ?? 1) === 0;
    check('M4-T11', `${t.name}: same probe outcome as jsnes`, !!end && diff.length === 0 && lagOk, end ? (diff.length ? diff.map((k) => `${k} mesen ${end[k]} jsnes ${t.end[k]}`).join(', ') : `state ${end.state} event ${end.event} hp ${end.hp} x ${end.px}, lag ${end.lag}`) : 'no end line');
    if (existsSync(shot)) copyFileSync(shot, path.join(work, `mesen-m4-${t.name}.png`));
  }
  }

  // M6-T8: BLUM.nes, every stage script and the cheat run (jsnes traces from tests/engine/m6-blum.test.ts)
  const m6Dir = path.join(root, '.tmp', 'm6-traces');
  const m6 = existsSync(m6Dir) ? readdirSync(m6Dir).filter((f) => f.endsWith('.json') && (!only || f === `${only}.json`)).sort() : [];
  if (!only) check('M6-T8', 'BLUM traces present (9 stages + cheat run; run test:engine first)', m6.length >= 10, `${m6.length} traces`);
  if (m6.length) {
    const prices = pricesSchema.parse(JSON.parse(readFileSync(path.join(root, 'config', 'prices.json'), 'utf8')));
    const blumDir = path.join(work, 'blum-project');
    rmSync(blumDir, { recursive: true, force: true });
    const { store } = await makeSampleBlum(path.join(blumDir, 'BLUM.blum'), prices);
    const docs = store.docs();
    const assets = store.assets();
    store.close();
    for (const file of m6) {
      const t = JSON.parse(readFileSync(path.join(m6Dir, file), 'utf8'));
      const emit = t.cheat ? { testCheats: true } : { startLevel: t.startLevel };
      const r = buildRom({ docs, assets, engineDir: path.join(root, 'engine'), toolchain: defaultToolchain(root), workDir: path.join(work, 'build', t.name), emit });
      if (!r.ok) throw new Error(`build ${t.name} failed: ${r.issues.map((i) => i.fr).join(' | ')}`);
      if (createHash('sha1').update(r.rom).digest('hex') !== t.romSha1) {
        check('M6-T8', `${t.name}: same ROM as the jsnes run`, false, 'trace is stale: run npm run test:engine first');
        continue;
      }
      const rom = path.join(work, 'roms', `${t.name}.nes`);
      mkdirSync(path.dirname(rom), { recursive: true });
      writeFileSync(rom, r.rom);
      const entries = [];
      for (const run of t.inputs) {
        const m = run.b.reduce((acc, b) => acc | BUTTON[b], 0);
        if (m) for (let k = 0; k < run.n; k++) entries.push(`[${run.f + k}]=${m}`);
      }
      const shot = path.join(shots, `mesen-${t.name}.png`);
      if (t.cheat) {
        const out = runLua('m6-cheat', rom, { maxFrames: t.frames + 3000, timeoutS: 240, extraLua: `, shot = "${luaPath(shot)}", inputs = { ${entries.join(', ')} }` });
        const end = out.find((l) => l.kind === 'end');
        check('M6-T8', 'cheat run reaches the ending (state 7), as in jsnes', end?.state === 7, end ? `state ${end.state}, probe frame ${end.frame} (jsnes ${t.endFrame}), lag ${end.lag}` : 'no end line');
      } else {
        const out = runLua('m4-replay', rom, { maxFrames: t.frames + 600, timeoutS: 180, extraLua: `, replay = true, endFrame = ${t.endFrame}, shot = "${luaPath(shot)}", inputs = { ${entries.join(', ')} }` });
        const end = out.find((l) => l.kind === 'end');
        const keys = ['state', 'event', 'hp', 'lives', 'px', 'bossHp', 'kills'];
        const diff = keys.filter((k) => end?.[k] !== t.end[k]);
        check('M6-T8', `${t.name}: same probe outcome as jsnes, 0 lag`, !!end && diff.length === 0 && end.lag === 0, end ? (diff.length ? diff.map((k) => `${k} mesen ${end[k]} jsnes ${t.end[k]}`).join(', ') : `state ${end.state} event ${end.event} hp ${end.hp} x ${end.px}, lag ${end.lag}`) : 'no end line');
      }
      if (existsSync(shot)) copyFileSync(shot, path.join(work, `mesen-${t.name}.png`));
    }
  }
} catch (e) {
  console.error(String(e?.stack ?? e));
  results.push({ id: 'run', ok: false });
} finally {
  for (const pid of mesenPids()) {
    if (!before.has(pid)) {
      console.error(`test:mesen: killing leftover Mesen pid ${pid}`);
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    }
  }
  release();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`test:mesen: ${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
