import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// `.tmp/gate.lock` (TEST-STRATEGY §2): one heavy job at a time on box-01. A second job waits, then
// exits with "gate busy: <command> (pid)". A lock whose pid is dead is taken over.
export interface GateLockInfo {
  pid: number;
  startedAt: string;
  command: string;
}

export interface GateLockOptions {
  waitMs?: number;
  pollMs?: number;
  pid?: number;
  isAlive?: (pid: number) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

export class GateBusyError extends Error {
  constructor(readonly holder: GateLockInfo) {
    super(`gate busy: ${holder.command} (${holder.pid})`);
  }
}

export function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readLock(file: string): GateLockInfo | null {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8')) as GateLockInfo;
    return typeof v.pid === 'number' ? v : null;
  } catch {
    return null;
  }
}

/** Take the lock or wait for it. Returns a release function. */
export async function acquireGateLock(file: string, command: string, opts: GateLockOptions = {}): Promise<() => void> {
  const waitMs = opts.waitMs ?? 10 * 60_000;
  const pollMs = opts.pollMs ?? 1000;
  const pid = opts.pid ?? process.pid;
  const isAlive = opts.isAlive ?? pidIsAlive;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  mkdirSync(path.dirname(file), { recursive: true });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      const info: GateLockInfo = { pid, startedAt: new Date().toISOString(), command };
      writeFileSync(file, JSON.stringify(info), { flag: 'wx' });
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const cur = readLock(file);
        if (cur && cur.pid === pid) rmSync(file, { force: true });
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    const holder = readLock(file);
    if (!holder || !isAlive(holder.pid)) {
      // Stale lock (dead pid or unreadable): take it over.
      rmSync(file, { force: true });
      continue;
    }
    if (Date.now() >= deadline) throw new GateBusyError(holder);
    await sleep(pollMs);
  }
}
