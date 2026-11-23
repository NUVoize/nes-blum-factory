// THE LEGEND OF BLUM (BLUMZ-M1): the game's data files (rpg/legend/*.json, docs/RPG-PLAN.md section 5) and
// their zod schemas. Everything the ROM shows comes from these files and the BLUMZ-A1 kit (rpg/kit/).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const Facing = z.enum(['down', 'up', 'left', 'right']);
export type FacingName = z.infer<typeof Facing>;
export const FACINGS: readonly FacingName[] = ['down', 'up', 'left', 'right'];

const Cond = z.object({ if: z.string().optional(), unless: z.string().optional() }).strict();

export const EntitySchema = z
  .object({
    id: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    x: z.number().int().min(0).max(15),
    y: z.number().int().min(0).max(14),
    sprite: z.string().optional(),
    facing: Facing.optional(),
    show: Cond.optional(),
    talk: z.string().optional(),
    touch: z.string().optional(),
  })
  .strict();
export type EntityDef = z.infer<typeof EntitySchema>;

const Dir = z.enum(['up', 'down', 'left', 'right']);
export type DirName = z.infer<typeof Dir>;

export const ScreenSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    rows: z.array(z.string()).length(15),
    exits: z.partialRecord(Dir, z.string()),
    entities: z.array(EntitySchema).max(8),
  })
  .strict();
export type ScreenDef = z.infer<typeof ScreenSchema>;

export const AreaSchema = z
  .object({ id: z.string(), name: z.string(), tileset: z.string(), music: z.string(), screens: z.array(ScreenSchema).min(1) })
  .strict();
export type AreaDef = z.infer<typeof AreaSchema>;

export const AreasFile = z.object({ schemaVersion: z.literal(1), comment: z.string().optional(), areas: z.array(AreaSchema).min(1) }).strict();

const LevelSchema = z.object({ hp: z.number().int().min(1).max(250), atk: z.number().int().min(1).max(99), def: z.number().int().min(0).max(99), energy: z.number().int().min(1).max(9) }).strict();
export const GameFile = z
  .object({
    schemaVersion: z.literal(1),
    comment: z.string().optional(),
    title: z.string(),
    start: z.object({ screen: z.string(), x: z.number().int().min(0).max(15), y: z.number().int().min(0).max(14), facing: Facing, script: z.string() }).strict(),
    player: z.object({ level: z.number().int().min(1), collations: z.number().int().min(0).max(9), collationHeal: z.number().int().min(1).max(99), collationMax: z.number().int().min(1).max(9) }).strict(),
    levels: z.array(LevelSchema).min(2).max(16),
    fictionalNames: z.array(z.string()),
    end: z.string(),
  })
  .strict();
export type GameDef = z.infer<typeof GameFile>;

export const EFFECTS = ['hit', 'all', 'steal', 'pierce', 'summon'] as const;
export const ClassesFile = z
  .object({
    schemaVersion: z.literal(1),
    comment: z.string().optional(),
    classes: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string(),
            tiers: z.array(z.string()).length(3),
            effect: z.enum(EFFECTS),
            power: z.number().int().min(1).max(99),
            cost: z.number().int().min(1).max(9),
            fx: z.string(),
            battleText: z.string(),
            pitch: z.string(),
          })
          .strict(),
      )
      .length(5),
    helper: z.object({ damage: z.number().int().min(1), turns: z.number().int().min(1).max(9), text: z.string() }).strict(),
    stealText: z.string(),
  })
  .strict();
export type ClassesDef = z.infer<typeof ClassesFile>;
export type ClassDef = ClassesDef['classes'][number];

export const ItemsFile = z
  .object({
    schemaVersion: z.literal(1),
    comment: z.string().optional(),
    items: z.array(z.object({ id: z.string().regex(/^ITEM_[A-Z0-9_]+$/), name: z.string(), kind: z.literal('quest'), critical: z.boolean(), description: z.string() }).strict()).max(32),
    collation: z.object({ name: z.string(), description: z.string() }).strict(),
  })
  .strict();
export type ItemsDef = z.infer<typeof ItemsFile>;

export const PuzzlesFile = z
  .object({
    schemaVersion: z.literal(1),
    comment: z.string().optional(),
    puzzles: z.array(
      z
        .object({
          id: z.string(),
          chapter: z.string(),
          obstacle: z.string(),
          requires: z.object({ items: z.array(z.string()), flags: z.array(z.string()) }).catchall(z.unknown()),
          unlocks: z.object({ flags: z.array(z.string()).min(1) }).strict(),
          hints: z.array(z.string()),
          action: z.string(),
          success: z.string(),
          failure: z.string(),
          recovery: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export type PuzzleDef = z.infer<typeof PuzzlesFile>['puzzles'][number];

export const MOVE_KINDS = ['attack', 'multi', 'warn', 'blast', 'heal', 'stun'] as const;
const MoveSchema = z
  .object({
    id: z.string(),
    kind: z.enum(MOVE_KINDS),
    text: z.string(),
    hits: z.number().int().min(1).max(9).optional(),
    damage: z.number().int().min(0).max(99).optional(),
    blocked: z.number().int().min(0).max(99).optional(),
    blockedText: z.string().optional(),
    amount: z.number().int().min(1).max(99).optional(),
  })
  .strict();
export type MoveDef = z.infer<typeof MoveSchema>;
export const BattleSchema = z
  .object({
    id: z.string().regex(/^BAT_[A-Z0-9_]+$/),
    name: z.string(),
    short: z.string().max(14),
    art: z.string(),
    backdrop: z.string(),
    boss: z.boolean(),
    flee: z.boolean(),
    music: z.enum(['battle', 'boss']),
    stats: z.object({ hp: z.number().int().min(1).max(250), atk: z.number().int().min(0).max(99), def: z.number().int().min(0).max(99) }).strict(),
    xp: z.number().int().min(0).max(99),
    minLevel: z.number().int().min(1),
    intro: z.string(),
    moves: z.array(MoveSchema).min(1).max(8),
    pattern: z.array(z.string()).min(1).max(16),
  })
  .strict();
export type BattleDef = z.infer<typeof BattleSchema>;
export const BattlesFile = z
  .object({
    schemaVersion: z.literal(1),
    comment: z.string().optional(),
    battles: z.array(BattleSchema).min(1).max(32),
    text: z
      .object({ attack: z.string(), defend: z.string(), collation: z.string(), noCollation: z.string(), noEnergy: z.string(), flee: z.string(), noFlee: z.string(), stunned: z.string(), win: z.string(), lose: z.string() })
      .strict(),
  })
  .strict();
export type BattlesDef = z.infer<typeof BattlesFile>;

export const CardsFile = z.object({ schemaVersion: z.literal(1), comment: z.string().optional(), cards: z.record(z.string(), z.array(z.string()).max(12)) }).strict();

// ---- script ops ----
export type CondDef = { flag: string } | { notFlag: string } | { item: string } | { notItem: string } | { all: CondDef[] };
export type Op =
  | { say: string | string[]; who?: string; id?: string }
  | { choice: string; who?: string; options: string[]; bot: number; then: Op[][]; id?: string }
  | { if: CondDef; then: Op[]; else?: Op[] }
  | { set: string }
  | { clear: string }
  | { give: string }
  | { giveCollations: number }
  | { battle: string }
  | { warp: { screen: string; x: number; y: number; facing: FacingName } }
  | { classSelect: true }
  | { card: string }
  | { save: true }
  | { heal: true }
  | { levelUp: true }
  | { music: string }
  | { sfx: string }
  | { chapter: number }
  | { theEnd: string }
  | { sayClass: Record<string, string>; who?: string }
  | { label: string }
  | { goto: string };

const CondSchema: z.ZodType<CondDef> = z.lazy(() =>
  z.union([
    z.object({ flag: z.string() }).strict(),
    z.object({ notFlag: z.string() }).strict(),
    z.object({ item: z.string() }).strict(),
    z.object({ notItem: z.string() }).strict(),
    z.object({ all: z.array(CondSchema).min(1) }).strict(),
  ]),
);
export const OpSchema: z.ZodType<Op> = z.lazy(() =>
  z.union([
    z.object({ say: z.union([z.string(), z.array(z.string()).min(1)]), who: z.string().optional(), id: z.string().optional() }).strict(),
    z.object({ choice: z.string(), who: z.string().optional(), options: z.array(z.string()).min(2).max(4), bot: z.number().int().min(0), then: z.array(z.array(OpSchema)), id: z.string().optional() }).strict(),
    z.object({ if: CondSchema, then: z.array(OpSchema), else: z.array(OpSchema).optional() }).strict(),
    z.object({ set: z.string() }).strict(),
    z.object({ clear: z.string() }).strict(),
    z.object({ give: z.string() }).strict(),
    z.object({ giveCollations: z.number().int().min(1).max(9) }).strict(),
    z.object({ battle: z.string() }).strict(),
    z.object({ warp: z.object({ screen: z.string(), x: z.number().int().min(0).max(15), y: z.number().int().min(0).max(14), facing: Facing }).strict() }).strict(),
    z.object({ classSelect: z.literal(true) }).strict(),
    z.object({ card: z.string() }).strict(),
    z.object({ save: z.literal(true) }).strict(),
    z.object({ heal: z.literal(true) }).strict(),
    z.object({ levelUp: z.literal(true) }).strict(),
    z.object({ music: z.string() }).strict(),
    z.object({ sfx: z.string() }).strict(),
    z.object({ chapter: z.number().int().min(0).max(255) }).strict(),
    z.object({ theEnd: z.string() }).strict(),
    z.object({ sayClass: z.record(z.string(), z.string()), who: z.string().optional() }).strict(),
    z.object({ label: z.string() }).strict(),
    z.object({ goto: z.string() }).strict(),
  ]),
);
export const ScriptsFile = z.object({ schemaVersion: z.literal(1), comment: z.string().optional(), scripts: z.record(z.string(), z.array(OpSchema)) }).strict();

export interface LegendData {
  game: GameDef;
  areas: AreaDef[];
  classes: ClassesDef;
  items: ItemsDef;
  puzzles: PuzzleDef[];
  battles: BattlesDef;
  cards: Record<string, string[]>;
  scripts: Record<string, Op[]>;
}

/** Parses the raw JSON documents (file name without .json -> parsed JSON). Throws a readable zod error. */
export function parseLegendData(docs: Record<string, unknown>): LegendData {
  const need = (n: string) => {
    if (!(n in docs)) throw new Error(`${n}.json : fichier manquant`);
    return docs[n];
  };
  const parse = <T>(name: string, schema: z.ZodType<T>): T => {
    const r = schema.safeParse(need(name));
    if (!r.success) throw new Error(`${name}.json : ${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).slice(0, 6).join(' ; ')}`);
    return r.data;
  };
  return {
    game: parse('game', GameFile),
    areas: parse('areas', AreasFile).areas,
    classes: parse('classes', ClassesFile),
    items: parse('items', ItemsFile),
    puzzles: parse('puzzles', PuzzlesFile).puzzles,
    battles: parse('battles', BattlesFile),
    cards: parse('cards', CardsFile).cards,
    scripts: parse('scripts', ScriptsFile).scripts,
  };
}

export const LEGEND_FILES = ['game', 'areas', 'classes', 'items', 'puzzles', 'battles', 'cards', 'scripts'] as const;

/** Reads rpg/legend/*.json as raw documents. */
export function readLegendDocs(dataDir: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const n of LEGEND_FILES) out[n] = JSON.parse(readFileSync(path.join(dataDir, `${n}.json`), 'utf8'));
  return out;
}

export function loadLegendData(dataDir: string): LegendData {
  return parseLegendData(readLegendDocs(dataDir));
}
