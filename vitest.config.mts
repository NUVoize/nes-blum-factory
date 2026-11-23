import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Engine tier (real cc65 builds + jsnes) and Mesen tier run through their own scripts.
    exclude: ['tests/engine/**', 'tests/mesen/**', '**/node_modules/**'],
    environment: 'node',
    // box-01 load limit: never more than 4 workers.
    maxWorkers: 4,
  },
});
