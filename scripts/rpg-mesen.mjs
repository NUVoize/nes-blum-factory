// npm run test:rpg-mesen — LEGEND OF BLUM engine spike (BLUMZ-PLAN, docs/RPG-PLAN.md section 2), accurate
// tier. Builds rpg/spike, plays the spike route with the bot in jsnes (reference), then in Mesen with the
// same bot (tests/mesen/rpg-spike.lua) and checks: same state changes on the same frames, same final
// outcome, 0 lag, free CPU, every shot in both emulators, the dialogue and battle text readable in Mesen's
// pictures, 0 Mesen process left. Holds .tmp/gate.lock (one heavy job at a time).
//   node scripts/rpg-mesen.mjs [--publish] [--tag=BLUMZ-PLAN]
// Output: .tmp/rpg-mesen/ (rom, shots, report.json, contact sheet); --publish copies them to
// runs/reports/<tag>-*.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const tag = args.find((a) => a.startsWith('--tag='))?.slice(6) ?? 'BLUMZ-PLAN';
const jsnes = await import(pathToFileURL(path.join(root, 'node_modules', 'jsnes', 'src', 'index.js')).href);

const tsc = spawnSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-b'], { cwd: root, stdio: 'inherit' });
if (tsc.status !== 0) process.exit(tsc.status ?? 1);
const dist = (p) => path.join(root, 'dist', 'electron', 'core', ...p.split('/'));
const { acquireGateLock, GateBusyError } = require(dist('gate-lock.js'));
const { defaultToolchain } = require(dist('build/engine-build.js'));
const { buildRpgSpike } = require(dist('rpg/build-spike.js'));
const { readRpgProbe, rpgBot, rpgFreeCycles, RPG_SHOTS, SHOT_DELAY, BOT_END_X } = require(dist('rpg/spike-run.js'));
const { fontPixels } = require(dist('rpg/spike-art.js'));
const { BOX_BOTTOM, TEXT_COL } = require(dist('rpg/spike-world.js'));
const { RomHarness } = require(dist('emu/harness.js'));
const { encodePng, decodePng } = require(dist('util/png.js'));

const FRAMES = 1500;
const FREE_MIN = 15000;
const work = path.join(root, '.tmp', 'rpg-mesen');
const shots = path.join(work, 'shots');
const reports = path.resolve(root, '..', '..', '..', 'CODEX', 'NOVA-COCKPIT', 'runs', 'reports');
const mesen = process.env.NBF_MESEN ?? path.join(root, '.tmp', 'tools', 'mesen', 'Mesen.exe');
if (!existsSync(mesen)) {
  console.error(`rpg-mesen: Mesen not found (${mesen}): node scripts/fetch-mesen.mjs`);
  process.exit(1);
}

let release = () => {};
try {
  release = await acquireGateLock(path.join(root, '.tmp', 'gate.lock'), 'rpg-mesen');
} catch (e) {
  console.error(e instanceof GateBusyError ? e.message : String(e));
  process.exit(3);
}

const checks = [];
const check = (id, what, ok, detail) => {
  checks.push({ id, what, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${what}: ${detail}`);
};
const report = { frames: FRAMES };
let exitCode = 0;
try {
  rmSync(shots, { recursive: true, force: true });
  mkdirSync(shots, { recursive: true });
  const b = buildRpgSpike(path.join(root, 'rpg', 'spike'), defaultToolchain(root), path.join(work, 'build'));
  if (!b.ok) throw new Error('rpg spike build failed\n' + b.log);
  const romPath = path.join(work, 'rpg-spike.nes');
  writeFileSync(romPath, b.rom);
  report.rom = { bytes: b.rom.length, bgTiles: b.world.art.bgTileCount, spriteTiles: b.world.art.spriteTileCount };
  const pages = b.world.pages;

  // ---- jsnes ----
  const h = new RomHarness(jsnes, b.rom);
  let p = readRpgProbe(h.s.mem);
  const keyOf = (q) => [q.state, q.room, q.dSub, q.dPage, q.bSub, q.turn, q.cursor].join('/');
  const jEvents = [];
  let lastKey = '';
  let jFree = Infinity;
  const first = new Map();
  const jShots = {};
  for (let f = 1; f <= FRAMES; f++) {
    h.step(1, rpgBot(p));
    p = readRpgProbe(h.s.mem);
    const k = keyOf(p);
    if (k !== lastKey) (jEvents.push(`${f}:${k}`), (lastKey = k));
    if (f > 10) jFree = Math.min(jFree, rpgFreeCycles(p.idle));
    for (const s of RPG_SHOTS) if (!first.has(s.name) && s.when(p)) first.set(s.name, f);
    for (const [n, f0] of first) {
      if (!jShots[n] && f === f0 + SHOT_DELAY) {
        jShots[n] = { frame: f };
        writeFileSync(path.join(shots, `jsnes-${n}.png`), encodePng(h.rgba(), 256, 240, 2));
      }
    }
  }
  const jEnd = p;
  report.jsnes = { end: jEnd, freeMin: jFree, events: jEvents.length, shots: Object.keys(jShots).length };
  console.log(`jsnes: ${FRAMES} frames, lag ${jEnd.lag}, flags ${jEnd.flags}, free CPU min ${jFree}, ${jEvents.length} state changes, shots ${Object.keys(jShots).length}/${RPG_SHOTS.length}`);

  // ---- Mesen ----
  const before = new Set(mesenPids());
  const out = path.join(work, 'mesen.jsonl');
  rmSync(out, { force: true });
  const lp = (x) => x.replace(/\\/g, '/');
  const shotLua = RPG_SHOTS.map((s) => `{ name = "${s.name}", hit = function(p) return ${s.lua} end }`).join(',\n  ');
  const cfg = `local CFG = { out = "${lp(out)}", shots = "${lp(shots)}", replay = true, maxFrames = ${FRAMES}, shotDelay = ${SHOT_DELAY}, endX = ${BOT_END_X}, shotList = {\n  ${shotLua}\n} }\n`;
  const lib = readFileSync(path.join(root, 'tests', 'mesen', 'lib.lua'), 'utf8');
  const body = readFileSync(path.join(root, 'tests', 'mesen', 'rpg-spike.lua'), 'utf8');
  const script = path.join(work, 'rpg-spike.lua');
  writeFileSync(script, `${cfg}local R = (function()\n${lib}\nend)()\n${body}\n`);
  const t1 = Date.now();
  const r = spawnSync(mesen, ['--testrunner', '--timeout=300', romPath, script], { cwd: path.dirname(mesen), encoding: 'utf8', timeout: 330_000, windowsHide: true });
  const ms = Date.now() - t1;
  const left = mesenPids().filter((pid) => !before.has(pid));
  check('R1', 'Mesen runs the spike to the end, no process left', r.status === 0 && existsSync(out) && left.length === 0, `exit ${r.status}, ${ms} ms, processes left ${left.length}`);
  if (!existsSync(out)) throw new Error(`Mesen produced no output ${r.stdout ?? ''}${r.stderr ?? ''}`);
  const lines = readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const mEnd = lines.find((l) => l.kind === 'end');
  const mEvents = lines.filter((l) => l.kind === 'p').map((l) => `${l.f}:${keyOf(l)}`);
  const mFree = Math.min(...lines.filter((l) => l.kind === 'idle').map((l) => rpgFreeCycles(l.idle)));
  const mShots = Object.fromEntries(lines.filter((l) => l.kind === 'shot').map((l) => [l.name, { frame: l.f }]));
  report.mesen = { end: mEnd, freeMin: mFree, events: mEvents.length, shots: Object.keys(mShots).length, ms };

  check('R2', '0 lag frames (both)', jEnd.lag === 0 && mEnd?.lag === 0, `jsnes ${jEnd.lag}, Mesen ${mEnd?.lag}`);
  const route = (e) => e && e.state === 1 && e.room === 1 && e.px === BOT_END_X && e.flags === 3 && e.items === 1 && e.xp > 0;
  check('R3', 'route done: dialogue (clochette), transition, battle won, walking on', route(jEnd) && route(mEnd), `jsnes flags ${jEnd.flags} room ${jEnd.room} px ${jEnd.px}; Mesen flags ${mEnd?.flags} room ${mEnd?.room} px ${mEnd?.px}`);
  const firstDiff = jEvents.findIndex((e, i) => e !== mEvents[i]);
  check('R4', 'same state changes on the same frames (jsnes = Mesen)', firstDiff < 0 && jEvents.length === mEvents.length, firstDiff < 0 ? `${jEvents.length} changes identical` : `first difference #${firstDiff}: jsnes ${jEvents[firstDiff]} Mesen ${mEvents[firstDiff]}`);
  const same = ['state', 'room', 'px', 'py', 'flags', 'xp', 'turn', 'php', 'ehp', 'curNt', 'vpeak'].filter((k) => jEnd[k] !== mEnd?.[k]);
  check('R5', `same final probe at frame ${FRAMES}`, same.length === 0, same.length ? same.map((k) => `${k} jsnes ${jEnd[k]} Mesen ${mEnd?.[k]}`).join(', ') : 'identical');
  check('R6', `free CPU >= ${FREE_MIN} cycles every frame (both)`, jFree >= FREE_MIN && mFree >= FREE_MIN && rpgFreeCycles(mEnd.idleMin) >= FREE_MIN, `jsnes min ${jFree}, Mesen min ${mFree} (ROM min ${rpgFreeCycles(mEnd.idleMin)})`);
  const missing = RPG_SHOTS.map((s) => s.name).filter((n) => !mShots[n] || !jShots[n]);
  const frameDiff = RPG_SHOTS.map((s) => s.name).filter((n) => mShots[n] && jShots[n] && mShots[n].frame !== jShots[n].frame);
  check('R7', `all ${RPG_SHOTS.length} shots in both emulators, same frames`, missing.length === 0 && frameDiff.length === 0, missing.length || frameDiff.length ? `missing ${missing.join(',')} frame differs ${frameDiff.join(',')}` : 'ok');
  // text readable in Mesen's pictures (palette-agnostic: glyph pixels bright, window pixels blue)
  const textChecks = [
    ['dialog-1', BOX_BOTTOM + 1, pages[0][0]],
    ['dialog-1', BOX_BOTTOM + 3, pages[0][1]],
    ['dialog-2', BOX_BOTTOM + 3, pages[1][1]],
    ['dialog-3', BOX_BOTTOM + 1, pages[2][0]],
    ['dialog-3', BOX_BOTTOM + 3, pages[2][1]],
    ['battle-power', 3, 'Coup de cartable !'],
    ['battle-menu', 25, 'Défense'],
  ];
  const textBad = [];
  for (const [shot, row, text] of textChecks) {
    const file = path.join(shots, `${shot}.png`);
    if (!existsSync(file)) {
      textBad.push(`${shot}: no shot`);
      continue;
    }
    const img = decodePng(readFileSync(file));
    const col0 = shot === 'battle-menu' ? 4 - TEXT_COL : 0;
    [...text].forEach((ch, i) => {
      if (!glyphLike(img, TEXT_COL + col0 + i, row, ch)) textBad.push(`${shot} « ${ch} » #${i}`);
    });
  }
  check('R8', 'dialogue (é è à ç ô) and battle text readable in Mesen', textBad.length === 0, textBad.length ? textBad.slice(0, 8).join('; ') : `${textChecks.length} lines, every glyph`);
  contactSheet();
  report.checks = checks;
} catch (e) {
  console.error(String(e?.stack ?? e));
  exitCode = 1;
} finally {
  writeFileSync(path.join(work, 'report.json'), JSON.stringify(report, null, 1));
  if (flag('publish')) {
    mkdirSync(reports, { recursive: true });
    if (existsSync(path.join(work, 'contact-sheet.png'))) copyFileSync(path.join(work, 'contact-sheet.png'), path.join(reports, `${tag}-spike-contact-sheet.png`));
    for (const s of RPG_SHOTS) {
      for (const emu of ['mesen', 'jsnes']) {
        const src = path.join(shots, emu === 'mesen' ? `${s.name}.png` : `jsnes-${s.name}.png`);
        if (existsSync(src)) copyFileSync(src, path.join(reports, `${tag}-${emu}-${s.name}.png`));
      }
    }
    copyFileSync(path.join(work, 'report.json'), path.join(reports, `${tag}-spike-report.json`));
    console.log(`published to ${reports}`);
  }
  release();
}
const failed = checks.filter((c) => !c.ok).length;
console.log(`rpg-mesen: ${checks.length - failed}/${checks.length} checks passed`);
process.exit(exitCode || (failed ? 1 : 0) || (checks.length < 8 ? 1 : 0));

/** Palette-agnostic glyph test on a screenshot: ink pixels bright, window pixels blue and darker. */
function glyphLike(img, col, row, ch) {
  const g = fontPixels(ch);
  const scale = img.width / 256;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = (Math.floor((row * 8 + y) * scale) * img.width + Math.floor((col * 8 + x) * scale)) * 4;
      const [r, gr, bl] = [img.data[i], img.data[i + 1], img.data[i + 2]];
      const ink = g[y * 8 + x] === 2;
      if (ink && !(r > 180 && gr > 180 && bl > 180)) return false;
      if (!ink && !(bl > r + 40 && bl > gr + 40 && r < 150)) return false;
    }
  }
  return true;
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

// Mesen (left) and jsnes (right) for every shot, 1x, one row per shot.
function contactSheet() {
  const rows = RPG_SHOTS.filter((s) => existsSync(path.join(shots, `${s.name}.png`)) && existsSync(path.join(shots, `jsnes-${s.name}.png`)));
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
          const si = (Math.floor(y * scale) * img.width + Math.floor(x * scale)) * 4;
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
