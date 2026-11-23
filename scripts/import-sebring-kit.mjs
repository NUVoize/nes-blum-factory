// Imports the SEBRING art + music kit (NES-BLUM-FACTORY-ASSETS/sebring, BLUMR-A1, read-only) into racer/kit/
// (BLUMR-M2). Binary engine files are copied as they are; the FamiStudio ca65 export is normalised to LF
// with machine paths removed (like import-sample-music.mjs). The build (src/core/racer/build-racer.ts) reads
// only racer/kit/, so the factory builds without the assets repo. Run: node scripts/import-sebring-kit.mjs
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const assetsRepo = path.resolve(root, '..', 'NES-BLUM-FACTORY-ASSETS');
const src = path.join(assetsRepo, 'sebring');
const kit = path.join(root, 'racer', 'kit');
const commit = execFileSync('git', ['-C', assetsRepo, 'log', '-1', '--format=%h', '--', 'sebring'], { encoding: 'utf8' }).trim();

const binaries = [
  ...[0, 1, 2, 3, 4].map((i) => `engine/chr/backdrop-${i}.chr`),
  'engine/chr/sprites.chr',
  'engine/chr/title-r0.chr',
  'engine/chr/title-r1.chr',
  'engine/chr/ending-r0.chr',
  'engine/chr/ending-r1.chr',
  ...[0, 1, 2, 3, 4].flatMap((i) => [`engine/stages/stage${i}.bin`, `engine/stages/stage${i}-card-palette.bin`]),
  'engine/screens.bin',
  'engine/title-palette.bin',
  'engine/ending-palette.bin',
];
const texts = ['manifest.json', 'palettes.json', 'gfx/sprites/sprites.json', 'music/index.json', 'README.md', 'ASSETS-ROWS.md'];

for (const f of binaries) {
  const to = path.join(kit, f.replace(/^engine\//, ''));
  mkdirSync(path.dirname(to), { recursive: true });
  copyFileSync(path.join(src, f), to);
}
for (const f of texts) {
  const to = path.join(kit, path.basename(f));
  writeFileSync(to, readFileSync(path.join(src, f), 'utf8').replace(/\r\n/g, '\n'));
}
mkdirSync(path.join(kit, 'audio'), { recursive: true });
for (const f of ['music.s', 'sfx.s']) {
  const text = readFileSync(path.join(src, 'music', 'export', f), 'utf8').replace(/\r\n/g, '\n').replace(/^; .*[A-Z]:\\.*$/gm, '; (path removed)');
  writeFileSync(path.join(kit, 'audio', f), text);
}
writeFileSync(path.join(kit, 'SOURCE.txt'), `NES-BLUM-FACTORY-ASSETS/sebring @ ${commit} (BLUMR-A1, original art and music, see README.md and ASSETS-ROWS.md)\nImported by scripts/import-sebring-kit.mjs. Do not edit by hand: change the kit, then re-import.\n`);
console.log(`import-sebring-kit: ${binaries.length} binaries + ${texts.length} texts + 2 audio files from sebring @ ${commit}`);
