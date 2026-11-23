// npm run test:racer-mesen — SEBRING racer (BLUMR-M1, docs/RACER-PLAN.md M1-T6), accurate tier.
// Builds the racer ROM, plays the whole game with the race bot in jsnes (title -> 5 stages -> ending ->
// credits -> title), then replays it in Mesen with the same bot (tests/mesen/racer-m1.lua) and checks:
// every kernel write in hblank on the flat / max uphill / crest / hardest-curve frame of each stage, the
// HUD split line, the same outcome per stage as jsnes, 0 lag, free CPU, 0 Mesen process left.
// BLUMR-M2: the same checks on the A1 art + real-route stages (M2-T1, M2-T2: no cheats, at most 1 continue).
// BLUMR-FIX (BLUMR-W F4): a second pass with the crash bot on stage 1 (spins, flips, recoveries): same crashes
// as jsnes, kernel writes in hblank during a crash, 0 lag.
// Holds .tmp/gate.lock (one heavy job at a time).   node scripts/racer-mesen.mjs [--publish] [--tag=BLUMR-M2]
// Output: .tmp/racer-mesen/ (rom, shots, report.json); --publish copies shots + report to
// runs/reports/<tag>-* (default tag BLUMR-M1).
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const tag = args.find((a) => a.startsWith('--tag='))?.slice(6) ?? 'BLUMR-M1';
const jsnes = await import(pathToFileURL(path.join(root, 'node_modules', 'jsnes', 'src', 'index.js')).href);

const tsc = spawnSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-b'], { cwd: root, stdio: 'inherit' });
if (tsc.status !== 0) process.exit(tsc.status ?? 1);
const dist = (p) => path.join(root, 'dist', 'electron', 'core', ...p.split('/'));
const { acquireGateLock, GateBusyError } = require(dist('gate-lock.js'));
const { defaultToolchain } = require(dist('build/engine-build.js'));
const { buildRacer } = require(dist('racer/build-racer.js'));
const { readRacerProbe, racerBot, racerFreeCycles } = require(dist('racer/racer-run.js'));
const { RomHarness } = require(dist('emu/harness.js'));
const { encodePng, decodePng } = require(dist('util/png.js'));

const MAX_FRAMES = 40000; // BLUMR-M2 real-route stages: about 32 000 frames for the whole game
const CRASH_STOP = 8; // crash pass: back on the road after this many crashes
const CRASH_MAX = 12000;
const FREE_MIN = 2000;
const work = path.join(root, '.tmp', 'racer-mesen');
const shots = path.join(work, 'shots');
const reports = path.resolve(root, '..', '..', '..', 'CODEX', 'NOVA-COCKPIT', 'runs', 'reports');
const mesen = process.env.NBF_MESEN ?? path.join(root, '.tmp', 'tools', 'mesen', 'Mesen.exe');
if (!existsSync(mesen)) {
  console.error(`racer-mesen: Mesen not found (${mesen}): node scripts/fetch-mesen.mjs`);
  process.exit(1);
}

let release = () => {};
try {
  release = await acquireGateLock(path.join(root, '.tmp', 'gate.lock'), 'racer-mesen');
} catch (e) {
  console.error(e instanceof GateBusyError ? e.message : String(e));
  process.exit(3);
}

const checks = [];
const check = (id, what, ok, detail) => {
  checks.push({ id, what, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${what}: ${detail}`);
};
const report = {};
let exitCode = 0;
try {
  rmSync(shots, { recursive: true, force: true });
  mkdirSync(shots, { recursive: true });
  const b = buildRacer(path.join(root, 'racer'), path.join(root, 'engine'), defaultToolchain(root), path.join(work, 'build'));
  if (!b.ok) throw new Error('racer build failed\n' + b.log);
  const romPath = path.join(work, 'sebring.nes');
  writeFileSync(romPath, b.rom);

  // ---- jsnes: the reference run, and the frames to look at ----
  const h = new RomHarness(jsnes, b.rom);
  let p = readRacerProbe(h.s.mem);
  const clears = [];
  const ext = new Map(); // stage -> { flat, up, crest, curve } first frames
  let minFree = Infinity;
  let f = 0;
  const t0 = Date.now();
  for (f = 1; f <= MAX_FRAMES; f++) {
    h.step(1, racerBot(p));
    const prev = p;
    p = readRacerProbe(h.s.mem);
    if (p.clears !== prev.clears) clears.push({ stage: p.stage, time: p.time, crashes: p.crashes, game: p.frame, frame: f, lag: p.lag });
    if (p.nmiMode === 2 && p.state >= 3 && p.state <= 6) {
      minFree = Math.min(minFree, racerFreeCycles(p.idle));
      if (p.state === 3) {
        const e = ext.get(p.stage) ?? { flat: null, up: { v: 0, f: null }, crest: { v: 0, f: null }, curve: { v: 0, f: null } };
        // game frames (the probe's counter): emulator frame numbers may drift by a frame or two between
        // emulators at each load (vblank polling), the game frames do not
        const g = p.frame;
        if (e.flat === null && p.hill === 0 && p.curve === 0 && p.speed > 100) e.flat = g;
        if (p.hill > e.up.v) e.up = { v: p.hill, f: g };
        if (p.hill < e.crest.v) e.crest = { v: p.hill, f: g };
        if (Math.abs(p.curve) > Math.abs(e.curve.v)) e.curve = { v: p.curve, f: g };
        ext.set(p.stage, e);
      }
    }
    if (p.titles >= 2) break;
  }
  const jsEnd = p;
  report.jsnes = { frames: f, ms: Date.now() - t0, clears, lag: p.lag, freeMin: Math.min(minFree, racerFreeCycles(p.idleMin)) };
  console.log(`jsnes: ${f} frames, stages cleared ${clears.length}, lag ${p.lag}, free CPU min ${report.jsnes.freeMin}`);

  // game frames: Mesen logs the kernel writes and takes the shot 2 emulator frames after it sees them
  const logFrames = [];
  const shotFrames = [{ name: 'title', frame: 8 }];
  for (const [stage, e] of [...ext.entries()].sort((a, b) => a[0] - b[0])) {
    const add = (kind, frame) => {
      if (frame === null) return;
      logFrames.push(frame);
      shotFrames.push({ name: `s${stage + 1}-${kind}`, frame });
    };
    add('flat', e.flat);
    add('uphill', e.up.f);
    add('crest', e.crest.f);
    add('curve', e.curve.f);
  }
  shotFrames.push({ name: 'card', frame: (clears[0]?.game ?? 0) + 30 });
  shotFrames.push({ name: 'ending', frame: (clears.at(-1)?.game ?? 0) + 120 });
  shotFrames.push({ name: 'ending-fireworks', frame: (clears.at(-1)?.game ?? 0) + 150 });
  report.logFrames = logFrames;

  // ---- Mesen ----
  const { lines, ms, left } = runMesen(romPath, 'mesen', `maxFrames = ${MAX_FRAMES}, logFrames = { ${logFrames.join(', ')} }, shotFrames = { ${shotFrames.map((s) => `{ name = "${s.name}", frame = ${s.frame} }`).join(', ')} }`);
  const end = lines.find((l) => l.kind === 'end');
  const mClears = lines.filter((l) => l.kind === 'clear');
  const timing = lines.filter((l) => l.kind === 'writes').map((l) => ({ stage: l.stage, hill: l.hill, curve: l.curve, ...analyzeWrites(l) }));
  report.mesen = { ms, frames: end?.f, clears: mClears.map(({ stage, time, crashes, game, frame, lag }) => ({ stage, time, crashes, game, frame, lag })), lag: end?.lag, freeMin: end ? Math.min(end.minFree, racerFreeCycles(end.idleMin)) : null, processesLeft: left.length, timing };
  console.log(`Mesen: ${end?.f} frames in ${ms} ms`);
  for (const t of timing) console.log(`  frame ${t.frame} stage ${t.stage + 1} hill ${t.hill} curve ${t.curve}: ${t.kernelLines} kernel lines ${t.firstLine}-${t.lastLine}, W3 dots ${t.w3[0]}-${t.w3[1]}, W4 ${t.w4[0]}-${t.w4[1]}, R0 ${t.bank[0]}-${t.bank[1]}, hblank ok ${t.hblankOk}, HUD split line ${t.hudLine} dot ${t.hudDot}`);

  const stagesSeen = new Set(timing.map((t) => t.stage));
  check('M1-T6', 'kernel writes inside hblank (257-320) on flat, uphill, crest and hardest-curve frames of every stage', timing.length === logFrames.length && stagesSeen.size === 5 && timing.every((t) => t.hblankOk && t.kernelLines >= 100), `${timing.length}/${logFrames.length} frames logged, stages ${[...stagesSeen].map((s) => s + 1).join(',')}, all in hblank: ${timing.every((t) => t.hblankOk)}, W3 dots ${Math.min(...timing.map((t) => t.w3[0]))}-${Math.max(...timing.map((t) => t.w3[1]))}, R0 dots ${Math.min(...timing.map((t) => t.bank[0]))}-${Math.max(...timing.map((t) => t.bank[1]))}`);
  check('M1-T6', 'HUD split (IRQ #1) on the plain sky line 15-16, inside dots 0-90', timing.every((t) => t.hudLine >= 15 && t.hudLine <= 16 && t.hudDot <= 90), timing.map((t) => `${t.hudLine}:${t.hudDot}`).join(' '));
  const sameClears = mClears.length === clears.length && clears.every((c, i) => ['stage', 'time', 'crashes', 'game'].every((k) => c[k] === mClears[i][k]));
  check('M1-T6', 'same outcome as jsnes for every stage (stage, time left, crashes, game frame)', sameClears, mClears.map((c) => `E${c.stage} t${c.time} x${c.crashes} g${c.game}`).join(' | ') + ` vs jsnes ` + clears.map((c) => `E${c.stage} t${c.time} x${c.crashes} g${c.game}`).join(' | '));
  const sameEnd = !!end && ['state', 'stage', 'time', 'crashes', 'continues', 'clears', 'frame'].every((k) => end[k] === jsEnd[k]);
  check('M1-T6', 'same final probe (back on the title after the credits)', sameEnd, end ? `state ${end.state} stage ${end.stage} time ${end.time} crashes ${end.crashes} frame ${end.frame} (jsnes state ${jsEnd.state} frame ${jsEnd.frame})` : 'no end line');
  check('M1-T6', '0 lag frames, free CPU >= 2000 cycles in every race frame', !!end && end.lag === 0 && report.mesen.freeMin >= FREE_MIN, `lag ${end?.lag}, free min ${report.mesen.freeMin}`);
  check('M1-T6', '0 Mesen process left', left.length === 0, `${left.length}`);
  check('M2-T2', 'whole game without cheats, 5 stages, at most 1 continue, back on the title', mClears.length === 5 && !!end && end.state === 1 && jsEnd.contUsed <= 1, `stages ${mClears.length}, continues used (jsnes) ${jsEnd.contUsed}, final state ${end?.state}`);

  // ---- crash pass (BLUMR-W F4): jsnes reference, then Mesen with the same bot ----
  const hc = new RomHarness(jsnes, b.rom);
  let c = readRacerProbe(hc.s.mem);
  const jsCrashes = [];
  let crashFree = Infinity;
  for (let i = 1; i <= CRASH_MAX; i++) {
    hc.step(1, racerBot(c, 'crash'));
    const prev = c;
    c = readRacerProbe(hc.s.mem);
    if (c.crashes !== prev.crashes) jsCrashes.push({ crashes: c.crashes, crashKind: c.crashKind, time: c.time, game: c.frame });
    if (c.nmiMode === 2 && c.state >= 3 && c.state <= 6) crashFree = Math.min(crashFree, racerFreeCycles(c.idle));
    if (c.crashes >= CRASH_STOP && c.state === 3) break;
  }
  const jsCrashEnd = c;
  // kernel writes logged (and shot) 12 game frames into the first two crashes: the car spins or rolls
  const crashLog = jsCrashes.slice(0, 2).map((k) => k.game + 12);
  const crashShots = crashLog.map((g, i) => ({ name: `crash${i + 1}`, frame: g }));
  const cm = runMesen(romPath, 'mesen-crash', `kind = "crash", crashStop = ${CRASH_STOP}, maxFrames = ${CRASH_MAX}, logFrames = { ${crashLog.join(', ')} }, shotFrames = { ${crashShots.map((s) => `{ name = "${s.name}", frame = ${s.frame} }`).join(', ')} }`);
  shotFrames.push(...crashShots);
  const cEnd = cm.lines.find((l) => l.kind === 'end');
  const mCrashes = cm.lines.filter((l) => l.kind === 'crash').map(({ crashes, crashKind, time, game }) => ({ crashes, crashKind, time, game }));
  const cTiming = cm.lines.filter((l) => l.kind === 'writes').map(analyzeWrites);
  const cFree = cEnd ? Math.min(cEnd.minFree, racerFreeCycles(cEnd.idleMin)) : null;
  report.crash = {
    jsnes: { crashes: jsCrashes, endFrame: jsCrashEnd.frame, lag: jsCrashEnd.lag, freeMin: Math.min(crashFree, racerFreeCycles(jsCrashEnd.idleMin)) },
    mesen: { ms: cm.ms, crashes: mCrashes, endState: cEnd?.state, endFrame: cEnd?.frame, lag: cEnd?.lag, freeMin: cFree, processesLeft: cm.left.length, timing: cTiming },
  };
  const fmt = (x) => x.map((k) => `#${k.crashes} k${k.crashKind} t${k.time} g${k.game}`).join(' ');
  console.log(`crash pass: Mesen ${fmt(mCrashes)} | jsnes ${fmt(jsCrashes)}`);
  const kinds = new Set(mCrashes.map((k) => k.crashKind));
  const sameCrashes = mCrashes.length === jsCrashes.length && jsCrashes.every((k, i) => ['crashes', 'crashKind', 'time', 'game'].every((q) => k[q] === mCrashes[i][q]));
  check('FIX-F4', `crash bot: ${CRASH_STOP} crashes (spins and flips), each back on the road, same as jsnes`, sameCrashes && mCrashes.length >= CRASH_STOP && kinds.has(1) && kinds.has(2) && !!cEnd && cEnd.state === 3 && cEnd.frame === jsCrashEnd.frame, `${mCrashes.length} crashes, kinds ${[...kinds].sort().join(',')}, end state ${cEnd?.state} game ${cEnd?.frame} (jsnes ${jsCrashEnd.frame})`);
  check('FIX-F4', 'kernel writes inside hblank during a crash', cTiming.length === crashLog.length && cTiming.length > 0 && cTiming.every((t) => t.hblankOk && t.kernelLines >= 100), cTiming.map((t) => `${t.kernelLines} lines, W3 ${t.w3[0]}-${t.w3[1]}, R0 ${t.bank[0]}-${t.bank[1]}, ok ${t.hblankOk}`).join(' | '));
  check('FIX-F4', 'crash pass: 0 lag, free CPU >= 2000, 0 Mesen process left', !!cEnd && cEnd.lag === 0 && cFree >= FREE_MIN && cm.left.length === 0, `lag ${cEnd?.lag}, free min ${cFree}, left ${cm.left.length}`);
  contactSheet(shotFrames.map((s) => s.name));
  report.checks = checks;
  writeFileSync(path.join(work, 'report.json'), JSON.stringify(report, null, 1));
  if (flag('publish')) {
    mkdirSync(reports, { recursive: true });
    for (const s of shotFrames) if (existsSync(path.join(shots, `${s.name}.png`))) copyFileSync(path.join(shots, `${s.name}.png`), path.join(reports, `${tag}-mesen-${s.name}.png`));
    if (existsSync(path.join(work, 'contact-sheet.png'))) copyFileSync(path.join(work, 'contact-sheet.png'), path.join(reports, `${tag}-mesen-contact-sheet.png`));
    copyFileSync(path.join(work, 'report.json'), path.join(reports, `${tag}-mesen-report.json`));
    console.log(`published to ${reports}`);
  }
  exitCode = checks.every((c) => c.ok) ? 0 : 1;
  console.log(`${checks.filter((c) => c.ok).length}/${checks.length} checks passed`);
} catch (e) {
  console.error(String(e?.stack ?? e));
  exitCode = 1;
} finally {
  release();
}
process.exit(exitCode);

// Kernel writes per line: ... $2005 (W3), $2006 (W4), $8001 (R0 = stripe bank 0/2); HUD split = first
// $2006 write on a visible line before line 100 (IRQ #1). Same analysis as scripts/racer-spike.mjs.
function analyzeWrites(l) {
  const w = l.w;
  const k = [];
  for (let i = 2; i < w.length; i++) {
    if (w[i].a >= 0x8000 && (w[i].v === 0 || w[i].v === 2) && w[i - 1].a === 0x2006 && w[i - 2].a === 0x2005 && w[i - 2].l === w[i].l) k.push({ w3: w[i - 2], w4: w[i - 1], b: w[i] });
  }
  const vis = k.filter((x) => x.b.l >= 0 && x.b.l < 240);
  const range = (a) => [Math.min(...a), Math.max(...a)];
  const hud = w.find((x) => x.a === 0x2006 && x.l >= 0 && x.l < 100);
  return {
    frame: l.frame,
    kernelLines: vis.length,
    firstLine: vis[0]?.w3.l,
    lastLine: vis[vis.length - 1]?.w3.l,
    w3: range(vis.map((x) => x.w3.d)),
    w4: range(vis.map((x) => x.w4.d)),
    bank: range(vis.map((x) => x.b.d)),
    hblankOk: vis.length > 0 && vis.every((x) => x.w3.l === x.b.l && x.w3.d >= 257 && x.b.d <= 320),
    hudLine: hud?.l,
    hudDot: hud?.d,
  };
}

/** One Mesen test-runner pass (`name`.lua / `name`.jsonl in work): Lua CFG fields after out / shots / replay. */
function runMesen(romPath, name, cfgFields) {
  const before = new Set(mesenPids());
  const out = path.join(work, `${name}.jsonl`);
  rmSync(out, { force: true });
  const lp = (x) => x.replace(/\\/g, '/');
  const cfg = `local CFG = { out = "${lp(out)}", shots = "${lp(shots)}", replay = true, ${cfgFields} }\n`;
  const lib = readFileSync(path.join(root, 'tests', 'mesen', 'lib.lua'), 'utf8');
  const body = readFileSync(path.join(root, 'tests', 'mesen', 'racer-m1.lua'), 'utf8');
  const script = path.join(work, `${name}.lua`);
  writeFileSync(script, `${cfg}local R = (function()\n${lib}\nend)()\n${body}\n`);
  const t1 = Date.now();
  const r = spawnSync(mesen, ['--testrunner', '--timeout=600', romPath, script], { cwd: path.dirname(mesen), encoding: 'utf8', timeout: 630_000, windowsHide: true });
  const ms = Date.now() - t1;
  const left = mesenPids().filter((pid) => !before.has(pid));
  if (r.status !== 0 || !existsSync(out)) throw new Error(`Mesen exit ${r.status} after ${ms} ms ${r.stdout ?? ''}${r.stderr ?? ''}`);
  return { lines: readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)), ms, left };
}

function mesenPids() {
  try {
    const o = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='Mesen.exe'\" | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress"], { encoding: 'utf8', windowsHide: true }).trim();
    if (!o) return [];
    return [].concat(JSON.parse(o)).filter((x) => (x.ExecutablePath ?? '').toLowerCase() === path.resolve(mesen).toLowerCase()).map((x) => x.ProcessId);
  } catch {
    return [];
  }
}

// every Mesen shot, 1x, 4 per row
function contactSheet(names) {
  const imgs = names.filter((n) => existsSync(path.join(shots, `${n}.png`))).map((n) => decodePng(readFileSync(path.join(shots, `${n}.png`))));
  if (!imgs.length) return;
  const cols = 4;
  const rows = Math.ceil(imgs.length / cols);
  const W = cols * 264;
  const H = rows * 248;
  const out = new Uint8Array(W * H * 4).fill(0);
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  imgs.forEach((img, n) => {
    const scale = img.width / 256;
    const ox = (n % cols) * 264;
    const oy = Math.floor(n / cols) * 248;
    for (let y = 0; y < 240; y++) {
      for (let x = 0; x < 256; x++) {
        const si = (y * scale * img.width + x * scale) * 4;
        const di = ((oy + y) * W + ox + x) * 4;
        out[di] = img.data[si];
        out[di + 1] = img.data[si + 1];
        out[di + 2] = img.data[si + 2];
      }
    }
  });
  writeFileSync(path.join(work, 'contact-sheet.png'), encodePng(out, W, H, 2));
}
