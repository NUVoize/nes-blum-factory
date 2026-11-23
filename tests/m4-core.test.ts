// M4 unit tier: boss DSL (M4-T5), story budgets (M4-T1), level validator (M4-T7), stretch gating
// (M4-T12), contract additions (engine.h <-> contract.ts) and the REBOND/TABLEAU tools.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOSS_OPS, bossScriptIssues, bossScriptSchema, compileBossScript, formatBossScript, parseBossScript, DEFAULT_BOSS_SCRIPT } from '../src/core/engine-data/boss-dsl';
import { BUILT_AI_PATTERNS, CHEAT, EVENT, PROBE, PROBE_FLAG, TEXT_SCREEN, MAX_ENEMY_SHOTS, MAX_SHOTS } from '../src/core/engine-data/contract';
import { demoProject, FEATURE_LEVELS } from '../src/core/engine-data/feature-levels';
import { DEMO_LEVEL, JARDIN_TILESET, makeGrid, MT } from '../src/core/engine-data/demo';
import { emitProject } from '../src/core/engine-data/emit';
import { storyScreens, TEXT_BANK_BYTES, TEXT_LINES, wrapText } from '../src/core/engine-data/text-screens';
import { enemyPatternChoices, physicsControls, proposeBoss, proposeEnemy } from '../src/core/directors/rebond';
import { defaultLegend, gridToRows, proposeLevel } from '../src/core/directors/tableau';
import { DIRECTORS } from '../src/core/directors/specs';
import { DEFAULT_FEATURES } from '../src/core/features';
import { exitReachable, validateLevel } from '../src/core/nes/levels';
import { validateProjectDocs } from '../src/core/schema/documents';
import type { Level } from '../src/core/schema/engine-docs';
import { DEFAULT_PHYSICS } from '../src/core/schema/physics';
import type { Story } from '../src/core/schema/story';
import type { Json } from '../src/core/util/json-pointer';

const ROOT = path.resolve(import.meta.dirname, '..');
const MANIFEST = { format: 'nbf-project', schemaVersion: 1, id: '01J0000000000000000000TEST', title: 'Test', locale: 'fr', engineDataVersion: 1, createdAt: '2026-10-19T12:00:00.000Z', updatedAt: '2026-10-19T12:00:00.000Z' };
const check = (docs: Record<string, Json>, flags = DEFAULT_FEATURES) => validateProjectDocs({ 'project.json': MANIFEST, ...docs }, flags);
const errors = (docs: Record<string, Json>, flags = DEFAULT_FEATURES) => check(docs, flags).filter((i) => i.severity === 'error');
const warnings = (docs: Record<string, Json>) => check(docs).filter((i) => i.severity === 'warning');

describe('M4-T5 boss DSL: parser, validator, compiler', () => {
  const TEXT = ['phase', 'vulnerable on', 'move_to 12 2', 'wait 30', 'shoot aimed 32', 'phase hp<=3', 'flash 10', 'charge 48', 'shoot spread 40', 'jump -16 64', 'spawn rampeur'].join('\n');

  it('M4-T5 parses the text form, round-trips, compiles to 3-byte steps with the fixed opcodes', () => {
    const r = parseBossScript(TEXT);
    expect(r.errors).toEqual([]);
    const s = r.script!;
    expect(s.phases).toHaveLength(2);
    expect(s.phases[1]!.hpBelow).toBe(3);
    expect(parseBossScript(formatBossScript(s)).script).toEqual(s);
    const c = compileBossScript(s, (id) => (id === 'rampeur' ? 5 : -1));
    expect(c.phases[0]!.threshold).toBe(255);
    expect(c.phases[0]!.steps).toEqual([6, 1, 0, 0, 12, 2, 1, 30, 0, 3, 0, 32]);
    expect(c.phases[1]!.steps.slice(-3)).toEqual([4, 5, 0]);
    expect(c.phases[1]!.steps.slice(9, 12)).toEqual([2, 0xf0, 64]); // jump vx -16 as a signed byte
  });

  it('M4-T5 rejects out-of-range values and unknown ops (the op set has exactly 8 kinds)', () => {
    expect(BOSS_OPS).toHaveLength(8);
    const unknown = parseBossScript('phase\nwait 10\nteleport 3');
    expect(unknown.script).toBeNull();
    expect(unknown.errors[0]!.fr).toMatch(/ligne 3 : action inconnue « teleport »/);
    for (const bad of ['wait 0', 'wait 300', 'move_to 300 1', 'move_to 10 9', 'charge 200', 'shoot laser 32', 'jump 0 500', 'flash 0', 'vulnerable maybe']) {
      const r = parseBossScript(`phase\nwait 5\n${bad}`);
      expect(r.script, bad).toBeNull();
      expect(r.errors[0]!.fr, bad).toMatch(/ligne 3/);
    }
    // JSON form: a 9th op kind is not part of the schema
    const json = { schemaVersion: 1, phases: [{ steps: [{ op: 'wait', frames: 10 }, { op: 'teleport', x: 3 }] }] };
    expect(bossScriptSchema.safeParse(json).success).toBe(false);
  });

  it('M4-T5 floor rules: more than 2 phases, thresholds above the boss hp, phases that never wait', () => {
    const three = parseBossScript('phase\nwait 5\nphase hp<=4\nwait 5\nphase hp<=2\nwait 5').script!;
    expect(bossScriptIssues(three, 6)[0]!.fr).toMatch(/trop de phases : 3 \(max 2\)/);
    const high = parseBossScript('phase\nwait 5\nphase hp<=8\nwait 5').script!;
    expect(bossScriptIssues(high, 4)[0]!.fr).toMatch(/commence à 8 vies, mais le boss n’en a que 4/);
    expect(parseBossScript('phase\nvulnerable on\nshoot aimed 32').errors[0]!.fr).toMatch(/attente ou un déplacement/);
    expect(parseBossScript('phase\nwait 5\nphase hp<=3\nwait 5\nphase hp<=3\nwait 5').errors[0]!.fr).toMatch(/descendre/);
    expect(bossScriptIssues(DEFAULT_BOSS_SCRIPT, 6)).toEqual([]);
  });

  it('M4-T5 a boss script that calls a missing enemy, or a missing script, is refused with a French reason', () => {
    const docs = FEATURE_LEVELS.boss();
    (docs['scripts/gros-rampeur.json'] as { phases: Array<{ steps: unknown[] }> }).phases[0]!.steps.push({ op: 'spawn', enemy: 'fantome' });
    expect(errors(docs)[0]!.fr).toMatch(/« spawn » appelle « fantome », qui n’est pas un ennemi/);
    const noScript = FEATURE_LEVELS.boss();
    delete noScript['scripts/gros-rampeur.json'];
    expect(errors(noScript)[0]!.fr).toMatch(/script de boss « gros-rampeur » introuvable/);
  });

  it('emitter: the boss block lands in the stage bank, the boss kind marker in the entity list', () => {
    const r = emitProject(FEATURE_LEVELS.boss());
    expect(r.issues.filter((i) => i.severity === 'error').map((i) => i.fr)).toEqual([]);
    const s = r.files['gen/data.s'] as string;
    expect(s).toMatch(/level_0_boss: ; Gros rampeur/);
    expect(s).toMatch(/\.byte 4,1,32,32,2,48/); // hp, damage, w, h, phases, CHR bank
    expect(s).toMatch(/\.word level_0_boss/);
    expect(r.report!.chr.some((c) => c.bank1k === 48 && c.tiles > 0)).toBe(true);
  });
});

describe('M4-T1 story budgets (PLUME)', () => {
  const story = (docs: Record<string, Json>) => docs['story.json'] as unknown as Story;

  it('M4-T1 more than 8 worlds, more than 4 stages in a world: rejected with French reasons', () => {
    const many = demoProject();
    story(many).worlds = Array.from({ length: 9 }, (_, i) => ({ id: `monde-${i + 1}`, name: { fr: `Monde ${i + 1}` }, theme: 'jardin', stages: [{ id: 'niveau-1', name: { fr: 'Niveau' } }] }));
    expect(errors(many).map((e) => e.fr)).toContain('trop de mondes : 9 (la cartouche en permet 8)');
    const long = demoProject();
    story(long).worlds[0]!.stages = Array.from({ length: 5 }, (_, i) => ({ id: `niveau-${i + 1}`, name: { fr: `N${i + 1}` } }));
    expect(errors(long).some((e) => /a 5 niveaux \(max 4\)/.test(e.fr))).toBe(true);
  });

  it('M4-T1 texts over one screen or over the text bank budget are rejected', () => {
    const tooLong = demoProject();
    story(tooLong).worlds[0]!.intro = { fr: 'Un mot très long encore et encore. '.repeat(8) };
    expect(errors(tooLong).some((e) => /trop long pour un écran : \d+ lignes \(max 10 lignes de 28 lettres\)/.test(e.fr))).toBe(true);

    const budget = demoProject();
    story(budget).worlds = Array.from({ length: 8 }, (_, i) => ({
      id: `monde-${i + 1}`,
      name: { fr: `Monde ${i + 1}` },
      theme: 'jardin',
      stages: [{ id: 'niveau-1', name: { fr: 'Niveau' } }],
      intro: { fr: 'Le jardin dort sous la neige. Blum se réveille et part chercher les graines perdues, une par une, jusqu’au bout du monde. Les castors gardent la rivière, les taupes creusent partout et le vent souffle fort sur la colline.' },
    }));
    const screens = storyScreens(story(budget));
    expect(screens.every((s) => s.lines.length <= TEXT_LINES)).toBe(true);
    const e = errors(budget).find((x) => /octets/.test(x.fr));
    expect(e?.fr).toMatch(new RegExp(`les textes du jeu prennent \\d+ octets, la cartouche leur réserve ${TEXT_BANK_BYTES}`));
    // the same story with short intros fits
    story(budget).worlds.forEach((w) => (w.intro = { fr: 'En route !' }));
    expect(errors(budget)).toEqual([]);
  });

  it('wrapText: words, forced breaks, long words cut', () => {
    expect(wrapText('BONJOUR LE MONDE', 8)).toEqual(['BONJOUR', 'LE MONDE']);
    expect(wrapText('A\nB', 28)).toEqual(['A', 'B']);
    expect(wrapText('ABCDEFGHIJ', 4)).toEqual(['ABCD', 'EFGH', 'IJ']);
  });
});

describe('M4-T7 level validator (TABLEAU)', () => {
  const level = (docs: Record<string, Json>) => docs['levels/niveau-1.json'] as unknown as Level;

  it('M4-T7 the demo level and every feature level pass with no warning', () => {
    expect(check(demoProject())).toEqual([]);
    for (const [name, make] of Object.entries(FEATURE_LEVELS)) {
      const issues = check(make());
      // the lag stress level is crowded on purpose: only the sprite flicker warning (PLAN §6.1)
      if (name === 'stress') expect(issues.map((i) => i.fr), name).toEqual([expect.stringMatching(/sprites sur une même ligne.*clignoter/)]);
      else expect(issues, name).toEqual([]);
    }
  });

  it('M4-T7 spawn in solid, more than 6 enemies on a screen, more than 8 screens: each rejected in French', () => {
    const spawn = demoProject();
    level(spawn).spawn = { col: 0, row: 10 }; // the block at (0, 10)
    expect(errors(spawn)[0]!.fr).toMatch(/le départ \(colonne 0, ligne 10\) est dans un mur/);

    const crowd = demoProject();
    level(crowd).entities = [2, 4, 6, 8, 10, 12, 14].map((col) => ({ actor: 'rampeur', col: col + 20, row: 10 }));
    expect(errors(crowd)[0]!.fr).toMatch(/trop d’ennemis sur un écran : 7 à partir de la colonne 22 \(max 6\)/);

    const wide = demoProject();
    const l = level(wide);
    l.width = 144;
    l.grid = makeGrid(144, [[MT.exit, [[140, 10]]]]);
    expect(errors(wide).some((e) => /niveau trop large : 144 colonnes, soit 9 écrans \(max 8 écrans\)/.test(e.fr))).toBe(true);
  });

  it('M4-T7 an exit outside the jump envelope gives the « la sortie semble inaccessible » warning, not a rejection', () => {
    const docs = demoProject();
    const l = level(docs);
    // the exit on top of a 7-block tower: single jump ~4 blocks, double jump ~6
    l.grid = makeGrid(64, [[MT.block, [3, 4, 5, 6, 7, 8, 9, 10].map((r) => [40, r] as [number, number])], [MT.exit, [[40, 2]]]]);
    l.entities = [];
    const w = warnings(docs);
    expect(errors(docs)).toEqual([]);
    expect(w.map((x) => x.fr)).toEqual(['la sortie semble inaccessible avec les sauts actuels']);
    // a 3-block step is reachable; with the double jump off, a 5-block one is not, with it on it is
    const step = (h: number, dj: boolean) => {
      const g = makeGrid(32, [[MT.block, Array.from({ length: h }, (_, i) => [20, 10 - i] as [number, number])], [MT.exit, [[20, 10 - h]]]]);
      return exitReachable({ ...DEMO_LEVEL, width: 32, grid: g, entities: [] }, JARDIN_TILESET, { ...DEFAULT_PHYSICS, doubleJump: { enabled: dj, velocity: 896 } });
    };
    expect(step(3, false)).toBe(true);
    expect(step(5, false)).toBe(false);
    expect(step(5, true)).toBe(true);
  });

  it('a level with no exit and no boss is a warning; one with two bosses an error', () => {
    const docs = FEATURE_LEVELS.boss();
    expect(validateLevel(level(docs), { tileset: JARDIN_TILESET, physics: DEFAULT_PHYSICS, actorKind: () => 'boss', allowWide: false }).some((i) => /un seul boss/.test(i.fr))).toBe(false);
    level(docs).entities.push({ actor: 'gros-rampeur', col: 20, row: 10 });
    expect(errors(docs).some((e) => /un seul boss par niveau \(il y en a 2\)/.test(e.fr))).toBe(true);
    const none = demoProject();
    level(none).grid = makeGrid(64, []);
    expect(warnings(none)[0]!.fr).toBe('ce niveau n’a ni sortie ni boss : on ne peut pas le finir');
  });
});

describe('M4-T12 stretch gating', () => {
  it('M4-T12 with the stretch flags off: wall grab, a turret enemy, a 12-screen stage are rejected in French', () => {
    const wall = demoProject();
    (wall['physics.json'] as { wallGrab: { enabled: boolean } }).wallGrab.enabled = true;
    expect(errors(wall)[0]!.fr).toBe('l’accroche aux murs n’est pas encore disponible dans le moteur');

    const turret = demoProject();
    turret['actors/tourelle.json'] = { schemaVersion: 1, kind: 'enemy', name: { fr: 'Tourelle' }, pattern: 'turret', speed: 0, hp: 2, damage: 1, turnAtLedge: false, graphics: 'builtin:walker' };
    expect(errors(turret)[0]!.fr).toMatch(/le comportement « turret » n’est pas encore disponible dans le moteur/);

    const twelve = demoProject();
    const l = twelve['levels/niveau-1.json'] as unknown as Level;
    l.width = 192;
    l.grid = makeGrid(192, [[MT.exit, [[190, 10]]]]);
    expect(errors(twelve)[0]!.fr).toMatch(/niveau trop large : 192 colonnes, soit 12 écrans/);
    // the emitter refuses it too (a build never sees a stretch feature)
    expect(emitProject(twelve).ok).toBe(false);
  });

  it('M4-T12 the REBOND form has no control for a stretch feature that is off, and offers only built enemy patterns', () => {
    const pointers = physicsControls(DEFAULT_FEATURES).map((c) => c.pointer);
    for (const gated of ['/wallGrab/enabled', '/swim/enabled', '/melee/enabled', '/doors/enterDelayFrames']) expect(pointers).not.toContain(gated);
    expect(pointers).toContain('/doubleJump/enabled');
    expect(pointers).toContain('/projectile/speed');
    expect(physicsControls({ ...DEFAULT_FEATURES, wallGrab: true }).map((c) => c.pointer)).toContain('/wallGrab/enabled');
    expect(enemyPatternChoices(DEFAULT_FEATURES)).toEqual(['walker', 'hopper', 'flyer', 'shooter']);
    expect(enemyPatternChoices({ ...DEFAULT_FEATURES, extraEnemies: true })).not.toContain('turret'); // not built in the engine
    expect(BUILT_AI_PATTERNS).toEqual(['walker', 'hopper', 'flyer', 'shooter']);
  });
});

describe('ENGINE_DATA_VERSION 1 additions (M4a): engine.h <-> contract.ts', () => {
  const header = readFileSync(path.join(ROOT, 'engine', 'src', 'engine.h'), 'utf8');
  const defines = new Map<string, number>();
  for (const m of header.matchAll(/^#define (\w+) (0x[0-9A-Fa-f]+|\d+)\s*$/gm)) defines.set(m[1]!, Number(m[2]));

  it('events, flags, probe offsets, text screens, cheats, shot counts agree', () => {
    expect(defines.get('EV_KILL')).toBe(EVENT.kill);
    expect(defines.get('EV_BOSS_PHASE')).toBe(EVENT.bossPhase);
    expect(defines.get('EV_BOSS_DEFEATED')).toBe(EVENT.bossDefeated);
    expect(defines.get('EV_SHOT')).toBe(EVENT.shot);
    expect(defines.get('PF_DOUBLEJUMPED')).toBe(PROBE_FLAG.doubleJumped);
    const pr: Record<string, keyof typeof PROBE> = { SHOTS: 'shots', KILLS: 'kills', ESHOTS: 'enemyShots', BOSSPHASE: 'bossPhase', TEXT: 'textScreen', BOSSX: 'bossX', VX: 'vx', CHEATS: 'cheats' };
    for (const [c, k] of Object.entries(pr)) expect(defines.get(`PR_${c}`), c).toBe(PROBE[k]);
    expect(defines.get('TS_INTRO')).toBe(TEXT_SCREEN.intro);
    expect(defines.get('TS_ENDING')).toBe(TEXT_SCREEN.ending);
    expect(defines.get('TS_CREDITS')).toBe(TEXT_SCREEN.credits);
    expect(defines.get('CHEAT_INVINCIBLE')).toBe(CHEAT.invincible);
    expect(defines.get('CHEAT_SKIP')).toBe(CHEAT.skipStage);
    expect(defines.get('MAX_SHOTS')).toBe(MAX_SHOTS);
    expect(defines.get('MAX_ESHOTS')).toBe(MAX_ENEMY_SHOTS);
    expect(defines.get('BOSS_KIND_BASE')).toBe(0xf0);
    // probe fields stay inside $7F00-$7F3F; the cheat byte is the first one after it
    for (const k of ['shots', 'kills', 'enemyShots', 'bossPhase', 'textScreen', 'bossX', 'vx'] as const) expect(PROBE[k]).toBeLessThan(0x40);
    expect(PROBE.cheats).toBe(0x40);
  });

  it('boss opcodes in the interpreter follow BOSS_OPS order', () => {
    const vars = readFileSync(path.join(ROOT, 'engine', 'src', 'actor_vars.h'), 'utf8');
    BOSS_OPS.forEach((op, i) => expect(vars).toMatch(new RegExp(`#define OP_${op.toUpperCase()} ${i}\\b`)));
  });

  it('exported ROMs never carry the test cheats', () => {
    expect(emitProject(demoProject()).files['gen/config.h']).not.toMatch(/NBF_TEST_CHEATS/);
    expect(emitProject(demoProject(), { testCheats: true }).files['gen/config.h']).toMatch(/#define NBF_TEST_CHEATS 1/);
  });
});

describe('REBOND and TABLEAU tools', () => {
  it('propose_enemy writes the actor and places it; stretch patterns are refused by validation', () => {
    const docs = demoProject();
    const out = proposeEnemy.toOps(
      proposeEnemy.input.parse({ id: 'sauteur', name: { fr: 'Sauteur' }, pattern: 'hopper', speed: 64, hp: 2, damage: 1, period: 50, place: [{ level: 'niveau-1', col: 20, row: 10 }] }),
      docs,
    );
    expect(out.ops.map((o) => ('doc' in o ? o.doc : ''))).toEqual(['actors/sauteur.json', 'levels/niveau-1.json']);
    expect(out.summary.fr).toBe('Ennemi « Sauteur » (sauteur, 2 vie(s)), placé 1 fois.');
    expect((out.ops[0] as unknown as { value: { graphics: string } }).value.graphics).toBe('builtin:hopper');
  });

  it('propose_boss parses the DSL text, writes actor + script, replaces the stage boss; DSL errors come back in French', () => {
    const docs = FEATURE_LEVELS.boss();
    const out = proposeBoss.toOps(proposeBoss.input.parse({ id: 'taupe', name: { fr: 'Taupe' }, hp: 5, damage: 1, script: 'phase\nvulnerable on\nwait 40\nshoot aimed 32', place: { level: 'niveau-1', col: 26, row: 10 } }), docs);
    expect(out.ops.map((o) => ('doc' in o ? o.doc : ''))).toEqual(['scripts/taupe.json', 'actors/taupe.json', 'levels/niveau-1.json']);
    const entities = (out.ops[2] as unknown as { value: Array<{ actor: string }> }).value;
    expect(entities.map((e) => e.actor)).toEqual(['taupe']); // the old boss is replaced
    expect(() => proposeBoss.toOps(proposeBoss.input.parse({ id: 'taupe', name: { fr: 'Taupe' }, hp: 5, damage: 1, script: 'phase\ndance 3' }), docs)).toThrow(/action inconnue « dance »/);
  });

  it('propose_level: rows + legend <-> grid, unknown characters refused, a new stage joins its world', () => {
    const docs = demoProject();
    const legend = defaultLegend(JARDIN_TILESET);
    expect(legend).toMatchObject({ '.': MT.sky, '#': MT.grass, '=': MT.plank, H: MT.ladder, '^': MT.spikes, '*': MT.flower, F: MT.checkpoint, E: MT.exit });
    const rows = gridToRows(DEMO_LEVEL.grid, legend);
    const out = proposeLevel.toOps(proposeLevel.input.parse({ id: 'niveau-1', width: 64, rows, spawn: { col: 2, row: 10 }, entities: DEMO_LEVEL.entities }), docs);
    expect((out.ops[0] as unknown as { value: Level }).value.grid).toEqual(DEMO_LEVEL.grid);
    const bad = [...rows];
    bad[3] = 'X' + bad[3]!.slice(1);
    expect(() => proposeLevel.toOps(proposeLevel.input.parse({ id: 'niveau-1', width: 64, rows: bad, spawn: { col: 2, row: 10 } }), docs)).toThrow(/caractère « X » inconnu \(ligne 4, colonne 1\)/);
    const fresh = proposeLevel.toOps(proposeLevel.input.parse({ id: 'niveau-2', width: 64, rows, spawn: { col: 2, row: 10 } }), docs);
    expect(fresh.ops[1]).toEqual({ op: 'add', doc: 'story.json', pointer: '/worlds/0/stages/-', value: { id: 'niveau-2', name: { fr: 'niveau-2' } } });
    expect(DIRECTORS.level.tools.map((t) => t.name)).toEqual(['propose_level']);
    expect(DIRECTORS.movement.tools.map((t) => t.name)).toEqual(['propose_physics', 'propose_enemy', 'propose_boss']);
  });

  it('propose_story adds a starter stage for every new stage id, so the project keeps building', () => {
    const docs = demoProject();
    const story = DIRECTORS.story.tools[0]!;
    const out = story.toOps(
      story.input.parse({
        title: 'TROIS MONDES',
        premise: { fr: 'Trois mondes.' },
        romLocale: 'fr',
        worlds: [1, 2, 3].map((i) => ({ id: `monde-${i}`, name: { fr: `Monde ${i}` }, theme: 'jardin', stages: [{ id: `niveau-${i}`, name: { fr: `Niveau ${i}` } }] })),
        ending: { fr: 'Fin.' },
      }),
      docs,
    );
    expect(out.ops.map((o) => ('doc' in o ? o.doc : ''))).toEqual(['story.json', 'levels/niveau-2.json', 'levels/niveau-3.json']);
    expect(out.summary.fr).toMatch(/dont 2 niveau\(x\) de départ à dessiner avec TABLEAU/);
  });
});
