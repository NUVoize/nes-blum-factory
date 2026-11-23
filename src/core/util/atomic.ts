import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';
import path from 'node:path';

export interface AtomicHooks {
  /** Test hook: runs after the temp file is flushed, before the rename. Throwing simulates a crash. */
  beforeRename?: (tmpPath: string, finalPath: string) => void;
  /** Test hook: replaces renameSync (to simulate a file held by OneDrive or an antivirus). */
  rename?: (from: string, to: string) => void;
}

const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);

/**
 * renameSync, retried for about 2 s while Windows reports the target as held (OneDrive, antivirus,
 * the search indexer), as graceful-fs does. Other errors and the last failure are thrown.
 */
export function renameWithRetry(from: string, to: string, rename: (a: string, b: string) => void = renameSync, maxMs = 2000): void {
  const start = Date.now();
  for (let wait = 10; ; wait = Math.min(wait * 2, 200)) {
    try {
      rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? '';
      if (!BUSY.has(code) || Date.now() - start >= maxMs) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
    }
  }
}

/** Write `name.tmp`, flush it to disk, then rename over the target: a crash leaves the old or the new file. */
export function atomicWriteFile(file: string, data: string | Uint8Array, hooks: AtomicHooks = {}): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
    let off = 0;
    while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  hooks.beforeRename?.(tmp, file);
  renameWithRetry(tmp, file, hooks.rename);
}

export function removeFileIfExists(file: string): void {
  rmSync(file, { force: true });
}
