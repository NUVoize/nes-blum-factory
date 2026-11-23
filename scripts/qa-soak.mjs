// BLUM-Q1: seeded random-input soak of every BLUM stage in jsnes, looking for what a scripted route never
// meets: hangs (probe frame counter frozen), softlocks (a state that never ends, a player alive in play who
// cannot move for 30 s), lag frames. Each stage runs from a START_LEVEL build of the shipped sample with
// "player-like" inputs (mostly right, jumps, shots, some left/up/down), Start on game over (continue).
//   node scripts/qa-soak.mjs [--seconds=180] [--seeds=2] [--out=.tmp/q1-soak]
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const seconds = Number(arg('seconds') ?? 180);
const seeds = Number(arg('seeds') ?? 2);
const out = path.resolve(arg('out') ?? path.join(root, '.tmp', 'q1-soak'));
const dist = (p) => path.join(root, 'dist', 'electron', 'core', ...p.split('/'));
const { RomHarness, seededBytes } = require(dist('emu/harness.js'));
const { ProjectStore } = require(dist('project/store.js'));
const { runPipeline } = require(dist('build/pipeline.js'));
const { encodePng } = require(dist('util/png.js'));
const jsnes = await import(pathToFileURL(path.join(root, 'node_modules', 'jsnes', 'src', 'index.js')).href);

const IDS = ['w1-s1', 'w1-s2', 'w2-s1', 'w2-s2', 'w3-s1', 'w3-s2', 'w4-s1', 'w4-s2', 'w4-f'];
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const copy = path.join(out, 'BLUM.blum');
cpSync(path.join(root, 'resources', 'samples', 'BLUM.blum'), copy, { recursive: true });
const st = ProjectStore.open(copy);
const docs = st.docs();
const assets = st.assets();
st.close();

const results = [];
for (let level = 0; level < IDS.length; level++) {
  const r = runPipeline({ docs, assets, engineDir: path.join(root, 'engine'), toolchain: { dir: path.join(root, 'resources', 'toolchain', 'cc65') }, workDir: path.join(out, 'build', `b${level}`), emit: { startLevel: level } });
  for (let seed = 1; seed <= seeds; seed++) {
    const rnd = seededBytes(seed * 101 + level, seconds * 60 + 600);
    let ri = 0;
    const next = () => rnd[ri++ % rnd.length];
    const h = new RomHarness(jsnes, r.rom);
    const rec = { stage: IDS[level], seed, frames: 0, deaths: 0, gameOvers: 0, clears: 0, maxLag: 0, maxFrozen: 0, maxStill: 0, maxStateFrames: {}, problems: [] };
    let hold = [], holdLeft = 0, lastF = -1, frozen = 0, still = 0, lastX = -1, prevState = -1, stateFrames = 0;
    for (let f = 0; f < seconds * 60; f++) {
      const p = h.probe();
      if (holdLeft <= 0) {
        // player-like: 60% right (+ jump 40%), 15% left, 10% shoot, 8% up/down, 7% nothing
        const v = next() % 100;
        hold = v < 60 ? (next() % 10 < 4 ? ['RIGHT', 'A'] : ['RIGHT']) : v < 75 ? (next() % 2 ? ['LEFT', 'A'] : ['LEFT']) : v < 85 ? ['B', 'RIGHT'] : v < 89 ? ['UP'] : v < 93 ? ['DOWN'] : [];
        holdLeft = 4 + (next() % 40);
      }
      holdLeft--;
      const menu = p.state === 1 || p.state === 2 || p.state === 8 || p.state === 7;
      h.step(1, menu ? (f % 50 < 2 ? ['START'] : []) : hold);
      const q = h.probe();
      rec.frames++;
      rec.maxLag = Math.max(rec.maxLag, q.lagFrames);
      if (q.frame === lastF) rec.maxFrozen = Math.max(rec.maxFrozen, ++frozen);
      else frozen = 0;
      lastF = q.frame;
      if (q.state !== prevState) {
        if (q.state === 4) rec.deaths++;
        if (q.state === 8) rec.gameOvers++;
        if (q.state === 5) rec.clears++;
        stateFrames = 0;
      }
      stateFrames++;
      rec.maxStateFrames[q.state] = Math.max(rec.maxStateFrames[q.state] ?? 0, stateFrames);
      prevState = q.state;
      if (q.state === 3 || q.state === 6) {
        still = q.px === lastX ? still + 1 : 0;
        rec.maxStill = Math.max(rec.maxStill, still);
      } else still = 0;
      lastX = q.px;
      if (frozen === 240) rec.problems.push(`hang: probe frame frozen 240 frames at state ${q.state} (frame ${f})`);
      if (still === 1800) {
        rec.problems.push(`stuck: alive in play, x ${q.px} y ${q.py} unchanged for 30 s (frame ${f})`);
        writeFileSync(path.join(out, `stuck-${IDS[level]}-s${seed}-${f}.png`), encodePng(h.rgba(), 256, 240, 2));
      }
      if ((q.state === 4 || q.state === 5) && stateFrames === 600) rec.problems.push(`state ${q.state} lasted 600 frames (frame ${f})`);
    }
    if (rec.maxLag > 0) rec.problems.push(`lag ${rec.maxLag}`);
    results.push(rec);
    console.log(`${rec.stage} seed ${seed}: ${rec.frames} frames, deaths ${rec.deaths}, game overs ${rec.gameOvers}, clears ${rec.clears}, lag ${rec.maxLag}, frozen max ${rec.maxFrozen}, still max ${rec.maxStill}${rec.problems.length ? ' PROBLEMS ' + rec.problems.join(' | ') : ''}`);
  }
}
writeFileSync(path.join(out, 'soak-result.json'), JSON.stringify(results, null, 1));
const bad = results.filter((r) => r.problems.length);
console.log(`qa-soak: ${results.length} runs, ${results.reduce((n, r) => n + r.frames, 0)} frames, ${bad.length} with problems`);
process.exit(bad.length ? 1 : 0);
