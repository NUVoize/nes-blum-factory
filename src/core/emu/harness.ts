// Headless ROM test harness (TEST-STRATEGY §3): frames, input scripts, RAM probe, framebuffer hash,
// dirty boot (RAM/WRAM pre-fill). Used by the engine test tier and the build's headless check.
import { createHash } from 'node:crypto';
import { PROBE } from '../engine-data/contract.js';
import { NesSession, type ButtonName, type JsnesModule } from './nes-session.js';

export interface InputStep {
  frames: number;
  hold?: ButtonName[];
}

export interface Probe {
  magic: string;
  version: number;
  state: number;
  world: number;
  stage: number;
  frame: number;
  px: number;
  py: number;
  hp: number;
  lives: number;
  flags: number;
  event: number;
  bossHp: number;
  enemies: number;
  checkpoint: number;
  lagFrames: number;
  collected: number;
  camX: number;
  stressErrors: number;
  // M4a
  shots: number;
  kills: number;
  enemyShots: number;
  bossPhase: number;
  textScreen: number;
  bossX: number;
}

export type Prefill = 'clean' | 0xff | { seed: number };

/** Small deterministic PRNG (mulberry32) for the seeded dirty-boot pattern. */
export function seededBytes(seed: number, n: number): Uint8Array {
  let a = seed >>> 0;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[i] = ((t ^ (t >>> 14)) >>> 0) & 0xff;
  }
  return out;
}

export class RomHarness {
  readonly s: NesSession;

  constructor(
    jsnes: JsnesModule,
    readonly rom: Uint8Array,
    opts: { prefill?: Prefill } = {},
  ) {
    this.s = new NesSession(jsnes);
    this.s.load(rom);
    this.prefill(opts.prefill ?? 'clean');
  }

  /** Simulates power-on RAM contents: internal RAM $0000-$07FF and WRAM $6000-$7FFF. */
  private prefill(p: Prefill): void {
    if (p === 'clean') return;
    const mem = this.s.mem;
    const bytes = p === 0xff ? new Uint8Array(0x800 + 0x2000).fill(0xff) : seededBytes(p.seed, 0x800 + 0x2000);
    mem.set(bytes.subarray(0, 0x800), 0);
    mem.set(bytes.subarray(0x800), 0x6000);
  }

  get frames(): number {
    return this.s.frames;
  }

  step(n = 1, hold: ButtonName[] = []): void {
    this.s.setButtons(hold);
    for (let i = 0; i < n; i++) this.s.step();
  }

  /** Runs a script; `onFrame` sees the probe after every frame. */
  run(script: InputStep[], onFrame?: (p: Probe, h: RomHarness) => void): void {
    for (const st of script) {
      this.s.setButtons(st.hold ?? []);
      for (let i = 0; i < st.frames; i++) {
        this.s.step();
        onFrame?.(this.probe(), this);
      }
    }
    this.s.setButtons([]);
  }

  /** Steps until `pred` holds (checked after each frame). Returns the frame count used, or -1. */
  runUntil(pred: (p: Probe) => boolean, maxFrames: number, hold: ButtonName[] = []): number {
    this.s.setButtons(hold);
    for (let i = 1; i <= maxFrames; i++) {
      this.s.step();
      if (pred(this.probe())) return i;
    }
    return -1;
  }

  probe(): Probe {
    const m = this.s.mem;
    const b = (o: number) => m[PROBE.base + o]!;
    const w = (o: number) => b(o) | (b(o + 1) << 8);
    return {
      magic: String.fromCharCode(b(0), b(1), b(2), b(3)),
      version: b(PROBE.version),
      state: b(PROBE.state),
      world: b(PROBE.world),
      stage: b(PROBE.stage),
      frame: w(PROBE.frame),
      px: w(PROBE.px),
      py: b(PROBE.py),
      hp: b(PROBE.hp),
      lives: b(PROBE.lives),
      flags: b(PROBE.flags),
      event: b(PROBE.event),
      bossHp: b(PROBE.bossHp),
      enemies: b(PROBE.enemies),
      checkpoint: b(PROBE.checkpoint),
      lagFrames: b(PROBE.lag),
      collected: b(PROBE.collected),
      camX: w(PROBE.camX),
      stressErrors: b(PROBE.stressErrors),
      shots: b(PROBE.shots),
      kills: b(PROBE.kills),
      enemyShots: b(PROBE.enemyShots),
      bossPhase: b(PROBE.bossPhase),
      textScreen: b(PROBE.textScreen),
      bossX: w(PROBE.bossX),
    };
  }

  /** SHA-1 of the RGB framebuffer jsnes delivered (master palette applied). */
  frameHash(): string {
    return createHash('sha1').update(Buffer.from(this.s.frame.buffer, this.s.frame.byteOffset, this.s.frame.byteLength)).digest('hex');
  }

  /** True when every pixel has the same colour. */
  frameUniform(): boolean {
    const f = this.s.frame;
    const first = f[0];
    for (let i = 1; i < f.length; i++) if (f[i] !== first) return false;
    return true;
  }

  /** Nametable tile indices of a rectangle (nametable A by default). */
  nametableTiles(col: number, row: number, w: number, h = 1, base = 0x2000): number[] {
    const out: number[] = [];
    for (let r = row; r < row + h; r++) for (let c = col; c < col + w; c++) out.push(this.s.nametableByte(base + r * 32 + c));
    return out;
  }

  /** OAM entries that are on screen (y < 0xEF). */
  sprites(): Array<{ index: number; y: number; tile: number; attr: number; x: number }> {
    const oam = this.s.oam;
    const out: Array<{ index: number; y: number; tile: number; attr: number; x: number }> = [];
    for (let i = 0; i < 64; i++) {
      const y = oam[i * 4]!;
      if (y >= 0xef) continue;
      out.push({ index: i, y, tile: oam[i * 4 + 1]!, attr: oam[i * 4 + 2]!, x: oam[i * 4 + 3]! });
    }
    return out;
  }

  /** RGBA bytes (for PNG snapshots). */
  rgba(): Uint8Array {
    const out = new Uint8Array(256 * 240 * 4);
    this.s.frame.forEach((v, i) => {
      out[i * 4] = v & 0xff;
      out[i * 4 + 1] = (v >> 8) & 0xff;
      out[i * 4 + 2] = (v >> 16) & 0xff;
      out[i * 4 + 3] = 0xff;
    });
    return out;
  }
}
