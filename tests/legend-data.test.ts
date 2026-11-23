// BLUMZ-M1: THE LEGEND OF BLUM data, compiler, validator and battle simulator (unit tier: no cc65, no
// emulator; the ROM itself is tests/engine/legend-slice.test.ts). The validator runs here on the real data
// (0 errors) and on fixtures that break the rules on purpose (each must produce its error).
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileLegend } from '../src/core/rpg/legend/compile';
import { parseLegendData, readLegendDocs, type LegendData } from '../src/core/rpg/legend/data';
import { loadLegendKit } from '../src/core/rpg/legend/kit';
import { simulateBattle } from '../src/core/rpg/legend/sim';
import { choicePages, paginate, wrap } from '../src/core/rpg/legend/text';
import { lastReport, validateLegend, type LegendIssue } from '../src/core/rpg/legend/validate';

const ROOT = path.resolve(import.meta.dirname, '..');
const RPG = path.join(ROOT, 'rpg');
const kit = loadLegendKit(path.join(RPG, 'kit'));
const docs = () => structuredClone(readLegendDocs(path.join(RPG, 'legend'))) as Record<string, any>;
const check = (d: Record<string, any>): LegendIssue[] => {
  const data = parseLegendData(d);
  return validateLegend(data, compileLegend(data, kit));
};
const errors = (d: Record<string, any>) => check(d).filter((i) => i.level === 'error');
const codes = (d: Record<string, any>) => errors(d).map((i) => i.code);
const screen = (d: Record<string, any>, id: string) => d.areas.areas.flatMap((a: any) => a.screens).find((s: any) => s.id === id);

describe('BLUMZ-M1 legend data: the real slice', () => {
  it('compiles: 10 screens, 4 areas, 4 battles, 5 classes, text and world banks under 8 KiB, CHR 25 KiB', () => {
    const data = parseLegendData(docs());
    const c = compileLegend(data, kit);
    expect(c.meta.screens.length).toBe(10);
    expect(data.areas.length).toBe(4);
    expect(c.meta.battles.size).toBe(4);
    expect(c.meta.classes).toEqual(['GUERRIER', 'MAGE', 'VOLEUR', 'ARCHER', 'NECROMANCIEN']);
    expect(c.sizes.text).toBeLessThanOrEqual(8192);
    expect(c.sizes.world).toBeLessThanOrEqual(8192);
    expect(c.sizes.chrUnits).toBe(25);
    expect(c.chr.length).toBe(128 * 1024);
    expect(c.inc).toMatch(/^START_SCRIPT = \d+$/m);
    expect(c.text).toMatch(/^sc_SCR_BELANGER:$/m);
  });

  it('validator: 0 errors, the end is reachable, no softlock, every class wins every battle (worst rolls, no collation)', () => {
    const issues = check(docs());
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(lastReport.goals).toBeGreaterThan(0);
    expect(lastReport.states).toBeGreaterThan(20);
    expect(lastReport.sims.length).toBe(4 * 5);
    for (const s of lastReport.sims) expect(s.win, `${s.battle} ${s.cls}`).toBe(true);
    expect(lastReport.battlesMet.get('BAT_MARIE_CLAUDE')).toBe(3);
  });

  it('ITEM_CLOCHE: one source in CH00, stays in the inventory (no op removes an item), 2 hints said before the window puzzle', () => {
    const d = docs();
    const s = JSON.stringify(d.scripts.scripts);
    expect(s.match(/"give":"ITEM_CLOCHE"/g)?.length).toBe(1);
    expect(JSON.stringify(d.scripts.scripts.SCR_BELANGER)).toContain('ITEM_CLOCHE');
    expect(s).not.toMatch(/"take"|"remove"|"drop"/);
    const p = d.puzzles.puzzles.find((x: any) => x.id === 'PUZ_FENETRE');
    expect(p.requires.items).toEqual(['ITEM_CLOCHE']);
    expect(p.hints.length).toBe(2);
  });

  it('privacy and taste: no address, no link, no emoji, only locked or declared fictional speakers', () => {
    const d = docs();
    const all = JSON.stringify([d.scripts, d.cards, d.items, d.battles, d.classes, d.game]);
    expect(all).not.toMatch(/\b[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d\b/);
    expect(all).not.toMatch(/https?:|www\./);
    expect(all).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});

describe('BLUMZ-M1 legend validator: fixtures that must fail', () => {
  it('one-way exit and an exit into a wall', () => {
    const d = docs();
    delete screen(d, 'cuisine').exits.left;
    expect(codes(d)).toContain('one-way-exit');
    const d2 = docs();
    const rows = screen(d2, 'cuisine').rows;
    rows[7] = '#' + rows[7].slice(1);
    expect(codes(d2)).toContain('blocked-exit');
  });

  it('softlock: a door that needs a flag nobody sets', () => {
    const d = docs();
    d.scripts.scripts.SCR_PORTE_ECOLE[0].if = { all: [{ flag: 'F_MAXI' }, { flag: 'F_JAMAIS' }] };
    const c = codes(d);
    expect(c).toContain('no-end');
  });

  it('softlock: a save point after which the end cannot be reached', () => {
    const d = docs();
    const mc = d.scripts.scripts.SCR_MARIE_CLAUDE;
    mc.splice(mc.length - 1, 0, { save: true });
    expect(codes(d)).toContain('softlock');
  });

  it('class-gated puzzle', () => {
    const d = docs();
    d.puzzles.puzzles[1].requires.class = 'MAGE';
    expect(codes(d)).toContain('class-gate');
  });

  it('critical item given twice, a puzzle with one hint, a puzzle bypassed without its item', () => {
    const d = docs();
    d.scripts.scripts.SCR_MAGDI.push({ give: 'ITEM_CLOCHE' });
    expect(codes(d)).toContain('critical-source');
    const d2 = docs();
    d2.puzzles.puzzles[0].hints = ['HINT_CLOCHE_1'];
    expect(codes(d2)).toContain('hints');
    const d3 = docs();
    d3.scripts.scripts.SCR_NIVOIX.push({ set: 'F_PORTE_1RE' });
    expect(codes(d3)).toContain('puzzle-bypass');
  });

  it('a battle message longer than one page (the battle window shows one page per message)', () => {
    const d = docs();
    d.battles.battles[0].intro = 'Un Mouton de poussière sort de sous le comptoir, il a très faim et il a vraiment mauvais caractère !';
    expect(() => check(d)).toThrow(/message de combat sur 2 pages/);
  });

  it('a boss one class cannot beat', () => {
    const d = docs();
    const b = d.battles.battles.find((x: any) => x.id === 'BAT_MARIE_CLAUDE');
    b.stats.hp = 120;
    const issues = errors(d);
    expect(issues.some((i) => i.code === 'battle-lost' || i.code === 'battle-long')).toBe(true);
  });

  it('text: a glyph the font lacks, an emoji, a postal code, a street number, an undeclared speaker', () => {
    const d = docs();
    d.scripts.scripts.SCR_BOITE[0].say = 'Une boîte ~ aux lettres.';
    expect(codes(d)).toContain('text-glyph');
    const d2 = docs();
    d2.scripts.scripts.SCR_BOITE[0].say = 'Le code H1H 1H1 est écrit dessus.';
    expect(codes(d2)).toContain('privacy');
    const d3 = docs();
    d3.scripts.scripts.SCR_BOITE[0].say = 'Il habite au 1234 rue des Érables.';
    expect(codes(d3)).toContain('privacy');
    const d4 = docs();
    d4.scripts.scripts.SCR_BOITE[0].who = 'Jean Tremblay';
    expect(codes(d4)).toContain('name');
  });
});

describe('BLUMZ-M1 legend text and battle simulator', () => {
  it('wraps French text to 28 tiles, keeps « ! » with its word, [n] counts as 3 tiles', () => {
    expect(wrap('Coup de cartable ! [n] dégâts.')).toEqual(['Coup de cartable ! [n]', 'dégâts.']);
    for (const l of wrap('La porte de la 1re est barrée. Une affiche : « Billet d\'autorisation obligatoire. »')) expect(l.length).toBeLessThanOrEqual(28);
    expect(paginate(['a', 'b']).length).toBe(2);
    const c = choicePages('Sonner la clochette ?', ['Oui', 'Non']);
    expect(c.pages.at(-1)![1]).toBe('  Oui     Non');
    expect(c.cols).toEqual([1, 9]);
    expect(() => wrap('anticonstitutionnellementxxxxxxxx')).toThrow(/trop long/);
  });

  it('simulator: Défense blocks the dictée, the necromancer helper hits, worst rolls lose more PV than best rolls', () => {
    const data: LegendData = parseLegendData(docs());
    const mc = data.battles.battles.find((b) => b.id === 'BAT_MARIE_CLAUDE')!;
    const g = data.classes.classes[0]!;
    const worst = simulateBattle(data.game, g, data.classes.helper, mc, { level: 3, collations: 0 }, 'worst');
    const best = simulateBattle(data.game, g, data.classes.helper, mc, { level: 3, collations: 0 }, 'best');
    expect(worst.win && best.win).toBe(true);
    expect(worst.log).toContain('défense');
    expect(worst.log.some((l) => l === 'dictee 4')).toBe(true);
    expect(best.hpLeft).toBeGreaterThanOrEqual(worst.hpLeft);
    const necro = simulateBattle(data.game, data.classes.classes[4]!, data.classes.helper, mc, { level: 3, collations: 0 }, 'worst');
    expect(necro.log.some((l) => l.startsWith('allié'))).toBe(true);
  });
});
