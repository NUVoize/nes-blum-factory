import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { ConvertJob, ConvertJobResult } from '../core/convert/job.js';

// Main-process side of the converter worker: one lazy worker thread, requests matched by id, closed
// with the app (no orphan threads).
export class ConvertRunner {
  private worker: Worker | null = null;
  private next = 1;
  private readonly pending = new Map<number, (r: ConvertJobResult) => void>();

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(path.join(__dirname, 'convert-worker.js'));
    w.on('message', (m: { reqId: number; result: ConvertJobResult }) => {
      this.pending.get(m.reqId)?.(m.result);
      this.pending.delete(m.reqId);
    });
    const failAll = (why: string) => {
      for (const done of this.pending.values()) done({ ok: false, errors: [{ fr: `convertisseur arrêté : ${why}`, en: `converter stopped: ${why}` }], doc: null, chr: null, before: null, after: null, proposedSet: null, colourMiss: 0, freeColourMiss: null, ms: 0 });
      this.pending.clear();
      this.worker = null;
    };
    w.on('error', (e: Error) => failAll(e.message));
    w.on('exit', (code) => failAll(`code ${code}`));
    this.worker = w;
    return w;
  }

  run(job: ConvertJob): Promise<ConvertJobResult> {
    const reqId = this.next++;
    return new Promise((resolve) => {
      this.pending.set(reqId, resolve);
      this.ensure().postMessage({ reqId, job });
    });
  }

  async close(): Promise<void> {
    const w = this.worker;
    this.worker = null;
    if (w) await w.terminate();
  }
}
