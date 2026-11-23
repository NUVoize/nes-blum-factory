// Emitter v1: project JSON -> engine/gen/* (PLAN §7.1 step 2). Pure: returns file contents, writes nothing.
// Contract: ENGINE_DATA_VERSION 1 (contract.ts, engine/src/engine.h).
import { DEFAULT_FEATURES, type FeatureFlags } from '../features.js';
import { TileBank } from '../nes/chr.js';
import { headerForCartridge } from '../nes/header.js';
import type { Issue } from '../schema/common.js';
import { bossActorSchema, ENEMY_DEFAULTS, enemyActorSchema, levelSchema, tilesetSchema, type BossActor, type EnemyActor, type Level, type Tileset } from '../schema/engine-docs.js';
import { bossScriptIssues, bossScriptSchema, compileBossScript } from './boss-dsl.js';
import { screenBytes, storyScreens, textScreenIssues } from './text-screens.js';
import { palettesSchema, type Palettes } from '../schema/misc.js';
import { physicsSchema, type Physics } from '../schema/physics.js';
import { cartridgeSchema, type Cartridge } from '../schema/project.js';
import { storySchema, type Story } from '../schema/story.js';
import type { Json } from '../util/json-pointer.js';
import { buildBuiltinBoss, buildBuiltinEnemy, buildCommonBank, buildFontBank, buildJardinBank, buildPlayer, type FontBank, type SpriteEntry } from './builtin-chr.js';
import { decodeTile } from '../nes/chr.js';
import { validateProjectBudgets } from '../nes/budgets/index.js';
import { graphicsDocSchema, playerActorSchema, type FrameDoc, type GraphicsDoc } from '../schema/graphics.js';
import {
  AI_PATTERN,
  BEHAVIOUR,
  BOSS_KIND_BASE,
  BUILT_AI_PATTERNS,
  CHR_BANK,
  ENGINE_DATA_VERSION,
  FLOOR_BEHAVIOURS,
  LEVEL_HEADER,
  LEVEL_ROWS,
  MAX_BG_SETS,
  MAX_WORLDS,
  PRG_BANK,
  TUNING,
  TUNING_FIELDS,
  TUNING_MACROS,
  tuningAddress,
  type TuningField,
} from './contract.js';
import { foldRomText } from './art/font.js';
import { SFX_LIBRARY, SONG_LIBRARY } from './audio-library.js';

// Built-in music and SFX (M6: the BLUMA soundtrack, 11 songs + 10 SFX), in engine/audio order.
export { SFX_LIBRARY, SONG_LIBRARY } from './audio-library.js';

/** MMC3 IRQ reload value for the HUD split: the IRQ fires at the end of line 29 (timed on Mesen). */
export const HUD_SPLIT_LINE = 30;
export const START_LIVES = 3;
/** Floor stage width (PLAN §5.6); wider needs the `doors` stretch flag. */
export const FLOOR_MAX_WIDTH = 128;
const DATA_BANK_SIZE = 0x2000;

export interface EmitOptions {
  /** Debug start (PLAN §7.3 "Tester ce niveau", M6-T4). Index in story order. */
  startLevel?: number;
  /** Test-only: bank-switch stress in the idle loop (M2-T16). Never in exported ROMs. */
  bankStress?: boolean;
  flags?: FeatureFlags;
  /** Test-only cheats (PLAN §5.8): invincible + stage skip through the probe byte $7F40. Never in exported ROMs. */
  testCheats?: boolean;
  /** Binary project files (graphics/<id>.chr from CHROMA). */
  assets?: Record<string, Uint8Array>;
}

export interface EmitReport {
  levels: Array<{ id: string; bank: number; bytes: number; width: number; enemies: number }>;
  chr: Array<{ name: string; bank1k: number; tiles: number; capacity: number }>;
  dataBanks: Array<{ bank: number; bytes: number }>;
  tuning: Uint8Array;
  startLevel: number;
}

export interface EmitResult {
  ok: boolean;
  issues: Issue[];
  files: Record<string, string | Uint8Array>;
  report: EmitReport | null;
}

class EmitError extends Error {
  constructor(readonly issue: Issue) {
    super(issue.fr);
  }
}

function issue(doc: string, path: string, fr: string, en: string): Issue {
  return { doc, path, fr, en, severity: 'error' };
}

function parseDoc<T>(docs: Record<string, Json>, docPath: string, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } } }): T {
  const raw = docs[docPath];
  if (raw === undefined) throw new EmitError(issue(docPath, '', `document manquant : ${docPath}`, `missing document: ${docPath}`));
  const r = schema.safeParse(raw);
  if (!r.success) {
    const first = r.error.issues[0]!;
    const where = '/' + first.path.map(String).join('/');
    throw new EmitError(issue(docPath, where, `${docPath} ${where} : ${first.message}`, `${docPath} ${where}: ${first.message}`));
  }
  return r.data;
}

// ---------- tuning block ($7E00) ----------

export function tuningValues(p: Physics): Record<TuningField, number> {
  return {
    walkAccel: p.walkAccel,
    runMax: p.runMax,
    friction: p.friction,
    turnBoost: p.turnBoost,
    gravity: p.gravity,
    maxFall: p.maxFall,
    airControl: p.airControl,
    jumpVelocity: p.jumpVelocity,
    jumpCut: p.jumpCut,
    coyoteFrames: p.coyoteFrames,
    jumpBufferFrames: p.jumpBufferFrames,
    doubleJumpEnabled: p.doubleJump.enabled ? 1 : 0,
    doubleJumpVelocity: p.doubleJump.velocity,
    climbSpeed: p.ladders.climbSpeed,
    canJumpOff: p.ladders.canJumpOff ? 1 : 0,
    projectileEnabled: p.projectile.enabled ? 1 : 0,
    projectileSpeed: p.projectile.speed,
    projectileMax: p.projectile.maxOnScreen,
    projectileCooldown: p.projectile.cooldown,
    hp: p.health.hp,
    knockbackX: p.health.knockback.x,
    knockbackY: p.health.knockback.y,
    iframes: p.health.iframes,
  };
}

export function tuningBlock(p: Physics): Uint8Array {
  const b = new Uint8Array(256);
  b.set(TUNING.magic, 0);
  b[TUNING.versionOffset] = ENGINE_DATA_VERSION;
  const v = tuningValues(p);
  TUNING_FIELDS.forEach((f, i) => {
    const o = TUNING.fieldsOffset + 2 * i;
    b[o] = v[f] & 0xff;
    b[o + 1] = (v[f] >> 8) & 0xff;
  });
  return b;
}

// ---------- level encoding ----------

/** Column-major RLE: pairs [count 1..255, metatile] over width × 13 cells. */
export function encodeLevelRle(grid: number[][], width: number): number[] {
  const cells: number[] = [];
  for (let c = 0; c < width; c++) for (let r = 0; r < LEVEL_ROWS; r++) cells.push(grid[r]![c]!);
  const out: number[] = [];
  let i = 0;
  while (i < cells.length) {
    const v = cells[i]!;
    let n = 1;
    while (i + n < cells.length && cells[i + n] === v && n < 255) n++;
    out.push(n, v);
    i += n;
  }
  return out;
}

export function decodeLevelRle(rle: number[], width: number): number[][] {
  const grid = Array.from({ length: LEVEL_ROWS }, () => Array<number>(width).fill(0));
  let cell = 0;
  for (let i = 0; i < rle.length; i += 2) {
    for (let n = 0; n < rle[i]!; n++, cell++) grid[cell % LEVEL_ROWS]![Math.floor(cell / LEVEL_ROWS)] = rle[i + 1]!;
  }
  return grid;
}

// ---------- asm helpers ----------

function bytesAsm(bytes: ArrayLike<number>, indent = '    '): string {
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    lines.push(
      indent +
        '.byte ' +
        Array.from(Array.prototype.slice.call(bytes, i, i + 16) as number[], (v) => '$' + (v & 0xff).toString(16).padStart(2, '0')).join(','),
    );
  }
  return lines.join('\n');
}

function metaspriteAsm(label: string, entries: SpriteEntry[]): string {
  const b: number[] = [];
  for (const e of entries) b.push(e.x & 0xff, e.y & 0xff, e.tile & 0xff, e.attr & 0xff);
  b.push(0x80);
  return `${label}:\n${bytesAsm(b)}`;
}

function encodeText(font: FontBank, text: string, where: string, issues: Issue[]): number[] {
  const { text: folded, unknown } = foldRomText(text);
  if (unknown.length) {
    issues.push({
      doc: 'story.json',
      path: where,
      severity: 'warning',
      fr: `caractères absents de la police, remplacés par des espaces : ${[...new Set(unknown)].join(' ')}`,
      en: `characters missing from the font, replaced by spaces: ${[...new Set(unknown)].join(' ')}`,
    });
  }
  return [...folded].map((c) => font.glyphs.get(c) ?? 0);
}

function centered(tiles: number[], width = 32, blank = 0): { col: number; row: number[] } {
  const t = tiles.slice(0, width);
  const col = Math.floor((width - t.length) / 2);
  const row = Array<number>(width).fill(blank);
  t.forEach((v, i) => (row[col + i] = v));
  return { col, row };
}

const ROM_TEXT = {
  fr: { press: 'APPUIE SUR START', clear: 'BRAVO !', gameOver: 'PERDU ! START POUR CONTINUER', footer: 'NES BLUM FACTORY' },
  en: { press: 'PRESS START', clear: 'STAGE CLEAR!', gameOver: 'GAME OVER  START TO CONTINUE', footer: 'NES BLUM FACTORY' },
} as const;

// ---------- converted graphics (CHROMA, M3) ----------

/** The player's 8 metasprites (idle, run1, run2, jump; right then left) with their CHR bank. */
export const PLAYER_FRAME_SLOTS = ['idle', 'run1', 'run2', 'jump'] as const;

/** Frame by name with fallbacks: run1 <- run <- idle, run2 <- run1, jump <- idle; else the first frame. */
export function pickFrame(frames: FrameDoc[], want: string): FrameDoc {
  const by = (n: string) => frames.find((f) => f.name === n);
  const chain: Record<string, string[]> = { idle: ['idle'], run1: ['run1', 'run', 'run2', 'idle'], run2: ['run2', 'run3', 'run1', 'run', 'idle'], jump: ['jump', 'jump1', 'fall', 'idle'] };
  for (const n of chain[want] ?? [want]) {
    const f = by(n);
    if (f) return f;
  }
  return frames[0]!;
}

/**
 * Converted frame -> engine metasprite. `ox`/`oy` put the frame's hotspot (feet centre) on the actor's
 * hitbox: player hitbox 12×20 (feet at 6, 20), enemies 16×16 (feet at 8, 16).
 */
export function frameEntries(f: FrameDoc, left: boolean, ox: number, oy: number, tileOf: (sp: FrameDoc['sprites'][number]) => number): SpriteEntry[] {
  return f.sprites.map((sp) => ({
    x: left ? f.hotspot.x - sp.x - 8 + ox : sp.x - f.hotspot.x + ox,
    y: sp.y - f.hotspot.y + oy,
    tile: tileOf(sp),
    attr: (sp.palette & 3) | ((sp.flipH !== left ? 1 : 0) << 6) | ((sp.flipV ? 1 : 0) << 7),
  }));
}

function graphicsFor(docs: Record<string, Json>, assets: Record<string, Uint8Array>, ref: string, who: string): { doc: GraphicsDoc; chr: Uint8Array; path: string } {
  const path = ref.replace(/\.chr$/, '.json');
  const g = parseDoc(docs, path, graphicsDocSchema);
  const chr = assets[g.chr];
  if (!chr) throw new EmitError(issue(path, '/chr', `fichier de tuiles ${g.chr} introuvable (${who})`, `tile file ${g.chr} missing (${who})`));
  return { doc: g, chr, path };
}

// ---------- enemies and bosses (M4a) ----------

/** Max enemy kinds in one game (kind byte < BOSS_KIND_BASE, tables stay small in fixed ROM). */
export const MAX_KINDS = 24;

/**
 * Per-kind engine parameters [p1 byte, p2 word]:
 * hopper [frames between hops, jump speed]; flyer [phase step per frame (256 = one wave), wave height px];
 * shooter [frames between shots, shot speed]; walker [0, 0].
 */
export function kindParams(k: EnemyActor): [number, number] {
  switch (k.pattern) {
    case 'hopper':
      return [k.period ?? ENEMY_DEFAULTS.hopper.period, k.jump ?? ENEMY_DEFAULTS.hopper.jump];
    case 'flyer': {
      const period = k.period ?? ENEMY_DEFAULTS.flyer.period;
      return [Math.max(1, Math.min(16, Math.round(256 / period))), k.amplitude ?? ENEMY_DEFAULTS.flyer.amplitude];
    }
    case 'shooter':
      return [k.period ?? ENEMY_DEFAULTS.shooter.period, k.shotSpeed ?? ENEMY_DEFAULTS.shooter.shotSpeed];
    default:
      return [0, 0];
  }
}

interface BossBlob {
  actor: BossActor;
  bank1k: number;
  /** right frame 0, right frame 1, left frame 0, left frame 1; entries from the boss box top-left. */
  frames: SpriteEntry[][];
  w: number;
  h: number;
  phases: Array<{ threshold: number; steps: number[] }>;
}

/** Boss block offsets (engine/src/boss.c reads them). */
export const BOSS_BLOCK = { hp: 0, damage: 1, w: 2, h: 3, phases: 4, chr: 5, ms: 6, phaseTable: 14, phaseSize: 4 } as const;

function bossBlockSize(b: BossBlob): number {
  return BOSS_BLOCK.phaseTable + BOSS_BLOCK.phaseSize * b.phases.length + b.phases.reduce((n, p) => n + p.steps.length, 0) + b.frames.reduce((n, f) => n + 4 * f.length + 1, 0);
}

function bossAsm(label: string, b: BossBlob): string[] {
  const out: string[] = [`${label}: ; ${b.actor.name.fr}`];
  out.push(`    .byte ${b.actor.hp},${b.actor.damage},${b.w},${b.h},${b.phases.length},${b.bank1k}`);
  out.push(`    .word ${b.frames.map((_, i) => `${label}_ms${i}`).join(',')}`);
  b.phases.forEach((p, i) => out.push(`    .byte ${p.threshold},${p.steps.length / 3}`, `    .word ${label}_p${i}`));
  b.phases.forEach((p, i) => out.push(`${label}_p${i}:`, bytesAsm(p.steps)));
  b.frames.forEach((f, i) => out.push(metaspriteAsm(`${label}_ms${i}`, f)));
  return out;
}

// ---------- main ----------

export function emitProject(docs: Record<string, Json>, opts: EmitOptions = {}): EmitResult {
  const issues: Issue[] = [];
  try {
    return emitInner(docs, opts, issues);
  } catch (e) {
    if (e instanceof EmitError) return { ok: false, issues: [...issues, e.issue], files: {}, report: null };
    throw e;
  }
}

function emitInner(docs: Record<string, Json>, opts: EmitOptions, issues: Issue[]): EmitResult {
  const flags = opts.flags ?? DEFAULT_FEATURES;
  const story: Story = parseDoc(docs, 'story.json', storySchema);
  const physics: Physics = parseDoc(docs, 'physics.json', physicsSchema);
  const cart: Cartridge = parseDoc(docs, 'cartridge.json', cartridgeSchema);
  const palettes: Palettes = parseDoc(docs, 'graphics/palettes.json', palettesSchema);

  const assets = opts.assets ?? {};
  // world/scene budgets (PLAN §6.1) on every build
  for (const b of validateProjectBudgets(docs)) {
    if (b.severity === 'error') throw new EmitError(b);
    issues.push(b);
  }

  if (story.worlds.length > MAX_WORLDS) {
    throw new EmitError(issue('story.json', '/worlds', `trop de mondes pour la cartouche : ${story.worlds.length} (max ${MAX_WORLDS})`, `too many worlds: ${story.worlds.length} (max ${MAX_WORLDS})`));
  }

  // levels in story order
  const levels: Array<{ level: Level; world: number; tileset: Tileset }> = [];
  story.worlds.forEach((w, wi) => {
    for (const s of w.stages) {
      const lp = `levels/${s.id}.json`;
      const level = parseDoc(docs, lp, levelSchema);
      const tileset = parseDoc(docs, `tilesets/${level.tileset}.json`, tilesetSchema);
      levels.push({ level, world: wi, tileset });
    }
  });
  if (levels.length === 0) throw new EmitError(issue('story.json', '/worlds', 'aucun niveau à construire', 'no stage to build'));
  const startLevel = opts.startLevel ?? 0;
  if (startLevel < 0 || startLevel >= levels.length) {
    throw new EmitError(issue('story.json', '/worlds', `niveau de départ ${startLevel} inexistant`, `start level ${startLevel} does not exist`));
  }

  // ---- CHR ----
  const chr = new Uint8Array(CHR_BANK.total * 1024);
  const chrReport: EmitReport['chr'] = [];
  const font = buildFontBank();
  chr.set(font.bank.bytes(), CHR_BANK.font * 1024);
  chrReport.push({ name: 'police + HUD', bank1k: CHR_BANK.font, tiles: font.bank.count, capacity: 128 });

  // world BG sets: one 4 KiB slot per distinct tileset CHR source
  const bgSlots = new Map<string, number>();
  for (const { level, tileset } of levels) {
    if (bgSlots.has(tileset.chr)) continue;
    const slot = bgSlots.size;
    if (slot >= MAX_BG_SETS) throw new EmitError(issue(`tilesets/${tileset.id}.json`, '/chr', `trop de jeux de tuiles différents (max ${MAX_BG_SETS})`, `too many different tile sets (max ${MAX_BG_SETS})`));
    const bank1k = CHR_BANK.worldBase + 4 * slot;
    if (tileset.chr.startsWith('graphics/')) {
      const g = graphicsFor(docs, assets, tileset.chr, `jeu de tuiles ${tileset.id}`);
      if (g.doc.kind !== 'tileset' && g.doc.kind !== 'screen') {
        throw new EmitError(issue(`tilesets/${tileset.id}.json`, '/chr', `${g.path} n’est pas un jeu de tuiles`, `${g.path} is not a tileset`));
      }
      chr.set(g.chr.subarray(0, 4096), bank1k * 1024);
      chrReport.push({ name: `tuiles ${g.doc.name} (niveau ${level.id})`, bank1k, tiles: g.doc.budget.tiles, capacity: 256 });
    } else if (tileset.chr === 'builtin:jardin') {
      const jardin = buildJardinBank().bank;
      chr.set(jardin.bytes(), bank1k * 1024);
      chrReport.push({ name: `tuiles ${tileset.chr} (niveau ${level.id})`, bank1k, tiles: jardin.count, capacity: 256 });
    } else {
      throw new EmitError(issue(`tilesets/${tileset.id}.json`, '/chr', `graphismes intégrés inconnus : ${tileset.chr}`, `unknown built-in graphics: ${tileset.chr}`));
    }
    bgSlots.set(tileset.chr, bank1k);
  }

  // player: built-in hero, or the CHROMA graphic named by actors/player.json (one 1 KiB bank per animation group)
  let playerFrames: SpriteEntry[][];
  let playerMsBank: number[];
  const playerActor = docs['actors/player.json'] !== undefined ? parseDoc(docs, 'actors/player.json', playerActorSchema) : null;
  if (playerActor && playerActor.graphics.startsWith('graphics/')) {
    const g = graphicsFor(docs, assets, playerActor.graphics, 'héros');
    if (g.doc.role !== 'player' || !g.doc.frames?.length) {
      throw new EmitError(issue('actors/player.json', '/graphics', `${g.path} n’est pas un graphisme de héros`, `${g.path} is not a hero graphic`));
    }
    const picked = PLAYER_FRAME_SLOTS.map((n) => pickFrame(g.doc.frames!, n));
    const right = picked.map((f) => frameEntries(f, false, 6, 20, (sp) => sp.tile));
    const left = picked.map((f) => frameEntries(f, true, 6, 20, (sp) => sp.tile));
    playerFrames = [...right, ...left];
    playerMsBank = [...picked, ...picked].map((f) => f.bank);
    for (const b of g.doc.budget.banks) {
      chr.set(g.chr.subarray(b.index * 1024, b.index * 1024 + 1024), (CHR_BANK.player + b.index) * 1024);
      chrReport.push({ name: `héros ${g.doc.name} (banque ${b.index})`, bank1k: CHR_BANK.player + b.index, tiles: b.tiles, capacity: 64 });
    }
  } else {
    const playerBank = new TileBank('joueur', 64);
    playerFrames = buildPlayer(playerBank);
    playerMsBank = playerFrames.map(() => 0);
    chr.set(playerBank.bytes(), CHR_BANK.player * 1024);
    chrReport.push({ name: 'joueur', bank1k: CHR_BANK.player, tiles: playerBank.count, capacity: 64 });
  }

  // enemy kinds: one per (actor, world) so tile numbers always point into that world's enemy bank
  const kindKeys: string[] = [];
  const kinds: EnemyActor[] = [];
  const kindFrames: SpriteEntry[][][] = [];
  const worldEnemyBanks = new Map<number, TileBank>();
  const enemyBankOf = (world: number) => {
    let bank = worldEnemyBanks.get(world);
    if (!bank) {
      bank = new TileBank(`ennemis monde ${world + 1}`, 64);
      worldEnemyBanks.set(world, bank);
    }
    return bank;
  };
  /** Sprite frames of a CHROMA graphic, re-added into `bank` from tile `base` (enemies $80, bosses $C0). */
  const graphicFrames = (actorPath: string, ref: string, who: string, wanted: string[] | undefined, bank: TileBank, base: number, origin: (f: FrameDoc) => [number, number], role: 'enemy' | 'boss') => {
    const g = graphicsFor(docs, assets, ref, who);
    if (g.doc.kind !== 'sprite' || !g.doc.frames?.length) throw new EmitError(issue(actorPath, '/graphics', `${g.path} n’est pas un sprite`, `${g.path} is not a sprite`));
    if (role === 'boss' && g.doc.role !== 'boss') throw new EmitError(issue(actorPath, '/graphics', `${g.path} n’est pas un graphisme de boss`, `${g.path} is not a boss graphic`));
    const names = wanted ?? g.doc.frames.slice(0, 2).map((f) => f.name);
    const frames = [names[0]!, names[1] ?? names[0]!].map((n) => g.doc.frames!.find((f) => f.name === n) ?? g.doc.frames![0]!);
    const tileOf = (f: FrameDoc) => (sp: FrameDoc['sprites'][number]) => {
      try {
        return base + bank.add(decodeTile(g.chr, f.bank * 1024 + sp.tile * 16));
      } catch (e) {
        throw new EmitError(issue(actorPath, '/graphics', (e as Error).message, (e as Error).message));
      }
    };
    const right = frames.map((f) => frameEntries(f, false, origin(f)[0], origin(f)[1], tileOf(f)));
    const left = frames.map((f) => frameEntries(f, true, origin(f)[0], origin(f)[1], tileOf(f)));
    return { frames: [...right, ...left], w: Math.max(...frames.map((f) => f.w)), h: Math.max(...frames.map((f) => f.h)) };
  };
  const kindIndex = (actorId: string, world: number, where: { doc: string; path: string }): number => {
    const key = `${actorId}@${world}`;
    const known = kindKeys.indexOf(key);
    if (known >= 0) return known;
    const actorPath = `actors/${actorId}.json`;
    const actor = parseDoc(docs, actorPath, enemyActorSchema);
    if (!(BUILT_AI_PATTERNS as readonly string[]).includes(actor.pattern)) {
      throw new EmitError(
        issue(actorPath, '/pattern', `le comportement « ${actor.pattern} » n’est pas encore disponible dans le moteur`, `enemy pattern "${actor.pattern}" is not available in the engine yet`),
      );
    }
    if (kindKeys.length >= MAX_KINDS) throw new EmitError(issue(where.doc, where.path, `plus de ${MAX_KINDS} sortes d’ennemis dans le jeu`, `more than ${MAX_KINDS} enemy kinds in the game`));
    const bank = enemyBankOf(world);
    const builtin = /^builtin:(.+)$/.exec(actor.graphics);
    let frames: SpriteEntry[][];
    if (builtin) {
      try {
        frames = buildBuiltinEnemy(builtin[1]!, bank, 2);
      } catch (e) {
        throw new EmitError(issue(actorPath, '/graphics', (e as Error).message, (e as Error).message));
      }
    } else frames = graphicFrames(actorPath, actor.graphics, actor.name.fr, actor.frames, bank, 0x80, () => [8, 16], 'enemy').frames;
    kindKeys.push(key);
    kinds.push(actor);
    kindFrames.push(frames);
    return kindKeys.length - 1;
  };

  // bosses: at most one per stage, graphics in their own 1 KiB bank (R5), script compiled into the stage's bank
  const bossBlobs = new Map<string, BossBlob>(); // by level id
  const bossBanks = new Map<string, number>(); // boss actor id -> 1 KiB bank
  const levelKinds = new Map<string, number[]>(); // level id -> kind per entity, in document order
  for (const { level, world } of levels) {
    const lp = `levels/${level.id}.json`;
    const perEntity: number[] = [];
    for (const [ei, e] of level.entities.entries()) {
      const actorPath = `actors/${e.actor}.json`;
      const raw = docs[actorPath] as { kind?: string } | undefined;
      if (raw?.kind !== 'boss') {
        perEntity.push(kindIndex(e.actor, world, { doc: lp, path: `/entities/${ei}` }));
        continue;
      }
      if (bossBlobs.has(level.id)) throw new EmitError(issue(lp, `/entities/${ei}`, 'un seul boss par niveau', 'one boss per stage'));
      const actor = parseDoc(docs, actorPath, bossActorSchema);
      const scriptPath = `scripts/${actor.script}.json`;
      const script = parseDoc(docs, scriptPath, bossScriptSchema);
      const rule = bossScriptIssues(script, actor.hp)[0];
      if (rule) throw new EmitError(issue(scriptPath, rule.path, rule.fr, rule.en));
      let bank1k = bossBanks.get(e.actor);
      const fresh = bank1k === undefined;
      if (bank1k === undefined) {
        bank1k = CHR_BANK.boss + bossBanks.size;
        if (bank1k >= CHR_BANK.total) throw new EmitError(issue(actorPath, '', 'trop de boss pour la cartouche', 'too many bosses for the cartridge'));
        bossBanks.set(e.actor, bank1k);
      }
      const bank = new TileBank(`boss ${actor.name.fr}`, 64);
      let art: { frames: SpriteEntry[][]; w: number; h: number };
      if (actor.graphics.startsWith('builtin:')) {
        if (actor.graphics !== 'builtin:boss') throw new EmitError(issue(actorPath, '/graphics', `graphisme intégré inconnu : ${actor.graphics}`, `unknown built-in graphics: ${actor.graphics}`));
        art = { frames: buildBuiltinBoss(bank), w: 32, h: 32 };
      } else {
        // entries relative to the top-left of the boss box: hotspot (feet centre) at (w/2, h)
        art = graphicFrames(actorPath, actor.graphics, actor.name.fr, actor.frames, bank, 0xc0, (f) => [f.w / 2, f.h], 'boss');
      }
      if (art.w > 32) throw new EmitError(issue(actorPath, '/graphics', `boss trop large : ${art.w} pixels (max 32)`, `boss too wide: ${art.w} px (max 32)`));
      if (fresh) {
        chr.set(bank.bytes(), bank1k * 1024);
        chrReport.push({ name: bank.name, bank1k, tiles: bank.count, capacity: 64 });
      }
      const compiled = compileBossScript(script, (id) => kindIndex(id, world, { doc: scriptPath, path: '/phases' }));
      bossBlobs.set(level.id, { actor, bank1k, frames: art.frames, w: art.w, h: art.h, phases: compiled.phases });
      perEntity.push(BOSS_KIND_BASE);
    }
    levelKinds.set(level.id, perEntity);
  }
  for (const [world, bank] of worldEnemyBanks) {
    const bank1k = CHR_BANK.enemiesBase + world;
    chr.set(bank.bytes(), bank1k * 1024);
    chrReport.push({ name: bank.name, bank1k, tiles: bank.count, capacity: 64 });
  }
  const common = buildCommonBank();
  chr.set(common.bank.bytes(), CHR_BANK.common * 1024);
  chrReport.push({ name: 'objets communs (tirs)', bank1k: CHR_BANK.common, tiles: common.bank.count, capacity: 64 });

  // ---- level checks + data banks ----
  const levelBlobs: Array<{ id: string; bytes: number[]; header: number[]; mt: number[]; ent: number[]; rle: number[]; bank: number; width: number; enemies: number; boss: BossBlob | null }> = [];
  for (const { level, world, tileset } of levels) {
    const lp = `levels/${level.id}.json`;
    if (level.width > FLOOR_MAX_WIDTH && !flags.doors) {
      throw new EmitError(issue(lp, '/width', `niveau trop large : ${level.width} colonnes (max ${FLOOR_MAX_WIDTH}, soit 8 écrans)`, `stage too wide: ${level.width} columns (max ${FLOOR_MAX_WIDTH}, 8 screens)`));
    }
    const mtById = new Map(tileset.metatiles.map((m) => [m.id, m]));
    const maxId = Math.max(...tileset.metatiles.map((m) => m.id));
    for (const m of tileset.metatiles) {
      if (!FLOOR_BEHAVIOURS.includes(m.behaviour)) {
        throw new EmitError(
          issue(`tilesets/${tileset.id}.json`, `/metatiles`, `le comportement de tuile « ${m.behaviour} » (${m.name}) n’est pas encore disponible`, `tile behaviour "${m.behaviour}" (${m.name}) is not available yet`),
        );
      }
    }
    level.grid.forEach((row, r) =>
      row.forEach((id, c) => {
        if (!mtById.has(id)) throw new EmitError(issue(lp, `/grid/${r}/${c}`, `métatuile ${id} absente du jeu « ${tileset.id} »`, `metatile ${id} not in tileset "${tileset.id}"`));
      }),
    );
    const count = maxId + 1;
    const mt: number[] = [];
    for (const q of [0, 1, 2, 3] as const) for (let id = 0; id < count; id++) mt.push(mtById.get(id)?.tiles[q] ?? 0);
    for (let id = 0; id < count; id++) mt.push(mtById.get(id)?.palette ?? 0);
    for (let id = 0; id < count; id++) mt.push(BEHAVIOUR[mtById.get(id)?.behaviour ?? 'empty']);

    const kindOf = new Map(level.entities.map((e, i) => [e, levelKinds.get(level.id)![i]!]));
    const ents = [...level.entities].sort((a, b) => a.col - b.col || a.row - b.row);
    const ent = [ents.length, ...ents.map((e) => kindOf.get(e)!), ...ents.map((e) => e.col), ...ents.map((e) => e.row), ...ents.map((e) => (e.facing === 'left' ? 1 : 0))];
    const rle = encodeLevelRle(level.grid, level.width);
    const songOf = (id: string, pointer: string) => {
      const n = SONG_LIBRARY.indexOf(id as (typeof SONG_LIBRARY)[number]);
      if (n < 0) throw new EmitError(issue(lp, pointer, `musique « ${id} » absente de la bibliothèque`, `song "${id}" not in the library`));
      return n;
    };
    const song = songOf(level.music, '/music');
    const bossSong = songOf(level.bossMusic ?? 'boss', '/bossMusic');
    const header = [level.width & 0xff, level.spawn.col, level.spawn.row, world, bgSlots.get(tileset.chr)!, CHR_BANK.enemiesBase + world, song, count, 0, 0, 0, 0, 0, 0, tileset.empty, bossSong];
    levelBlobs.push({ id: level.id, bytes: [], header, mt, ent, rle, bank: -1, width: level.width, enemies: ents.length, boss: bossBlobs.get(level.id) ?? null });
  }

  // ROM text screens (PLAN §5.9): world intros, ending, credits
  for (const ti of textScreenIssues(story, font)) {
    if (ti.severity === 'error') throw new EmitError(ti);
    issues.push(ti);
  }
  const textScreens = storyScreens(story);
  const textBytes = textScreens.map((sc) => screenBytes(sc, font, story.romLocale));
  const textSize = textBytes.reduce((n, b) => n + b.length, 0);

  // assign data banks greedily (BANK0..BANK27): stages (with their boss block), then the text screens
  const bankFill = new Map<number, number>();
  const place = (size: number, what: string): number => {
    let bank = PRG_BANK.firstData;
    while ((bankFill.get(bank) ?? 0) + size > DATA_BANK_SIZE) {
      bank++;
      if (bank > PRG_BANK.lastData) throw new EmitError(issue(what, '', 'les niveaux ne rentrent plus dans la cartouche', 'stages no longer fit in the cartridge'));
    }
    bankFill.set(bank, (bankFill.get(bank) ?? 0) + size);
    return bank;
  };
  for (const b of levelBlobs) {
    const size = LEVEL_HEADER.size + b.mt.length + b.ent.length + 2 + b.rle.length + (b.boss ? bossBlockSize(b.boss) : 0);
    b.bank = place(size, `levels/${b.id}.json`);
    b.bytes = [size];
  }
  const textBank = place(textSize, 'story.json');

  // ---- data.s ----
  const tuning = tuningBlock(physics);
  const pal = (setId: string) => palettes.sets.find((s) => s.id === setId) ?? palettes.sets[0]!;
  const palBytes = (s: Palettes['sets'][number]) => {
    const out: number[] = [];
    for (let i = 0; i < 4; i++) out.push(s.backdrop, ...(s.bg[i] ?? s.bg[0]!));
    for (let i = 0; i < 4; i++) out.push(s.backdrop, ...(s.sprites[i] ?? s.sprites[0]!));
    return out;
  };
  const worldPalettes = story.worlds.flatMap((w) => palBytes(pal(w.id)));
  const first = pal(story.worlds[0]!.id);
  const titlePalette = palBytes({ ...first, backdrop: 0x0f, bg: [first.bg[0]!, first.bg[0]!, first.bg[0]!, first.bg[0]!] });

  const t = ROM_TEXT[story.romLocale];
  const blank = font.glyphs.get(' ')!;
  const titleTiles = encodeText(font, story.title, '/title', issues);
  const pressTiles = encodeText(font, t.press, '', issues);
  const titleRow = centered(titleTiles);
  const pressRow = centered(pressTiles);
  const footer = centered(encodeText(font, t.footer, '', issues));
  const titleList: number[] = [];
  const at = (col: number, row: number, tiles: number[]) => {
    const addr = 0x2000 + row * 32 + col;
    titleList.push(addr >> 8, addr & 0xff, tiles.length, ...tiles);
  };
  const TITLE_ROW = 9;
  const PRESS_ROW = 18;
  at(titleRow.col, TITLE_ROW, titleTiles);
  at(titleRow.col - 2, TITLE_ROW, [font.icons.flower]);
  at(titleRow.col + titleTiles.length + 1, TITLE_ROW, [font.icons.flower]);
  at(pressRow.col, PRESS_ROW, pressTiles);
  at(footer.col, 25, encodeText(font, t.footer, '', issues));
  titleList.push(0);

  const fullRow = (s: string) => centered(encodeText(font, s, '', issues), 32, blank).row;

  const ms: SpriteEntry[][] = [...playerFrames];
  const kindMs: number[] = [];
  for (const frames of kindFrames) {
    kindMs.push(ms.length);
    ms.push(...frames);
  }

  const lines: string[] = [];
  lines.push('; GENERATED by src/core/engine-data/emit.ts (ENGINE_DATA_VERSION 1). Do not edit.');
  lines.push('.export _tuning_defaults, _world_palettes, _title_palette, _level_bank, _level_ptr, _ms_table');
  lines.push('.export _kind_ai, _kind_speed, _kind_hp, _kind_ms, _kind_flags, _player_ms_bank');
  lines.push('.export _title_screen, _hud_static, _text_clear, _text_gameover, _text_press');
  lines.push('.export _kind_dmg, _kind_p1, _kind_p2, _text_bank, _text_ptr, _world_intro, _level_first');
  lines.push('', '.segment "RODATA"', '_tuning_defaults:', bytesAsm(tuning));
  lines.push('_world_palettes:', bytesAsm(worldPalettes));
  lines.push('_title_palette:', bytesAsm(titlePalette));
  lines.push('_level_bank:', bytesAsm(levelBlobs.map((b) => b.bank)));
  lines.push('_level_ptr:', ...levelBlobs.map((_, i) => `    .word level_${i}`));
  lines.push('_player_ms_bank:', bytesAsm(playerMsBank));
  lines.push('_ms_table:', ...ms.map((_, i) => `    .word ms_${i}`));
  ms.forEach((m, i) => lines.push(metaspriteAsm(`ms_${i}`, m)));
  const kAi = kinds.map((k) => AI_PATTERN[k.pattern as keyof typeof AI_PATTERN] ?? 0);
  lines.push('_kind_ai:', kinds.length ? bytesAsm(kAi) : '    .byte 0');
  lines.push('_kind_speed:', kinds.length ? kinds.map((k) => `    .word ${k.speed}`).join('\n') : '    .word 0');
  lines.push('_kind_hp:', kinds.length ? bytesAsm(kinds.map((k) => k.hp)) : '    .byte 0');
  lines.push('_kind_ms:', kinds.length ? bytesAsm(kindMs) : '    .byte 0');
  lines.push('_kind_flags:', kinds.length ? bytesAsm(kinds.map((k) => (k.turnAtLedge && k.pattern !== 'flyer' ? 1 : 0))) : '    .byte 0');
  lines.push('_kind_dmg:', kinds.length ? bytesAsm(kinds.map((k) => k.damage)) : '    .byte 0');
  lines.push('_kind_p1:', kinds.length ? bytesAsm(kinds.map(kindParams).map((k) => k[0])) : '    .byte 0');
  lines.push('_kind_p2:', kinds.length ? kinds.map(kindParams).map((k) => `    .word ${k[1]}`).join('\n') : '    .word 0');
  lines.push('_text_bank:', textScreens.length ? bytesAsm(textScreens.map(() => textBank)) : '    .byte 0');
  lines.push('_text_ptr:', ...(textScreens.length ? textScreens.map((_, i) => `    .word text_${i}`) : ['    .word 0']));
  lines.push('_world_intro:', bytesAsm(story.worlds.map((_, wi) => { const i = textScreens.findIndex((t) => t.kind === 'intro' && t.world === wi); return i < 0 ? 0xff : i; })));
  lines.push('_level_first:', bytesAsm(levels.map((l, i) => (i === 0 || levels[i - 1]!.world !== l.world ? 1 : 0))));
  lines.push('_title_screen:', bytesAsm(titleList));
  lines.push('_hud_static:', '    .byte 0');
  lines.push('_text_clear:', bytesAsm([32, ...fullRow(t.clear)]));
  lines.push('_text_gameover:', bytesAsm([32, ...fullRow(t.gameOver)]));
  lines.push('_text_press:', bytesAsm([pressTiles.length, ...pressTiles]));

  const byBank = new Map<number, number[]>();
  levelBlobs.forEach((b, i) => {
    const list = byBank.get(b.bank) ?? [];
    list.push(i);
    byBank.set(b.bank, list);
  });
  if (opts.bankStress) {
    // signatures read by the stress loop (engine/lib/neslib.s); bank 0 data shifts by one byte
    lines.push('', '.segment "BANK0"', '    .byte $B0', '.segment "BANK1"', '    .byte $B1');
  }
  if (!byBank.has(textBank)) byBank.set(textBank, []);
  for (const [bank, idx] of [...byBank].sort((a, b) => a[0] - b[0])) {
    lines.push('', `.segment "BANK${bank}"`);
    for (const i of idx) {
      const b = levelBlobs[i]!;
      const h = b.header.map((v) => `$${(v & 0xff).toString(16).padStart(2, '0')}`);
      h[LEVEL_HEADER.mtPtr] = `<level_${i}_mt`;
      h[LEVEL_HEADER.mtPtr + 1] = `>level_${i}_mt`;
      h[LEVEL_HEADER.entPtr] = `<level_${i}_ent`;
      h[LEVEL_HEADER.entPtr + 1] = `>level_${i}_ent`;
      h[LEVEL_HEADER.rlePtr] = `<level_${i}_rle`;
      h[LEVEL_HEADER.rlePtr + 1] = `>level_${i}_rle`;
      lines.push(`level_${i}: ; ${b.id}`, `    .byte ${h.join(',')}`);
      lines.push(`level_${i}_mt:`, bytesAsm(b.mt));
      lines.push(`level_${i}_ent:`, bytesAsm(b.ent), `    .word ${b.boss ? `level_${i}_boss` : 0}`);
      lines.push(`level_${i}_rle:`, bytesAsm(b.rle));
      if (b.boss) lines.push(...bossAsm(`level_${i}_boss`, b.boss));
    }
    if (bank === textBank) {
      textScreens.forEach((sc, i) => lines.push(`text_${i}: ; ${sc.kind}${sc.world !== undefined ? ' ' + (sc.world + 1) : ''}`, bytesAsm(textBytes[i]!)));
    }
  }
  if (!byBank.has(0) && !opts.bankStress) lines.push('', '.segment "BANK0"', '    .byte 0');

  // ---- config.h / config.inc / header.inc ----
  const h: string[] = [
    '// GENERATED by src/core/engine-data/emit.ts. Do not edit.',
    `#define ENGINE_DATA_VERSION ${ENGINE_DATA_VERSION}`,
    `#define LEVEL_COUNT ${levelBlobs.length}`,
    `#define START_LEVEL ${startLevel}`,
    `#define START_LIVES ${START_LIVES}`,
    `#define CHR_FONT ${CHR_BANK.font}`,
    `#define CHR_TITLE ${CHR_BANK.title}`,
    `#define CHR_PLAYER ${CHR_BANK.player}`,
    `#define CHR_COMMON ${CHR_BANK.common}`,
    `#define SONG_TITLE ${SONG_LIBRARY.indexOf('title')}`,
    `#define SONG_CLEAR ${SONG_LIBRARY.indexOf('clear')}`,
    `#define SONG_GAMEOVER ${SONG_LIBRARY.indexOf('gameover')}`,
    `#define SONG_ENDING ${SONG_LIBRARY.indexOf('ending')}`,
    ...(['jump', 'pickup', 'stomp', 'hurt', 'oneup', 'bosshit'] as const).map((id) => `#define SFX_${id.toUpperCase()} ${SFX_LIBRARY.indexOf(id)}`),
    `#define HUD_SPLIT_LINE ${HUD_SPLIT_LINE}`,
    `#define HUD_TILE_BLANK ${blank}`,
    `#define HUD_TILE_DIGIT0 ${font.glyphs.get('0')}`,
    `#define HUD_TILE_HEART ${font.icons.heart}`,
    `#define HUD_TILE_FLOWER ${font.icons.flower}`,
    `#define HUD_TILE_LIFE ${font.icons.life}`,
    `#define HUD_TILE_X ${font.icons.times}`,
    `#define TITLE_PRESS_COL ${pressRow.col}`,
    `#define TITLE_PRESS_ROW ${PRESS_ROW}`,
    `#define TEXT_HUD_COL 0`,
    `#define MS_PLAYER_IDLE 0`,
    `#define MS_PLAYER_RUN1 1`,
    `#define MS_PLAYER_RUN2 2`,
    `#define MS_PLAYER_JUMP 3`,
    `#define MS_PLAYER_LEFT 4`,
    `#define TILE_SHOT ${common.playerShot}`,
    `#define TILE_ESHOT ${common.enemyShot}`,
    `#define TEXT_ENDING ${textScreens.findIndex((t) => t.kind === 'ending') < 0 ? 255 : textScreens.findIndex((t) => t.kind === 'ending')}`,
    `#define TEXT_CREDITS ${textScreens.findIndex((t) => t.kind === 'credits')}`,
    `#define TEXT_BLANK ${blank}`,
    `#define HUD_TILE_BOSS ${font.glyphs.get('B')}`,
    ...(opts.testCheats ? ['#define NBF_TEST_CHEATS 1'] : []),
  ];
  for (const f of TUNING_FIELDS) {
    const macro = TUNING_MACROS[f];
    if (macro) h.push(`#define ${macro} (*(int *)0x${tuningAddress(f).toString(16).toUpperCase()})`);
  }
  const inc: string[] = [
    '; GENERATED by src/core/engine-data/emit.ts. Do not edit.',
    `ENGINE_DATA_VERSION = ${ENGINE_DATA_VERSION}`,
    `SOUND_BANK = ${PRG_BANK.sound}`,
    `FIXED_A000_BANK = ${PRG_BANK.fixedA000}`,
    `CHR_FONT = ${CHR_BANK.font}`,
    `CHR_PLAYER = ${CHR_BANK.player}`,
    `CHR_COMMON = ${CHR_BANK.common}`,
    `CHR_ENEMIES = ${CHR_BANK.enemiesBase}`,
    `CHR_BOSS = ${CHR_BANK.boss}`,
  ];
  if (opts.bankStress) inc.push('NBF_TEST_BANKSTRESS = 1');
  const header = headerForCartridge(cart);

  const report: EmitReport = {
    levels: levelBlobs.map((b) => ({ id: b.id, bank: b.bank, bytes: b.bytes[0]!, width: b.width, enemies: b.enemies })),
    chr: chrReport,
    dataBanks: [...bankFill].map(([bank, bytes]) => ({ bank, bytes })),
    tuning,
    startLevel,
  };

  return {
    ok: !issues.some((i) => i.severity === 'error'),
    issues,
    files: {
      'gen/data.s': lines.join('\n') + '\n',
      'gen/config.h': h.join('\n') + '\n',
      'gen/config.inc': inc.join('\n') + '\n',
      'gen/header.inc': `; GENERATED: NES 2.0 header from cartridge.json\n${bytesAsm(header)}\n`,
      'gen/chr.bin': chr,
    },
    report,
  };
}
