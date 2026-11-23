// Dev tool, not a gate test: CPU cycles per function over 600 frames of the M4-T10 stress level, from the
// ld65 labels. Run with NBF_PROFILE=1 npm run test:engine -- tests/engine/profile-rom.test.ts;
// the table goes to .tmp/profile-rom.txt. Found the cc65 tosicmp / beh_at hot spots in M4a.
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { FEATURE_LEVELS } from '../../src/core/engine-data/feature-levels';
import { buildFixture, harness } from './rom';

it.skipIf(!process.env.NBF_PROFILE)('profile: CPU cycles per function on the stress level', () => {
  const b = buildFixture(FEATURE_LEVELS.stress());
  const h = harness(b.rom!);
  h.step(60);
  h.step(2, ['START']);
  h.runUntil((p) => p.state === 3, 120);
  const labels = [...b.labels].filter(([n, a]) => a >= 0xa000 && !/^__|^@|^L[0-9A-F]{4}$/.test(n)).sort((x, y) => x[1] - y[1]);
  const fnOf = (pc: number) => {
    let lo = 0, hi = labels.length - 1, best = '?';
    while (lo <= hi) { const m = (lo + hi) >> 1; if (labels[m]![1] <= pc) { best = labels[m]![0]; lo = m + 1; } else hi = m - 1; }
    return pc < 0xa000 ? 'bank8000' : best;
  };
  const cpu = (h.s.nes as unknown as { cpu: { emulate(): number; REG_PC: number } }).cpu;
  const orig = cpu.emulate.bind(cpu);
  const bucket = new Map<string, number>();
  let total = 0;
  cpu.emulate = () => { const pc = (cpu.REG_PC + 1) & 0xffff; const c = orig(); total += c; const f = fnOf(pc); bucket.set(f, (bucket.get(f) ?? 0) + c); return c; };
  const frames = 600;
  const lag0 = h.probe().lagFrames;
  for (let i = 0; i < frames; i++) h.step(1, i % 20 < 2 ? ['B'] : i % 60 < 30 ? ['RIGHT'] : ['LEFT']);
  const lag = h.probe().lagFrames - lag0;
  const rows = [...bucket].sort((a, b2) => b2[1] - a[1]).slice(0, 45).map(([n, c]) => `${n.padEnd(28)} ${(c / frames).toFixed(0).padStart(7)} cyc/frame ${((100 * c) / total).toFixed(1)}%`);
  writeFileSync('.tmp/profile-rom.txt', [`lag ${lag} total ${(total / frames).toFixed(0)} cyc/frame`, ...rows].join(String.fromCharCode(10)));
});
