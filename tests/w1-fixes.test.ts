// BLUM-FIX1: Warden W1 findings (runs/reports/BLUM-W1-REVIEW.md). P1-1 key pasted in a director chat,
// P1-2 CHROMA colours far from the locked world palette, P2-6 zip import size cap.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { conversionInput, settingsFor, worldSet } from '../src/core/directors/chroma';
import { DirectorRuntime } from '../src/core/directors/runtime';
import { STORY_TEMPLATES } from '../src/core/directors/specs';
import { colourMiss, suggestNewPalettes } from '../src/core/convert/fidelity';
import { runConvertJob } from '../src/core/convert/job';
import { FakeProvider } from '../src/core/llm/fake';
import { containsKey } from '../src/core/llm/redact';
import { pricesSchema } from '../src/core/llm/prices';
import { exportProjectZip, importProjectZip, ZIP_LIMITS } from '../src/core/project/zip';
import { ProjectError, ProjectStore } from '../src/core/project/store';
import { decodePng } from '../src/core/util/png';
import { fixtureBytes } from './fixtures/images';
import { tempDir } from './helpers';
import { t } from '../src/shared/i18n';

const root = path.join(import.meta.dirname, '..');
const prices = pricesSchema.parse(JSON.parse(readFileSync(path.join(root, 'config', 'prices.json'), 'utf8')));
const FAKE_KEY = 'sk-ant-api03-' + 'A1b2C3d4E5f6G7h8'.repeat(4);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

describe('W1 P1-1 an API key pasted in a director chat', () => {
  it('containsKey spots the key pattern anywhere in a message', () => {
    expect(containsKey(`voici ma clé ${FAKE_KEY} merci`)).toBe(true);
    expect(containsKey('sk-ant-abcd')).toBe(true);
    expect(containsKey('un jeu de fleur, sk-ant tout court')).toBe(false);
    expect(containsKey('Un jeu de fleur')).toBe(false);
  });

  it('is refused with a French reason: no model call, nothing saved, nothing in the zip', async () => {
    const store = ProjectStore.create(path.join(tempDir(), 'Cle.blum'), { title: 'Cle' });
    const provider = new FakeProvider([[{ text: 'never reached' }]]);
    const events: unknown[] = [];
    const rt = new DirectorRuntime({ store, provider, prices, onEvent: (e) => events.push(e) });
    const before = store.fileHashes();
    const r = await rt.send('story', `Tiens ma clé : ${FAKE_KEY}`);
    expect(r.failure?.fr).toMatch(/Ne colle pas ta clé ici.*Réglages/);
    expect(r.failure?.en).toMatch(/Settings/);
    expect(r.proposals).toHaveLength(0);
    expect(provider.requests).toHaveLength(0);
    expect(events).toContainEqual({ type: 'error', ...r.failure });
    expect(store.chat('story')).toHaveLength(0);
    expect(store.fileHashes()).toEqual(before);
    for (const f of walk(store.dir)) expect(readFileSync(f, 'latin1')).not.toContain('sk-ant-api03');
    const zip = Buffer.from(exportProjectZip(store.dir)).toString('latin1');
    expect(zip).not.toContain('sk-ant-api03');
    store.close();
  });

  it('a normal message is still saved, and the saved user text goes through redaction', async () => {
    const store = ProjectStore.create(path.join(tempDir(), 'Ok.blum'), { title: 'Ok' });
    const provider = new FakeProvider([[{ text: 'Bonjour.' }, { tool: 'propose_story', input: { ...STORY_TEMPLATES.jardin, title: 'BLUM' } }], [{ text: 'Voilà.' }]]);
    const rt = new DirectorRuntime({ store, provider, prices });
    const r = await rt.send('story', 'Un jeu de fleur');
    expect(r.failure).toBeNull();
    // BLUM-Q1: the two turns are joined with a space
    expect(store.chat('story').map((l) => l.text)).toEqual(['Un jeu de fleur', 'Bonjour. Voilà.']);
    store.close();
  });
});

describe('W1 P1-2 CHROMA colour miss in locked mode', () => {
  const store = ProjectStore.create(path.join(tempDir(), 'Chroma.blum'), { title: 'Chroma' });
  const docs = store.docs();
  const job = (png: Uint8Array, mode: 'locked' | 'free') => {
    const image = decodePng(png);
    const input = conversionInput.parse({ id: 'apercu', name: 'Aperçu', source: 'x', kind: 'sprite', role: 'player', mode, world: 'monde-1', frame: { w: 16, h: 24 } });
    const settings = settingsFor(input, image.width, image.height, docs);
    return runConvertJob({ png, settings, id: 'apercu', name: 'Aperçu', paletteSet: worldSet(docs, 'monde-1') });
  };

  it('colourMiss is 0 for identical images and 1 for a fully different one', () => {
    const a = { width: 8, height: 8, data: new Uint8Array(8 * 8 * 4).fill(255) };
    const b = { width: 8, height: 8, data: new Uint8Array(8 * 8 * 4) };
    for (let i = 3; i < b.data.length; i += 4) b.data[i] = 255;
    expect(colourMiss(a, a)).toBe(0);
    expect(colourMiss(a, b)).toBe(1);
    // fully transparent images have nothing to miss
    const t = { width: 8, height: 8, data: new Uint8Array(8 * 8 * 4) };
    expect(colourMiss(t, t)).toBe(0);
  });

  it('the orange « Pousse » sheet in the locked demo world misses its colours: new palettes are suggested', () => {
    const locked = job(fixtureBytes('character-sheet.png'), 'locked');
    const free = job(fixtureBytes('character-sheet.png'), 'free');
    expect(locked.ok && free.ok).toBe(true);
    expect(free.freeColourMiss).toBeNull();
    expect(locked.freeColourMiss).toBeCloseTo(free.colourMiss, 6);
    expect(locked.colourMiss).toBeGreaterThan(free.colourMiss);
    expect(suggestNewPalettes(locked)).toBe(true);
    expect(suggestNewPalettes(free)).toBe(false);
  });

  it('the built-in « Exemple : personnage » fits the demo world in locked mode (first thing Blum sees)', () => {
    const r = job(new Uint8Array(readFileSync(path.join(root, 'src', 'renderer', 'chroma', 'exemple-personnage.png'))), 'locked');
    expect(r.ok).toBe(true);
    expect(suggestNewPalettes(r)).toBe(false);
    expect(r.colourMiss).toBeLessThan(0.1);
  });
});

describe('W1 P2-6 zip import size cap', () => {
  it('limits are 64 MiB uncompressed and 4096 entries', () => {
    expect(ZIP_LIMITS).toEqual({ maxBytes: 64 * 1024 * 1024, maxEntries: 4096 });
  });

  it('a zip whose content is too big or has too many entries is refused before anything is written', () => {
    const s = ProjectStore.create(path.join(tempDir(), 'Gros.blum'), { title: 'Gros' });
    const good = exportProjectZip(s.dir);
    s.close();
    const big = zipSync({ 'graphics/bombe.chr': new Uint8Array(4096) }, { level: 9 });
    const dest1 = path.join(tempDir(), 'Bombe.blum');
    const refusal = (bytes: Uint8Array, dest: string, limits: { maxBytes: number; maxEntries: number }) => {
      try {
        importProjectZip(bytes, dest, limits);
      } catch (e) {
        expect(e).toBeInstanceOf(ProjectError);
        return (e as ProjectError).fr;
      }
      throw new Error('not refused');
    };
    expect(refusal(big, dest1, { maxBytes: 1024, maxEntries: 100 })).toMatch(/^archive refusée : trop grosse/);
    expect(existsSync(dest1)).toBe(false);
    const dest2 = path.join(tempDir(), 'Many.blum');
    expect(refusal(good, dest2, { maxBytes: 1 << 30, maxEntries: 2 })).toMatch(/^archive refusée : trop de fichiers \(plus de 2\)/);
    expect(existsSync(dest2)).toBe(false);
    // the real project fits the default limits
    const dest3 = path.join(tempDir(), 'Bon.blum');
    importProjectZip(good, dest3);
    expect(readdirSync(dest3).length).toBeGreaterThan(1);
  });
});

describe('W1 P2-3 cartridge card: « 1 monde » / « 2 mondes »', () => {
  it('singular and plural in both languages', () => {
    expect(t('fr', 'cart.world1')).toBe('1 monde');
    expect(t('fr', 'cart.worlds', { n: 2 })).toBe('2 mondes');
    expect(t('en', 'cart.world1')).toBe('1 world');
    expect(t('en', 'cart.worlds', { n: 3 })).toBe('3 worlds');
  });
});
