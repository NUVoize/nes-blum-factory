// SEBRING engine spike (BLUMR-PLAN, docs/RACER-PLAN.md section 4): build racer/spike, drive it with the
// bot in jsnes (the app's emulator) and in Mesen (accurate tier), take the screenshot sequence, measure
// free CPU per frame and the dot of every kernel write. Holds .tmp/gate.lock (one heavy job at a time).
//   node scripts/racer-spike.mjs [--no-mesen] [--frames=N] [--define=NAME=VALUE ...]
// Output: .tmp/racer-spike/ (rom, shots, report.json); shots copied to runs/reports/BLUMR-PLAN-*.png
// when --publish is given.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const defines = Object.fromEntries(args.filter((a) => a.startsWith('--define=')).map((a) => a.slice(9).split('=')).map(([k, v]) => [k, Number(v)]));
const FRAMES = Number(opt('frames', '3600'));
const jsnes = await import(pathToFileURL(path.join(root, 'node_modules', 'jsnes', 'src', 'index.js')).href);

const tsc = spawnSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-b'], { cwd: root, stdio: 'inherit' });
if (tsc.status !== 0) process.exit(tsc.status ?? 1);
const dist = (p) => path.join(root, 'dist', 'electron', 'core', ...p.split('/'));
const { acquireGateLock, GateBusyError } = require(dist('gate-lock.js'));
const { defaultToolchain } = require(dist('build/engine-build.js'));
const { buildSpike } = require(dist('racer/build-spike.js'));
const { readSpikeProbe, spikeBot, SPIKE_SHOTS, shotMatches, freeCycles, FRAME_CYCLES } = require(dist('racer/spike-run.js'));
const { RomHarness } = require(dist('emu/harness.js'));
const { encodePng, decodePng } = require(dist('util/png.js'));

const work = path.join(root, '.tmp', 'racer-spike');
const shots = path.join(work, 'shots');
const reports = path.resolve(root, '..', '..', '..', 'CODEX', 'NOVA-COCKPIT', 'runs', 'reports');

let release = () => {};
try {
  release = await acquireGateLock(path.join(root, '.tmp', 'gate.lock'), 'racer-spike');
} catch (e) {
  console.error(e instanceof GateBusyError ? e.message : String(e));
  process.exit(3);
}

const report = { defines, frames: FRAMES };
let exitCode = 0;
try {
  rmSync(shots, { recursive: true, force: true });
  mkdirSync(shots, { recursive: true });
  const b = buildSpike(path.join(root, 'racer', 'spike'), defaultToolchain(root), path.join(work, 'build'), { defines });
  if (!b.ok) throw new Error('spike build failed\n' + b.log);
  const romPath = path.join(work, 'sebring-spike.nes');
  writeFileSync(romPath, b.rom);
  report.rom = { bytes: b.rom.length, roadTiles: b.assets.roadTileCount, backdropTiles: b.assets.backdropTileCount, kloop: b.labels.get('kloop'), kloopEnd: b.labels.get('kloop_end') };
  console.log(`ROM ${b.rom.length} bytes, road tiles ${b.assets.roadTileCount}/128, backdrop tiles ${b.assets.backdropTileCount}/128`);

  // ---- jsnes ----
  const h = new RomHarness(jsnes, b.rom);
  const done = new Set();
  const idle = [];
  const segFrames = {};
  let p = readSpikeProbe(h.s.mem);
  const t0 = Date.now();
  for (let f = 1; f <= FRAMES; f++) {
    h.step(1, spikeBot(p));
    p = readSpikeProbe(h.s.mem);
    if (p.magic === 'SBRG' && f > 10) idle.push(p.idle);
    segFrames[p.seg] ??= f;
    for (const s of SPIKE_SHOTS) {
      if (!done.has(s.name) && shotMatches(s, f, p)) {
        done.add(s.name);
        writeFileSync(path.join(shots, `jsnes-${s.name}.png`), encodePng(h.rgba(), 256, 240, 2));
        (report.jsnesShots ??= {})[s.name] = { frame: f, ...pick(p) };
      }
    }
  }
  report.jsnes = summarize(idle, p);
  report.jsnes.ms = Date.now() - t0;
  report.jsnes.segFirstFrame = segFrames;
  report.jsnes.missingShots = SPIKE_SHOTS.map((s) => s.name).filter((n) => !done.has(n));
  console.log(`jsnes: ${FRAMES} frames, lag ${p.lag}, free CPU min ${report.jsnes.freeMin} / avg ${report.jsnes.freeAvg} cycles (${report.jsnes.busyMaxPct}% busy worst), shots ${done.size}/${SPIKE_SHOTS.length}`);

  // ---- Mesen ----
  if (!flag('no-mesen')) {
    const mesen = process.env.NBF_MESEN ?? path.join(root, '.tmp', 'tools', 'mesen', 'Mesen.exe');
    if (!existsSync(mesen)) throw new Error(`Mesen not found (${mesen}): node scripts/fetch-mesen.mjs`);
    const before = new Set(mesenPids(mesen));
    const out = path.join(work, 'mesen.jsonl');
    rmSync(out, { force: true });
    const lp = (x) => x.replace(/\\/g, '/');
    const shotLua = SPIKE_SHOTS.map((s) => `{ name = "${s.name}"${s.frame !== undefined ? `, frame = ${s.frame}` : `, seg = ${s.seg}, curve = ${s.curve}, hill = ${s.hill}`} }`).join(', ');
    const logFrames = [300, 301, 302, (report.jsnesShots?.uphill?.frame ?? 0) + 2, (report.jsnesShots?.crest?.frame ?? 0) + 2];
    const cfg = `local CFG = { out = "${lp(out)}", shots = "${lp(shots)}", replay = true, maxFrames = ${FRAMES}, logFrames = { ${logFrames.join(', ')} }, shotList = { ${shotLua} } }\n`;
    const lib = readFileSync(path.join(root, 'tests', 'mesen', 'lib.lua'), 'utf8');
    const body = readFileSync(path.join(root, 'tests', 'mesen', 'racer-spike.lua'), 'utf8');
    const script = path.join(work, 'racer-spike.lua');
    writeFileSync(script, `${cfg}local R = (function()\n${lib}\nend)()\n${body}\n`);
    const t1 = Date.now();
    const r = spawnSync(mesen, ['--testrunner', '--timeout=300', romPath, script], { cwd: path.dirname(mesen), encoding: 'utf8', timeout: 330_000, windowsHide: true });
    const ms = Date.now() - t1;
    const left = mesenPids(mesen).filter((pid) => !before.has(pid));
    if (r.status !== 0 || !existsSync(out)) throw new Error(`Mesen exit ${r.status} after ${ms} ms ${r.stdout ?? ''}${r.stderr ?? ''}`);
    const lines = readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const end = lines.find((l) => l.kind === 'end');
    const midle = lines.filter((l) => l.kind === 'p' && l.magic === 'SBRG').map((l) => l.idle);
    report.mesen = summarize(midle, end);
    report.mesen.ms = ms;
    report.mesen.processesLeft = left.length;
    report.mesen.shots = Object.fromEntries(lines.filter((l) => l.kind === 'shot').map((l) => [l.name, { frame: l.f, ...pick(l.probe) }]));
    report.mesen.missingShots = SPIKE_SHOTS.map((s) => s.name).filter((n) => !report.mesen.shots[n]);
    report.mesen.timing = lines.filter((l) => l.kind === 'writes').map((l) => analyzeWrites(l));
    const same = ['seg', 'curve', 'speed', 'carX', 'hill', 'dist', 'phase'].filter((k) => end[k] !== p[k]);
    report.sameOutcome = { equal: same.length === 0, differ: same.map((k) => `${k} mesen ${end[k]} jsnes ${p[k]}`) };
    console.log(`Mesen: ${FRAMES} frames in ${ms} ms, lag ${end.lag}, free CPU min ${report.mesen.freeMin} (ROM minimum over all frames) / avg ${report.mesen.freeAvg} (${report.mesen.busyMaxPct}% busy worst), shots ${Object.keys(report.mesen.shots).length}/${SPIKE_SHOTS.length}, processes left ${left.length}`);
    for (const t of report.mesen.timing) console.log(`  frame ${t.frame}: ${t.kernelLines} kernel lines ${t.firstLine}-${t.lastLine}, W3 dots ${t.w3[0]}-${t.w3[1]}, W4 ${t.w4[0]}-${t.w4[1]}, R0 ${t.bank[0]}-${t.bank[1]}, hblank ok ${t.hblankOk}, HUD split line ${t.hudLine} dot ${t.hudDot}`);
    console.log(`  same outcome as jsnes at frame ${FRAMES}: ${report.sameOutcome.equal ? 'yes' : report.sameOutcome.differ.join(', ')}`);
    contactSheet();
  }
  writeFileSync(path.join(work, 'report.json'), JSON.stringify(report, null, 1));
  if (flag('publish')) {
    mkdirSync(reports, { recursive: true });
    for (const f of ['contact-sheet.png']) if (existsSync(path.join(work, f))) copyFileSync(path.join(work, f), path.join(reports, `BLUMR-PLAN-spike-${f}`));
    for (const s of SPIKE_SHOTS) {
      for (const emu of ['mesen', 'jsnes']) {
        const src = path.join(shots, emu === 'mesen' ? `${s.name}.png` : `jsnes-${s.name}.png`);
        if (existsSync(src)) copyFileSync(src, path.join(reports, `BLUMR-PLAN-${emu}-${s.name}.png`));
      }
    }
    copyFileSync(path.join(work, 'report.json'), path.join(reports, 'BLUMR-PLAN-spike-report.json'));
    console.log(`published to ${reports}`);
  }
} catch (e) {
  console.error(String(e?.stack ?? e));
  exitCode = 1;
} finally {
  release();
}
process.exit(exitCode);

function pick(p) {
  return { seg: p.seg, curve: p.curve, hill: p.hill, hy: p.hy, speed: p.speed, carX: p.carX, phase: p.phase, lag: p.lag, idle: p.idle };
}

function summarize(idles, last) {
  const free = idles.map(freeCycles);
  const min = Math.min(...free);
  const avg = Math.round(free.reduce((a, v) => a + v, 0) / Math.max(1, free.length));
  // the ROM keeps its own minimum over every frame from frame 4 ($7F18)
  const romMin = freeCycles(last.idleMin);
  const worst = Math.min(min, romMin);
  return { lag: last.lag, freeMin: worst, freeMinSampled: min, freeMinRom: romMin, freeAvg: avg, busyMaxPct: Math.round((100 * (FRAME_CYCLES - worst)) / FRAME_CYCLES), samples: free.length, last: pick(last) };
}

// Kernel writes per line: ... $2005 (W3), $2006 (W4), $8001 (R0); HUD split = first $2006 pair after line 0.
function analyzeWrites(l) {
  const w = l.w;
  const k = [];
  for (let i = 2; i < w.length; i++) {
    if (w[i].a >= 0x8000 && (w[i].v === 0 || w[i].v === 2) && w[i - 1].a === 0x2006 && w[i - 2].a === 0x2005 && w[i - 2].l === w[i].l) k.push({ w3: w[i - 2], w4: w[i - 1], b: w[i] });
  }
  const vis = k.filter((x) => x.b.l >= 0 && x.b.l < 240);
  const range = (a) => [Math.min(...a), Math.max(...a)];
  const hud = w.find((x) => x.a === 0x2006 && x.l >= 0 && x.l < 100); // IRQ #1 first write
  return {
    frame: l.frame,
    kernelLines: vis.length,
    firstLine: vis[0]?.w3.l,
    lastLine: vis[vis.length - 1]?.w3.l,
    w3: range(vis.map((x) => x.w3.d)),
    w4: range(vis.map((x) => x.w4.d)),
    bank: range(vis.map((x) => x.b.d)),
    sameLine: vis.every((x) => x.w3.l === x.b.l),
    hblankOk: vis.every((x) => x.w3.l === x.b.l && x.w3.d >= 257 && x.b.d <= 320),
    hudLine: hud?.l,
    hudDot: hud?.d,
  };
}

function mesenPids(exe) {
  try {
    const o = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='Mesen.exe'\" | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress"], { encoding: 'utf8', windowsHide: true }).trim();
    if (!o) return [];
    return [].concat(JSON.parse(o)).filter((x) => (x.ExecutablePath ?? '').toLowerCase() === path.resolve(exe).toLowerCase()).map((x) => x.ProcessId);
  } catch {
    return [];
  }
}

// Mesen (left) and jsnes (right) for every shot, 1x, one row per shot.
function contactSheet() {
  const rows = SPIKE_SHOTS.filter((s) => existsSync(path.join(shots, `${s.name}.png`)) && existsSync(path.join(shots, `jsnes-${s.name}.png`)));
  if (!rows.length) return;
  const W = 256 * 2 + 8;
  const H = rows.length * 248;
  const out = new Uint8Array(W * H * 4).fill(0);
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  rows.forEach((s, r) => {
    const imgs = [decodePng(readFileSync(path.join(shots, `${s.name}.png`))), decodePng(readFileSync(path.join(shots, `jsnes-${s.name}.png`)))];
    imgs.forEach((img, c) => {
      const scale = img.width / 256;
      for (let y = 0; y < 240; y++) {
        for (let x = 0; x < 256; x++) {
          const si = ((y * scale) * img.width + x * scale) * 4;
          const di = ((r * 248 + y) * W + c * 264 + x) * 4;
          out[di] = img.data[si];
          out[di + 1] = img.data[si + 1];
          out[di + 2] = img.data[si + 2];
        }
      }
    });
  });
  writeFileSync(path.join(work, 'contact-sheet.png'), encodePng(out, W, H, 2));
}
