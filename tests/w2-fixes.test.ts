// BLUM-FIX2: Warden W2 fixes. Rename retry for files held by OneDrive or an antivirus (P2-6), no false
// "exit out of reach" warning on the sample's boss stages (P2-4).
import { cpSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectStore } from '../src/core/project/store';
import { validateProjectDocs } from '../src/core/schema/documents';
import { atomicWriteFile, renameWithRetry } from '../src/core/util/atomic';
import { tempDir } from './helpers';

const busy = (code: string) => Object.assign(new Error(code), { code });

describe('W2 P2-6 rename retry', () => {
  it('retries while the target is held, then renames', () => {
    let calls = 0;
    renameWithRetry('a', 'b', () => {
      if (++calls < 3) throw busy(calls === 1 ? 'EPERM' : 'EBUSY');
    });
    expect(calls).toBe(3);
  });

  it('throws other errors at once and gives up after the time limit', () => {
    let calls = 0;
    expect(() => renameWithRetry('a', 'b', () => { calls++; throw busy('ENOENT'); })).toThrow('ENOENT');
    expect(calls).toBe(1);
    const t0 = Date.now();
    expect(() => renameWithRetry('a', 'b', () => { throw busy('EACCES'); }, 100)).toThrow('EACCES');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
  });

  it('atomicWriteFile goes through the retry', () => {
    const file = path.join(tempDir(), 'x.json');
    let held = 2;
    atomicWriteFile(file, '{"ok":1}', { rename: (a, b) => { if (held-- > 0) throw busy('EPERM'); renameWithRetry(a, b); } });
    expect(readFileSync(file, 'utf8')).toBe('{"ok":1}');
  });
});

describe('W2 P2-4 sample warnings', () => {
  it('the shipped BLUM sample has no "exit out of reach" warning (boss stages end on the boss)', async () => {
    const copy = path.join(tempDir(), 'BLUM.blum');
    cpSync(path.join(process.cwd(), 'resources', 'samples', 'BLUM.blum'), copy, { recursive: true });
    const store = ProjectStore.open(copy);
    try {
      const issues = validateProjectDocs(store.docs());
      expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
      expect(issues.filter((i) => i.fr.includes('inaccessible'))).toEqual([]);
    } finally {
      store.close();
    }
  });
});
