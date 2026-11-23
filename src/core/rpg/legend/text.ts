// THE LEGEND OF BLUM (BLUMZ-M1): French text -> dialogue pages (2 lines of 28 tiles) -> ROM bytes.
// Québec typography: a space before ! ? : ; and inside « », never broken across lines. [n] = a number the
// engine prints at run time (damage, XP, level), up to 3 digits.
import { encodeText, textWidth, unknownChars } from '../spike-art.js';

export const TEXT_W = 28;
export const NUM_TOKEN = '[n]';
export const CODE_NUM = 0xfd;
export const CODE_LINE = 0xfe;
export const CODE_END = 0xff;

export type Page = [string, string];

const glueLeft = /^[!?:;»]+[.,]?$/;
const glueRight = /^«$/;

/** Words of a paragraph, punctuation glued to its neighbour so a line never starts with « ! » or ends with « « ». */
function words(text: string): string[] {
  const raw = text.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i]!;
    if (glueLeft.test(w) && out.length) out[out.length - 1] += ` ${w}`;
    else if (glueRight.test(w) && i + 1 < raw.length) {
      out.push(`${w} ${raw[i + 1]}`);
      i++;
    } else out.push(w);
  }
  return out;
}

/** Display width of a line: [n] counts as 3 tiles (the widest number). */
export function lineWidth(line: string): number {
  return textWidth(line.split(NUM_TOKEN).join('000'));
}

/** Greedy wrap to `width` tiles. Throws when one word is wider than a line. */
export function wrap(text: string, width = TEXT_W): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of words(text)) {
    if (lineWidth(w) > width) throw new Error(`mot trop long pour une ligne de ${width} : « ${w} »`);
    const next = cur ? `${cur} ${w}` : w;
    if (lineWidth(next) <= width) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** One paragraph or a list of paragraphs -> pages of 2 lines (each paragraph starts a new page). */
export function paginate(text: string | string[], width = TEXT_W): Page[] {
  const pages: Page[] = [];
  for (const para of Array.isArray(text) ? text : [text]) {
    const lines = wrap(para, width);
    for (let i = 0; i < lines.length; i += 2) pages.push([lines[i]!, lines[i + 1] ?? '']);
  }
  return pages;
}

/** Choice block: the question wrapped, its last line on the last page above the options line. */
export function choicePages(question: string, options: string[]): { pages: Page[]; cols: number[] } {
  const lines = wrap(question);
  const last = lines.pop() ?? '';
  const pages: Page[] = [];
  for (let i = 0; i < lines.length; i += 2) pages.push([lines[i]!, lines[i + 1] ?? '']);
  const cols: number[] = [];
  let line = '';
  for (const o of options) {
    const col = line.length + 1;
    cols.push(col);
    line += `  ${o}`;
    line = line.padEnd(line.length + 3, ' ');
  }
  line = line.trimEnd();
  if (lineWidth(line) > TEXT_W) throw new Error(`choix trop long : « ${options.join(' / ')} »`);
  pages.push([last, line]);
  return { pages, cols };
}

/** Text -> tile bytes, [n] -> CODE_NUM. */
export function encodeLine(line: string): number[] {
  const out: number[] = [];
  line.split(NUM_TOKEN).forEach((part, i) => {
    if (i > 0) out.push(CODE_NUM);
    out.push(...encodeText(part));
  });
  return out;
}

/** Characters the font does not have (the validator reports them with the place). */
export function badChars(text: string): string[] {
  return unknownChars(text.split(NUM_TOKEN).join(''));
}

/** A line with every character the font lacks replaced by a space (the validator reports them). */
export function sanitize(line: string): string {
  const bad = new Set(badChars(line));
  return bad.size ? [...line].map((ch) => (bad.has(ch) ? ' ' : ch)).join('') : line;
}

/** A block: [page count] then per page [speaker][line 1][CODE_LINE][line 2][CODE_END]. */
export function encodeBlock(pages: Page[], speaker: number): number[] {
  const out = [pages.length];
  for (const [a, b] of pages) out.push(speaker, ...encodeLine(sanitize(a)), CODE_LINE, ...encodeLine(sanitize(b.trimEnd())), CODE_END);
  return out;
}
