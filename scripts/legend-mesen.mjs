// npm run test:legend-mesen — THE LEGEND OF BLUM vertical slice (BLUMZ-M1), accurate tier. Builds the ROM,
// plays the whole slice with the bot in jsnes for each of the 5 classes (reference: input trace, state
// changes, shots), then replays every input trace in Mesen 2 (tests/mesen/legend-replay.lua) and checks:
// the slice finishes in Mesen for every class, the same state changes on the same frames, the same final
// probe, 0 lag, free CPU, every shot in both emulators at the same frame, the French text readable in
// Mesen's pictures, the 10-minute random soak trace (scripts/legend-soak.mjs --trace) identical in Mesen,
// 0 Mesen process left. Holds .tmp/gate.lock (one heavy job at a time).
//   node scripts/legend-mesen.mjs [--publish] [--tag=BLUMZ-M1] [--classes=0,1,2,3,4] [--no-soak]
// Output: .tmp/legend-mesen/ (rom, shots, report.json, contact sheets); --publish copies them to
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
const arg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const tag = arg('tag') ?? 'BLUMZ-M1';
const classes = (arg('classes') ?? '0,1,2,3,4').split(',').map(Number);
const jsnes = await import(pathToFileURL(path.join(root, 'node_modules', 'jsnes', 'src', 'index.js')).href);

const tsc = spawnSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-b'], { cwd: root, stdio: 'inherit' });
if (tsc.status !== 0) process.exit(tsc.status ?? 1);
const dist = (p) => path.join(root, 'dist', 'electron', 'core', ...p.split('/'));
const { acquireGateLock, GateBusyError } = require(dist('gate-lock.js'));
const { defaultToolchain } = require(dist('build/engine-build.js'));
const { buildLegend } = require(dist('rpg/legend/build.js'));
const { LegendBot, loadRoute, playSlice, readLegendProbe, legendFreeCycles, LS, DS, BS, MS } = require(dist('rpg/legend/run.js'));
const { soakRun } = require(dist('rpg/legend/soak.js'));
const { fontPixels } = require(dist('rpg/spike-art.js'));
const { RomHarness } = require(dist('emu/harness.js'));
const { encodePng, decodePng } = require(dist('util/png.js'));

const FREE_MIN = 9000;
/** Screens where the slice has no dialogue window (nobody to talk to, no event). */
const NO_DIALOG = ['rue'];
const SHOT_DELAY = 2;
const work = path.join(root, '.tmp', 'legend-mesen');
const shots = path.join(work, 'shots');
const reports = path.resolve(root, '..', '..', '..', 'CODEX', 'NOVA-COCKPIT', 'runs', 'reports');
const mesen = process.env.NBF_MESEN ?? path.join(root, '.tmp', 'tools', 'mesen', 'Mesen.exe');
if (!existsSync(mesen)) {
  console.error(`legend-mesen: Mesen not found (${mesen}): node scripts/fetch-mesen.mjs`);
  process.exit(1);
}

let release = () => {};
try {
  release = await acquireGateLock(path.join(root, '.tmp', 'gate.lock'), 'legend-mesen');
} catch (e) {
  console.error(e instanceof GateBusyError ? e.message : String(e));
  process.exit(3);
}

const checks = [];
const check = (id, what, ok, detail) => {
  checks.push({ id, what, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${what}: ${detail}`);
};
const CLASS_NAMES = ['guerrier', 'mage', 'voleur', 'archer', 'necromancien'];
const report = { classes: {} };
const shotNames = [];
let exitCode = 0;
try {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(shots, { recursive: true });
  const b = buildLegend(path.join(root, 'rpg'), path.join(root, 'engine'), defaultToolchain(root), path.join(work, 'build'));
  if (!b.ok) throw new Error('legend build failed\n' + b.log);
  const romPath = path.join(work, 'legend-slice.nes');
  writeFileSync(romPath, b.rom);
  const meta = b.compiled.meta;
  const route = loadRoute(path.join(root, 'rpg'));
  report.rom = { bytes: b.rom.length, text: b.compiled.sizes.text, world: b.compiled.sizes.world, chrKiB: b.compiled.sizes.chrUnits };
  const before = new Set(mesenPids());
  const textChecks = [];
  let allLeft = 0;

  for (const cls of classes) {
    const name = CLASS_NAMES[cls];
    // ---- jsnes reference run, with shots ----
    const h = new RomHarness(jsnes, b.rom);
    const wanted = shotRules(meta, cls);
    const first = new Map();
    const taken = new Map();
    const onFrame = (p, f) => {
        for (const w of wanted) if (!first.has(w.name) && w.when(p)) first.set(w.name, f + (w.delay ?? SHOT_DELAY));
        for (const [n, at] of first) {
          if (!taken.has(n) && f === at) {
            taken.set(n, { frame: f, probe: p });
            writeFileSync(path.join(shots, `${name}-jsnes-${n}.png`), encodePng(h.rgba(), 256, 240, 2));
          }
        }
    };
    const r = playSlice(h, new LegendBot(meta, b.data, route, { cls }), { maxFrames: 20000, onFrame });
    const endFrame = r.frames + 30;
    for (let i = 1; i <= 30; i++) {
      h.step(1, []);
      onFrame(readLegendProbe(h.s.mem), r.frames + i);
    }
    const jEnd = r.end;
    console.log(`jsnes ${name}: ${r.frames} frames, finished ${r.finished}, lag ${jEnd.lag}, free CPU min ${r.freeMin}, ${r.events.length} state changes, ${taken.size} shots`);
    // ---- Mesen replay ----
    const out = path.join(work, `mesen-${name}.jsonl`);
    const shotList = [...taken].map(([n, t]) => ({ name: `${name}-mesen-${n}`, frame: t.frame }));
    const res = runMesen(romPath, out, r.inputs, endFrame, shotList);
    const lines = res.lines;
    const mEnd = lines.find((l) => l.kind === 'end');
    const mEvents = lines.filter((l) => l.kind === 'p').map((l) => `${l.f}:${l.k}`);
    const mFree = Math.min(...lines.filter((l) => l.kind === 'i').map((l) => legendFreeCycles(l.v)));
    const mShots = new Set(lines.filter((l) => l.kind === 'shot').map((l) => l.name));
    // compare from the title screen: before it, Mesen shows the battery RAM's old probe (restored from its
    // .sav) and jsnes the power-on RAM; the reset code clears the probe at the same frame in both
    const jEvents = fromTitle(r.events);
    mEvents.splice(0, mEvents.length, ...fromTitle(mEvents));
    const firstDiff = jEvents.findIndex((e, i) => e !== mEvents[i]);
    const finishedM = mEnd && mEnd.state === LS.end;
    check(`${name}-1`, `${name}: Mesen plays the whole slice to « À SUIVRE »`, res.status === 0 && finishedM && r.finished, `exit ${res.status}, ${res.ms} ms, jsnes end state ${jEnd.state}, Mesen end state ${mEnd?.state}`);
    check(`${name}-2`, `${name}: same state changes on the same frames (jsnes = Mesen)`, firstDiff < 0 && jEvents.length === mEvents.length, firstDiff < 0 ? `${jEvents.length} changes identical` : `first difference #${firstDiff}: jsnes ${jEvents[firstDiff]} Mesen ${mEvents[firstDiff]}`);
    const keys = ['state', 'screen', 'px', 'py', 'hp', 'xp', 'level', 'cls', 'items', 'saves'];
    const diff = keys.filter((k) => (k === 'items' ? (jEnd.items & 0xff) !== mEnd?.items : jEnd[k] !== mEnd?.[k]));
    const flagsSame = jEnd.flags.every((v, i) => v === mEnd?.flags?.[i]);
    check(`${name}-3`, `${name}: same final probe (state, screen, position, PV, XP, level, class, items, saves, 256 flags)`, diff.length === 0 && flagsSame, diff.length || !flagsSame ? `${diff.map((k) => `${k} jsnes ${jEnd[k]} Mesen ${mEnd?.[k]}`).join(', ')} flags ${flagsSame}` : 'identical');
    check(`${name}-4`, `${name}: 0 lag frames, free CPU >= ${FREE_MIN} cycles every frame (both)`, jEnd.lag === 0 && mEnd?.lag === 0 && r.freeMin >= FREE_MIN && mFree >= FREE_MIN, `lag jsnes ${jEnd.lag} Mesen ${mEnd?.lag}; free CPU min jsnes ${r.freeMin}, Mesen ${mFree}`);
    const missing = shotList.filter((s) => !mShots.has(s.name)).map((s) => s.name);
    const never = wanted.filter((w) => !w.counter).map((w) => w.name).filter((n) => !taken.has(n) && !NO_DIALOG.some((x) => n === `dialog-${x}`));
    check(`${name}-5`, `${name}: every shot in both emulators, same frames`, missing.length === 0 && never.length === 0, missing.length || never.length ? `missing in Mesen ${missing.join(',')}; never matched in jsnes ${never.join(',')}` : `${taken.size} shots`);
    report.classes[name] = { frames: r.frames, events: jEvents.length, freeMin: { jsnes: r.freeMin, mesen: mFree }, lag: { jsnes: jEnd.lag, mesen: mEnd?.lag }, battles: r.battles, ms: res.ms };
    for (const [n] of taken) shotNames.push(`${name}-${n}`);
    if (cls === classes[0]) textChecks.push(...readableTexts(meta, name, taken));
  }
  // ---- text readable in Mesen's pictures ----
  const bad = [];
  for (const t of textChecks) {
    const file = path.join(shots, `${t.file}.png`);
    if (!existsSync(file)) {
      bad.push(`${t.file}: no shot`);
      continue;
    }
    const img = decodePng(readFileSync(file));
    [...t.text].forEach((ch, i) => {
      if (ch !== ' ' && !glyphLike(img, t.col + i, t.row, ch)) bad.push(`${t.file} « ${ch} » #${i}`);
    });
  }
  check('text', 'dialogue (é è à ç ô), battle and menu text readable in Mesen', bad.length === 0 && textChecks.length >= 4, bad.length ? bad.slice(0, 8).join('; ') : `${textChecks.length} lines, every glyph`);

  // ---- soak trace replay ----
  if (!flag('no-soak')) {
    const s = soakRun(jsnes, b.rom, { seed: 1, frames: 36000, prefill: 0xff });
    const out = path.join(work, 'mesen-soak.jsonl');
    const res = runMesen(romPath, out, s.inputs, s.frames, [], 0xff);
    const lines = res.lines;
    const mEnd = lines.find((l) => l.kind === 'end');
    const mEvents = fromTitle(lines.filter((l) => l.kind === 'p').map((l) => `${l.f}:${l.k}`));
    s.events = fromTitle(s.events);
    const firstDiff = s.events.findIndex((e, i) => e !== mEvents[i]);
    report.soak = { frames: s.frames, events: s.events.length, problems: s.problems, states: s.states, ms: res.ms };
    check('soak', `10-minute random soak (36 000 frames, dirty boot) identical in Mesen, no crash`, res.status === 0 && mEnd && mEnd.state >= 0 && s.problems.length === 0 && firstDiff < 0 && s.events.length === mEvents.length, `${s.events.length} state changes, first difference ${firstDiff < 0 ? 'none' : `#${firstDiff} jsnes ${s.events[firstDiff]} Mesen ${mEvents[firstDiff]}`}, jsnes problems ${s.problems.length}, Mesen exit ${res.status}, ${res.ms} ms`);
  }
  allLeft = mesenPids().filter((pid) => !before.has(pid)).length;
  check('procs', 'no Mesen process left', allLeft === 0, `${allLeft} left`);
  contactSheets();
  report.checks = checks;
} catch (e) {
  console.error(String(e?.stack ?? e));
  exitCode = 1;
} finally {
  writeFileSync(path.join(work, 'report.json'), JSON.stringify(report, null, 1));
  if (flag('publish')) {
    mkdirSync(reports, { recursive: true });
    for (const f of ['contact-sheet-guerrier.png', 'contact-sheet-classes.png']) if (existsSync(path.join(work, f))) copyFileSync(path.join(work, f), path.join(reports, `${tag}-${f}`));
    for (const n of shotNames) {
      const [cls, ...rest] = n.split('-');
      for (const emu of ['mesen', 'jsnes']) {
        const src = path.join(shots, `${cls}-${emu}-${rest.join('-')}.png`);
        if (existsSync(src) && (cls === CLASS_NAMES[classes[0]] || rest.join('-').includes('power'))) copyFileSync(src, path.join(reports, `${tag}-${emu}-${cls}-${rest.join('-')}.png`));
      }
    }
    copyFileSync(path.join(work, 'report.json'), path.join(reports, `${tag}-mesen-report.json`));
    console.log(`published to ${reports}`);
  }
  release();
}
const failed = checks.filter((c) => !c.ok).length;
console.log(`legend-mesen: ${checks.length - failed}/${checks.length} checks passed`);
process.exit(exitCode || (failed ? 1 : 0) || (checks.length < classes.length * 5 + 2 ? 1 : 0));

// ---------------------------------------------------------------------------------------------------
function fromTitle(events) {
  const i = events.findIndex((e) => e.split(':')[1].startsWith(`${LS.title}/`));
  return i < 0 ? events : events.slice(i);
}

function runMesen(romPath, out, inputs, endFrame, shotList, prefill) {
  rmSync(out, { force: true });
  const lp = (x) => x.replace(/\\/g, '/');
  const entries = Object.entries(inputs).map(([f, m]) => `[${f}]=${m}`);
  const chunks = [];
  for (let i = 0; i < entries.length; i += 200) chunks.push(entries.slice(i, i + 200).join(','));
  const inputLua = `local IN = {}\n${chunks.map((c) => `for k, v in pairs({${c}}) do IN[k] = v end`).join('\n')}\n`;
  const shotLua = shotList.map((s) => `{ name = "${s.name}", frame = ${s.frame} }`).join(',\n  ');
  const cfg = `${inputLua}local CFG = { out = "${lp(out)}", shots = "${lp(shots)}", replay = true, inputs = IN, endFrame = ${endFrame}, maxFrames = ${endFrame + 600}, shotList = {\n  ${shotLua}\n} }\n`;
  const lib = readFileSync(path.join(root, 'tests', 'mesen', 'lib.lua'), 'utf8');
  const body = readFileSync(path.join(root, 'tests', 'mesen', 'legend-replay.lua'), 'utf8');
  const script = out.replace(/\.jsonl$/, '.lua');
  writeFileSync(script, `${cfg}local R = (function()\n${lib}\nend)()\n${body}\n`);
  void prefill;
  const t1 = Date.now();
  const r = spawnSync(mesen, ['--testrunner', '--timeout=900', romPath, script], { cwd: path.dirname(mesen), encoding: 'utf8', timeout: 960_000, windowsHide: true });
  const ms = Date.now() - t1;
  if (!existsSync(out)) throw new Error(`Mesen produced no output ${r.stdout ?? ''}${r.stderr ?? ''}`);
  const lines = readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { status: r.status, ms, lines };
}

/** Shot conditions (first frame where the probe matches + SHOT_DELAY): every screen, every kind of window. */
function shotRules(meta, cls) {
  const rules = [];
  const scr = (id) => meta.screenIndex.get(id);
  const battles = [...meta.battles.entries()];
  if (cls === classes[0]) {
    // BLUMZ-F2: the bot now waits on the title (BLUMZ-W P3-1: this shot was taken during the fade-out), then
    // goes down to CONTINUER: one arrow only (BLUMZ-W P2-1)
    rules.push({ name: 'title', when: (p) => p.state === LS.title && p.palLevel === 0, delay: 20 });
    rules.push({ name: 'title-continuer', when: (p) => p.state === LS.title && p.selCur === 1, delay: 4 });
    let cards = 0;
    let lastState = -1;
    // counts the cards seen (never matches itself: rules are evaluated every frame until they match)
    rules.push({
      name: 'card-counter',
      counter: true,
      when: (p) => {
        if (p.state === LS.card && lastState !== LS.card) cards++;
        lastState = p.state;
        return false;
      },
    });
    rules.push({ name: 'card-prologue', when: (p) => p.state === LS.card });
    rules.push({ name: 'card-maternelle', when: (p) => p.state === LS.card && cards === 2 });
    rules.push({ name: 'card-1re', when: (p) => p.state === LS.card && cards === 3 });
    rules.push({ name: 'card-fin', when: (p) => p.state === LS.end && p.palLevel === 0, delay: 10 });
    for (const s of meta.screens) rules.push({ name: `map-${s.id}`, when: (p) => p.state === LS.map && p.screen === s.index && p.palLevel === 0, delay: 12 });
    for (const s of meta.screens) rules.push({ name: `dialog-${s.id}`, when: (p) => p.state === LS.dialog && p.dSub === DS.wait && p.screen === s.index && !p.menuOpen });
    rules.push({ name: 'classes', when: (p) => p.state === LS.classes && p.palLevel === 0, delay: 1 }); // BLUMZ-F2: the Guerrier bot picks at once (was black)
    rules.push({ name: 'choice', when: (p) => p.state === LS.dialog && p.dSub === DS.choice });
    rules.push({ name: 'menu', when: (p) => p.state === LS.menu && p.mSub === MS.select, delay: 4 });
    rules.push({ name: 'menu-objets', when: (p) => p.state === LS.dialog && p.menuOpen && p.dSub === DS.wait });
    rules.push({ name: 'slide-horizontal', when: (p) => p.state === LS.scroll && p.mirror === 0 && p.scrollX === 128, delay: 0 });
    rules.push({ name: 'slide-vertical', when: (p) => p.state === LS.scroll && p.mirror === 1 && p.scrollY >= 116 && p.scrollY <= 124, delay: 0 });
    void scr;
    for (const [id, i] of battles) {
      const short = id.replace(/^BAT_/, '').toLowerCase().replace(/_/g, '-');
      rules.push({ name: `battle-${short}-intro`, when: (p) => p.state === LS.battle && p.battle === i && p.bSub === BS.wait && p.turn === 0 });
      rules.push({ name: `battle-${short}-menu`, when: (p) => p.state === LS.battle && p.battle === i && p.bSub === BS.menu && p.turn === 0, delay: 4 });
      rules.push({ name: `battle-${short}-turn2`, when: (p) => p.state === LS.battle && p.battle === i && p.bSub === BS.wait && p.turn === 2 });
      rules.push({ name: `battle-${short}-win`, when: (p) => p.state === LS.battle && p.battle === i && p.bSub === BS.wait && p.pose === 3 });
    }
  }
  // every class: its power on Marie-Claude (the class's effect sprite) and her dictée
  const mc = meta.battles.get('BAT_MARIE_CLAUDE');
  rules.push({ name: 'battle-marie-claude-power', when: (p) => p.state === LS.battle && p.battle === mc && p.bSub === BS.type && p.turn === 1, delay: 6 });
  rules.push({ name: 'battle-marie-claude-charge', when: (p) => p.state === LS.battle && p.battle === mc && p.charge === 1 && p.bSub === BS.wait });
  return rules;
}

/** Lines to read glyph by glyph in Mesen's shots (Guerrier run). */
function readableTexts(meta, name, taken) {
  const out = [];
  const startPage = meta.texts.find((t) => t.where === 'script SCR_START')?.pages[0];
  const salon = taken.get('dialog-salon');
  if (startPage && salon) {
    const row = salon.probe.dRow;
    out.push({ file: `${name}-mesen-dialog-salon`, row: row + 1, col: 2, text: startPage[0] });
    out.push({ file: `${name}-mesen-dialog-salon`, row: row + 3, col: 2, text: startPage[1] });
  }
  if (taken.has('battle-mouton-menu')) {
    out.push({ file: `${name}-mesen-battle-mouton-menu`, row: 25, col: 4, text: 'Défense' });
    out.push({ file: `${name}-mesen-battle-mouton-menu`, row: 23, col: 15, text: 'Énergie' });
  }
  if (taken.has('menu')) out.push({ file: `${name}-mesen-menu`, row: 9, col: 4, text: 'Objets' });
  return out;
}

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

// Mesen (left) and jsnes (right), 1x, two pairs per row: every shot of the first class; then the power shot
// of every class.
function contactSheets() {
  const sheet = (file, pairs) => {
    pairs = pairs.filter(([m, j]) => existsSync(m) && existsSync(j));
    if (!pairs.length) return;
    const per = 2;
    const W = per * (256 * 2 + 16) + 8;
    const rows = Math.ceil(pairs.length / per);
    const H = rows * 248;
    const outImg = new Uint8Array(W * H * 4);
    for (let i = 3; i < outImg.length; i += 4) outImg[i] = 255;
    pairs.forEach((pair, k) => {
      const ox = (k % per) * (256 * 2 + 16);
      const oy = Math.floor(k / per) * 248;
      pair.forEach((f, c) => {
        const img = decodePng(readFileSync(f));
        const scale = img.width / 256;
        for (let y = 0; y < 240; y++) {
          for (let x = 0; x < 256; x++) {
            const si = (Math.floor(y * scale) * img.width + Math.floor(x * scale)) * 4;
            const di = ((oy + y) * W + ox + c * 260 + x) * 4;
            outImg[di] = img.data[si];
            outImg[di + 1] = img.data[si + 1];
            outImg[di + 2] = img.data[si + 2];
          }
        }
      });
    });
    writeFileSync(path.join(work, file), encodePng(outImg, W, H, 1));
  };
  const first = CLASS_NAMES[classes[0]];
  const firstShots = shotNames.filter((n) => n.startsWith(`${first}-`)).map((n) => n.slice(first.length + 1));
  sheet('contact-sheet-guerrier.png', firstShots.map((n) => [path.join(shots, `${first}-mesen-${n}.png`), path.join(shots, `${first}-jsnes-${n}.png`)]));
  sheet('contact-sheet-classes.png', classes.map((c) => CLASS_NAMES[c]).flatMap((n) => ['battle-marie-claude-power', 'battle-marie-claude-charge'].map((s) => [path.join(shots, `${n}-mesen-${s}.png`), path.join(shots, `${n}-jsnes-${s}.png`)])));
}
