// Boss script DSL (PLAN §5.7): phases chosen by hp thresholds, each a looped list of steps from a fixed
// set of 8 ops. Core validates and compiles it to a byte stream; the engine interprets it in fixed code.
// Nothing here can express a jump into code, a loop without a frame of waiting, or an address.
import { z } from 'zod';
import { schemaVersion, slugSchema } from '../schema/common.js';

/** The 8 ops, in opcode order. Never reorder: the engine switch uses these numbers. */
export const BOSS_OPS = ['move_to', 'wait', 'jump', 'shoot', 'spawn', 'charge', 'vulnerable', 'flash'] as const;
export type BossOp = (typeof BOSS_OPS)[number];
export const SHOOT_PATTERNS = ['aimed', 'spread', 'rain'] as const;

/** Floor limits (PLAN §12.1): 2 phases; 16 steps per phase keeps a script under 100 bytes. */
export const BOSS_LIMITS = { phases: 2, steps: 16 } as const;

const int = (lo: number, hi: number) => z.number().int().min(lo).max(hi);

export const bossStepSchema = z.discriminatedUnion('op', [
  /** Walk to a level column (16 px) at `speed` px per frame. */
  z.object({ op: z.literal('move_to'), x: int(0, 255), speed: int(1, 4) }).strict(),
  z.object({ op: z.literal('wait'), frames: int(1, 255) }).strict(),
  /** Leap: vx in 1/16 px per frame (negative = towards the left), vy up in 1/16 px per frame. */
  z.object({ op: z.literal('jump'), vx: int(-64, 64), vy: int(16, 112) }).strict(),
  /** aimed: one shot at the player; spread: 3 shots in a fan; rain: 3 shots falling. Speed in 1/16 px per frame. */
  z.object({ op: z.literal('shoot'), pattern: z.enum(SHOOT_PATTERNS), speed: int(16, 96) }).strict(),
  /** Calls one enemy (an enemy actor id); at most 2 called enemies alive at once. */
  z.object({ op: z.literal('spawn'), enemy: slugSchema }).strict(),
  /** Runs at the player's side until a wall or the arena edge, in 1/16 px per frame. */
  z.object({ op: z.literal('charge'), speed: int(16, 96) }).strict(),
  z.object({ op: z.literal('vulnerable'), on: z.boolean() }).strict(),
  z.object({ op: z.literal('flash'), frames: int(1, 120) }).strict(),
]);
export type BossStep = z.infer<typeof bossStepSchema>;

export const bossPhaseSchema = z
  .object({
    /** The phase starts when the boss has this many hp or fewer (not used by the first phase). */
    hpBelow: int(0, 31).optional(),
    steps: z.array(bossStepSchema).min(1).max(BOSS_LIMITS.steps),
  })
  .strict();

export const bossScriptSchema = z
  .object({
    schemaVersion,
    phases: z.array(bossPhaseSchema).min(1).max(4),
  })
  .strict()
  .superRefine((s, ctx) => {
    s.phases.forEach((p, i) => {
      if (i === 0) return;
      if (p.hpBelow === undefined) ctx.addIssue({ code: 'custom', path: ['phases', i, 'hpBelow'], message: `la phase ${i + 1} doit dire à combien de vies elle commence` });
      const prev = i === 1 ? Infinity : s.phases[i - 1]!.hpBelow ?? Infinity;
      if (p.hpBelow !== undefined && p.hpBelow >= prev) ctx.addIssue({ code: 'custom', path: ['phases', i, 'hpBelow'], message: 'les seuils de vie doivent descendre de phase en phase' });
    });
    for (const [pi, p] of s.phases.entries()) {
      // a phase made only of instant steps would never give the engine a frame: require one that waits
      if (!p.steps.some((st) => ['move_to', 'wait', 'jump', 'charge', 'flash'].includes(st.op))) {
        ctx.addIssue({ code: 'custom', path: ['phases', pi, 'steps'], message: 'chaque phase doit avoir au moins une attente ou un déplacement' });
      }
    }
  });
export type BossScript = z.infer<typeof bossScriptSchema>;

export interface DslError {
  line: number;
  fr: string;
  en: string;
}

/**
 * Text form, one step per line (what the REBOND form shows):
 *   phase
 *   vulnerable on
 *   move_to 12 2
 *   phase hp<=3
 *   charge 48
 * Unknown ops and out-of-range values are errors with the line number.
 */
export function parseBossScript(text: string): { script: BossScript | null; errors: DslError[] } {
  const errors: DslError[] = [];
  const phases: Array<{ hpBelow?: number; steps: unknown[] }> = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) return;
    const [word, ...args] = line.split(/\s+/);
    const n = i + 1;
    const num = (k: number) => Number(args[k]);
    if (word === 'phase') {
      const m = args[0] ? /^hp<=(\d+)$/.exec(args[0]) : null;
      if (args[0] && !m) errors.push({ line: n, fr: `ligne ${n} : « phase » s’écrit « phase » ou « phase hp<=3 »`, en: `line ${n}: write "phase" or "phase hp<=3"` });
      phases.push(m ? { hpBelow: Number(m[1]), steps: [] } : { steps: [] });
      return;
    }
    if (!(BOSS_OPS as readonly string[]).includes(word!)) {
      errors.push({ line: n, fr: `ligne ${n} : action inconnue « ${word} » (permises : ${BOSS_OPS.join(', ')})`, en: `line ${n}: unknown action "${word}" (allowed: ${BOSS_OPS.join(', ')})` });
      return;
    }
    if (phases.length === 0) phases.push({ steps: [] });
    const op = word as BossOp;
    const step: Record<string, unknown> = { op };
    if (op === 'move_to') Object.assign(step, { x: num(0), speed: args[1] === undefined ? 1 : num(1) });
    else if (op === 'wait' || op === 'flash') step.frames = num(0);
    else if (op === 'jump') Object.assign(step, { vx: num(0), vy: num(1) });
    else if (op === 'shoot') Object.assign(step, { pattern: args[0], speed: args[1] === undefined ? 32 : num(1) });
    else if (op === 'spawn') step.enemy = args[0];
    else if (op === 'charge') step.speed = num(0);
    else if (op === 'vulnerable') {
      if (args[0] !== 'on' && args[0] !== 'off') errors.push({ line: n, fr: `ligne ${n} : « vulnerable » prend on ou off`, en: `line ${n}: "vulnerable" takes on or off` });
      step.on = args[0] === 'on';
    }
    const r = bossStepSchema.safeParse(step);
    if (!r.success) {
      const issue = r.error.issues[0]!;
      errors.push({ line: n, fr: `ligne ${n} : ${op} ${String(issue.path.join('/'))} hors limites`, en: `line ${n}: ${op} ${String(issue.path.join('/'))} out of range` });
      return;
    }
    phases.at(-1)!.steps.push(r.data);
  });
  if (errors.length) return { script: null, errors };
  const r = bossScriptSchema.safeParse({ schemaVersion: 1, phases });
  if (!r.success) {
    const issue = r.error.issues[0]!;
    return { script: null, errors: [{ line: 0, fr: issue.message, en: issue.message }] };
  }
  return { script: r.data, errors: [] };
}

export function formatBossScript(s: BossScript): string {
  const out: string[] = [];
  s.phases.forEach((p, i) => {
    out.push(i === 0 ? 'phase' : `phase hp<=${p.hpBelow}`);
    for (const st of p.steps) {
      switch (st.op) {
        case 'move_to':
          out.push(`move_to ${st.x} ${st.speed}`);
          break;
        case 'wait':
          out.push(`wait ${st.frames}`);
          break;
        case 'jump':
          out.push(`jump ${st.vx} ${st.vy}`);
          break;
        case 'shoot':
          out.push(`shoot ${st.pattern} ${st.speed}`);
          break;
        case 'spawn':
          out.push(`spawn ${st.enemy}`);
          break;
        case 'charge':
          out.push(`charge ${st.speed}`);
          break;
        case 'vulnerable':
          out.push(`vulnerable ${st.on ? 'on' : 'off'}`);
          break;
        case 'flash':
          out.push(`flash ${st.frames}`);
          break;
      }
    }
  });
  return out.join('\n');
}

/** Floor rules on top of the schema: ≤ 2 phases unless a stretch flag says otherwise. */
export function bossScriptIssues(s: BossScript, hp: number): Array<{ path: string; fr: string; en: string }> {
  const out: Array<{ path: string; fr: string; en: string }> = [];
  if (s.phases.length > BOSS_LIMITS.phases) {
    out.push({ path: '/phases', fr: `trop de phases : ${s.phases.length} (max ${BOSS_LIMITS.phases})`, en: `too many phases: ${s.phases.length} (max ${BOSS_LIMITS.phases})` });
  }
  s.phases.forEach((p, i) => {
    if (i > 0 && p.hpBelow !== undefined && p.hpBelow >= hp) {
      out.push({ path: `/phases/${i}/hpBelow`, fr: `la phase ${i + 1} commence à ${p.hpBelow} vies, mais le boss n’en a que ${hp}`, en: `phase ${i + 1} starts at ${p.hpBelow} hp but the boss has ${hp}` });
    }
  });
  return out;
}

/** Bytes per step: [opcode, a, b]. */
export const STEP_BYTES = 3;

/** Compiles a validated script. `enemyKind` maps a spawned enemy actor id to its engine kind index. */
export function compileBossScript(s: BossScript, enemyKind: (id: string) => number): { phases: Array<{ threshold: number; steps: number[] }> } {
  return {
    phases: s.phases.map((p, i) => ({
      threshold: i === 0 ? 255 : p.hpBelow!,
      steps: p.steps.flatMap((st) => {
        const code = BOSS_OPS.indexOf(st.op);
        switch (st.op) {
          case 'move_to':
            return [code, st.x, st.speed];
          case 'wait':
            return [code, st.frames, 0];
          case 'jump':
            return [code, st.vx & 0xff, st.vy];
          case 'shoot':
            return [code, SHOOT_PATTERNS.indexOf(st.pattern), st.speed];
          case 'spawn':
            return [code, enemyKind(st.enemy), 0];
          case 'charge':
            return [code, st.speed, 0];
          case 'vulnerable':
            return [code, st.on ? 1 : 0, 0];
          case 'flash':
            return [code, st.frames, 0];
        }
      }),
    })),
  };
}

/** A small default fight for new bosses (REBOND offline path). */
export const DEFAULT_BOSS_SCRIPT: BossScript = {
  schemaVersion: 1,
  phases: [
    {
      steps: [
        { op: 'vulnerable', on: true },
        { op: 'wait', frames: 50 },
        { op: 'shoot', pattern: 'aimed', speed: 40 },
        { op: 'jump', vx: -16, vy: 64 },
        { op: 'wait', frames: 40 },
        { op: 'jump', vx: 16, vy: 64 },
      ],
    },
    {
      hpBelow: 3,
      steps: [
        { op: 'flash', frames: 20 },
        { op: 'vulnerable', on: true },
        { op: 'charge', speed: 40 },
        { op: 'shoot', pattern: 'spread', speed: 40 },
        { op: 'wait', frames: 40 },
      ],
    },
  ],
};
