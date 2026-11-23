// npm run gift (BLUM-FIX2): the gift package for Blum, after `npm run package` and `npm run test:package`.
// release/CADEAU-BLUM/ = the app folder + « Jeu BLUM » (ROM, split bins, cartridge sheets, project zip)
// + « Jeu SEBRING » (BLUMR-M2: the racer ROM, split bins, cartridge sheets, tracks; npm run racer:handover)
// + « Jeu THE LEGEND OF BLUM » (BLUMZ-F2: the slice ROM, split bins, cartridge sheets; npm run legend:handover)
// + « Bande sonore » (BLUMS-M: Fred's two « Adventure Awaits » songs, mp3 + NES WAV + NSF; npm run soundtrack)
// + « LISEZ-MOI - Guide de démarrage.pdf » (docs/LISEZ-MOI.html), zipped as release/CADEAU-BLUM-<version>.zip.
// Not in dist/: that is the tsc/vite output (W2 P2-8).
// BLUMZ-F2: --stage=<dir> builds the CADEAU-BLUM folder inside <dir> instead of release/ (the zip keeps the same
// layout and name). An existing CADEAU-BLUM folder is never removed (Fred may be running the app from it, and
// nothing is deleted): move it to the archive first, or stage elsewhere.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const release = path.join(root, 'release');
const app = path.join(release, pkg.productName);
const hand = path.join(release, 'handover');
const stageArg = process.argv.find((a) => a.startsWith('--stage='))?.slice(8);
const stage = stageArg ? path.resolve(root, stageArg) : release;
const gift = path.join(stage, 'CADEAU-BLUM');
const zip = path.join(release, `CADEAU-BLUM-${pkg.version}.zip`);
const guide = 'LISEZ-MOI - Guide de démarrage.pdf';
const game = ['BLUM.nes', 'BLUM-PRG.bin', 'BLUM-CHR.bin', 'BLUM - fiche cartouche.html', 'BLUM - cartridge sheet.html', 'BLUM.blum.zip'];
const legendDir = 'Jeu THE LEGEND OF BLUM';
const legend = ['LEGEND-OF-BLUM-SLICE.nes', 'LEGEND-OF-BLUM-SLICE-PRG.bin', 'LEGEND-OF-BLUM-SLICE-CHR.bin', 'LEGEND-OF-BLUM-SLICE - fiche cartouche.html', 'LEGEND-OF-BLUM-SLICE - cartridge sheet.html'];
const soundDir = 'Bande sonore';
const sound = ['Adventure Awaits - version A.mp3', 'Adventure Awaits - version B.mp3', 'Adventure Awaits - version A (NES).wav', 'Adventure Awaits - version B (NES).wav', 'Adventure Awaits (NES).nsf', 'The Legend of Blum - musique du jeu (NES).nsf', 'LISEZ-MOI - Bande sonore.txt'];
const racer = ['SEBRING.nes', 'SEBRING-PRG.bin', 'SEBRING-CHR.bin', 'SEBRING - fiche cartouche.html', 'SEBRING - cartridge sheet.html', 'SEBRING-pistes.json'];

for (const p of [path.join(app, `${pkg.productName}.exe`), ...[...game, ...racer, ...legend].map((f) => path.join(hand, f)), ...sound.map((f) => path.join(hand, soundDir, f))]) {
  if (!existsSync(p)) {
    console.error(`gift: missing ${path.relative(root, p)}: run \`npm run package\`, \`npm run test:package\`, \`npm run racer:handover\`, \`npm run legend:handover\` and \`npm run soundtrack\` first`);
    process.exit(1);
  }
}

if (existsSync(gift)) {
  console.error(`gift: ${path.relative(root, gift)} exists: move it to the archive first (never deleted), or use --stage=<dir>`);
  process.exit(1);
}
if (existsSync(zip)) {
  console.error(`gift: ${path.relative(root, zip)} exists: move it to the archive first (never deleted)`);
  process.exit(1);
}
mkdirSync(path.join(gift, 'Jeu BLUM'), { recursive: true });
mkdirSync(path.join(gift, 'Jeu SEBRING'), { recursive: true });
mkdirSync(path.join(gift, legendDir), { recursive: true });
mkdirSync(path.join(gift, soundDir), { recursive: true });
console.log('gift: app folder');
cpSync(app, path.join(gift, pkg.productName), { recursive: true });
for (const f of game) cpSync(path.join(hand, f), path.join(gift, 'Jeu BLUM', f));
for (const f of racer) cpSync(path.join(hand, f), path.join(gift, 'Jeu SEBRING', f));
for (const f of legend) cpSync(path.join(hand, f), path.join(gift, legendDir, f));
for (const f of sound) cpSync(path.join(hand, soundDir, f), path.join(gift, soundDir, f));

console.log('gift: guide PDF');
const electron = require('electron');
const r = spawnSync(electron, [path.join(root, 'scripts', 'print-pdf.cjs'), path.join(root, 'docs', 'LISEZ-MOI.html'), path.join(gift, guide)], { stdio: 'inherit', windowsHide: true });
if (r.status !== 0 || !existsSync(path.join(gift, guide))) {
  console.error(`gift: PDF failed (exit ${r.status})`);
  process.exit(1);
}

// Windows' bsdtar writes zip archives (-a picks the format from the .zip extension)
execFileSync(path.join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', zip, '-C', stage, 'CADEAU-BLUM'], { stdio: 'inherit', windowsHide: true });
const mb = (n) => `${(n / 1048576).toFixed(1)} MiB`;
console.log(`gift: OK ${path.relative(root, zip)} (${mb(statSync(zip).size)})`);
