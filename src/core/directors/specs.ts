import { z } from 'zod';
import type { Op } from '../project/ops.js';
import type { DirectorId } from '../project/proposal.js';
import { paletteSetSchema, type Palettes } from '../schema/misc.js';
import { PHYSICS_LIMITS, PHYSICS_PRESETS, type PhysicsPresetId } from '../schema/physics.js';
import { storySchema, STORY_LIMITS, type Story } from '../schema/story.js';
import type { Level } from '../schema/engine-docs.js';
import { BOSS_OPS, BOSS_LIMITS } from '../engine-data/boss-dsl.js';
import { TEXT_BANK_BYTES, TEXT_COLS, TEXT_LINES } from '../engine-data/text-screens.js';
import { proposeBoss, proposeEnemy, proposePhysics } from './rebond.js';
import { proposeLevel, stubLevel, tableauContext } from './tableau.js';
import { DEFAULT_MODELS } from '../llm/prices.js';
import { chromaContext, conversionInput, conversionOps, type SourceImages } from './chroma.js';
import { editTileInput, editTileOps, type EditTileInput } from './chroma-tile.js';
import { boulonContext, proposeSplitStage } from './boulon.js';
import type { ToolSpec } from '../llm/types.js';
import type { Json } from '../util/json-pointer.js';

// DirectorSpec (PLAN §4.2). Tools never write: they turn a tool call into Ops that the runtime
// dry-runs and validates before anything is shown to Blum.
export interface ToolOutput {
  ops: Op[];
  summary: { fr: string; en: string };
  warnings?: Array<{ fr: string; en: string }>;
}

/** What a tool may read besides the documents: images dropped in the CHROMA panel (PLAN §6). */
export interface ToolContext {
  sources?: SourceImages;
  /** Read a binary project file (graphics/<id>.chr) for tools that edit one. */
  asset?: (path: string) => Uint8Array | undefined;
}

export interface DirectorTool<I = unknown> {
  name: string;
  description: string;
  input: z.ZodType<I>;
  toOps(input: I, docs: Record<string, Json>, ctx?: ToolContext): ToolOutput;
}

export interface DirectorSpec {
  id: DirectorId;
  name: string;
  /** CSS colour token for the panel accent (PLAN §9.2). */
  color: string;
  defaultModel: string;
  /** Stable system prompt (cached); the project context goes in the user turn. */
  systemPrompt(locale: 'fr' | 'en'): string;
  contextSlice(docs: Record<string, Json>, ctx?: ToolContext): Json;
  tools: DirectorTool<any>[];
}

export function toolSpec(t: DirectorTool<any>): ToolSpec {
  // io 'input': fields with a default stay optional for the model
  const schema = z.toJSONSchema(t.input, { target: 'draft-2020-12', io: 'input' }) as Record<string, unknown>;
  delete schema.$schema;
  return { name: t.name, description: t.description, input_schema: schema };
}

const HOUSE_RULES_FR = [
  'Tu travailles dans NES BLUM FACTORY, un studio pour faire de vrais jeux NES (cartouche MMC3).',
  'Tu parles français québécois simple, sans jargon, en 1 à 4 phrases. Pas d’emoji.',
  'Tu ne modifies jamais le projet toi-même : tu appelles un outil de proposition, et Blum approuve ou refuse.',
  'Le moteur lit des données, pas du code : tu ne proposes jamais de code C ou 6502.',
  'Si un outil te renvoie une erreur, corrige la proposition en respectant la raison donnée.',
  'Aucun personnage, logo ou nom de Nintendo.',
].join('\n');

function prompt(role: string, limits: string): string {
  return `${HOUSE_RULES_FR}\n\nTon rôle : ${role}\n\nLimites à respecter :\n${limits}`;
}

// ---------- PLUME (story) ----------

const storyInput = storySchema.omit({ schemaVersion: true });
type StoryInput = z.infer<typeof storyInput>;

const proposeStory: DirectorTool<StoryInput> = {
  name: 'propose_story',
  description: 'Propose the whole story document (title, premise, worlds with stages, ending). Replaces story.json after approval.',
  input: storyInput,
  toOps(input, docs) {
    const stages = input.worlds.reduce((n, w) => n + w.stages.length, 0);
    const ops: Op[] = [{ op: 'set', doc: 'story.json', value: { schemaVersion: 1, ...input } as unknown as Json }];
    // every stage gets a level so the project keeps building (PLAN §1.2); TABLEAU draws them later
    let stubs = 0;
    for (const w of input.worlds) {
      for (const st of w.stages) {
        const lp = `levels/${st.id}.json`;
        const current = docs[lp] as unknown as Level | undefined;
        if (current) {
          if (current.world !== w.id) ops.push({ op: 'patch', doc: lp, pointer: '/world', value: w.id });
          continue;
        }
        const stub = stubLevel(docs, st.id, w.id, st.name);
        if (stub) {
          ops.push({ op: 'set', doc: lp, value: stub as unknown as Json });
          stubs++;
        }
      }
    }
    return {
      ops,
      summary: {
        fr: `Histoire « ${input.title} » : ${input.worlds.length} monde(s), ${stages} niveau(x)${stubs ? `, dont ${stubs} niveau(x) de départ à dessiner avec TABLEAU` : ''}.`,
        en: `Story "${input.title}": ${input.worlds.length} world(s), ${stages} stage(s)${stubs ? `, ${stubs} starter stage(s) for TABLEAU to draw` : ''}.`,
      },
    };
  },
};

// ---------- CHROMA (visual) ----------

const proposePaletteSet: DirectorTool<z.infer<typeof paletteSetSchema>> = {
  name: 'propose_palette_set',
  description: 'Propose the locked palette set of one world: backdrop + 4 background + 4 sprite subpalettes of 3 NES colour indices ($0D forbidden). Sprite roles: 0 player, 1 common, 2-3 enemies and boss.',
  input: paletteSetSchema,
  toOps(input, docs) {
    const pal = docs['graphics/palettes.json'] as unknown as Palettes;
    const idx = pal.sets.findIndex((s) => s.id === input.id);
    const op: Op =
      idx >= 0
        ? { op: 'patch', doc: 'graphics/palettes.json', pointer: `/sets/${idx}`, value: input as unknown as Json }
        : { op: 'add', doc: 'graphics/palettes.json', pointer: '/sets/-', value: input as unknown as Json };
    // BLUM-Q1: the world's name from the story when there is one (the id has no accents: « tempete »)
    const world = (docs['story.json'] as { worlds?: Array<{ id: string; name?: { fr?: string; en?: string } }> } | undefined)?.worlds?.find((w) => w.id === input.id)?.name;
    return {
      ops: [op],
      summary: { fr: `Palettes du monde « ${world?.fr ?? input.id} ».`, en: `Palettes for world "${world?.en ?? world?.fr ?? input.id}".` },
    };
  },
};

const proposeConversion: DirectorTool<z.output<typeof conversionInput>> = {
  name: 'propose_conversion',
  description:
    'Convert an image Blum dropped into real NES graphics (CHR tiles, palettes, metatiles or metasprites) and propose it. The conversion is deterministic; you choose kind, role, size, crop, palette mode, dither and names. Use mode "locked" unless the world has no palettes yet.',
  input: conversionInput,
  toOps(input, docs, ctx) {
    return conversionOps(input, docs, ctx?.sources);
  },
};

const editTile: DirectorTool<EditTileInput> = {
  name: 'edit_tile',
  description: 'Replace the 64 pixels (values 0-3) of one tile of a converted graphic. For small fixes Blum asks for.',
  input: editTileInput,
  toOps(input, docs, ctx) {
    return editTileOps(input, docs, ctx?.asset);
  },
};

const PHYSICS_LIMIT_TEXT = Object.entries(PHYSICS_LIMITS)
  .map(([k, [lo, hi]]) => `- ${k}: ${lo}..${hi}`)
  .join('\n');

export const DIRECTORS: Record<DirectorId, DirectorSpec> = {
  story: {
    id: 'story',
    name: 'PLUME',
    color: '--c-dir-story',
    defaultModel: DEFAULT_MODELS.directors,
    systemPrompt: () =>
      prompt(
        'PLUME, la directrice de l’histoire. Tu transformes une idée en jeu NES : titre, prémisse, mondes, niveaux, boss, fin.',
        [
          `- au plus ${STORY_LIMITS.worlds} mondes, au plus ${STORY_LIMITS.stagesPerWorld} niveaux par monde`,
          '- titre : 24 caractères max ; noms : 24 max ; prémisse : 400 max',
          `- textes affichés dans la ROM (« intro » de chaque monde, « ending ») : un écran de ${TEXT_LINES} lignes de ${TEXT_COLS} lettres, environ 250 caractères ; tous les textes ensemble : ${TEXT_BANK_BYTES} octets`,
          '- identifiants en minuscules avec tirets (monde-1, niveau-1) ; garde les identifiants des niveaux qui existent déjà',
          '- « boss » : le nom du boss du monde ; REBOND crée ensuite son combat',
        ].join('\n'),
      ),
    contextSlice: (docs) => ({ story: docs['story.json'] ?? null, stages: Object.keys(docs).filter((p) => /^levels\/[a-z0-9-]+\.json$/.test(p)) }),
    tools: [proposeStory],
  },
  visual: {
    id: 'visual',
    name: 'CHROMA',
    color: '--c-dir-visual',
    defaultModel: DEFAULT_MODELS.directors,
    systemPrompt: () =>
      prompt(
        'CHROMA, la directrice des graphismes. Tu transformes les images de Blum en vrais graphismes NES avec propose_conversion, tu choisis les palettes et tu expliques les limites. Tu ne dessines pas : la conversion est faite par le convertisseur.',
        [
          '- 4 palettes de fond + 4 palettes de sprites, 3 couleurs chacune + 1 couleur de fond partagée',
          '- palette de fond 0 = HUD ; sprites : 0 héros, 1 objets, 2-3 ennemis et boss',
          '- couleurs NES $00-$3F, jamais $0D',
          '- 256 tuiles de fond par monde, 64 tuiles par banque de sprites, 8 sprites par ligne, boss de 32 pixels de large au plus',
          '- mode verrouillé par défaut ; mode libre seulement pour les premières images d’un monde',
        ].join('\n'),
      ),
    contextSlice: (docs, ctx) => chromaContext(docs, ctx?.sources),
    tools: [proposeConversion, proposePaletteSet, editTile],
  },
  movement: {
    id: 'movement',
    name: 'REBOND',
    color: '--c-dir-movement',
    defaultModel: DEFAULT_MODELS.directors,
    systemPrompt: () =>
      prompt(
        'REBOND, le directeur des mouvements. Tu règles la course, les sauts, la vie et le tir du héros (propose_physics), tu crées les ennemis (propose_enemy) et les combats de boss (propose_boss).',
        [
          `Valeurs entières en 1/256 de pixel par image :\n${PHYSICS_LIMIT_TEXT}`,
          '- accroche aux murs, nage, corps à corps et portes : pas encore disponibles (laisser enabled=false)',
          '- ennemis : walker (marche, tourne aux murs), hopper (saute tous les period images), flyer (vague de amplitude pixels, period images par vague), shooter (tire vers le héros tous les period images)',
          `- boss : ${BOSS_LIMITS.phases} phases au plus, ${BOSS_LIMITS.steps} étapes par phase, actions : ${BOSS_OPS.join(', ')} ; chaque phase doit attendre ou bouger au moins une fois ; un boss doit être « vulnerable on » pour être touché`,
          '- 32 pixels de large au plus pour un boss ; un seul boss par niveau',
        ].join('\n'),
      ),
    contextSlice: (docs) => ({
      physics: docs['physics.json'] ?? null,
      actors: Object.fromEntries(Object.entries(docs).filter(([p]) => /^actors\/[a-z0-9-]+\.json$/.test(p))),
      scripts: Object.fromEntries(Object.entries(docs).filter(([p]) => /^scripts\/[a-z0-9-]+\.json$/.test(p))),
      stages: Object.entries(docs)
        .filter(([p]) => /^levels\/[a-z0-9-]+\.json$/.test(p))
        .map(([, v]) => ({ id: (v as { id: string }).id, width: (v as { width: number }).width })),
    }),
    tools: [proposePhysics, proposeEnemy, proposeBoss],
  },
  level: {
    id: 'level',
    name: 'TABLEAU',
    color: '--c-dir-level',
    defaultModel: DEFAULT_MODELS.directors,
    systemPrompt: () =>
      prompt(
        'TABLEAU, l’architecte des niveaux. Tu dessines les niveaux avec propose_level : 13 lignes de caractères (la légende du jeu de tuiles est dans le contexte), le départ, les ennemis et le boss.',
        [
          '- un seul écran de haut (13 lignes), 16 colonnes par écran, 8 écrans de large au plus (128 colonnes)',
          '- le héros fait 1 case de large et un peu plus d’une case de haut : le départ doit être sur une case vide avec du sol dessous',
          '- 6 ennemis au plus sur un même écran, un seul boss par niveau (plutôt à la fin, sur un sol plat de 2 écrans)',
          '- un trou dans le sol tue ; les pics (^) tuent ; la sortie (E) finit le niveau ; F est un drapeau de reprise',
          '- garde la sortie atteignable : un saut monte d’environ 4 cases, un double saut d’environ 6',
        ].join('\n'),
      ),
    contextSlice: (docs) => tableauContext(docs),
    tools: [proposeLevel],
  },
  build: {
    id: 'build',
    name: 'BOULON',
    color: '--c-dir-build',
    defaultModel: DEFAULT_MODELS.quality,
    systemPrompt: () =>
      prompt(
        'BOULON, le mécano de la cartouche. Tu lis le rapport de construction de la ROM, tu expliques les problèmes en mots simples et tu proposes une réparation avec un outil. Tu ne touches jamais au code du moteur.',
        [
          '- cartouche MMC3 (mapper 4), 256 Ko de programme, 128 Ko de graphismes, 8 Ko de RAM obligatoires',
          '- un niveau fait 8 écrans de large au plus (128 colonnes) ; un niveau trop long se coupe en deux avec propose_split_stage',
          '- 4 niveaux par monde au plus : si le monde est plein, explique qu’il faut raccourcir le niveau avec TABLEAU',
          '- une seule proposition par réponse ; Blum l’approuve, puis la ROM est reconstruite (5 essais au plus)',
          '- si le problème vient du moteur (pas des données de Blum), dis-le et ne propose rien',
        ].join('\n'),
      ),
    contextSlice: (docs) => boulonContext(docs),
    tools: [proposeSplitStage],
  },
};

// ---------- offline paths ----------

const STORY_TEMPLATE_BASE = { romLocale: 'fr' as const };

export const STORY_TEMPLATES: Record<'jardin' | 'usine' | 'ciel', Omit<Story, 'schemaVersion'>> = {
  jardin: {
    ...STORY_TEMPLATE_BASE,
    title: 'FLEUR EN FUITE',
    premise: { fr: 'Une graine vole les couleurs du jardin. Une petite fleur part les reprendre.', en: 'A seed steals the garden colours. A little flower goes to take them back.' },
    worlds: [
      { id: 'monde-1', name: { fr: 'Le potager', en: 'The vegetable patch' }, theme: 'jardin', stages: [{ id: 'niveau-1', name: { fr: 'Les rangs', en: 'The rows' } }], boss: 'Grosse limace' },
      { id: 'monde-2', name: { fr: 'La serre', en: 'The greenhouse' }, theme: 'serre', stages: [{ id: 'niveau-2', name: { fr: 'Buée', en: 'Steam' } }], boss: 'Cactus géant' },
      { id: 'monde-3', name: { fr: 'Le vieux chêne', en: 'The old oak' }, theme: 'arbre', stages: [{ id: 'niveau-3', name: { fr: 'Les racines', en: 'The roots' } }], boss: 'La graine noire' },
    ],
    ending: { fr: 'Les couleurs reviennent. Le jardin refleurit.', en: 'The colours come back. The garden blooms again.' },
  },
  usine: {
    ...STORY_TEMPLATE_BASE,
    title: 'USINE A REVES',
    premise: { fr: 'Une usine de jouets s’est déréglée. Un petit robot-boulon doit l’arrêter.', en: 'A toy factory went haywire. A little bolt must stop it.' },
    worlds: [
      { id: 'monde-1', name: { fr: 'Le quai', en: 'The dock' }, theme: 'usine', stages: [{ id: 'niveau-1', name: { fr: 'Caisses', en: 'Crates' } }], boss: 'Grue folle' },
      { id: 'monde-2', name: { fr: 'La chaîne', en: 'The line' }, theme: 'usine', stages: [{ id: 'niveau-2', name: { fr: 'Engrenages', en: 'Gears' } }], boss: 'Presse' },
      { id: 'monde-3', name: { fr: 'Le bureau', en: 'The office' }, theme: 'usine', stages: [{ id: 'niveau-3', name: { fr: 'Paperasse', en: 'Paperwork' } }], boss: 'Le patron' },
    ],
    ending: { fr: 'L’usine fabrique enfin de bons jouets.', en: 'The factory finally makes good toys.' },
  },
  ciel: {
    ...STORY_TEMPLATE_BASE,
    title: 'NUAGE PERDU',
    premise: { fr: 'Un petit nuage est tombé sur la Terre. Il doit remonter au ciel.', en: 'A little cloud fell to Earth. It must climb back to the sky.' },
    worlds: [
      { id: 'monde-1', name: { fr: 'La ville', en: 'The city' }, theme: 'ville', stages: [{ id: 'niveau-1', name: { fr: 'Toits', en: 'Rooftops' } }], boss: 'Pigeon chef' },
      { id: 'monde-2', name: { fr: 'La montagne', en: 'The mountain' }, theme: 'montagne', stages: [{ id: 'niveau-2', name: { fr: 'Falaise', en: 'Cliff' } }], boss: 'Aigle' },
      { id: 'monde-3', name: { fr: 'L’orage', en: 'The storm' }, theme: 'ciel', stages: [{ id: 'niveau-3', name: { fr: 'Éclairs', en: 'Lightning' } }], boss: 'Roi tonnerre' },
    ],
    ending: { fr: 'Le nuage retrouve sa famille.', en: 'The cloud finds its family.' },
  },
};

/** Offline proposals: the same Ops as the AI path, from a template or preset. */
export function offlineProposal(director: DirectorId, choice: string, docs: Record<string, Json>): ToolOutput | null {
  if (director === 'story' && choice in STORY_TEMPLATES) return proposeStory.toOps(STORY_TEMPLATES[choice as keyof typeof STORY_TEMPLATES], docs);
  if (director === 'movement' && choice in PHYSICS_PRESETS) return proposePhysics.toOps({ preset: choice as PhysicsPresetId, changes: [], reason: '' }, docs);
  return null;
}

export const OFFLINE_CHOICES: Partial<Record<DirectorId, string[]>> = {
  story: Object.keys(STORY_TEMPLATES),
  movement: Object.keys(PHYSICS_PRESETS),
};
