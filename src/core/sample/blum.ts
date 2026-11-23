// The sample game BLUM (PLAN §12.3, MILESTONES M6): made "through the app" as a FakeProvider replay of
// hand-authored proposals. Every step is a director chat whose scripted answer calls the same tools a
// real Claude run would call; each proposal goes through the runtime's validation and is approved with
// the normal flow (journal, snapshots, undo). No model is called and no key is ever read.
//
// Content: BLUMA's game design (NES-BLUM-FACTORY-ASSETS/sample-game, GAME-DESIGN.md), stage maps
// (blum-levels.ts, generated) and graphics (the placeholder art every project already has).
import { FakeProvider, type FakeTurn } from '../llm/fake.js';
import type { Prices } from '../llm/prices.js';
import type { Usage } from '../llm/types.js';
import type { DirectorId, Proposal } from '../project/proposal.js';
import { ProjectStore } from '../project/store.js';
import { DirectorRuntime } from '../directors/runtime.js';
import { BLUM_LEVELS } from './blum-levels.js';

export const BLUM_TITLE = 'BLUM';

/** World ids match the placeholder tilesets (graphics/tuiles-<world>.json). */
export const BLUM_WORLDS = ['potager', 'cabane', 'chantier', 'tempete'] as const;

const stagesOf = (world: string) => BLUM_LEVELS.filter((l) => l.world === world).map((l) => ({ id: l.id, name: l.name }));

export const BLUM_STORY = {
  title: BLUM_TITLE,
  premise: {
    fr: 'Le matin de sa fête, Blum ouvre la porte : le jardin est gelé. Au mois de mai. Le Gros Frette, un géant de glace de mauvaise humeur, a volé le printemps parce que personne ne l’a invité. Blum met sa tuque et part le chercher.',
    en: 'On the morning of his birthday, Blum opens the door: the garden is frozen. In May. The Big Chill, a grumpy ice giant, stole spring because nobody invited him. Blum puts on his tuque and goes to find him.',
  },
  romLocale: 'fr' as const,
  worlds: [
    {
      id: 'potager',
      name: { fr: 'Le Potager', en: 'The Vegetable Patch' },
      theme: 'jardin',
      stages: stagesOf('potager'),
      boss: 'Rosaire la Taupe',
      intro: {
        fr: 'Le matin de sa fête, Blum ouvre la porte : le jardin est gelé. Au mois de mai ! Le Gros Frette a volé le printemps. Blum met sa tuque et part le chercher.',
        en: 'On his birthday morning, Blum opens the door: the garden is frozen. In May! The Big Chill stole spring. Blum puts on his tuque and goes after him.',
      },
    },
    {
      id: 'cabane',
      name: { fr: 'La Cabane à sucre', en: 'The Sugar Shack' },
      theme: 'erabliere',
      stages: stagesOf('cabane'),
      boss: 'Le Castor Contremaître',
      intro: {
        fr: 'À la cabane, le sirop coule de travers. Et quelqu’un cogne au plafond...',
        en: 'At the shack, the syrup runs the wrong way. And something is knocking on the ceiling...',
      },
    },
    {
      id: 'chantier',
      name: { fr: 'Le Chantier', en: 'The Roadworks' },
      theme: 'chantier',
      stages: stagesOf('chantier'),
      boss: 'Le Roi des Cônes',
      intro: {
        fr: 'Un chantier. Évidemment. Les cônes marchent tout seuls et la grue monte jusqu’au ciel.',
        en: 'Roadworks. Of course. The cones walk on their own and the crane climbs to the sky.',
      },
    },
    {
      id: 'tempete',
      name: { fr: 'La Tempête', en: 'The Ice Storm' },
      theme: 'verglas',
      stages: stagesOf('tempete'),
      boss: 'Le Gros Frette',
      intro: {
        fr: 'Le Mont-Frette. Mets ta tuque. Le Gros Frette t’attend au fond du Frigo.',
        en: 'Mount Frette. Tuque on. The Big Chill is waiting at the back of the Fridge.',
      },
    },
  ],
  ending: {
    fr: 'BONNE FÊTE BLUM !\nLe Gros Frette fond en flaque et le soleil revient.\nLE PRINTEMPS EST REVENU.\nMERCI D’AVOIR JOUÉ.\nPour Blum, de Fred. 2026',
    en: 'HAPPY BIRTHDAY BLUM!\nThe Big Chill melts into a puddle and the sun comes back.\nSPRING IS BACK.\nTHANKS FOR PLAYING.\nFor Blum, from Fred. 2026',
  },
};

type Triple = [number, number, number];
const HUD: Triple = [0x0f, 0x30, 0x16];
const PLAYER: Triple = [0x0f, 0x36, 0x29];
const COMMON: Triple = [0x0f, 0x30, 0x27];

/** BLUMA palettes.json, one set per world (BG 0 = HUD everywhere; sprites: player, common, 2 enemy/boss). */
export const BLUM_PALETTES: Array<{ id: string; backdrop: number; bg: Triple[]; sprites: Triple[] }> = [
  { id: 'potager', backdrop: 0x21, bg: [HUD, [0x19, 0x29, 0x39], [0x07, 0x17, 0x37], [0x16, 0x27, 0x30]], sprites: [PLAYER, COMMON, [0x0f, 0x17, 0x37], [0x0f, 0x00, 0x30]] },
  { id: 'cabane', backdrop: 0x31, bg: [HUD, [0x07, 0x17, 0x27], [0x06, 0x16, 0x26], [0x1c, 0x2c, 0x30]], sprites: [PLAYER, COMMON, [0x0f, 0x17, 0x27], [0x0f, 0x00, 0x30]] },
  { id: 'chantier', backdrop: 0x02, bg: [HUD, [0x0f, 0x27, 0x30], [0x00, 0x10, 0x3d], [0x08, 0x28, 0x38]], sprites: [PLAYER, COMMON, [0x0f, 0x27, 0x30], [0x0f, 0x28, 0x00]] },
  { id: 'tempete', backdrop: 0x01, bg: [HUD, [0x11, 0x21, 0x31], [0x0f, 0x2c, 0x30], [0x07, 0x17, 0x37]], sprites: [PLAYER, COMMON, [0x0f, 0x30, 0x21], [0x0f, 0x16, 0x27]] },
];

/** BLUMA physics.json in the engine's units (jumpCut capped at the engine's 256; air control as a ratio /256). */
export const BLUM_PHYSICS: Array<{ pointer: string; value: number | boolean }> = [
  { pointer: '/walkAccel', value: 24 },
  { pointer: '/runMax', value: 384 },
  { pointer: '/friction', value: 32 },
  { pointer: '/turnBoost', value: 48 },
  { pointer: '/gravity', value: 56 },
  { pointer: '/maxFall', value: 1024 },
  { pointer: '/airControl', value: 208 },
  { pointer: '/jumpVelocity', value: 1184 },
  { pointer: '/jumpCut', value: 256 },
  { pointer: '/coyoteFrames', value: 6 },
  { pointer: '/jumpBufferFrames', value: 6 },
  { pointer: '/doubleJump/enabled', value: true },
  { pointer: '/doubleJump/velocity', value: 960 },
  { pointer: '/ladders/climbSpeed', value: 256 },
  { pointer: '/projectile/speed', value: 768 },
  { pointer: '/projectile/maxOnScreen', value: 2 },
  { pointer: '/projectile/cooldown', value: 18 },
  { pointer: '/health/hp', value: 3 },
  { pointer: '/health/knockback/x', value: 512 },
  { pointer: '/health/knockback/y', value: 512 },
  { pointer: '/health/iframes', value: 60 },
];

const sheet = (world: string) => `graphics/ennemis-${world}.json`;

/** BLUMA actors.json enemies (the stretch « grêlon » chaser is not used by any map). */
export const BLUM_ENEMIES = [
  { id: 'limace', name: { fr: 'Limace gourmande', en: 'Greedy Slug' }, pattern: 'walker', speed: 64, hp: 1, damage: 1, turnAtLedge: true, graphics: sheet('potager'), frames: ['limace1', 'limace2'] },
  { id: 'corneille', name: { fr: 'Corneille jacasseuse', en: 'Nosy Crow' }, pattern: 'flyer', speed: 192, hp: 1, damage: 1, turnAtLedge: false, graphics: sheet('potager'), frames: ['corneille1', 'corneille2'], period: 64, amplitude: 16 },
  { id: 'ecureuil', name: { fr: 'Écureuil nerveux', en: 'Jumpy Squirrel' }, pattern: 'hopper', speed: 256, hp: 1, damage: 1, turnAtLedge: false, graphics: sheet('cabane'), frames: ['ecureuil1', 'ecureuil2'], period: 30, jump: 768 },
  { id: 'chaudiere', name: { fr: 'Chaudière qui coule', en: 'Leaky Sap Bucket' }, pattern: 'shooter', speed: 0, hp: 2, damage: 1, turnAtLedge: false, graphics: sheet('cabane'), frames: ['chaudiere1', 'chaudiere2'], period: 90, shotSpeed: 128 },
  { id: 'cone', name: { fr: 'Cône marcheur', en: 'Walking Cone' }, pattern: 'walker', speed: 128, hp: 1, damage: 1, turnAtLedge: false, graphics: sheet('chantier'), frames: ['cone1', 'cone2'] },
  { id: 'marteau', name: { fr: 'Marteau-piqueur', en: 'Jackhammer' }, pattern: 'hopper', speed: 0, hp: 2, damage: 1, turnAtLedge: false, graphics: sheet('chantier'), frames: ['marteau1', 'marteau2'], period: 20, jump: 512 },
  { id: 'bonhomme', name: { fr: 'Bonhomme de neige', en: 'Snowman' }, pattern: 'shooter', speed: 0, hp: 2, damage: 1, turnAtLedge: false, graphics: sheet('tempete'), frames: ['bonhomme1', 'bonhomme2'], period: 120, shotSpeed: 192 },
  { id: 'glacon', name: { fr: 'Glaçon filant', en: 'Shooting Icicle' }, pattern: 'flyer', speed: 256, hp: 1, damage: 1, turnAtLedge: false, graphics: sheet('tempete'), frames: ['glacon1', 'glacon2'], period: 32, amplitude: 8 },
] as const;

/** The five fights of GAME-DESIGN.md §5, written in the boss DSL (PLAN §5.7: 8 ops, 2 phases). */
export const BLUM_BOSSES = [
  {
    id: 'taupe',
    name: { fr: 'Rosaire la Taupe', en: 'Rosaire the Mole' },
    hp: 6,
    damage: 1,
    graphics: 'graphics/boss-taupe.json',
    frames: ['taupe1', 'taupe2'],
    script: [
      'phase',
      'vulnerable off',
      'move_to 114 1',
      'wait 30',
      'jump 0 64',
      'flash 12',
      'vulnerable on',
      'wait 90',
      'vulnerable off',
      'move_to 121 1',
      'wait 30',
      'jump 0 64',
      'flash 12',
      'vulnerable on',
      'wait 90',
      'phase hp<=3',
      'vulnerable off',
      'move_to 115 2',
      'jump 0 72',
      'spawn limace',
      'vulnerable on',
      'wait 70',
      'vulnerable off',
      'move_to 122 2',
      'jump 0 72',
      'vulnerable on',
      'wait 70',
    ],
  },
  {
    id: 'castor',
    name: { fr: 'Le Castor Contremaître', en: 'The Beaver Foreman' },
    hp: 8,
    damage: 1,
    graphics: 'graphics/boss-castor.json',
    frames: ['castor1', 'castor2'],
    script: ['phase', 'vulnerable off', 'wait 30', 'charge 40', 'flash 10', 'vulnerable on', 'wait 80', 'phase hp<=4', 'vulnerable off', 'shoot aimed 32', 'wait 20', 'charge 48', 'flash 10', 'vulnerable on', 'wait 60'],
  },
  {
    id: 'roi-cones',
    name: { fr: 'Le Roi des Cônes', en: 'The Cone King' },
    hp: 8,
    damage: 1,
    graphics: 'graphics/boss-roi-cones.json',
    frames: ['roi-cones1', 'roi-cones2'],
    script: ['phase', 'vulnerable on', 'jump 24 72', 'wait 20', 'jump -24 72', 'wait 20', 'spawn cone', 'wait 60', 'phase hp<=4', 'vulnerable on', 'jump 32 80', 'wait 10', 'jump -32 80', 'wait 10', 'spawn cone', 'flash 6', 'wait 40'],
  },
  {
    id: 'yeti',
    name: { fr: 'Le Yéti du Mont-Frette', en: 'The Mount Frette Yeti' },
    hp: 10,
    damage: 1,
    graphics: 'graphics/boss-yeti.json',
    frames: ['yeti1', 'yeti2'],
    script: ['phase', 'vulnerable off', 'charge 28', 'wait 30', 'jump 0 64', 'shoot spread 28', 'flash 10', 'vulnerable on', 'wait 100', 'phase hp<=5', 'vulnerable off', 'charge 36', 'wait 20', 'jump 0 72', 'shoot spread 32', 'flash 10', 'vulnerable on', 'wait 80'],
  },
  {
    id: 'gros-frette',
    name: { fr: 'Le Gros Frette', en: 'The Big Chill' },
    hp: 12,
    damage: 1,
    graphics: 'graphics/boss-gros-frette.json',
    frames: ['gros-frette1', 'gros-frette2'],
    script: [
      'phase',
      'vulnerable on',
      'shoot aimed 32',
      'wait 30',
      'shoot aimed 32',
      'wait 30',
      'shoot aimed 32',
      'wait 20',
      'charge 32',
      'wait 40',
      'phase hp<=6',
      'vulnerable on',
      'spawn glacon',
      'shoot aimed 36',
      'wait 20',
      'shoot spread 36',
      'wait 15',
      'charge 44',
      'flash 6',
      'wait 30',
    ],
  },
] as const;

/**
 * Enemies left out of BLUMA's maps: the engine's CPU budget (0 lag frames on every stage, M6-T8) is
 * exceeded by one frame where they meet other enemies and shots (measured with the stage scripts).
 */
export const LAG_TRIM: Array<{ stage: string; actor: string; col: number }> = [
  { stage: 'w2-s2', actor: 'chaudiere', col: 52 },
  { stage: 'w2-s2', actor: 'ecureuil', col: 55 },
  { stage: 'w4-s2', actor: 'bonhomme', col: 103 },
];

/** One director chat of the replay: what Fred typed, and the scripted answer (text + tool calls). */
export interface ReplayStep {
  director: DirectorId;
  prompt: string;
  reply: string;
  calls: Array<{ tool: string; input: unknown }>;
}

export function blumReplay(): ReplayStep[] {
  const steps: ReplayStep[] = [
    {
      director: 'story',
      prompt: 'Fais-moi un jeu pour la fête de Blum : le Gros Frette a volé le printemps, quatre mondes québécois (potager, cabane à sucre, chantier, tempête), un boss à la fin de chaque monde et un boss final.',
      reply: 'Voici BLUM : quatre mondes, deux niveaux chacun, et le Frigo du Gros Frette à la toute fin. Les intros tiennent sur un écran.',
      calls: [{ tool: 'propose_story', input: BLUM_STORY }],
    },
    {
      director: 'visual',
      prompt: 'Prends les couleurs des tuiles de chaque monde : ciel bleu au potager, ciel pâle à la cabane, nuit au chantier et à la tempête.',
      reply: 'Quatre jeux de palettes, un par monde. La palette 0 reste celle du HUD partout, Blum garde ses couleurs.',
      calls: BLUM_PALETTES.map((p) => ({ tool: 'propose_palette_set', input: p })),
    },
    {
      director: 'movement',
      prompt: 'Blum court vite, saute trois cases, deux fois de suite, et lance de la tire d’érable.',
      reply: 'Saut de trois cases, double saut pour la quatrième, tire d’érable deux à la fois. Trois cœurs.',
      calls: [{ tool: 'propose_physics', input: { changes: BLUM_PHYSICS, reason: 'Blum : nerveux, saut de 3 cases, double saut' } }],
    },
    {
      director: 'movement',
      prompt: 'Les ennemis : limace et corneille au potager, écureuil et chaudière à la cabane, cône et marteau-piqueur au chantier, bonhomme de neige et glaçon dans la tempête.',
      reply: 'Huit ennemis, deux par monde. Les chaudières et les bonshommes tirent, les écureuils et les marteaux sautent.',
      calls: BLUM_ENEMIES.map((e) => ({ tool: 'propose_enemy', input: { ...e, frames: [...e.frames] } })),
    },
    {
      director: 'movement',
      prompt: 'Les cinq boss : Rosaire la Taupe, le Castor Contremaître, le Roi des Cônes, le Yéti et le Gros Frette.',
      reply: 'Cinq combats en deux phases. Ils clignotent quand on peut les toucher.',
      calls: BLUM_BOSSES.map((b) => ({ tool: 'propose_boss', input: { ...b, frames: [...b.frames], script: b.script.join('\n') } })),
    },
  ];
  for (const world of BLUM_WORLDS) {
    const levels = BLUM_LEVELS.filter((l) => l.world === world);
    steps.push({
      director: 'level',
      prompt: `Dessine les niveaux du monde « ${world} ».`,
      reply: `${levels.length} niveau(x) pour ce monde, le boss sur un sol plat à la fin du dernier.`,
      calls: levels.map(({ intro: _i, ...input }) => ({ tool: 'propose_level', input: { ...input, entities: input.entities.filter((e) => !LAG_TRIM.some((t) => t.stage === input.id && t.actor === e.actor && t.col === e.col)) } })),
    });
  }
  return steps;
}

/** Replay usage: no model is called, so the readout shows zero tokens and zero cost. */
const NO_USAGE: Usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

export interface SampleResult {
  store: ProjectStore;
  approved: Proposal[];
}

/**
 * Creates the BLUM project in `dir` (must not exist or be empty) by replaying every step through
 * DirectorRuntime + FakeProvider and approving each proposal. Throws on the first refused proposal.
 */
export async function makeSampleBlum(dir: string, prices: Prices, now?: () => Date): Promise<SampleResult> {
  const store = ProjectStore.create(dir, { title: BLUM_TITLE, ...(now ? { now } : {}) }, now ? { now } : {});
  const approved: Proposal[] = [];
  try {
    for (const step of blumReplay()) {
      const turns: FakeTurn[] = [[{ text: step.reply }, ...step.calls.map((c) => ({ tool: c.tool, input: c.input }))], [{ text: 'C’est prêt, tu peux approuver.' }]];
      const provider = new FakeProvider(turns, NO_USAGE);
      const runtime = new DirectorRuntime({ store, provider, prices, ...(now ? { now } : {}) });
      const r = await runtime.send(step.director, step.prompt);
      if (r.failure || r.proposals.length !== step.calls.length) {
        // the refusals went back to the "model" as tool results: name them
        const refused = provider.requests
          .flatMap((q) => q.messages.flatMap((m) => m.content))
          .filter((b) => b.type === 'tool_result' && b.is_error)
          .map((b) => (b as { content: string }).content);
        throw new Error(`${step.director}: ${r.proposals.length} proposition(s) sur ${step.calls.length}. ${r.failure?.fr ?? ''} ${refused.join(' | ')}`);
      }
      for (const p of r.proposals) approved.push(runtime.approve(p.id));
    }
  } catch (e) {
    store.close();
    throw e;
  }
  return { store, approved };
}
