import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ProjectError, ProjectStore } from '../src/core/project/store';
import { exportProjectZip, importProjectZip, isSafeEntryName } from '../src/core/project/zip';
import { HERO_ACTOR, tempDir } from './helpers';

describe('M1 zip export/import', () => {
  it('M1-T11 export/import round-trip gives identical document hashes', () => {
    const s = ProjectStore.create(path.join(tempDir(), 'Rond.blum'), { title: 'Rond' });
    s.apply({
      director: 'story',
      summary: { fr: 'x', en: 'x' },
      ops: [
        { op: 'patch', doc: 'story.json', pointer: '/title', value: 'ALLER RETOUR' },
        { op: 'set', doc: 'actors/hero.json', value: HERO_ACTOR },
        { op: 'addAsset', path: 'graphics/hero.chr', base64: Buffer.from([0, 1, 2, 255]).toString('base64') },
      ],
    });
    writeFileSync(path.join(s.dir, 'build', 'game.nes'), 'not exported');
    const hashes = s.fileHashes();
    expect(Object.keys(hashes)).toContain('graphics/hero.chr');
    const zip = exportProjectZip(s.dir);
    const names = Object.keys(unzipSync(zip));
    expect(names).not.toContain('.lock');
    expect(names.some((n) => n.startsWith('build/') && n !== 'build/')).toBe(false);
    expect(names).toContain('history/journal.jsonl');
    s.close();

    const dest = path.join(tempDir(), 'Copie.blum');
    importProjectZip(zip, dest);
    const copy = ProjectStore.open(dest);
    expect(copy.fileHashes()).toEqual(hashes);
    expect(copy.history()).toHaveLength(1);
    expect(copy.readOnly).toBe(false);
    copy.close();
  });

  it('M1-T11 an import with ../ paths is refused and writes nothing', () => {
    const s = ProjectStore.create(path.join(tempDir(), 'Src.blum'), { title: 'Src' });
    const good = unzipSync(exportProjectZip(s.dir));
    s.close();
    for (const evil of ['../evil.txt', 'actors/../../evil.json', '/abs.json', 'C:/win.json', 'a\\..\\b.json']) {
      const zip = zipSync({ ...good, [evil]: strToU8('{}') });
      const dest = path.join(tempDir(), 'Dest.blum');
      expect(() => importProjectZip(zip, dest), evil).toThrow(ProjectError);
      expect(existsSync(dest), evil).toBe(false);
      expect(existsSync(path.join(path.dirname(dest), 'evil.txt'))).toBe(false);
    }
    expect(isSafeEntryName('graphics/sources/a.png')).toBe(true);
  });

  it('M1-T11 an import with an invalid document is refused with a French reason', () => {
    const s = ProjectStore.create(path.join(tempDir(), 'Inv.blum'), { title: 'Inv' });
    const entries = unzipSync(exportProjectZip(s.dir));
    s.close();
    entries['physics.json'] = strToU8(JSON.stringify({ schemaVersion: 1, gravity: 'beaucoup' }));
    const dest = path.join(tempDir(), 'Bad.blum');
    let err: unknown;
    try {
      importProjectZip(zipSync(entries), dest);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ProjectError);
    expect((err as ProjectError).fr).toMatch(/^archive refusée : physics.json/);
    expect(existsSync(dest)).toBe(false);
  });
});
