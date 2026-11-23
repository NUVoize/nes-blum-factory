import { z } from 'zod';
import { DEFAULT_FEATURES, type FeatureFlags } from '../features.js';
import type { Json } from '../util/json-pointer.js';
import type { Issue } from './common.js';
import { actorSchema, levelSchema, tilesetSchema, type Actor, type Level, type Tileset } from './engine-docs.js';
import { BUILT_AI_PATTERNS, FLOOR_BEHAVIOURS } from '../engine-data/contract.js';
import { bossScriptIssues, bossScriptSchema, type BossScript } from '../engine-data/boss-dsl.js';
import { textScreenIssues } from '../engine-data/text-screens.js';
import { buildFontBank, type FontBank } from '../engine-data/builtin-chr.js';
import { validateLevel } from '../nes/levels.js';
import { graphicsDocSchema, playerActorSchema } from './graphics.js';
import { validateProjectBudgets } from '../nes/budgets/index.js';
import { audioLibrarySchema, palettesSchema, type Palettes } from './misc.js';
import { physicsSchema, type Physics } from './physics.js';
import { cartridgeSchema, projectManifestSchema, type Cartridge } from './project.js';
import { STORY_LIMITS, storySchema, type Story } from './story.js';

// Every project document, keyed by its path inside the project folder (PLAN §3).
const FIXED_DOCS: Record<string, z.ZodType> = {
  'project.json': projectManifestSchema,
  'cartridge.json': cartridgeSchema,
  'story.json': storySchema,
  'physics.json': physicsSchema,
  'graphics/palettes.json': palettesSchema,
  'audio/library.json': audioLibrarySchema,
};

// Levels and tilesets: ENGINE_DATA_VERSION 1 schemas (M2b); graphics (M3); enemy/boss actors and boss
// scripts (M4a).
const FOLDER_DOCS: Array<[RegExp, z.ZodType]> = [
  [/^actors\/player\.json$/, playerActorSchema],
  [/^actors\/[a-z0-9-]{1,32}\.json$/, actorSchema],
  [/^scripts\/[a-z0-9-]{1,32}\.json$/, bossScriptSchema],
  [/^tilesets\/[a-z0-9-]{1,32}\.json$/, tilesetSchema],
  [/^levels\/[a-z0-9-]{1,32}\.json$/, levelSchema],
  [/^graphics\/[a-z0-9-]{1,32}\.json$/, graphicsDocSchema],
];

/** Binary assets a transaction may add (PLAN §3). */
export const ASSET_PATTERNS = [/^graphics\/sources\/[a-z0-9-]{1,32}\.png$/, /^graphics\/[a-z0-9-]{1,32}\.chr$/, /^graphics\/[a-z0-9-]{1,32}\.png$/];

/** Folders that hold project metadata, never documents. */
export const META_DIRS = ['history', 'build', 'proposals', 'directors'] as const;

export const REQUIRED_DOCS = Object.keys(FIXED_DOCS);

export function schemaForDoc(docPath: string): z.ZodType | null {
  if (FIXED_DOCS[docPath]) return FIXED_DOCS[docPath]!;
  for (const [re, schema] of FOLDER_DOCS) if (re.test(docPath)) return schema;
  return null;
}

export function isAssetPath(p: string): boolean {
  return ASSET_PATTERNS.some((re) => re.test(p));
}

function zodIssueText(issue: z.core.$ZodIssue): { fr: string; en: string } {
  const where = issue.path.length ? '/' + issue.path.join('/') : '/';
  switch (issue.code) {
    case 'too_big':
      return { fr: `${where} : valeur trop grande (max ${String(issue.maximum)})`, en: `${where}: too big (max ${String(issue.maximum)})` };
    case 'too_small':
      return { fr: `${where} : valeur trop petite (min ${String(issue.minimum)})`, en: `${where}: too small (min ${String(issue.minimum)})` };
    case 'invalid_type':
      return { fr: `${where} : type attendu ${issue.expected}`, en: `${where}: expected ${issue.expected}` };
    case 'unrecognized_keys':
      return { fr: `${where} : champ inconnu (${issue.keys.join(', ')})`, en: `${where}: unknown field (${issue.keys.join(', ')})` };
    default:
      return { fr: `${where} : ${issue.message}`, en: `${where}: ${issue.message}` };
  }
}

export function validateDoc(docPath: string, value: unknown): Issue[] {
  const schema = schemaForDoc(docPath);
  if (!schema) {
    return [{ doc: docPath, path: '', severity: 'error', fr: `document inconnu : ${docPath}`, en: `unknown document: ${docPath}` }];
  }
  const res = schema.safeParse(value);
  if (res.success) return [];
  return res.error.issues.map((i) => ({ doc: docPath, path: '/' + i.path.join('/'), severity: 'error' as const, ...zodIssueText(i) }));
}

function err(doc: string, path: string, fr: string, en: string): Issue {
  return { doc, path, fr, en, severity: 'error' };
}

/** NES/cartridge budgets and stretch gating, run after the schemas pass. */
export function validateBudgets(docs: Record<string, Json>, flags: FeatureFlags = DEFAULT_FEATURES): Issue[] {
  const issues: Issue[] = [];
  const story = docs['story.json'] as unknown as Story | undefined;
  if (story) {
    if (story.worlds.length > STORY_LIMITS.worlds) {
      issues.push(
        err('story.json', '/worlds', `trop de mondes : ${story.worlds.length} (la cartouche en permet ${STORY_LIMITS.worlds})`, `too many worlds: ${story.worlds.length} (max ${STORY_LIMITS.worlds})`),
      );
    }
    story.worlds.forEach((w, i) => {
      if (w.stages.length > STORY_LIMITS.stagesPerWorld) {
        issues.push(
          err('story.json', `/worlds/${i}/stages`, `le monde « ${w.name.fr} » a ${w.stages.length} niveaux (max ${STORY_LIMITS.stagesPerWorld})`, `world "${w.name.en ?? w.name.fr}" has ${w.stages.length} stages (max ${STORY_LIMITS.stagesPerWorld})`),
        );
      }
    });
    if (story.romLocale === 'en' && !flags.romEnglish) {
      issues.push(err('story.json', '/romLocale', 'le texte anglais dans la ROM n’est pas encore disponible', 'English ROM text is not available yet'));
    }
  }
  const palettes = docs['graphics/palettes.json'] as unknown as Palettes | undefined;
  palettes?.sets.forEach((s, i) => {
    if (s.bg.length > 4) issues.push(err('graphics/palettes.json', `/sets/${i}/bg`, `le monde « ${s.id} » utilise ${s.bg.length} palettes de fond (la NES en a 4)`, `"${s.id}" uses ${s.bg.length} background palettes (the NES has 4)`));
    if (s.sprites.length > 4) issues.push(err('graphics/palettes.json', `/sets/${i}/sprites`, `le monde « ${s.id} » utilise ${s.sprites.length} palettes de sprites (la NES en a 4)`, `"${s.id}" uses ${s.sprites.length} sprite palettes (the NES has 4)`));
  });
  const physics = docs['physics.json'] as unknown as Physics | undefined;
  if (physics) {
    const gated: Array<[boolean, keyof FeatureFlags, string, string, string]> = [
      [physics.wallGrab.enabled, 'wallGrab', '/wallGrab/enabled', 'l’accroche aux murs', 'wall grab'],
      [physics.swim.enabled, 'swim', '/swim/enabled', 'la nage', 'swimming'],
      [physics.melee.enabled, 'melee', '/melee/enabled', 'l’attaque au corps à corps', 'melee attack'],
    ];
    for (const [on, flag, path, fr, en] of gated) {
      if (on && !flags[flag]) issues.push(err('physics.json', path, `${fr} n’est pas encore disponible dans le moteur`, `${en} is not available in the engine yet`));
    }
  }
  const cart = docs['cartridge.json'] as unknown as Cartridge | undefined;
  if (cart?.battery && !flags.battery) {
    issues.push(err('cartridge.json', '/battery', 'la sauvegarde sur pile n’est pas encore disponible', 'battery saves are not available yet'));
  }
  if (story) issues.push(...textScreenIssues(story, font()));
  issues.push(...validateActors(docs, flags));
  issues.push(...validateLevels(docs, flags));
  // world/scene budgets: palettes, tiles, sprites per line, boss width (PLAN §6.1)
  issues.push(...validateProjectBudgets(docs));
  return issues;
}

let fontCache: FontBank | null = null;
const font = () => (fontCache ??= buildFontBank());

const actorEntries = (docs: Record<string, Json>) =>
  Object.entries(docs).filter(([p]) => /^actors\/[a-z0-9-]+\.json$/.test(p) && p !== 'actors/player.json') as Array<[string, unknown]>;

/** Stretch gating for enemies (PLAN §12.2) and boss scripts that must exist and stay inside the floor. */
function validateActors(docs: Record<string, Json>, flags: FeatureFlags): Issue[] {
  const issues: Issue[] = [];
  for (const [p, raw] of actorEntries(docs)) {
    const a = raw as Actor;
    if (a.kind === 'enemy' && !(BUILT_AI_PATTERNS as readonly string[]).includes(a.pattern)) {
      issues.push(
        err(p, '/pattern', `le comportement « ${a.pattern} » n’est pas encore disponible dans le moteur${flags.extraEnemies ? '' : ' (ennemis supplémentaires : plus tard)'}`, `enemy pattern "${a.pattern}" is not available in the engine yet`),
      );
    }
    if (a.kind === 'boss') {
      const sp = `scripts/${a.script}.json`;
      const script = docs[sp] as unknown as BossScript | undefined;
      if (!script) {
        issues.push(err(p, '/script', `script de boss « ${a.script} » introuvable (${sp})`, `boss script "${a.script}" not found (${sp})`));
        continue;
      }
      for (const b of bossScriptIssues(script, a.hp)) issues.push(err(sp, b.path, b.fr, b.en));
      script.phases.forEach((ph, pi) =>
        ph.steps.forEach((st, si) => {
          if (st.op !== 'spawn') return;
          const target = docs[`actors/${st.enemy}.json`] as { kind?: string } | undefined;
          if (target?.kind !== 'enemy') issues.push(err(sp, `/phases/${pi}/steps/${si}/enemy`, `« spawn » appelle « ${st.enemy} », qui n’est pas un ennemi`, `"spawn" calls "${st.enemy}", which is not an enemy`));
        }),
      );
    }
  }
  return issues;
}

/** Every level: TABLEAU's validator (size, spawn, enemies per screen, reachability warning) + floor tile behaviours. */
function validateLevels(docs: Record<string, Json>, flags: FeatureFlags): Issue[] {
  const issues: Issue[] = [];
  const physics = docs['physics.json'] as unknown as Physics | undefined;
  const actorKind = (id: string) => (docs[`actors/${id}.json`] as { kind?: string } | undefined)?.kind;
  for (const [p, raw] of Object.entries(docs)) {
    if (!/^levels\/[a-z0-9-]+\.json$/.test(p)) continue;
    const level = raw as unknown as Level;
    const tileset = docs[`tilesets/${level.tileset}.json`] as unknown as Tileset | undefined;
    issues.push(...validateLevel(level, { tileset, physics, actorKind, allowWide: flags.doors }));
    for (const m of tileset?.metatiles ?? []) {
      if (FLOOR_BEHAVIOURS.includes(m.behaviour)) continue;
      const used = level.grid.some((row) => row.includes(m.id));
      if (used) issues.push(err(p, '/grid', `la tuile « ${m.name} » a le comportement « ${m.behaviour} », pas encore disponible`, `tile "${m.name}" uses behaviour "${m.behaviour}", not available yet`));
    }
  }
  return issues;
}

/** Full check of a document set: every schema, then the budgets. */
export function validateProjectDocs(docs: Record<string, Json>, flags: FeatureFlags = DEFAULT_FEATURES): Issue[] {
  const issues: Issue[] = [];
  for (const req of REQUIRED_DOCS) {
    if (!(req in docs)) issues.push(err(req, '', `document manquant : ${req}`, `missing document: ${req}`));
  }
  for (const [p, v] of Object.entries(docs)) issues.push(...validateDoc(p, v));
  if (issues.some((i) => i.severity === 'error')) return issues;
  return validateBudgets(docs, flags);
}
