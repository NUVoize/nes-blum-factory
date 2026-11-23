import { defineConfig } from 'vitest/config';

// Engine tier (TEST-STRATEGY §1): real cc65 builds + headless jsnes runs. One worker, files in sequence
// (one cc65 build at a time on box-01). Started by scripts/test-engine.mjs, which holds .tmp/gate.lock.
export default defineConfig({
  test: {
    include: ['tests/engine/**/*.test.ts'],
    environment: 'node',
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
