// Engine-tier helpers: build fixture projects with the real cc65 toolchain (cached by input hash) and run
// them in the headless jsnes harness (TEST-STRATEGY §3).
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as jsnes from 'jsnes';
import { buildRom, defaultToolchain, type BuildResult } from '../../src/core/build/engine-build';
import { demoDocs } from '../../src/core/engine-data/demo';
import type { EmitOptions } from '../../src/core/engine-data/emit';
import { RomHarness, type Prefill, type Probe } from '../../src/core/emu/harness';
import type { JsnesModule } from '../../src/core/emu/nes-session';
import { DEFAULT_AUDIO } from '../../src/core/schema/misc';
import { DEFAULT_PHYSICS } from '../../src/core/schema/physics';
import { DEFAULT_CARTRIDGE } from '../../src/core/schema/project';
import { DEFAULT_STORY } from '../../src/core/schema/story';
import type { Json } from '../../src/core/util/json-pointer';
import { encodePng } from '../../src/core/util/png';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const ENGINE_DIR = path.join(ROOT, 'engine');
export const JSNES = jsnes as unknown as JsnesModule;

/** M1 defaults + the demo stage: what a new project contains. */
export function demoProjectDocs(): Record<string, Json> {
  return structuredClone({
    'cartridge.json': DEFAULT_CARTRIDGE,
    'story.json': { ...DEFAULT_STORY, title: 'BLUM DEMO' },
    'physics.json': DEFAULT_PHYSICS,
    'audio/library.json': DEFAULT_AUDIO,
    ...demoDocs(),
  }) as Record<string, Json>;
}

function engineHash(): string {
  const h = createHash('sha1');
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else h.update(name).update(readFileSync(p));
    }
  };
  for (const d of ['cfg', 'src', 'lib', 'audio']) walk(path.join(ENGINE_DIR, d));
  return h.digest('hex');
}

let cachedEngineHash: string | null = null;
const memo = new Map<string, BuildResult>();

/** Builds once per (engine sources, docs, options); later calls reuse the result. */
export function buildFixture(docs: Record<string, Json>, emit: EmitOptions = {}, assets: Record<string, Uint8Array> = {}): BuildResult {
  cachedEngineHash ??= engineHash();
  const h = createHash('sha1').update(cachedEngineHash).update(JSON.stringify(docs)).update(JSON.stringify(emit));
  for (const [p, b] of Object.entries(assets).sort()) h.update(p).update(b);
  const key = h.digest('hex').slice(0, 16);
  const hit = memo.get(key);
  if (hit) return hit;
  const workDir = path.join(ROOT, '.tmp', 'engine-builds', key);
  const r = buildRom({ docs, assets, engineDir: ENGINE_DIR, toolchain: defaultToolchain(ROOT), workDir, emit });
  if (!r.ok) throw new Error('fixture build failed: ' + r.issues.map((i) => i.fr).join(' | ') + '\n' + r.steps.map((s) => s.output).join('\n'));
  memo.set(key, r);
  return r;
}

export function harness(rom: Uint8Array, prefill?: Prefill): RomHarness {
  return new RomHarness(JSNES, rom, { prefill });
}

/** Boot to the title, press Start, wait for play (state 3). */
export function startPlay(h: RomHarness): void {
  h.step(60);
  h.step(2, ['START']);
  const n = h.runUntil((p) => p.state === 3, 120);
  if (n < 0) throw new Error('never reached play state');
  h.step(2);
}

/**
 * Hold Right; each time the player reaches the next x threshold while grounded, hold A for `jumpFrames`.
 * Stops when `until` holds or after maxFrames. Returns the probe trace.
 */
export function runRight(h: RomHarness, jumpAt: number[], until: (p: Probe) => boolean, maxFrames = 3000, jumpFrames = 22): Probe[] {
  const trace: Probe[] = [];
  const queue = [...jumpAt];
  let jumping = 0;
  for (let f = 0; f < maxFrames; f++) {
    const p = h.probe();
    if (jumping === 0 && queue.length && p.px >= queue[0]! && p.flags & 1) {
      queue.shift();
      jumping = jumpFrames;
    }
    h.step(1, jumping > 0 ? ['RIGHT', 'A'] : ['RIGHT']);
    if (jumping > 0) jumping--;
    const q = h.probe();
    trace.push(q);
    if (until(q)) return trace;
  }
  return trace;
}

/** PNG of the current frame (×2) under .tmp/engine-shots/. */
export function writeShot(h: RomHarness, name: string): string {
  const dir = path.join(ROOT, '.tmp', 'engine-shots');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  writeFileSync(file, encodePng(h.rgba(), 256, 240, 2));
  return file;
}
