// SEBRING engine spike: probe layout, the bot (same policy as tests/mesen/racer-spike.lua) and the shot
// list shared by the jsnes run (tests/engine/racer-spike.test.ts, scripts/racer-spike.mjs) and Mesen.
import type { ButtonName } from '../emu/nes-session.js';

/** Probe block at $7F00 (docs/RACER-PLAN.md section 6.2). */
export const SPIKE_PROBE = {
  base: 0x7f00,
  state: 0x05,
  seg: 0x06,
  curve: 0x07,
  frame: 0x08,
  speed: 0x0a,
  carX: 0x0b,
  hill: 0x0c,
  hy: 0x0d,
  phase: 0x0e,
  offroad: 0x0f,
  dist: 0x10,
  bdX: 0x12,
  lag: 0x14,
  idle: 0x16,
  idleMin: 0x18,
} as const;

/** Cycles of one idle-loop iteration in spike.s main (inc zp / bne / cmp zp / beq). */
export const IDLE_CYCLES = 14;
/** NTSC CPU cycles per frame (341 × 262 / 3, rendering on, odd frames one dot shorter). */
export const FRAME_CYCLES = 29780.5;

export interface SpikeProbe {
  magic: string;
  state: number;
  seg: number;
  curve: number;
  frame: number;
  speed: number;
  carX: number;
  hill: number;
  hy: number;
  phase: number;
  offroad: number;
  dist: number;
  bdX: number;
  lag: number;
  idle: number;
  idleMin: number;
}

const s8 = (v: number) => (v >= 128 ? v - 256 : v);

export function readSpikeProbe(mem: Uint8Array): SpikeProbe {
  const b = (o: number) => mem[SPIKE_PROBE.base + o]!;
  const w = (o: number) => b(o) | (b(o + 1) << 8);
  return {
    magic: String.fromCharCode(b(0), b(1), b(2), b(3)),
    state: b(SPIKE_PROBE.state),
    seg: b(SPIKE_PROBE.seg),
    curve: s8(b(SPIKE_PROBE.curve)),
    frame: w(SPIKE_PROBE.frame),
    speed: b(SPIKE_PROBE.speed),
    carX: b(SPIKE_PROBE.carX),
    hill: s8(b(SPIKE_PROBE.hill)),
    hy: b(SPIKE_PROBE.hy),
    phase: b(SPIKE_PROBE.phase),
    offroad: b(SPIKE_PROBE.offroad),
    dist: w(SPIKE_PROBE.dist),
    bdX: w(SPIKE_PROBE.bdX),
    lag: b(SPIKE_PROBE.lag),
    idle: w(SPIKE_PROBE.idle),
    idleMin: w(SPIKE_PROBE.idleMin),
  };
}

/** Hold A (gas), steer back toward x 128. */
export function spikeBot(p: SpikeProbe): ButtonName[] {
  if (p.magic !== 'SBRG') return [];
  const out: ButtonName[] = ['A'];
  if (p.carX < 120) out.push('RIGHT');
  else if (p.carX > 136) out.push('LEFT');
  return out;
}

export interface ShotSpec {
  name: string;
  /** Fixed frame, or the first frame the probe matches seg + curve + hill. */
  frame?: number;
  seg?: number;
  curve?: number;
  hill?: number;
}

export const SPIKE_SHOTS: ShotSpec[] = [
  { name: 'straight', frame: 200 },
  { name: 'stripes-0', frame: 420 },
  { name: 'stripes-1', frame: 421 },
  { name: 'stripes-2', frame: 422 },
  { name: 'stripes-3', frame: 423 },
  { name: 'left-curve', seg: 1, curve: -24, hill: 0 },
  { name: 'right-curve', seg: 3, curve: 24, hill: 0 },
  { name: 'uphill', seg: 5, curve: 0, hill: 15 },
  { name: 'crest', seg: 6, curve: 0, hill: -10 },
  { name: 'hard-left', seg: 8, curve: -32, hill: 0 },
  { name: 'hard-right', seg: 9, curve: 31, hill: 0 },
];

export function shotMatches(s: ShotSpec, frame: number, p: SpikeProbe): boolean {
  if (s.frame !== undefined) return frame === s.frame;
  return p.seg === s.seg && p.curve === s.curve && p.hill === s.hill;
}

/** Free CPU cycles of a frame from its idle count. */
export function freeCycles(idle: number): number {
  return idle * IDLE_CYCLES;
}
