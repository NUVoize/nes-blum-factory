import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_TITLE } from '../src/shared/app-info';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

describe('scaffold', () => {
  it('names the app NES BLUM FACTORY', () => {
    expect(APP_TITLE).toBe('NES BLUM FACTORY');
    expect(pkg.productName).toBe(APP_TITLE);
  });

  it('points Electron at the compiled main process', () => {
    expect(pkg.main).toBe('dist/electron/main/main.js');
  });

  it('contains no emoji or pictographs in UI source', () => {
    const files = [
      '../src/renderer/App.tsx',
      '../src/renderer/BloomMark.tsx',
      '../src/shared/i18n.ts',
      '../src/renderer/index.html',
    ];
    for (const f of files) {
      const text = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(/\p{Extended_Pictographic}/u.test(text), f).toBe(false);
    }
  });
});
