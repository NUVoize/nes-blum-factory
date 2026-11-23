import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');

describe('design tokens', () => {
  it('uses SNES 15-bit colour steps (every channel a multiple of 8)', () => {
    const hexes = [...css.matchAll(/#([0-9a-f]{6})\b/gi)].map((m) => m[1]!);
    expect(hexes.length).toBeGreaterThan(5);
    for (const hex of hexes) {
      for (let i = 0; i < 6; i += 2) {
        expect(parseInt(hex.slice(i, i + 2), 16) % 8, `#${hex}`).toBe(0);
      }
    }
  });
});
