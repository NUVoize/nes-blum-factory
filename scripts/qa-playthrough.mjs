// BLUM-Q1: full no-cheat playthrough of a release BLUM ROM, title -> 9 stages -> ending -> credits, by an
// input bot in jsnes and in MesenCE (accurate tier), with per-stage measurements and a jsnes/Mesen compare.
//   node scripts/qa-playthrough.mjs [--rom=release/handover/BLUM.nes] [--out=.tmp/q1] [--no-mesen]
// The bot feeds the frozen stage scripts (tests/engine/blum-scripts) from the frame each stage starts, and
// uses Continue on game over (Start = first stage of the current world with full lives). Needs `npm run build`
// (dist) and, for Mesen, `node scripts/fetch-mesen.mjs`. Writes <out>/q1-result.json and screenshots.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const romPath = path.resolve(arg('rom') ?? path.join(root, 'release', 'handover', 'BLUM.nes'));
const out = path.resolve(arg('out') ?? path.join(root, '.tmp', 'q1'));
const withMesen = !process.argv.includes('--no-mesen');
const dist = (p) => path.join(root, 'dist', 'electron', 'core', ...p.split('/'));
if (!existsSync(dist('build/pipeline.js'))) {
  console.error('qa-playthrough: dist missing, run `npm run build` first');
  process.exit(1);
}
const { RomHarness } = require(dist('emu/harness.js'));
const { ProjectStore } = require(dist('project/store.js'));
const { runPipeline } = require(dist('build/pipeline.js'));
const { encodePng } = require(dist('util/png.js'));
const jsnes = await import(pathToFileURL(path.join(root, 'node_modules', 'jsnes', 'src', 'index.js')).href);

const IDS = ['w1-s1', 'w1-s2', 'w2-s1', 'w2-s2', 'w3-s1', 'w3-s2', 'w4-s1', 'w4-s2', 'w4-f'];
const WORLD = [0, 0, 1, 1, 2, 2, 3, 3, 3];
const BUTTON = { A: 1, B: 2, SELECT: 4, START: 8, UP: 16, DOWN: 32, LEFT: 64, RIGHT: 128 };
const NAMES = { R: 'RIGHT', L: 'LEFT', U: 'UP', D: 'DOWN', A: 'A', B: 'B', S: 'START' };
const parse = (t) =>
  t.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean).map((l) => {
    const [n, k = '-'] = l.split(/\s+/);
    return { frames: +n, hold: k === '-' ? [] : [...k].map((c) => NAMES[c]) };
  });
const frameList = (steps) => steps.flatMap((s) => Array(s.frames).fill(s.hold));
const maskOf = (hold) => hold.reduce((m, b) => m | BUTTON[b], 0);
const holdOf = (m) => Object.keys(BUTTON).filter((b) => m & BUTTON[b]);

rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, 'shots'), { recursive: true });
const rom = new Uint8Array(readFileSync(romPath));
const result = { rom: romPath, romSha1: createHash('sha1').update(rom).digest('hex'), date: new Date().toISOString() };

// 1. Stage scripts from the frame play begins, measured on START_LEVEL builds of the shipped sample.
const copy = path.join(out, 'BLUM.blum');
cpSync(path.join(root, 'resources', 'samples', 'BLUM.blum'), copy, { recursive: true });
const st = ProjectStore.open(copy);
const docs = st.docs();
const assets = st.assets();
st.close();
const suffix = [];
let zp = { musicReq: 0x1c, sfxReq: 0x1d };
IDS.forEach((id, i) => {
  const r = runPipeline({ docs, assets, engineDir: path.join(root, 'engine'), toolchain: { dir: path.join(root, 'resources', 'toolchain', 'cc65') }, workDir: path.join(out, 'build', `b${i}`), emit: { startLevel: i } });
  if (!r.rom) throw new Error(`START_LEVEL ${i} build failed`);
  if (i === 0 && r.dbg) {
    const sym = (n) => Number(new RegExp(`name="${n}",[^\\n]*val=(0x[0-9A-Fa-f]+)`).exec(r.dbg)?.[1]);
    zp = { musicReq: sym('NBF_MUSIC_REQ'), sfxReq: sym('NBF_SFX_REQ') };
  }
  const frames = frameList(parse(readFileSync(path.join(root, 'tests', 'engine', 'blum-scripts', `${id}.txt`), 'utf8')));
  const h = new RomHarness(jsnes, r.rom);
  let start = -1;
  for (let f = 0; f < frames.length; f++) {
    h.step(1, frames[f]);
    // play (3), or boss (6) when the boss stands in the first screen (4-F, BLUM-FIX3)
    if (start < 0 && [3, 6].includes(h.probe().state)) start = f + 1;
  }
  suffix[i] = frames.slice(start).map(maskOf);
});
if (zp.sfxReq !== zp.musicReq + 1) throw new Error(`unexpected zero page layout ${JSON.stringify(zp)}`);

// 2. jsnes: the same bot as tests/mesen/q1-playthrough.lua, frame for frame.
function jsnesRun() {
  const h = new RomHarness(jsnes, rom);
  const attempts = [];
  let cur = null;
  let mode = 'boot', waitI = 0, feedI = 0, goI = 0, endK = 0, next = 0, continues = 0;
  let sawEnding = false, sawCredits = false, creditsAt = -1, endingAt = -1, prevState = -1, frame = 0;
  const shot = (name) => writeFileSync(path.join(out, 'shots', `jsnes-${name}.png`), encodePng(h.rgba(), 256, 240, 2));
  while (frame < 60000) {
    h.step(1, holdOf(next));
    frame++;
    const p = h.probe();
    if (cur && p.state === 4 && prevState !== 4) cur.deaths++;
    prevState = p.state;
    if (cur) {
      cur.frames++;
      cur.maxLag = Math.max(cur.maxLag, p.lagFrames);
      if (p.state === 3 || p.state === 6) {
        const spr = h.s.nes.ppu.spriteMem;
        const count = new Map();
        let worst = 0;
        for (let i = 0; i < 64; i++) {
          const y = spr[i * 4];
          if (y >= 0xef) continue;
          for (let l = y + 1; l <= y + 8; l++) {
            const c = (count.get(l) ?? 0) + 1;
            count.set(l, c);
            worst = Math.max(worst, c);
          }
        }
        cur.maxSpritesLine = Math.max(cur.maxSpritesLine, worst);
        if (worst > 8) cur.overflowFrames++;
      }
    }
    if (mode === 'boot') {
      next = 0;
      if (frame >= 60) (mode = 'wait'), (waitI = 0);
    } else if (mode === 'wait') {
      if (p.state === 3 || p.state === 6) {
        mode = 'feed';
        feedI = 0;
        cur = { level: p.stage, startLives: p.lives, deaths: 0, frames: 0, maxLag: 0, maxSpritesLine: 0, overflowFrames: 0 };
        attempts.push(cur);
      } else {
        next = waitI % 40 < 2 && p.state !== 5 ? BUTTON.START : 0;
        waitI++;
      }
    }
    if (mode === 'feed') {
      if (p.state === 5 || p.state === 7 || p.state === 8) {
        Object.assign(cur, { endState: p.state, endLives: p.lives, endHp: p.hp, event: p.event, px: p.px, bossHp: p.bossHp, scriptLeft: suffix[cur.level].length - feedI });
        shot(`L${cur.level}-a${attempts.length}-end-s${p.state}`);
        const lvl = cur.level;
        cur = null;
        if (p.state === 8) {
          if (++continues > 6) break;
          (mode = 'gameover'), (goI = 0);
        } else if (lvl + 1 >= IDS.length) (mode = 'ending'), (endK = 0);
        else (mode = 'wait'), (waitI = 0);
      } else if (feedI < suffix[cur.level].length) next = suffix[cur.level][feedI++];
      else {
        next = 0;
        if (++feedI > suffix[cur.level].length + 600) {
          cur.stuck = true;
          break;
        }
      }
    }
    if (mode === 'gameover') {
      goI++;
      next = goI > 45 && goI <= 47 ? BUTTON.START : 0;
      if (goI > 47) (mode = 'wait'), (waitI = 0);
    } else if (mode === 'ending') {
      if (p.state === 7 && !sawEnding) (sawEnding = true), (endingAt = endK);
      if (sawEnding && endK === endingAt + 100) shot('ending');
      if (p.textScreen === 3 && !sawCredits) (sawCredits = true), (creditsAt = endK);
      if (sawCredits && endK === creditsAt + 120) shot('credits');
      next = endK % 300 < 2 ? BUTTON.START : 0;
      endK++;
      if ((sawCredits && endK > creditsAt + 600) || endK > 20000) break;
    }
  }
  return { attempts, continues, sawEnding, sawCredits, frames: frame };
}
console.log('jsnes run...');
result.jsnes = jsnesRun();
for (const a of result.jsnes.attempts) console.log(`  jsnes ${IDS[a.level]}: end ${a.endState} deaths ${a.deaths} lives ${a.startLives}->${a.endLives} lag ${a.maxLag} spr/line ${a.maxSpritesLine} (>8 on ${a.overflowFrames} frames)`);
console.log(`  jsnes: continues ${result.jsnes.continues}, ending ${result.jsnes.sawEnding}, credits ${result.jsnes.sawCredits}, ${result.jsnes.frames} frames`);

// 3. Mesen: tests/mesen/q1-playthrough.lua.
function mesenPids(exe) {
  try {
    const o = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='Mesen.exe'\" | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress"], { encoding: 'utf8', windowsHide: true }).trim();
    return o ? [].concat(JSON.parse(o)).filter((p) => (p.ExecutablePath ?? '').toLowerCase() === exe.toLowerCase()).map((p) => p.ProcessId) : [];
  } catch {
    return [];
  }
}
if (withMesen) {
  const mesen = path.resolve(process.env.NBF_MESEN ?? path.join(root, '.tmp', 'tools', 'mesen', 'Mesen.exe'));
  if (!existsSync(mesen)) throw new Error(`Mesen not found (${mesen}): node scripts/fetch-mesen.mjs`);
  const lp = (p) => p.replace(/\\/g, '/');
  const resFile = path.join(out, 'mesen.jsonl');
  const romCopy = path.join(out, 'release.nes');
  writeFileSync(romCopy, rom);
  const hex = (a) => Buffer.from(a).toString('hex');
  const cfg = `local CFG = { out = "${lp(resFile)}", shotDir = "${lp(path.join(out, 'shots'))}", maxFrames = 60000, levels = ${IDS.length}, musicReq = ${zp.musicReq}, sfxReq = ${zp.sfxReq}, world = { ${WORLD.map((w, i) => `[${i}]=${w}`).join(', ')} }, suffix = { ${suffix.map((s, i) => `[${i}]="${hex(s)}"`).join(', ')} } }\n`;
  const lib = readFileSync(path.join(root, 'tests', 'mesen', 'lib.lua'), 'utf8');
  const body = readFileSync(path.join(root, 'tests', 'mesen', 'q1-playthrough.lua'), 'utf8');
  const script = path.join(out, 'q1-playthrough.lua');
  writeFileSync(script, `${cfg}local R = (function()\n${lib}\nend)()\n${body}\n`);
  const before = new Set(mesenPids(mesen));
  console.log('Mesen run...');
  const t0 = Date.now();
  const r = spawnSync(mesen, ['--testrunner', '--timeout=900', romCopy, script], { cwd: path.dirname(mesen), encoding: 'utf8', timeout: 960_000, windowsHide: true });
  for (const pid of mesenPids(mesen)) if (!before.has(pid)) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  if (r.status !== 0 || !existsSync(resFile)) throw new Error(`Mesen exit ${r.status} after ${Date.now() - t0} ms ${r.stdout ?? ''}${r.stderr ?? ''}`);
  const lines = readFileSync(resFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  result.mesen = { ms: Date.now() - t0, attempts: lines.filter((l) => l.kind === 'attempt'), end: lines.find((l) => l.kind === 'end') ?? null, stop: lines.find((l) => l.kind === 'stop') ?? null };
  for (const a of result.mesen.attempts) {
    console.log(`  mesen ${IDS[a.level]}: end ${a.endState} deaths ${a.deaths} hurts ${a.hurts} lives ${a.startLives}->${a.endLives} lag ${a.maxLag} spr/line ${a.maxSpritesLine} (>8 on ${a.overflowFrames} frames) palettes ${a.palettes.length} changes ${a.paletteChanges} bad ${a.badColours} silent ${a.silentSeconds}/${a.seconds}s music ${JSON.stringify(a.music)} sfx ${JSON.stringify(a.sfx)}`);
  }
  console.log(`  mesen: ${JSON.stringify(result.mesen.end ? { ...result.mesen.end, requests: result.mesen.end.requests?.length } : result.mesen.stop)} in ${result.mesen.ms} ms`);
  // Palette RAM against the world's palette set (graphics/palettes.json): backdrop + 3 colours per
  // sub-palette (the unused $3F04/$08/$0C entries are not shown, so not compared).
  const sets = JSON.parse(readFileSync(path.join(copy, 'graphics', 'palettes.json'), 'utf8')).sets;
  const levelWorld = IDS.map((id) => JSON.parse(readFileSync(path.join(copy, 'levels', `${id}.json`), 'utf8')).world);
  for (const a of result.mesen.attempts) {
    const set = sets.find((s) => s.id === levelWorld[a.level]);
    const want = [set.backdrop, ...set.bg.flat(), ...set.sprites.flat()];
    a.paletteMismatch = a.palettes.filter((hex) => {
      const b = Buffer.from(hex, 'hex');
      const got = [b[0], ...[0, 1, 2, 3].flatMap((i) => [b[4 * i + 1], b[4 * i + 2], b[4 * i + 3]]), ...[0, 1, 2, 3].flatMap((i) => [b[16 + 4 * i + 1], b[16 + 4 * i + 2], b[16 + 4 * i + 3]])];
      return got.some((v, i) => v !== want[i]);
    });
    a.paletteSet = set.id;
    console.log(`  palette ${IDS[a.level]} (${set.id}): ${a.palettes.length} snapshot(s), ${a.paletteMismatch.length} differ from palettes.json${a.paletteMismatch.length ? ' ' + a.paletteMismatch.join(' ') : ''}`);
  }
  // 4. Compare: the same sequence of stage attempts with the same outcome.
  const key = (a) => `${IDS[a.level]}:${a.endState}:${a.deaths}:${a.endLives}`;
  const js = result.jsnes.attempts.map(key);
  const me = result.mesen.attempts.map(key);
  result.agree = JSON.stringify(js) === JSON.stringify(me);
  console.log(`jsnes/Mesen same attempts and outcomes: ${result.agree}${result.agree ? '' : `\n  jsnes ${js.join(' ')}\n  mesen ${me.join(' ')}`}`);
}
writeFileSync(path.join(out, 'q1-result.json'), JSON.stringify(result, null, 1));
const finished = (r) => r && r.sawEnding && r.sawCredits;
const ok = finished(result.jsnes) && (!withMesen || (finished(result.mesen.end) && result.agree));
console.log(`qa-playthrough: ${ok ? 'OK' : 'FAIL'} (${path.join(out, 'q1-result.json')})`);
process.exit(ok ? 0 : 1);
