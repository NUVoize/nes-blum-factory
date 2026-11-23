// npm run racer:soak (BLUMR-M2, M2-T3): SEBRING soak in jsnes, looking for what the scripted race bot never
// meets: hangs (the game's frame counter frozen for more than 2 s outside loads), softlocks (a state that
// never ends: more than 60 s in one non-driving state), lag frames, an invalid state or a lost probe.
// Runs (3 minutes each, seeds 1..N): race bot, crash bot, idle (time over -> continues -> game over), a
// "player-like" random pad (gas, steering, brakes, pause, radio), the same in snow storm mode, each from a
// dirty boot (0xFF or seeded RAM); then one continuous 20-minute session of the race bot (the whole game
// twice and more, title -> credits -> title). Holds .tmp/gate.lock.
//   node scripts/racer-soak.mjs [--seconds=180] [--seeds=3] [--long=1200] [--out=.tmp/racer-soak]
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const seconds = Number(arg('seconds') ?? 180);
const seeds = Number(arg('seeds') ?? 3);
const long = Number(arg('long') ?? 1200);
const out = path.resolve(arg('out') ?? path.join(root, '.tmp', 'racer-soak'));
const dist = (p) => path.join(root, 'dist', 'electron', 'core', ...p.split('/'));
const { acquireGateLock, GateBusyError } = require(dist('gate-lock.js'));
const { RomHarness, seededBytes } = require(dist('emu/harness.js'));
const { defaultToolchain } = require(dist('build/engine-build.js'));
const { buildRacer } = require(dist('racer/build-racer.js'));
const { readRacerProbe, racerBot, RS } = require(dist('racer/racer-run.js'));
const { encodePng } = require(dist('util/png.js'));
const jsnes = await import(pathToFileURL(path.join(root, 'node_modules', 'jsnes', 'src', 'index.js')).href);

let release = () => {};
try {
  release = await acquireGateLock(path.join(root, '.tmp', 'gate.lock'), 'racer:soak');
} catch (e) {
  console.error(e instanceof GateBusyError ? e.message : String(e));
  process.exit(3);
}

const KINDS = ['race', 'crash', 'idle', 'random', 'random-snow'];
const results = [];
let code = 1;
try {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const b = buildRacer(path.join(root, 'racer'), path.join(root, 'engine'), defaultToolchain(root), path.join(out, 'build'));
  if (!b.ok) throw new Error('racer build failed\n' + b.log);

  const run = (kind, seed, secs) => {
    const prefill = seed % 2 ? 0xff : { seed };
    const h = new RomHarness(jsnes, b.rom, { prefill });
    const rnd = seededBytes(seed * 977 + KINDS.indexOf(kind), 1 << 16);
    let ri = 0;
    const next = () => rnd[ri++ & 0xffff];
    const rec = { kind, seed, prefill: seed % 2 ? '0xFF' : `seed ${seed}`, frames: 0, clears: 0, crashes: 0, continues: 0, gameOvers: 0, titles: 0, maxFrozen: 0, maxStateSeconds: 0, lag: 0, states: {}, snow: 0, problems: [] };
    let p = readRacerProbe(h.s.mem);
    let hold = [];
    let holdLeft = 0;
    let frozen = 0;
    let stateFrames = 0;
    let honked = 0;
    const t0 = Date.now();
    for (let f = 0; f < secs * 60; f++) {
      let pad;
      if (kind === 'random' || kind === 'random-snow') {
        if (p.state === RS.title && kind === 'random-snow' && p.snow === 0) {
          // the secret combo: 3 honks then Select, 12 frames apart
          const k = honked++ % 64;
          pad = k === 8 || k === 20 || k === 32 ? ['B'] : k === 44 ? ['SELECT'] : [];
        } else if (p.state !== RS.drive && p.state !== RS.checkpoint) pad = (p.frame & 31) < 2 ? ['START'] : [];
        else {
          if (holdLeft <= 0) {
            // player-like: 70 % gas (+ steering), 10 % brake, 8 % coast, 2 % pause, 2 % radio, rest steer only
            const v = next() % 100;
            const steer = next() % 3 === 0 ? [] : next() % 2 ? ['LEFT'] : ['RIGHT'];
            hold = v < 70 ? ['A', ...steer] : v < 80 ? ['B', ...steer] : v < 88 ? [] : v < 90 ? ['START'] : v < 92 ? ['SELECT', 'A'] : steer;
            holdLeft = hold.includes('START') || hold.includes('SELECT') ? 1 : 4 + (next() % 40);
          }
          holdLeft--;
          pad = hold;
          if (p.paused && !hold.includes('START') && (p.frame & 63) === 0) pad = ['START']; // never stay paused
        }
      } else pad = racerBot(p, kind);
      h.step(1, pad);
      const prev = p;
      p = readRacerProbe(h.s.mem);
      rec.frames++;
      // a dirty boot holds garbage until reset writes the probe (a frame or two)
      if (p.magic !== 'SBRG') {
        if (f < 30) continue;
        rec.problems.push(`probe lost at frame ${f}`);
        break;
      }
      if (p.state > 9) rec.problems.push(`invalid state ${p.state} at frame ${f}`);
      // the game frame counter stops only while a loader holds the PPU (a few frames) or while paused
      if (p.frame === prev.frame && !p.paused) rec.maxFrozen = Math.max(rec.maxFrozen, ++frozen);
      else frozen = 0;
      if (frozen === 120) rec.problems.push(`hang: game frame frozen 2 s at frame ${f}, state ${p.state}`);
      if (p.state === prev.state && p.state !== RS.drive && p.state !== RS.checkpoint && !p.paused) stateFrames++;
      else stateFrames = 0;
      rec.maxStateSeconds = Math.max(rec.maxStateSeconds, Math.round(stateFrames / 60));
      if (stateFrames === 3600) rec.problems.push(`softlock: state ${p.state} for 60 s at frame ${f}`);
      rec.states[p.state] = (rec.states[p.state] ?? 0) + 1;
      if (p.clears > prev.clears) rec.clears++;
      if (p.crashes > prev.crashes) rec.crashes++;
      if (p.contUsed > prev.contUsed) rec.continues++;
      if (p.state === RS.gameover && prev.state !== RS.gameover) rec.gameOvers++;
      if (p.titles > prev.titles) rec.titles++;
      rec.lag = p.lag;
      rec.snow = p.snow;
    }
    if (rec.lag) rec.problems.push(`${rec.lag} lag frames`);
    if (kind === 'random-snow' && rec.snow !== 1) rec.problems.push('snow mode never switched on');
    rec.ms = Date.now() - t0;
    writeFileSync(path.join(out, `${kind}-${seed}.png`), encodePng(h.rgba(), 256, 240, 1));
    console.log(`${kind.padEnd(11)} seed ${seed} (${rec.prefill.padEnd(7)}) ${String(rec.frames).padStart(6)} frames: clears ${rec.clears}, crashes ${rec.crashes}, continues ${rec.continues}, game overs ${rec.gameOvers}, titles ${rec.titles}, frozen max ${rec.maxFrozen}, longest state ${rec.maxStateSeconds} s, lag ${rec.lag}${rec.problems.length ? `  PROBLEMS: ${rec.problems.join('; ')}` : ''}`);
    return rec;
  };

  for (let seed = 1; seed <= seeds; seed++) for (const kind of KINDS) results.push(run(kind, seed, seconds));
  if (long > 0) results.push(run('race', 99, long));
  const frames = results.reduce((a, r) => a + r.frames, 0);
  const problems = results.flatMap((r) => r.problems.map((x) => `${r.kind}/${r.seed}: ${x}`));
  const summary = { runs: results.length, frames, minutes: +(frames / 3600).toFixed(1), longRunMinutes: long / 60, problems, results };
  writeFileSync(path.join(out, 'soak.json'), JSON.stringify(summary, null, 1));
  console.log(`racer:soak: ${results.length} runs, ${frames} frames (${summary.minutes} min of play), problems ${problems.length}${problems.length ? `: ${problems.join(' | ')}` : ''}`);
  code = problems.length ? 1 : 0;
} catch (e) {
  console.error(String(e?.stack ?? e));
} finally {
  release();
}
process.exit(code);
