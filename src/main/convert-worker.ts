// Worker thread for CHROMA previews (PLAN §6): the converter never blocks the main process.
import { parentPort } from 'node:worker_threads';
import { runConvertJob, type ConvertJob } from '../core/convert/job.js';

parentPort?.on('message', (msg: { reqId: number; job: ConvertJob }) => {
  parentPort!.postMessage({ reqId: msg.reqId, result: runConvertJob(msg.job) });
});
