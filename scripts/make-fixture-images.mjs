// Draws the converter test fixtures (M3-T6, M3-T9): original images, made here from code, no outside art.
// Run after `tsc -b`: node scripts/make-fixture-images.mjs  ->  tests/fixtures/img/*.png
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const { encodePng } = require(path.join(root, 'dist', 'electron', 'core', 'util', 'png.js'));
const out = path.join(root, 'tests', 'fixtures', 'img');
mkdirSync(out, { recursive: true });

// deterministic noise (mulberry32)
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h, fill = [0, 0, 0, 0]) {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(fill, i * 4);
  return {
    w,
    h,
    data,
    set(x, y, c) {
      x = Math.round(x);
      y = Math.round(y);
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      data.set(c.length === 3 ? [...c, 255] : c, (y * w + x) * 4);
    },
    rect(x, y, rw, rh, c) {
      for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) this.set(x + i, y + j, c);
    },
    ellipse(cx, cy, rx, ry, c) {
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) this.set(x, y, c);
    },
    line(x0, y0, x1, y1, c, t = 1) {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1) * 2;
      for (let i = 0; i <= n; i++) {
        const x = x0 + ((x1 - x0) * i) / n;
        const y = y0 + ((y1 - y0) * i) / n;
        this.rect(x - (t - 1) / 2, y - (t - 1) / 2, t, t, c);
      }
    },
    png() {
      return encodePng(data, w, h);
    },
  };
}

// 1. photo-like: sky gradient, sun, hills, a lake, noise (320×240, non-NES colours everywhere)
{
  const r = rng(7);
  const c = canvas(320, 240);
  for (let y = 0; y < 240; y++) {
    for (let x = 0; x < 320; x++) {
      const t = y / 240;
      let col = [Math.round(40 + 150 * t), Math.round(90 + 100 * t), Math.round(200 - 40 * t)];
      const hill1 = 150 + 25 * Math.sin(x / 37);
      const hill2 = 175 + 18 * Math.sin(x / 23 + 1.3);
      if (y > hill1) col = [Math.round(60 + 40 * Math.sin(x / 11)), Math.round(120 + (y - hill1) / 2), 50];
      if (y > hill2) col = [Math.round(40 + (y - hill2)), Math.round(90 + 20 * Math.cos(x / 9)), 40];
      if (y > 205) col = [Math.round(30 + 20 * Math.sin(x / 5 + y)), 80, Math.round(150 + (y - 205) * 2)];
      const n = (r() - 0.5) * 24;
      c.set(x, y, col.map((v) => Math.max(0, Math.min(255, Math.round(v + n)))));
    }
  }
  c.ellipse(250, 55, 22, 22, [255, 220, 90]);
  c.ellipse(250, 55, 16, 16, [255, 245, 170]);
  writeFileSync(path.join(out, 'photo-gradient.png'), c.png());
}

// 2. line drawing: black ink on paper (a cottage, a tree, a fence), 128×96
{
  const c = canvas(128, 96, [250, 247, 236, 255]);
  const ink = [24, 22, 30];
  c.line(10, 60, 50, 60, ink, 2);
  c.line(10, 60, 10, 90, ink, 2);
  c.line(50, 60, 50, 90, ink, 2);
  c.line(6, 62, 30, 38, ink, 2);
  c.line(30, 38, 54, 62, ink, 2);
  c.rect(24, 72, 10, 18, ink);
  c.rect(26, 74, 6, 16, [250, 247, 236, 255]);
  c.rect(38, 68, 8, 8, ink);
  c.rect(39, 69, 6, 6, [250, 247, 236, 255]);
  c.ellipse(90, 40, 20, 18, ink);
  c.ellipse(90, 40, 18, 16, [250, 247, 236, 255]);
  c.line(90, 58, 90, 90, ink, 3);
  for (let x = 60; x < 126; x += 8) c.line(x, 78, x, 92, ink, 1);
  c.line(58, 82, 126, 82, ink, 1);
  c.line(0, 92, 127, 92, ink, 1);
  writeFileSync(path.join(out, 'line-drawing.png'), c.png());
}

// 3. character sheet: 4 frames 16×24 of "Pousse", a sprout creature (transparent background)
const POUSSE = { outline: [20, 24, 32], body: [232, 120, 60], belly: [250, 210, 150], leaf: [70, 190, 80] };
function pousse(c, ox, frame, { outline, body, belly, leaf } = POUSSE) {
  const legDx = frame === 1 ? -1 : frame === 2 ? 1 : 0;
  const bob = frame === 1 || frame === 2 ? 1 : 0;
  c.line(ox + 8, 1 + bob, ox + 8, 5 + bob, leaf, 1);
  c.ellipse(ox + 5, 3 + bob, 3, 1.5, leaf);
  c.ellipse(ox + 11, 2 + bob, 3, 1.5, leaf);
  c.ellipse(ox + 8, 13 + bob, 7, 7.5, outline);
  c.ellipse(ox + 8, 13 + bob, 6, 6.5, body);
  c.ellipse(ox + 8, 15 + bob, 3.5, 3.5, belly);
  c.rect(ox + 5, 10 + bob, 2, 2, outline);
  c.rect(ox + 10, 10 + bob, 2, 2, outline);
  if (frame === 3) {
    c.rect(ox + 2, 7, 2, 4, outline);
    c.rect(ox + 12, 7, 2, 4, outline);
  }
  c.rect(ox + 4 + legDx, 20, 3, 3, outline);
  c.rect(ox + 9 - legDx, 20, 3, 3, outline);
}
{
  const c = canvas(64, 24);
  for (let f = 0; f < 4; f++) pousse(c, f * 16, f);
  writeFileSync(path.join(out, 'character-sheet.png'), c.png());
}
// the CHROMA « Exemple : personnage » (W1 P1-2): the same Pousse in 3 colours the demo world's hero
// slot carries ($0F, $36, $29), so the first conversion Blum sees in locked mode keeps its colours
{
  const c = canvas(64, 24);
  const colours = { outline: [20, 24, 32], body: [255, 190, 180], belly: [255, 190, 180], leaf: [120, 225, 20] };
  for (let f = 0; f < 4; f++) pousse(c, f * 16, f, colours);
  writeFileSync(path.join(root, 'src', 'renderer', 'chroma', 'exemple-personnage.png'), c.png());
}

// 4. three colourful enemies (16×16 each, transparent): each needs more than 3 colours
const enemies = {
  'enemy-beetle': (c) => {
    c.ellipse(8, 9, 7, 6, [20, 20, 30]);
    c.ellipse(8, 9, 6, 5, [200, 30, 40]);
    c.rect(7, 4, 2, 10, [20, 20, 30]);
    c.ellipse(5, 8, 1.5, 1.5, [250, 250, 250]);
    c.ellipse(11, 10, 1.5, 1.5, [250, 250, 250]);
    c.rect(3, 14, 3, 2, [60, 90, 220]);
    c.rect(10, 14, 3, 2, [60, 90, 220]);
    c.rect(6, 1, 4, 3, [240, 200, 40]);
  },
  'enemy-bird': (c) => {
    c.ellipse(8, 8, 6, 5, [30, 140, 230]);
    c.ellipse(9, 10, 3, 2.5, [250, 240, 200]);
    c.rect(13, 7, 3, 2, [250, 160, 20]);
    c.rect(9, 5, 2, 2, [10, 10, 10]);
    c.ellipse(4, 7, 3, 2, [120, 40, 160]);
    c.rect(6, 13, 1, 3, [250, 160, 20]);
    c.rect(10, 13, 1, 3, [250, 160, 20]);
  },
  'enemy-mushroom': (c) => {
    c.ellipse(8, 6, 7, 5, [150, 60, 200]);
    c.ellipse(5, 5, 1.5, 1.5, [255, 255, 255]);
    c.ellipse(11, 4, 1.5, 1.5, [255, 255, 255]);
    c.rect(5, 10, 6, 5, [240, 220, 180]);
    c.rect(6, 11, 1, 2, [20, 20, 20]);
    c.rect(9, 11, 1, 2, [20, 20, 20]);
    c.rect(4, 15, 8, 1, [90, 160, 60]);
  },
};
for (const [name, draw] of Object.entries(enemies)) {
  const c = canvas(16, 16);
  draw(c);
  writeFileSync(path.join(out, `${name}.png`), c.png());
}
console.log('fixtures written to', out);
