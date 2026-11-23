import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { PipelineInput, PipelineResult } from '../core/build/pipeline.js';

// Main-process side of the build worker: one lazy worker thread, one build at a time, closed with the
// app (no orphan threads, no orphan cc65: spawnSync waits for it inside the worker).
export class BuildRunner {
  private worker: Worker | null = null;
  private next = 1;
  private readonly pending = new Map<number, { resolve: (r: PipelineResult) => void; reject: (e: Error) => void }>();

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(path.join(__dirname, 'build-worker.js'));
    w.on('message', (m: { reqId: number; result?: PipelineResult; error?: string }) => {
      const p = this.pending.get(m.reqId);
      this.pending.delete(m.reqId);
      if (!p) return;
      if (m.result) p.resolve(m.result);
      else p.reject(new Error(m.error ?? 'build worker error'));
    });
    const failAll = (why: string) => {
      for (const p of this.pending.values()) p.reject(new Error(`construction arrêtée : ${why}`));
      this.pending.clear();
      this.worker = null;
    };
    w.on('error', (e: Error) => failAll(e.message));
    w.on('exit', (code) => failAll(`code ${code}`));
    this.worker = w;
    return w;
  }

  run(input: Omit<PipelineInput, 'jsnes' | 'now'>): Promise<PipelineResult> {
    const reqId = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject });
      this.ensure().postMessage({ reqId, input });
    });
  }

  async close(): Promise<void> {
    const w = this.worker;
    this.worker = null;
    if (w) await w.terminate();
  }
}
