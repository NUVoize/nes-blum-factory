// Worker thread for BOULON's builds (PLAN §7.1): cc65 + the 600-frame headless run never block the main
// process. jsnes is ESM-only for Node, so it is imported dynamically.
import { parentPort } from 'node:worker_threads';
import type { JsnesModule } from '../core/emu/nes-session.js';
import { runPipeline, type PipelineInput } from '../core/build/pipeline.js';

let jsnes: JsnesModule | null = null;

parentPort?.on('message', async (msg: { reqId: number; input: Omit<PipelineInput, 'jsnes'> }) => {
  try {
    jsnes ??= (await import('jsnes')) as unknown as JsnesModule;
    parentPort!.postMessage({ reqId: msg.reqId, result: runPipeline({ ...msg.input, jsnes }) });
  } catch (e) {
    parentPort!.postMessage({ reqId: msg.reqId, error: e instanceof Error ? e.message : String(e) });
  }
});
