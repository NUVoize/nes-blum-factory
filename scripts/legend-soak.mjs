// npm run legend:soak (BLUMZ-M1): THE LEGEND OF BLUM slice soak in jsnes, looking for what the scripted bot
// never meets: a frozen frame counter (hang), an invalid state, lag frames, a lost probe, a load or a slide
// that never ends. Two parts, each from a dirty boot (RAM and battery RAM full of $FF or noise):
//   1. random: 10 minutes of emulated time (36 000 frames) of a "player-like" pad (walks, A at everything,
//      menu, choices and battles at random), one continuous session;
//   2. mixed: the bot plays the whole slice with each of the 5 classes, interrupted by bursts of random input
//      (detours, menus, wrong answers, fleeing, lost battles), until « À SUIVRE ».
// The random part's input trace is replayed in Mesen by scripts/legend-mesen.mjs (same seed and length).
// Holds .tmp/gate.lock.
//   node scripts/legend-soak.mjs [--seconds=600] [--seed=1] [--out=.tmp/legend-soak]
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const seconds = Number(arg('seconds') ?? 600);
const seed = Number(arg('seed') ?? 1);
const out = path.resolve(arg('out') ?? path.join(root, '.tmp', 'legend-soak'));
const tsc = spawnSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-b'], { cwd: root, stdio: 'inherit' });
if (tsc.status !== 0) process.exit(tsc.status ?? 1);
const dist = (p) => path.join(root, 'dist', 'electron', 'core', ...p.split('/'));
const { acquireGateLock, GateBusyError } = require(dist('gate-lock.js'));
const { defaultToolchain } = require(dist('build/engine-build.js'));
const { buildLegend } = require(dist('rpg/legend/build.js'));
const { LegendBot, loadRoute } = require(dist('rpg/legend/run.js'));
const { soakRun } = require(dist('rpg/legend/soak.js'));
const jsnes = await import(pathToFileURL(path.join(root, 'node_modules', 'jsnes', 'src', 'index.js')).href);

let release = () => {};
try {
  release = await acquireGateLock(path.join(root, '.tmp', 'gate.lock'), 'legend:soak');
} catch (e) {
  console.error(e instanceof GateBusyError ? e.message : String(e));
  process.exit(3);
}
let code = 1;
const result = { seconds, seed, runs: [] };
try {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const b = buildLegend(path.join(root, 'rpg'), path.join(root, 'engine'), defaultToolchain(root), path.join(out, 'build'));
  if (!b.ok) throw new Error('legend build failed\n' + b.log);
  const summary = (kind, r, t0) => {
    const row = { kind, frames: r.frames, minutes: +(r.frames / 3600).toFixed(1), finished: r.finished, bursts: r.bursts, problems: r.problems, lag: r.lag, battles: r.battles, dialogs: r.dialogs, menus: r.menus, screens: r.screens.length, maxStill: r.maxStill, states: r.states, ms: Date.now() - t0 };
    result.runs.push(row);
    console.log(`${kind}: ${row.minutes} min (${r.frames} frames), ${r.problems.length} problems, lag ${r.lag}, battles ${r.battles}, dialogues ${r.dialogs}, menus ${r.menus}, screens ${row.screens}${r.bursts ? `, random bursts ${r.bursts}, finished ${r.finished}` : ''} (${row.ms} ms)`);
    for (const p of r.problems.slice(0, 5)) console.log(`  ${p}`);
    return row;
  };
  let t0 = Date.now();
  summary('random', soakRun(jsnes, b.rom, { seed, frames: seconds * 60, prefill: 0xff }), t0);
  const route = loadRoute(path.join(root, 'rpg'));
  for (let cls = 0; cls < 5; cls++) {
    t0 = Date.now();
    summary(`mixed-class-${cls}`, soakRun(jsnes, b.rom, { seed: 10 + cls, frames: 60000, prefill: { seed: cls }, bot: new LegendBot(b.compiled.meta, b.data, route, { cls }) }), t0);
  }
  const total = result.runs.reduce((n, r) => n + r.frames, 0);
  result.totalMinutes = +(total / 3600).toFixed(1);
  const bad = result.runs.filter((r) => r.problems.length || r.lag || (r.kind.startsWith('mixed') && !r.finished));
  console.log(`legend:soak: ${result.totalMinutes} min of play in total, ${bad.length} run(s) with problems`);
  code = bad.length ? 1 : 0;
} catch (e) {
  console.error(String(e?.stack ?? e));
} finally {
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(result, null, 1));
  release();
}
process.exit(code);
