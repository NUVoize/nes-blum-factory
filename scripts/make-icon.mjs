// App icon (M6; M5 shipped the Electron default): the BloomMark flower (src/renderer/BloomMark.tsx) on a
// 16x16 navy tile, drawn here pixel by pixel, written as build-res/icon.ico (PNG entries 16, 32, 48, 256)
// and build-res/icon.png. Own work, no font, no emoji. Run after `npm run build`: node scripts/make-icon.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const { encodePng } = require(path.join(root, 'dist', 'electron', 'core', 'util', 'png.js'));

// palette: the app's SNES-step tokens (styles.css)
const C = {
  o: [0x08, 0x08, 0x20], // outline navy-900
  n: [0x20, 0x20, 0x50], // tile navy-700
  m: [0x28, 0x30, 0x70], // tile light band navy-600
  p: [0xb8, 0x30, 0x60], // bloom-700
  P: [0xf8, 0x60, 0x88], // bloom-500
  y: [0xf0, 0xb8, 0x28], // gold-500
  Y: [0xf8, 0xf0, 0xe0], // cream
  g: [0x50, 0xc0, 0x48], // leaf-500
};
const FLOWER = ['...ppp...', '..pPPPp..', 'ppPyyyPpp', 'pPPyYyPPp', '.pPyyyPp.', '..ppgpp..', '.gg.g....', '..ggg.gg.', '....ggg..'];

const grid = Array.from({ length: 16 }, (_, y) =>
  Array.from({ length: 16 }, (_, x) => {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    const corner = (x < 1 || x > 14) && (y < 1 || y > 14);
    if (corner) return '.';
    if (edge) return 'o';
    return y < 6 ? 'm' : 'n';
  }),
);
FLOWER.forEach((row, fy) => [...row].forEach((c, fx) => c !== '.' && (grid[fy + 4][fx + 3] = c)));

function rgba(scale) {
  const size = 16 * scale;
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = grid[Math.floor(y / scale)][Math.floor(x / scale)];
      const i = (y * size + x) * 4;
      if (c === '.') continue;
      out.set([...C[c], 255], i);
    }
  }
  return { size, data: out };
}

const entries = [1, 2, 3, 16].map((s) => {
  const { size, data } = rgba(s);
  return { size, png: Buffer.from(encodePng(data, size, size)) };
});
const header = Buffer.alloc(6 + 16 * entries.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(entries.length, 4);
let offset = header.length;
entries.forEach((e, i) => {
  const o = 6 + 16 * i;
  header.writeUInt8(e.size >= 256 ? 0 : e.size, o);
  header.writeUInt8(e.size >= 256 ? 0 : e.size, o + 1);
  header.writeUInt8(0, o + 2);
  header.writeUInt8(0, o + 3);
  header.writeUInt16LE(1, o + 4);
  header.writeUInt16LE(32, o + 6);
  header.writeUInt32LE(e.png.length, o + 8);
  header.writeUInt32LE(offset, o + 12);
  offset += e.png.length;
});
const dir = path.join(root, 'build-res');
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'icon.ico'), Buffer.concat([header, ...entries.map((e) => e.png)]));
writeFileSync(path.join(dir, 'icon.png'), entries.at(-1).png);
console.log(`icon: build-res/icon.ico (${entries.map((e) => e.size).join(', ')})`);
