// ROM text screens (PLAN §5.9): world intros, ending, credits. Pure layout + encoding, shared by the
// emitter (bytes in a data bank) and the story validator (lines and text bank budget, M4-T1).
import type { Issue } from '../schema/common.js';
import type { Story } from '../schema/story.js';
import { foldRomText } from './art/font.js';
import type { FontBank } from './builtin-chr.js';

/** 28 letters per line, one empty tile row between lines (French accents sit in the glyph's top row). */
export const TEXT_COLS = 28;
export const TEXT_LINES = 10;
export const TEXT_FIRST_ROW = 6;
export const TEXT_LINE_STEP = 2;
export const TEXT_HEADING_ROW = 3;
export const TEXT_PROMPT_ROW = 26;
/** Bytes of all text screens together (one shared data bank region, PLAN §5.3). */
export const TEXT_BANK_BYTES = 2048;

export interface TextScreen {
  kind: 'intro' | 'ending' | 'credits';
  /** World index for intros. */
  world?: number;
  heading: string;
  lines: string[];
  /** Where the text comes from, for French reasons. */
  source: string;
}

/** Word wrap on spaces; `\n` forces a line break. Words longer than the width are cut. */
export function wrapText(text: string, width = TEXT_COLS): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = '';
    for (const raw of para.split(/\s+/).filter(Boolean)) {
      let word = raw;
      while (word.length > width) {
        if (line) (out.push(line), (line = ''));
        out.push(word.slice(0, width));
        word = word.slice(width);
      }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += ' ' + word;
      else (out.push(line), (line = word));
    }
    out.push(line);
  }
  while (out.length && out.at(-1) === '') out.pop();
  return out;
}

const CREDITS = {
  fr: ['FAIT AVEC NES BLUM FACTORY', 'MOTEUR ET OUTILS :', 'NESDOUG.LIB (MIT)', 'NESLIB (DOMAINE PUBLIC)', 'FAMISTUDIO (MIT)', 'CC65 (ZLIB)', '', 'DOUG FRAKER - SHIRU', 'MATHIEU GAUTHIER'],
  en: ['MADE WITH NES BLUM FACTORY', 'ENGINE AND TOOLS:', 'NESDOUG.LIB (MIT)', 'NESLIB (PUBLIC DOMAIN)', 'FAMISTUDIO (MIT)', 'CC65 (ZLIB)', '', 'DOUG FRAKER - SHIRU', 'MATHIEU GAUTHIER'],
} as const;

export const SCREEN_WORDS = {
  fr: { world: 'MONDE', ending: 'FIN', credits: 'MERCI !', prompt: 'APPUIE SUR START' },
  en: { world: 'WORLD', ending: 'THE END', credits: 'THANK YOU!', prompt: 'PRESS START' },
} as const;

/** Every text screen of a story, laid out (folded to the ROM font, wrapped). */
export function storyScreens(story: Story): TextScreen[] {
  const loc = story.romLocale;
  const pick = (t: { fr: string; en?: string }) => (loc === 'en' ? (t.en ?? t.fr) : t.fr);
  const fold = (s: string) => foldRomText(s).text;
  const out: TextScreen[] = [];
  story.worlds.forEach((w, i) => {
    if (!w.intro || !pick(w.intro).trim()) return;
    out.push({
      kind: 'intro',
      world: i,
      heading: fold(`${SCREEN_WORDS[loc].world} ${i + 1} : ${pick(w.name)}`).slice(0, TEXT_COLS + 4),
      lines: wrapText(fold(pick(w.intro))),
      source: `/worlds/${i}/intro`,
    });
  });
  if (pick(story.ending).trim()) out.push({ kind: 'ending', heading: SCREEN_WORDS[loc].ending, lines: wrapText(fold(pick(story.ending))), source: '/ending' });
  out.push({ kind: 'credits', heading: SCREEN_WORDS[loc].credits, lines: [fold(story.title), ...CREDITS[loc]], source: '' });
  return out;
}

/** Bytes of one screen as a draw list ([addr hi, addr lo, len, tiles...]..., 0). */
export function screenBytes(screen: TextScreen, font: Pick<FontBank, 'glyphs' | 'icons'>, loc: 'fr' | 'en'): number[] {
  const tile = (c: string) => font.glyphs.get(c) ?? 0;
  const out: number[] = [];
  const put = (row: number, col: number, tiles: number[]) => {
    if (!tiles.length) return;
    const addr = 0x2000 + row * 32 + col;
    out.push(addr >> 8, addr & 0xff, tiles.length, ...tiles);
  };
  const centred = (row: number, s: string) => {
    const t = [...s.slice(0, 30)].map(tile);
    put(row, Math.floor((32 - t.length) / 2), t);
    return Math.floor((32 - t.length) / 2);
  };
  const hc = centred(TEXT_HEADING_ROW, screen.heading);
  const hl = Math.min(30, screen.heading.length);
  if (hc >= 2) {
    put(TEXT_HEADING_ROW, hc - 2, [font.icons.flower]);
    put(TEXT_HEADING_ROW, hc + hl + 1, [font.icons.flower]);
  }
  screen.lines.slice(0, TEXT_LINES).forEach((l, i) => {
    const trimmed = l.trimEnd();
    if (trimmed) centred(TEXT_FIRST_ROW + TEXT_LINE_STEP * i, trimmed);
  });
  centred(TEXT_PROMPT_ROW, SCREEN_WORDS[loc].prompt);
  out.push(0);
  return out;
}

/** Story text checks: lines per screen and the text bank budget (M4-T1). */
export function textScreenIssues(story: Story, font: Pick<FontBank, 'glyphs' | 'icons'>): Issue[] {
  const issues: Issue[] = [];
  let total = 0;
  for (const s of storyScreens(story)) {
    if (s.lines.length > TEXT_LINES) {
      issues.push({
        doc: 'story.json',
        path: s.source,
        severity: 'error',
        fr: `le texte ${s.kind === 'ending' ? 'de fin' : `du monde ${(s.world ?? 0) + 1}`} est trop long pour un écran : ${s.lines.length} lignes (max ${TEXT_LINES} lignes de ${TEXT_COLS} lettres)`,
        en: `the ${s.kind === 'ending' ? 'ending' : `world ${(s.world ?? 0) + 1}`} text is too long for one screen: ${s.lines.length} lines (max ${TEXT_LINES} lines of ${TEXT_COLS} letters)`,
      });
    }
    total += screenBytes(s, font, story.romLocale).length;
  }
  if (total > TEXT_BANK_BYTES) {
    issues.push({
      doc: 'story.json',
      path: '/worlds',
      severity: 'error',
      fr: `les textes du jeu prennent ${total} octets, la cartouche leur réserve ${TEXT_BANK_BYTES} : raccourcis les introductions ou la fin`,
      en: `the game texts take ${total} bytes, the cartridge keeps ${TEXT_BANK_BYTES} for them: shorten the intros or the ending`,
    });
  }
  return issues;
}
