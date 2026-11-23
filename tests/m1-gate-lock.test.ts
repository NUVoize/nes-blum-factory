import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquireGateLock, GateBusyError } from '../src/core/gate-lock';
import { tempDir } from './helpers';

describe('M1 gate lock', () => {
  it('M1-T13 a second heavy script exits with a clear message while the lock is held', async () => {
    const file = path.join(tempDir(), 'gate.lock');
    const release = await acquireGateLock(file, 'test:engine', { pid: 4242, isAlive: () => true });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ pid: 4242, command: 'test:engine' });
    await expect(acquireGateLock(file, 'smoke', { pid: 5151, isAlive: () => true, waitMs: 0 })).rejects.toThrow('gate busy: test:engine (4242)');
    await expect(acquireGateLock(file, 'smoke', { pid: 5151, isAlive: () => true, waitMs: 0 })).rejects.toBeInstanceOf(GateBusyError);
    release();
    expect(existsSync(file)).toBe(false);
  });

  it('M1-T13 a second script waits, then gets the lock when the first releases it', async () => {
    const file = path.join(tempDir(), 'gate.lock');
    const release = await acquireGateLock(file, 'smoke', { pid: 1, isAlive: () => true });
    let polls = 0;
    const second = acquireGateLock(file, 'test:engine', {
      pid: 2,
      isAlive: () => true,
      waitMs: 60_000,
      sleep: async () => {
        polls++;
        if (polls === 3) release();
      },
    });
    const release2 = await second;
    expect(polls).toBe(3);
    expect(JSON.parse(readFileSync(file, 'utf8')).command).toBe('test:engine');
    release2();
  });

  it('M1-T13 a stale lock (dead pid) is taken over', async () => {
    const file = path.join(tempDir(), 'gate.lock');
    writeFileSync(file, JSON.stringify({ pid: 999_999, startedAt: '2026-10-19T00:00:00Z', command: 'crashed' }));
    const release = await acquireGateLock(file, 'smoke', { pid: 7, isAlive: (pid) => pid !== 999_999, waitMs: 0 });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ pid: 7, command: 'smoke' });
    release();
    // An unreadable lock counts as stale too.
    writeFileSync(file, 'garbage');
    (await acquireGateLock(file, 'smoke', { waitMs: 0 }))();
  });

  it('M1-T13 release never removes a lock that another process took', async () => {
    const file = path.join(tempDir(), 'gate.lock');
    const release = await acquireGateLock(file, 'smoke', { pid: 10 });
    writeFileSync(file, JSON.stringify({ pid: 11, startedAt: '', command: 'other' }));
    release();
    expect(existsSync(file)).toBe(true);
  });
});
