// Dev tool (M6-T4): finds an input script that clears one BLUM stage from a debug start (START_LEVEL),
// by a go-explore search over 8-frame button chords in the headless jsnes harness, then writes it as a readable
// script (tests/engine/blum-scripts/<stage>.txt). The test tier only replays the frozen scripts; this
// helper is how they were found. Never run in parallel with another heavy job (box-01 rule).
// Usage: npm run build first, then node scripts/blum-search.mjs <stage-id|all> [--max 700] (x40 rollouts)
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const dist = (p) => path.join(root, 'dist', 'electron', 'core', ...p.split('/'));
const { RomHarness } = require(dist('emu/harness.js'));
const { buildRom, defaultToolchain } = require(dist('build/engine-build.js'));
const { makeSampleBlum } = require(dist('sample/blum.js'));
const { pricesSchema } = require(dist('llm/prices.js'));
const { acquireGateLock } = require(dist('gate-lock.js'));
const jsnes = await import('jsnes');

const STAGES = ['w1-s1', 'w1-s2', 'w2-s1', 'w2-s2', 'w3-s1', 'w3-s2', 'w4-s1', 'w4-s2', 'w4-f'];
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const MAX_DEPTH = opt('max', 700);
const STEP = 8;
// chord weights for random rollouts (moving right and jumping dominate)
const WEIGHTED = [
  ['R', 30], ['RA', 22], ['RB', 10], ['-', 5], ['A', 5], ['B', 6], ['L', 6], ['LA', 5], ['U', 4], ['UR', 3], ['D', 2], ['LB', 2],
];
const TOTAL = WEIGHTED.reduce((n, [, w]) => n + w, 0);
const wanted = args[0] === 'all' || !args[0] ? STAGES : [args[0]];

const NAMES = { R: 'RIGHT', L: 'LEFT', U: 'UP', D: 'DOWN', A: 'A', B: 'B', S: 'START' };
const hold = (c) => (c === '-' ? [] : [...c].map((k) => NAMES[k]));

const release = await acquireGateLock(path.join(root, '.tmp', 'gate.lock'), 'blum-search');
const work = mkdtempSync(path.join(tmpdir(), 'nbf-search-'));
try {
  const prices = pricesSchema.parse(JSON.parse(readFileSync(path.join(root, 'config', 'prices.json'), 'utf8')));
  const { store } = await makeSampleBlum(path.join(work, 'BLUM.blum'), prices);
  const docs = store.docs();
  const assets = store.assets();
  store.close();
  for (const stage of wanted) {
    const index = STAGES.indexOf(stage);
    const r = buildRom({ docs, assets, engineDir: path.join(root, 'engine'), toolchain: defaultToolchain(root), workDir: path.join(work, `build-${stage}`), emit: { startLevel: index } });
    if (!r.ok) throw new Error(`build ${stage}: ${r.issues.map((i) => i.fr).join(' | ')}`);
    const t0 = Date.now();
    const script = args.includes('--policy') ? fight(r.rom, stage) : search(r.rom, stage);
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    if (!script) {
      console.log(`${stage}: NOT FOUND (${secs} s)`);
      continue;
    }
    // the script must stand alone: replay it from power-on in a fresh emulator
    const check = new RomHarness(jsnes, r.rom);
    replayPrefix(check, script.text);
    const end = check.probe();
    const wantArena = args.includes('--goal-arena');
    if (wantArena ? !(end.bossX > 0 && end.bossHp > 0) : end.state !== 5) {
      console.log(`${stage}: FOUND BUT DOES NOT REPLAY (state ${end.state}, x ${end.px})`);
      continue;
    }
    const out = args.includes('--goal-arena') ? path.join(root, '.tmp', `prefix-${stage}.txt`) : path.join(root, 'tests', 'engine', 'blum-scripts', `${stage}.txt`);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, script.text);
    console.log(`${stage}: ${script.frames} frames, ${script.lines} lines (${secs} s)`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
  release();
}

/** Frame-level boot: title, Start, Start through the world intro, until play. Returns the frame inputs. */
function boot(h) {
  const frames = [];
  const step = (n, c) => {
    for (let i = 0; i < n; i++) {
      h.step(1, hold(c));
      frames.push(c);
    }
  };
  step(60, '-');
  step(2, 'S');
  for (let i = 0; i < 600; i++) {
    const p = h.probe();
    if (p.state === 3) return frames;
    if (p.state === 2 && i % 40 === 20) step(2, 'S');
    else step(1, '-');
  }
  throw new Error('never reached play');
}

/** Selection score: progress to the right and up, boss damage, hp kept. */
function score(p, start, bossMax) {
  const boss = p.bossX > 0 && p.bossHp > 0;
  return p.px - p.py * 0.25 + (boss ? 3000 + (bossMax - p.bossHp) * 400 : 0) + p.hp * 700 - (start.lives - p.lives) * 1500 - (p.state === 4 ? 2000 : 0);
}

/** mulberry32: the search is deterministic for a given seed. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


/**
 * Go-explore: an archive of cells (position, hp, boss hp) with a compressed savestate each; pick a promising
 * cell, play a short random rollout from it, keep every new or shorter-path cell. Returns the first win.
 */
function search(rom, stage) {
  const h = new RomHarness(jsnes, rom);
  // --prefix <script>: replay a saved script first (phase 2 of a boss stage); else boot to play
  const prefixArg = args.indexOf('--prefix');
  const bootFrames = prefixArg >= 0 ? replayPrefix(h, readFileSync(args[prefixArg + 1], 'utf8')) : boot(h);
  const start = h.probe();
  const goalArena = args.includes('--goal-arena');
  const random = rng(0xb10b + STAGES.indexOf(stage) + 7919 * opt('seed', 0));
  const pack = () => deflateSync(h.s.saveState(), { level: 1 });
  const unpack = (z) => h.s.loadState(inflateSync(z).toString());
  let bossMax = 0;
  let odd = false;
  // in a boss fight the boss's place matters as much as Blum's
  const cellOf = (p) => `${p.state === 4 ? 'd' : ''}${p.lives}:` + (p.state === 6 ? `${p.px >> 4},${p.py >> 4},${p.hp},${p.bossHp},${p.bossX >> 4}` : `${p.px >> 4},${p.py >> 4},${p.hp},${p.bossHp}`);
  const archive = new Map();
  archive.set(cellOf(start), { z: pack(), chords: [], probe: start, score: score(start, start, 0), visits: 0 });
  const t0 = Date.now();
  let bestScore = -Infinity;
  let lastGain = 0;
  for (let iter = 0; iter < MAX_DEPTH * 40; iter++) {
    // mostly the frontier (high score, few visits), sometimes any cell near it: a takeoff spot a few
    // tiles back is often the way past an obstacle the frontier keeps bumping into
    const cells = [...archive.values()].sort((a, b) => b.score - a.score - (a.visits - b.visits) * 8);
    const top = cells.reduce((m, c) => Math.max(m, c.score), -Infinity);
    if (top > bestScore + 1) {
      bestScore = top;
      lastGain = iter;
    }
    let pick = cells[Math.floor(random() ** 3 * cells.length)];
    if (random() < Math.min(0.6, (iter - lastGain) / 600)) {
      const front = cells.reduce((m, c) => Math.max(m, c.probe.px), 0);
      // the longer the stall, the further back a detour may start (ladders, upper routes)
      const back = 160 + Math.floor((iter - lastGain) / 200) * 96;
      const near = cells.filter((c) => c.probe.px > front - back);
      pick = near[Math.floor(random() * near.length)];
    }
    pick.visits++;
    unpack(pick.z);
    const chords = [...pick.chords];
    let prev = chords.at(-1) ?? 'R';
    let lastProbe = pick.probe;
    for (let k = 0; k < 14; k++) {
      let c = prev;
      const onLadder = (lastProbe.flags & 2) !== 0;
      if (onLadder && random() < 0.6) c = random() < 0.85 ? 'U' : 'UR';
      else if (random() > 0.45) {
        let r = random() * TOTAL;
        for (const [name, w] of WEIGHTED) if ((r -= w) < 0) {
          c = name;
          break;
        }
      }
      let p = null;
      let dead = false;
      for (let f = 0; f < STEP; f++) {
        h.step(1, hold(c));
        p = h.probe();
        // a lost life is allowed (respawn at the checkpoint with full hp, as a player would); game over is not
        // a lag frame fails M6-T8 (0 lag on every stage): that path is no good either
        if (p.state === 8 || p.lives === 0 || p.lagFrames !== start.lagFrames) {
          dead = true;
          break;
        }
        if (p.state === 5) break;
      }
      if (dead) break;
      lastProbe = p;
      chords.push(c);
      prev = c;
      if (p.state === 5) return render(bootFrames, chords, stage, p);
      // phase 1 of a boss stage: the boss is on screen and Blum still has every heart and life
      if (goalArena && p.bossX > 0 && p.bossHp > 0 && p.hp >= 3) return render(bootFrames, chords, stage, p);
      if (p.bossHp > bossMax) bossMax = p.bossHp;
      if (process.env.NBF_SEARCH_DEBUG && p.state === 6 && p.bossHp === 0 && !odd) {
        odd = true;
        console.log(`  odd state: ${JSON.stringify(p)}`);
        writeFileSync(path.join(root, '.tmp', `odd-${stage}.txt`), render(bootFrames, chords, stage, p).text);
      }
      const key = cellOf(p);
      const old = archive.get(key);
      if (!old || chords.length < old.chords.length) archive.set(key, { z: pack(), chords: [...chords], probe: p, score: score(p, start, bossMax), visits: old?.visits ?? 0 });
    }
    if (iter % 500 === 0) {
      const best = [...archive.values()].reduce((a, b) => (b.score > a.score ? b : a));
      const b = best.probe;
      console.log(`  ${stage} iter ${iter}: ${archive.size} cells, best x ${b.px} y ${b.py} hp ${b.hp} boss ${b.bossHp}/${bossMax} state ${b.state} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
  }
  return null;
}


/**
 * Boss fight by a reactive policy (phase 2 of a boss stage, after --prefix): keep a distance, face the boss,
 * fire on a rhythm, jump away or over it when it comes close. Many parameter sets are tried in turn; the
 * first that wins (stage clear) is written. The output is still a plain frame script.
 */
function fight(rom, stage) {
  const prefixArg = args.indexOf('--prefix');
  if (prefixArg < 0) throw new Error('--policy needs --prefix');
  const h = new RomHarness(jsnes, rom);
  const prefix = replayPrefix(h, readFileSync(args[prefixArg + 1], 'utf8'));
  const z = deflateSync(h.s.saveState(), { level: 1 });
  const random = rng(0xf1 + STAGES.indexOf(stage) + 7919 * opt('seed', 0));
  const t0 = Date.now();
  let best = null;
  for (let attempt = 0; attempt < MAX_DEPTH; attempt++) {
    h.s.loadState(inflateSync(z).toString());
    const P = {
      near: 20 + Math.floor(random() * 40),
      far: 70 + Math.floor(random() * 80),
      period: 19 + Math.floor(random() * 14),
      over: random() < 0.5,
      dj: random() < 0.6,
      jitter: random() * 0.25,
    };
    const frames = [];
    let jump = 0;
    let p = h.probe();
    const startLag = p.lagFrames;
    for (let t = 0; t < 5000; t++) {
      const bcx = p.bossX + 16;
      const pcx = p.px + 6;
      const toward = bcx > pcx ? 'R' : 'L';
      const away = toward === 'R' ? 'L' : 'R';
      const dist = Math.abs(bcx - pcx);
      let c = '-';
      if (jump > 0) {
        // a held jump; a fresh A at the apex for the double jump
        const dir = P.over ? toward : away;
        c = P.dj && jump === 8 ? dir : dir + 'A';
        jump--;
      } else if (p.bossX > 0 && dist < P.near && p.flags & 1) {
        jump = 26;
        c = (P.over ? toward : away) + 'A';
      } else if (t % P.period < 2) c = toward + 'B';
      else if (dist > P.far) c = toward;
      else if (dist < P.far - 30) c = away;
      if (random() < P.jitter) c = ['R', 'L', '-', 'RA', 'LA'][Math.floor(random() * 5)];
      h.step(1, hold(c));
      frames.push(c);
      p = h.probe();
      if (p.state === 5) {
        console.log(`  ${stage} fight won on attempt ${attempt} ${JSON.stringify(P)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
        return renderFrames([...prefix, ...frames], stage, p);
      }
      if (p.state === 4 || p.state === 8 || p.lagFrames !== startLag) break;
    }
    if (!best || p.bossHp < best.bossHp) best = { bossHp: p.bossHp, attempt };
    if (attempt % 20 === 0) console.log(`  ${stage} attempt ${attempt}: best boss hp ${best.bossHp} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  return null;
}

/** Replays a frame script (same text format) from power-on; returns its frame inputs. */
function replayPrefix(h, text) {
  const frames = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [n, c] = line.split(/\s+/);
    for (let i = 0; i < Number(n); i++) {
      h.step(1, hold(c));
      frames.push(c);
    }
  }
  return frames;
}

function render(bootFrames, chords, stage, end) {
  const frames = [...bootFrames];
  for (const c of chords) for (let i = 0; i < STEP; i++) frames.push(c);
  return renderFrames(frames, stage, end);
}

function renderFrames(frames, stage, end) {
  // run-length lines
  const lines = [];
  let cur = frames[0];
  let n = 0;
  for (const c of frames) {
    if (c === cur) n++;
    else {
      lines.push(`${n} ${cur}`);
      cur = c;
      n = 1;
    }
  }
  lines.push(`${n} ${cur}`);
  const head = [
    `# BLUM ${stage}: input script from power-on of a START_LEVEL build (M6-T4).`,
    `# One line = <frames> <buttons> (R L U D A B, S = Start, - = none). Found with scripts/blum-search.mjs,`,
    `# then frozen: the test replays it and expects stage clear (probe state 5).`,
    `# End: frame ${end.frame}, x ${end.px}, hp ${end.hp}, event ${end.event}.`,
  ];
  return { text: [...head, ...lines, ''].join('\n'), frames: frames.length, lines: lines.length };
}
