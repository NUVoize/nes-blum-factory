import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./src/renderer', import.meta.url));
const outDir = fileURLToPath(new URL('./dist/renderer', import.meta.url));

// Renderer only. Electron loads dist/renderer/index.html from disk (file://), hence base './'.
// Dev server port: 5181 (517x/518x band reserved for this app; 5173 is Mission Control).
export default defineConfig({
  root,
  base: './',
  plugins: [react()],
  // No data: inlining: every asset is a file, so the strict CSP (font-src 'self') holds.
  build: { outDir, emptyOutDir: true, assetsInlineLimit: 0 },
  server: { port: 5181, strictPort: true, host: '127.0.0.1' },
});
