import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FEATURES } from '../src/core/features';
import { PROJECT_DIRS, ProjectError, ProjectStore, JOURNAL } from '../src/core/project/store';
import { projectManifestSchema } from '../src/core/schema/project';
import { atomicWriteFile } from '../src/core/util/atomic';
import { HERO_ACTOR, tempDir } from './helpers';

const PLAN_FILES = ['project.json', 'cartridge.json', 'story.json', 'physics.json', 'graphics/palettes.json', 'audio/library.json', JOURNAL, '.lock'];

function newProject(): ProjectStore {
  return ProjectStore.create(path.join(tempDir(), 'Mon jeu.blum'), { title: 'Mon jeu' });
}

describe('M1 project store', () => {
  it('M1-T3 create gives the PLAN §3 folder layout and a valid manifest; reopen gives an identical state', () => {
    const s = newProject();
    for (const d of PROJECT_DIRS) expect(statSync(path.join(s.dir, d)).isDirectory(), d).toBe(true);
    for (const f of PLAN_FILES) expect(existsSync(path.join(s.dir, f)), f).toBe(true);
    const manifest = projectManifestSchema.parse(JSON.parse(readFileSync(path.join(s.dir, 'project.json'), 'utf8')));
    expect(manifest.format).toBe('nbf-project');
    expect(manifest.title).toBe('Mon jeu');
    expect(manifest.locale).toBe('fr');
    expect(s.readOnly).toBe(false);
    expect(s.loadIssues).toEqual([]);

    s.apply({ director: 'story', summary: { fr: 'titre', en: 'title' }, ops: [{ op: 'patch', doc: 'story.json', pointer: '/title', value: 'BLUM' }] });
    const docs = s.docs();
    const hashes = s.fileHashes();
    s.close();
    expect(existsSync(path.join(s.dir, '.lock'))).toBe(false);

    const again = ProjectStore.open(s.dir);
    expect(again.docs()).toEqual(docs);
    expect(again.fileHashes()).toEqual(hashes);
    expect(again.history()).toHaveLength(1);
    again.close();
  });

  it('M1-T3 an invalid document opens read-only with a French reason, never silently fixed', () => {
    const s = newProject();
    s.close();
    const bad = JSON.parse(readFileSync(path.join(s.dir, 'physics.json'), 'utf8'));
    bad.gravity = 9999;
    writeFileSync(path.join(s.dir, 'physics.json'), JSON.stringify(bad));
    const ro = ProjectStore.open(s.dir);
    expect(ro.readOnly).toBe(true);
    expect(ro.loadIssues[0]!.fr).toMatch(/trop grande/);
    expect(() => ro.apply({ director: 'manual', summary: { fr: '', en: '' }, ops: [{ op: 'patch', doc: 'story.json', pointer: '/title', value: 'X' }] })).toThrow(ProjectError);
    expect(JSON.parse(readFileSync(path.join(s.dir, 'physics.json'), 'utf8')).gravity).toBe(9999);
    ro.close();
  });

  it('M1-T4 a crash between the tmp write and the rename leaves the old file intact', () => {
    const dir = tempDir();
    const file = path.join(dir, 'doc.json');
    atomicWriteFile(file, '{"v":1}\n');
    expect(() =>
      atomicWriteFile(file, '{"v":2}\n', {
        beforeRename: () => {
          throw new Error('simulated crash');
        },
      }),
    ).toThrow('simulated crash');
    expect(readFileSync(file, 'utf8')).toBe('{"v":1}\n');

    // Same through a transaction: the document and the journal stay as they were.
    const s0 = newProject();
    s0.close();
    const before = readFileSync(path.join(s0.dir, 'story.json'));
    const crashing = ProjectStore.open(s0.dir, {
      atomicHooks: {
        beforeRename: () => {
          throw new Error('simulated crash');
        },
      },
    });
    expect(() =>
      crashing.apply({ director: 'story', summary: { fr: 'x', en: 'x' }, ops: [{ op: 'patch', doc: 'story.json', pointer: '/title', value: 'CRASH' }] }),
    ).toThrow('simulated crash');
    crashing.close();
    expect(readFileSync(path.join(s0.dir, 'story.json')).equals(before)).toBe(true);
    const reopened = ProjectStore.open(s0.dir);
    expect(reopened.journal()).toHaveLength(0);
    expect(reopened.doc<{ title: string }>('story.json')!.title).toBe('MON JEU');
    reopened.close();
  });

  it('M1-T4 a second ProjectStore on the same folder is refused; a stale lock is taken over', () => {
    const s = newProject();
    let err: unknown;
    try {
      ProjectStore.open(s.dir);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ProjectError);
    expect((err as ProjectError).code).toBe('locked');
    expect((err as ProjectError).fr).toMatch(/déjà ouvert/);
    s.close();

    // Lock left by a dead process (crash): taken over.
    writeFileSync(path.join(s.dir, '.lock'), JSON.stringify({ pid: 2 ** 22 + 12345, startedAt: '2026-01-01T00:00:00Z' }));
    const s2 = ProjectStore.open(s.dir);
    expect(JSON.parse(readFileSync(path.join(s.dir, '.lock'), 'utf8')).pid).toBe(process.pid);
    s2.close();
  });

  it('M1-T5 approve = ops + journal line + snapshot; undo restores byte-identical files; redo re-applies; the journal is append-only', () => {
    const s = newProject();
    const storyPath = path.join(s.dir, 'story.json');
    const actorPath = path.join(s.dir, 'actors', 'hero.json');
    const original = readFileSync(storyPath);

    const tx = s.apply({
      director: 'story',
      summary: { fr: 'nouveau titre', en: 'new title' },
      ops: [
        { op: 'patch', doc: 'story.json', pointer: '/title', value: 'BLUM' },
        { op: 'set', doc: 'actors/hero.json', value: HERO_ACTOR },
      ],
    });
    const after = readFileSync(storyPath);
    expect(after.equals(original)).toBe(false);
    expect(existsSync(actorPath)).toBe(true);
    expect(tx.files.map((f) => f.path)).toEqual(['actors/hero.json', 'story.json']);
    expect(existsSync(path.join(s.dir, 'history', 'snapshots', tx.id, 'before', 'story.json'))).toBe(true);
    expect(existsSync(path.join(s.dir, 'history', 'snapshots', tx.id, 'after', 'actors', 'hero.json'))).toBe(true);
    const journal1 = readFileSync(path.join(s.dir, JOURNAL), 'utf8');
    expect(journal1.trim().split('\n')).toHaveLength(1);

    s.undo();
    expect(readFileSync(storyPath).equals(original)).toBe(true);
    expect(existsSync(actorPath)).toBe(false);
    expect(s.canRedo()).toBe(true);

    s.redo();
    expect(readFileSync(storyPath).equals(after)).toBe(true);
    expect(existsSync(actorPath)).toBe(true);

    const journal3 = readFileSync(path.join(s.dir, JOURNAL), 'utf8');
    expect(journal3.startsWith(journal1)).toBe(true);
    expect(s.journal().map((e) => e.kind)).toEqual(['apply', 'undo', 'redo']);
    expect(s.history().map((h) => h.state)).toEqual(['applied']);

    // A new apply after an undo clears the redo stack.
    s.undo();
    s.apply({ director: 'movement', summary: { fr: 'gravité', en: 'gravity' }, ops: [{ op: 'patch', doc: 'physics.json', pointer: '/gravity', value: 48 }] });
    expect(s.canRedo()).toBe(false);
    expect(s.journal()).toHaveLength(5);
    s.close();
  });

  it('M1 feature flags (PLAN §12.2): a disabled feature is rejected with a French reason, enabled it passes', () => {
    const s = newProject();
    const ops = [{ op: 'patch' as const, doc: 'physics.json', pointer: '/wallGrab/enabled', value: true }];
    const off = s.dryRun(ops);
    expect(off.ok).toBe(false);
    expect(off.issues[0]!.fr).toMatch(/accroche aux murs/);
    s.close();
    const on = ProjectStore.open(s.dir, { flags: { ...DEFAULT_FEATURES, wallGrab: true } });
    expect(on.dryRun(ops).ok).toBe(true);
    on.close();
  });
});
