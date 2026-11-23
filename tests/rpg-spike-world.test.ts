// BLUMZ-PLAN: the RPG spike data compiler (rpg/spike/data/world.json -> gen/world*.inc) and its checks.
// Unit tier: no cc65, no emulator (the ROM itself is tests/engine/rpg-spike.test.ts).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { glyphPixels } from '../src/core/engine-data/art/font';
import { FONT_FIRST, RPG_FONT_ORDER, buildSpikeArt, encodeText, fontPixels } from '../src/core/rpg/spike-art';
import { PAGE_BYTES, TEXT_W, checkWorld, compileWorld, parseWorld, type World } from '../src/core/rpg/spike-world';

const ROOT = path.resolve(import.meta.dirname, '..');
const load = (): World => parseWorld(JSON.parse(readFileSync(path.join(ROOT, 'rpg', 'spike', 'data', 'world.json'), 'utf8')));

describe('BLUMZ-PLAN RPG spike data', () => {
  it('compiles the spike world: constants, 2 rooms, text pages of 2 × 28 tiles, a 1 KiB battle screen', () => {
    const c = compileWorld(load());
    expect(c.inc).toMatch(/^START_ROOM = 0$/m);
    expect(c.inc).toMatch(/^NPC0_DLG_COUNT = 3$/m);
    expect(c.data).toMatch(/^room0_mt:$/m);
    expect(c.data).toMatch(/^room1_attr:$/m);
    expect(c.pages.length).toBe(3 + 9);
    expect(c.battleNametable.length).toBe(1024);
    expect(c.art.bgTileCount).toBeLessThanOrEqual(256);
    expect(c.art.chr.length).toBe(8192);
    // every page line fits the window
    for (const p of c.pages) for (const l of p) expect(encodeText(l).length).toBeLessThanOrEqual(TEXT_W);
    expect(PAGE_BYTES).toBe(56);
  });

  it('has lower case and the French accents in the RPG font, each glyph distinct', () => {
    for (const ch of 'abcdefghijklmnopqrstuvwxyzéèêëàâçîïôûùüÉÈÀÇÔ') expect(RPG_FONT_ORDER).toContain(ch);
    // known alias: BLUM's capital Ô is a small o under a circumflex (7-row cell), same pixels as ô
    const seen = new Map<string, string>();
    for (const ch of RPG_FONT_ORDER) {
      const key = fontPixels(ch).join('');
      const twin = seen.get(key);
      if (ch !== ' ' && twin !== undefined) expect(`${twin}${ch}`, `glyph ${ch} duplicates ${twin}`).toBe('Ôô');
      seen.set(key, ch);
    }
    expect(encodeText('Ça')).toEqual([FONT_FIRST + RPG_FONT_ORDER.indexOf('Ç'), FONT_FIRST + RPG_FONT_ORDER.indexOf('a')]);
    expect(encodeText('l’école')[1]).toBe(FONT_FIRST + RPG_FONT_ORDER.indexOf("'"));
    // ç keeps the c body and adds the cedilla under it
    expect(Array.from(fontPixels('ç').subarray(0, 56))).toEqual(Array.from(fontPixels('c').subarray(0, 56)));
    expect(Array.from(fontPixels('ç').subarray(56))).not.toEqual(Array.from(fontPixels('c').subarray(56)));
  });

  it('BLUMZ-F2: accented capitals have a 2-row accent over a shorter letter on the same baseline (BLUMZ-W P2-2)', () => {
    const ink = (ch: string, row: number) => Array.from(fontPixels(ch).subarray(row * 8, row * 8 + 8)).filter((v) => v === 2).length;
    for (const ch of 'ÉÈÊËÀÂÎÏÔÛÙÜ') {
      expect(ink(ch, 0), `${ch} accent row 0`).toBeGreaterThan(0);
      expect(ink(ch, 6), `${ch} baseline`).toBeGreaterThan(0);
      expect(ink(ch, 7), `${ch} row 7`).toBe(0);
      // the accent no longer sits in the letter's top bar: rows 0-1 hold at most the accent's 2-3 pixels
      expect(ink(ch, 0) + ink(ch, 1), ch).toBeLessThanOrEqual(3);
    }
    // the cedilla goes under a full-height C
    expect(Array.from(fontPixels('Ç').subarray(0, 56))).toEqual(Array.from(fontPixels('C').subarray(0, 56)));
    expect(ink('Ç', 7)).toBeGreaterThan(0);
    // BLUM's capitals without accent are unchanged
    expect(Array.from(fontPixels('E'))).toEqual(Array.from(glyphPixels('E')));
  });

  it('refuses broken data in French: long line, unknown character, unknown tile, one-way exit, wall start', () => {
    const art = buildSpikeArt();
    const w = load();
    expect(checkWorld(w, art)).toEqual([]);
    const bad = structuredClone(w);
    bad.dialogue.DLG_BELANGER![0]![1] = 'Une phrase beaucoup trop longue pour la fenêtre';
    bad.dialogue.DLG_BELANGER![1]![0] = 'Œuvre ☺';
    bad.rooms[0]!.rows[2] = '#.....X........#';
    delete bad.rooms[1]!.exits.left;
    bad.player.y = 0;
    const issues = checkWorld(bad, art).map((i) => `${i.where} : ${i.fr}`);
    expect(issues.some((i) => /caractères, maximum 28/.test(i))).toBe(true);
    expect(issues.some((i) => /absents de la police : « Œ » « ☺ »/.test(i))).toBe(true);
    expect(issues.some((i) => /tuile inconnue « X »/.test(i))).toBe(true);
    expect(issues.some((i) => /aller simple/.test(i))).toBe(true);
    expect(issues.some((i) => /case de départ est un mur/.test(i))).toBe(true);
  });

  it('checks that battle text says the numbers the data uses', () => {
    const w = load();
    w.battles[0]!.attackDamage = 7;
    expect(checkWorld(w).map((i) => i.fr)).toContain('le texte ne dit pas 7 dégâts');
  });
});
