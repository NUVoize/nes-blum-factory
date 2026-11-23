import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';

// Every test writes under os.tmpdir() only (TEST-STRATEGY §2). Folders are cleaned after each test.
const made: string[] = [];

export function tempDir(prefix = 'nbf-'): string {
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  made.push(d);
  return d;
}

afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true });
});

/** A valid actor document for store tests (actors/*.json has a schema since M4a). */
export const HERO_ACTOR = {
  schemaVersion: 1,
  kind: 'enemy',
  name: { fr: 'Blum' },
  pattern: 'walker',
  speed: 0,
  hp: 1,
  damage: 1,
  turnAtLedge: false,
  graphics: 'builtin:walker',
};
