import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OFFLINE_CHOICES } from '../src/core/directors/specs';
import { DIRECTOR_IDS } from '../src/core/project/proposal';
import { messages, type MessageKey } from '../src/shared/i18n';

const ROOT = path.resolve(import.meta.dirname, '..');

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join('/');
const SRC_TEXT = walk(path.join(ROOT, 'src'), ['.ts', '.tsx', '.css', '.html', '.json', '.mjs']);
const RENDERER_TSX = walk(path.join(ROOT, 'src', 'renderer'), ['.tsx']);

describe('M1 design system', () => {
  it('M1-T2 every colour token in the renderer CSS is a SNES 15-bit step', () => {
    const css = walk(path.join(ROOT, 'src', 'renderer'), ['.css']);
    expect(css.length).toBeGreaterThan(0);
    let count = 0;
    for (const f of css) {
      for (const m of readFileSync(f, 'utf8').matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
        const hex = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
        for (let i = 0; i < 6; i += 2) expect(parseInt(hex.slice(i, i + 2), 16) % 8, `${rel(f)} #${m[1]}`).toBe(0);
        count++;
      }
    }
    expect(count).toBeGreaterThan(20);
  });

  it('M1-T2 no pictograph code points anywhere in src/', () => {
    expect(SRC_TEXT.length).toBeGreaterThan(30);
    for (const f of SRC_TEXT) {
      const text = readFileSync(f, 'utf8');
      const hit = /\p{Extended_Pictographic}/u.exec(text);
      expect(hit, `${rel(f)}: ${hit?.[0]}`).toBeNull();
    }
  });

  it('M1-T2 only the two chosen OFL fonts are loaded', () => {
    const fontImports = new Set<string>();
    // BLUM-FIX2 (W2 P2-2): an @font-face may only re-declare a file of the two bundled @fontsource fonts
    // (the digits-only 'Body Digits' face uses the Press Start 2P woff2); nothing else, nothing remote
    const aliases = new Set<string>();
    for (const f of walk(path.join(ROOT, 'src'), ['.ts', '.tsx', '.css'])) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/@fontsource\/([a-z0-9-]+)/g)) fontImports.add(m[1]!);
      expect(text, rel(f)).not.toMatch(/fonts\.googleapis/);
      const faces = [...text.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]!);
      expect(faces.length, rel(f)).toBe((text.match(/@font-face/g) ?? []).length);
      for (const face of faces) {
        const srcs = [...face.matchAll(/url\(([^)]*)\)/g)].map((m) => m[1]!);
        expect(srcs.length, rel(f)).toBeGreaterThan(0);
        for (const u of srcs) expect(u, rel(f)).toMatch(/^'\.\.\/\.\.\/node_modules\/@fontsource\/(press-start-2p|pixelify-sans)\/files\/[a-z0-9-]+\.woff2'$/);
        aliases.add(/font-family:\s*'([^']+)'/.exec(face)![1]!);
      }
    }
    expect([...fontImports].sort()).toEqual(['pixelify-sans', 'press-start-2p']);
    expect(walk(path.join(ROOT, 'src'), ['.ttf', '.otf', '.woff', '.woff2'])).toEqual([]);
    const css = readFileSync(path.join(ROOT, 'src', 'renderer', 'styles.css'), 'utf8');
    const families = new Set([...css.matchAll(/'([A-Z][A-Za-z0-9 ]+)'/g)].map((m) => m[1]));
    for (const fam of families) expect(['Press Start 2P', 'Pixelify Sans', ...aliases]).toContain(fam);
    expect([...aliases]).toEqual(['Body Digits']);
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    // M5: the fonts are devDependencies (Vite bundles them into the renderer); the set of fonts is the same
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((d) => d.startsWith('@fontsource/'));
    expect(deps.sort()).toEqual(['@fontsource/pixelify-sans', '@fontsource/press-start-2p']);
  });

  it('M1 core stays pure: no electron or react import in src/core', () => {
    for (const f of walk(path.join(ROOT, 'src', 'core'), ['.ts'])) {
      const text = readFileSync(f, 'utf8');
      expect(text, rel(f)).not.toMatch(/from ['"](electron|react|react-dom)['"/]/);
    }
  });

  it('M1 no Nintendo terms in the UI dictionaries', () => {
    for (const locale of ['fr', 'en'] as const) {
      // M6-T2: Help's hardware compatibility text is the one place allowed to name the hardware
      for (const [k, v] of Object.entries(messages[locale])) if (!k.startsWith('help.hw.')) expect(v, `${locale}:${k}`).not.toMatch(/nintendo|famicom|snes|super nes/i);
    }
  });
});

describe('M1 i18n', () => {
  it('M1-T10 French is the default and FR/EN keys have parity, none empty', () => {
    const fr = Object.keys(messages.fr).sort();
    expect(Object.keys(messages.en).sort()).toEqual(fr);
    for (const locale of ['fr', 'en'] as const) {
      for (const [k, v] of Object.entries(messages[locale])) {
        expect(v.trim(), `${locale}:${k}`).not.toBe('');
        // Same placeholders in both languages.
        const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        expect(vars(v), `${locale}:${k}`).toEqual(vars(messages.fr[k as MessageKey]));
      }
    }
  });

  it('M1-T10 every key used by the renderer exists in the dictionaries', () => {
    const used = new Set<string>();
    for (const f of RENDERER_TSX) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/\bt\(\s*'([a-zA-Z0-9.]+)'/g)) used.add(m[1]!);
      for (const m of text.matchAll(/'((?:lang|nav|dir|doc|offline|settings)\.[a-zA-Z0-9.]+)'/g)) used.add(m[1]!);
    }
    for (const id of DIRECTOR_IDS) for (const suffix of ['role', 'hello']) used.add(`dir.${id}.${suffix}`);
    for (const choices of Object.values(OFFLINE_CHOICES)) for (const c of choices ?? []) used.add(`offline.${c}`);
    for (const k of ['directors', 'quality', 'chores']) used.add(`settings.model.${k}`);
    expect(used.size).toBeGreaterThan(100);
    for (const k of used) expect(messages.fr, k).toHaveProperty([k]);
  });

  /** JSX text nodes (after a tag `>` or an expression `}`) and literal UI attributes. */
  function literalUiText(source: string): string[] {
    const text = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const out: string[] = [];
    // `(?<![=-])>` skips arrows and TS generics (`=> Promise<T>`); text must end at a JSX tag.
    for (const m of text.matchAll(/(?:(?<![=-])>|\}(?=[^\S\n]*[^\s<>{}()=;:,.?&|!+*\/\[\]'"`]))([^<>{}\n]*\p{L}[^<>{}\n]*)<\/?[A-Za-z]/gu)) {
      out.push(`text "${m[1]!.trim()}"`);
    }
    for (const m of text.matchAll(/\b(title|placeholder|alt|aria-label)="([^"]*\p{L}[^"]*)"/gu)) out.push(`${m[1]}="${m[2]}"`);
    return out;
  }

  it('M1-T10 the literal-text scan catches the known shapes (negative control)', () => {
    expect(literalUiText('<p>Bonjour</p>')).toHaveLength(1);
    expect(literalUiText('<dd>{n} Ko</dd>')).toHaveLength(1);
    expect(literalUiText('<input placeholder="Salut" />')).toHaveLength(1);
    expect(literalUiText('const f = (): Promise<void> => g(); <p>{t(\'a.b\')}</p>')).toHaveLength(0);
  });

  it('M1-T10 no literal user-facing text in JSX (text nodes or title/placeholder/alt/aria-label)', () => {
    const problems = RENDERER_TSX.flatMap((f) => literalUiText(readFileSync(f, 'utf8')).map((p) => `${rel(f)}: ${p}`));
    expect(problems).toEqual([]);
  });
});
