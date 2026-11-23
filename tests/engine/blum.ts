// M6 helpers: the sample game BLUM made by the FakeProvider replay (once per test process), built with
// the real toolchain, and the per-stage input scripts (tests/engine/blum-scripts/*.txt).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pricesSchema } from '../../src/core/llm/prices';
import { makeSampleBlum } from '../../src/core/sample/blum';
import type { EmitOptions } from '../../src/core/engine-data/emit';
import type { ButtonName } from '../../src/core/emu/nes-session';
import type { RomHarness } from '../../src/core/emu/harness';
import type { Json } from '../../src/core/util/json-pointer';
import { tempDir } from '../helpers';
import { buildFixture, ROOT } from './rom';

let cached: Promise<{ docs: Record<string, Json>; assets: Record<string, Uint8Array>; dir: string }> | null = null;

/** The BLUM project documents and assets, made once by the replay. */
export function blumProject(): Promise<{ docs: Record<string, Json>; assets: Record<string, Uint8Array>; dir: string }> {
  cached ??= (async () => {
    const prices = pricesSchema.parse(JSON.parse(readFileSync(path.join(ROOT, 'config', 'prices.json'), 'utf8')));
    const dir = path.join(tempDir(), 'BLUM.blum');
    const { store } = await makeSampleBlum(dir, prices);
    try {
      return { docs: store.docs(), assets: store.assets(), dir };
    } finally {
      store.close();
    }
  })();
  return cached;
}

export async function buildBlum(emit: EmitOptions = {}) {
  const p = await blumProject();
  return buildFixture(p.docs, emit, p.assets);
}

/** Stage ids in story order (START_LEVEL index). */
export const BLUM_STAGE_IDS = ['w1-s1', 'w1-s2', 'w2-s1', 'w2-s2', 'w3-s1', 'w3-s2', 'w4-s1', 'w4-s2', 'w4-f'] as const;

/**
 * Input script text: one step per line, `<frames> <buttons>` with buttons among R L U D A B S (Start)
 * or `-` for none; `#` starts a comment. Example: `40 R`, `22 RA`, `10 -`.
 */
export function parseScript(text: string): Array<{ frames: number; hold: ButtonName[] }> {
  const names: Record<string, ButtonName> = { R: 'RIGHT', L: 'LEFT', U: 'UP', D: 'DOWN', A: 'A', B: 'B', S: 'START' };
  const out: Array<{ frames: number; hold: ButtonName[] }> = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [n, keys = '-'] = line.split(/\s+/);
    const frames = Number(n);
    if (!Number.isInteger(frames) || frames <= 0) throw new Error(`bad frame count: ${raw}`);
    const hold = keys === '-' ? [] : [...keys].map((k) => {
      const b = names[k];
      if (!b) throw new Error(`bad button ${k}: ${raw}`);
      return b;
    });
    out.push({ frames, hold });
  }
  return out;
}

export function readScript(stage: string): Array<{ frames: number; hold: ButtonName[] }> {
  return parseScript(readFileSync(path.join(ROOT, 'tests', 'engine', 'blum-scripts', `${stage}.txt`), 'utf8'));
}

/** From power-on of a START_LEVEL build: title, Start, through the world intro if any, until play. */
export function bootToPlay(h: RomHarness): void {
  h.step(60);
  h.step(2, ['START']);
  for (let i = 0; i < 600; i++) {
    h.step(1);
    const p = h.probe();
    if (p.state === 3) return;
    if (p.state === 2 && i % 40 === 20) h.step(2, ['START']);
  }
  throw new Error('never reached play state');
}
