import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STORY_TEMPLATES } from '../src/core/directors/specs';
import { SCREEN_WORDS } from '../src/core/engine-data/text-screens';
import { BLUM_BOSSES, BLUM_ENEMIES, BLUM_STORY } from '../src/core/sample/blum';
import { BLUM_LEVELS } from '../src/core/sample/blum-levels';
import { messages } from '../src/shared/i18n';

const ROOT = path.resolve(import.meta.dirname, '..');
const NINTENDO = /nintendo|famicom|snes|super nes/i;
const PICTO = /\p{Extended_Pictographic}/u;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

describe('M6-T2 UI and game strings', () => {
  it('Nintendo terms appear only in Help’s hardware compatibility text', () => {
    const hits: string[] = [];
    for (const locale of ['fr', 'en'] as const) {
      for (const [k, v] of Object.entries(messages[locale])) if (NINTENDO.test(v) && !k.startsWith('help.hw.')) hits.push(`${locale}:${k}`);
    }
    expect(hits).toEqual([]);
    // the compatibility text does name the hardware (that is its job)
    expect(messages.fr['help.hw.text']).toMatch(/Famicom/);
  });

  it('no pictographs and no Nintendo terms in game texts (sample BLUM, story templates, ROM words)', () => {
    const texts = JSON.stringify([BLUM_STORY, BLUM_ENEMIES, BLUM_BOSSES, BLUM_LEVELS.map((l) => [l.name, l.intro]), STORY_TEMPLATES, SCREEN_WORDS]);
    expect(PICTO.exec(texts)).toBeNull();
    expect(NINTENDO.exec(texts)).toBeNull();
  });

  it('no pictographs in the shipped sample project (resources/samples)', () => {
    const dir = path.join(ROOT, 'resources', 'samples');
    const files = walk(dir).filter((f) => /\.(json|jsonl)$/.test(f));
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(PICTO.exec(text), f).toBeNull();
      expect(NINTENDO.exec(text), f).toBeNull();
    }
  });

  it('every M6 screen key exists in both languages', () => {
    for (const k of ['nav.help', 'help.flash.ram', 'help.unblock.text', 'help.smart.text', 'help.mesen.text', 'first.s5.say', 'cart.sample', 'settings.usageBy'] as const) {
      expect(messages.fr[k].length).toBeGreaterThan(3);
      expect(messages.en[k].length).toBeGreaterThan(3);
    }
    // the PRG-RAM rule is spelled out in both languages
    expect(messages.fr['help.flash.ram']).toMatch(/8 Ko/);
    expect(messages.en['help.flash.ram']).toMatch(/8 KiB/);
  });
});
