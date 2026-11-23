// Imports the LEGEND OF BLUM slice art + music kit (NES-BLUM-FACTORY-ASSETS/legend, BLUMZ-A1, read-only) into
// rpg/kit/ (BLUMZ-M1). Engine binaries are copied as they are; the JSON docs the compiler reads (metatile chars,
// metasprites, enemy grids, screen layouts) are normalised to LF; the FamiStudio ca65 export is normalised to LF
// with machine paths removed (like import-sebring-kit.mjs). The build (src/core/rpg/legend/build.ts) reads only
// rpg/kit/, so the factory builds without the assets repo. Never copies _source-v1 (private references).
//   node scripts/import-legend-kit.mjs
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const assetsRepo = path.resolve(root, '..', 'NES-BLUM-FACTORY-ASSETS');
const src = path.join(assetsRepo, 'legend');
const kit = path.join(root, 'rpg', 'kit');
const commit = execFileSync('git', ['-C', assetsRepo, 'log', '-1', '--format=%h', '--', 'legend'], { encoding: 'utf8' }).trim();

let binaries = 0;
for (const dir of ['chr', 'metatiles', 'palettes', 'screens', 'battle']) {
  mkdirSync(path.join(kit, dir), { recursive: true });
  for (const f of readdirSync(path.join(src, 'engine', dir)).filter((f) => f.endsWith('.chr') || f.endsWith('.bin')).sort()) {
    copyFileSync(path.join(src, 'engine', dir, f), path.join(kit, dir, f));
    binaries++;
  }
}
let texts = 0;
const text = (from, to) => {
  mkdirSync(path.dirname(path.join(kit, to)), { recursive: true });
  writeFileSync(path.join(kit, to), readFileSync(path.join(src, from), 'utf8').replace(/\r\n/g, '\n'));
  texts++;
};
for (const dir of ['battle', 'blum', 'enemies', 'fx', 'npcs', 'screens', 'tilesets', 'ui']) {
  for (const f of readdirSync(path.join(src, 'gfx', dir)).filter((f) => f.endsWith('.json')).sort()) text(`gfx/${dir}/${f}`, `gfx/${dir}/${f}`);
}
text('manifest.json', 'manifest.json');
text('budget.json', 'budget.json');
text('README.md', 'README.md');
text('music/index.json', 'audio/index.json');
mkdirSync(path.join(kit, 'audio'), { recursive: true });
for (const f of ['music.s', 'sfx.s']) {
  const s = readFileSync(path.join(src, 'music', 'export', f), 'utf8').replace(/\r\n/g, '\n').replace(/^; .*[A-Z]:\\.*$/gm, '; (path removed)');
  writeFileSync(path.join(kit, 'audio', f), s);
}
writeFileSync(path.join(kit, 'SOURCE.txt'), `NES-BLUM-FACTORY-ASSETS/legend @ ${commit} (BLUMZ-A1, original art and music, see README.md)\nImported by scripts/import-legend-kit.mjs. Do not edit by hand: change the kit, then re-import.\n`);
console.log(`import-legend-kit: ${binaries} binaries + ${texts} texts + 2 audio files from legend @ ${commit}`);
