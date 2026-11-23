import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync, zipSync, type Zippable } from 'fflate';
import { ProjectError, LOCK_FILE } from './store.js';
import { validateProjectDocs } from '../schema/documents.js';
import type { Json } from '../util/json-pointer.js';

// PLAN §3: export = zip of the folder without build/ and .lock. Import = unzip into a new folder after
// every entry path has been checked; nothing is written if one entry escapes the folder.
const EXCLUDED_TOP = new Set(['build', LOCK_FILE]);
const FIXED_MTIME = new Date('2026-01-01T00:00:00Z');

/** Import caps (W1 P2-6): a zip bomb is refused instead of filling memory. A real project is a few MiB. */
export const ZIP_LIMITS = { maxBytes: 64 * 1024 * 1024, maxEntries: 4096 };

export function exportProjectZip(dir: string): Uint8Array {
  const files: Zippable = {};
  const walk = (rel: string) => {
    for (const ent of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (!rel && EXCLUDED_TOP.has(ent.name)) continue;
      if (ent.name.endsWith('.tmp')) continue;
      if (ent.isDirectory()) {
        files[`${r}/`] = [new Uint8Array(0), { mtime: FIXED_MTIME }];
        walk(r);
      } else {
        files[r] = [new Uint8Array(readFileSync(path.join(dir, r))), { mtime: FIXED_MTIME }];
      }
    }
  };
  walk('');
  return zipSync(files, { level: 6 });
}

/** A zip entry name is safe if it stays inside the target folder. */
export function isSafeEntryName(name: string): boolean {
  if (!name || name.includes('\\') || name.includes('\0')) return false;
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return false;
  return !name.split('/').some((seg) => seg === '..');
}

export function importProjectZip(bytes: Uint8Array, destDir: string, limits = ZIP_LIMITS): void {
  if (existsSync(destDir) && readdirSync(destDir).length > 0) {
    throw new ProjectError('exists', `le dossier existe déjà : ${destDir}`, `folder already exists: ${destDir}`);
  }
  const mib = Math.round(limits.maxBytes / (1024 * 1024));
  const tooBig = () => new ProjectError('invalid', `archive refusée : trop grosse (plus de ${mib} Mo)`, `archive refused: too big (over ${mib} MB)`);
  if (bytes.length > limits.maxBytes) throw tooBig();
  let count = 0;
  let declared = 0;
  // sizes from the zip directory are checked before inflating anything...
  const entries = unzipSync(bytes, {
    filter: (f) => {
      if (++count > limits.maxEntries) {
        throw new ProjectError('invalid', `archive refusée : trop de fichiers (plus de ${limits.maxEntries})`, `archive refused: too many files (over ${limits.maxEntries})`);
      }
      declared += f.originalSize;
      if (declared > limits.maxBytes) throw tooBig();
      return true;
    },
  });
  // ...and the inflated sizes again, in case the directory lied
  if (Object.values(entries).reduce((n, e) => n + e.length, 0) > limits.maxBytes) throw tooBig();
  const names = Object.keys(entries);
  const bad = names.find((n) => !isSafeEntryName(n));
  if (bad !== undefined) {
    throw new ProjectError('invalid', `archive refusée : chemin dangereux « ${bad} »`, `archive refused: unsafe path "${bad}"`);
  }
  const docs: Record<string, Json> = {};
  for (const n of names) {
    if (!n.endsWith('.json') || n.startsWith('proposals/') || n.startsWith('history/')) continue;
    try {
      docs[n] = JSON.parse(new TextDecoder().decode(entries[n]!)) as Json;
    } catch {
      throw new ProjectError('invalid', `archive refusée : JSON illisible « ${n} »`, `archive refused: unreadable JSON "${n}"`);
    }
  }
  const issues = validateProjectDocs(docs);
  if (issues.some((i) => i.severity === 'error')) {
    throw new ProjectError('invalid', `archive refusée : ${issues[0]!.doc} ${issues[0]!.fr}`, `archive refused: ${issues[0]!.doc} ${issues[0]!.en}`, issues);
  }
  mkdirSync(destDir, { recursive: true });
  for (const n of names) {
    const abs = path.join(destDir, ...n.split('/'));
    if (n.endsWith('/')) mkdirSync(abs, { recursive: true });
    else {
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, entries[n]!);
    }
  }
  if (!existsSync(path.join(destDir, 'build'))) mkdirSync(path.join(destDir, 'build'));
}
