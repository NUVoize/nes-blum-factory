// node scripts/everdrive-package.mjs --gift=<dir>/CADEAU-BLUM — BLUMEV-M: writes « EverDrive (carte SD) » into a
// gift folder: what Blum copies to the root of the EverDrive's micro SD card (N8 or N8 Pro). Short FAT32-safe
// names (8.3, ASCII). The ROMs are iNES 1.0 copies of release/handover (scripts/everdrive-header.mjs: same
// PRG/CHR, header bytes 7-15 zeroed), checked byte for byte against the originals past the header; the NSFs come
// from the gift's own « Bande sonore » folder (same bytes). Refuses to overwrite an existing folder.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GIFT_ROMS, ines1Copy } from './everdrive-header.mjs';

const root = path.resolve(import.meta.dirname, '..');
const giftArg = process.argv.find((a) => a.startsWith('--gift='))?.slice(7);
if (!giftArg) {
  console.error('everdrive-package: --gift=<dir>/CADEAU-BLUM required');
  process.exit(2);
}
const gift = path.resolve(root, giftArg);
const sd = path.join(gift, 'EverDrive (carte SD)');
if (existsSync(sd)) {
  console.error(`everdrive-package: ${sd} exists (never overwritten): move it to the archive first`);
  process.exit(1);
}
const sha = (b) => createHash('sha256').update(b).digest('hex');
const files = [];
const put = (rel, bytes) => {
  const p = path.join(sd, ...rel.split('/'));
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, bytes);
  files.push({ rel, bytes: bytes.length, sha256: sha(bytes) });
};
const fat83 = (name) => /^[A-Z0-9_-]{1,8}(\.[A-Z0-9]{1,3})?$/i.test(name);

for (const r of GIFT_ROMS) {
  const src = readFileSync(path.join(root, 'release', 'handover', r.file));
  const out = ines1Copy(src);
  if (!out.subarray(16).equals(src.subarray(16)) || !out.subarray(0, 7).equals(src.subarray(0, 7))) throw new Error(`${r.file}: copy differs past the header`);
  if (((out[6] & 2) !== 0) !== r.battery || out[6] >> 4 !== 4) throw new Error(`${r.file}: battery / mapper bits`);
  put(`BLUM/${r.sd}`, out);
}
const soundtrack = path.join(gift, 'Bande sonore');
put('BLUM/MUSIQUE/AWAITS.NSF', readFileSync(path.join(soundtrack, 'Adventure Awaits (NES).nsf')));
put('BLUM/MUSIQUE/LEGEND.NSF', readFileSync(path.join(soundtrack, 'The Legend of Blum - musique du jeu (NES).nsf')));
// Notepad-friendly line ends for the two texts
for (const t of ['LISEZMOI.TXT', 'README.TXT']) put(t, Buffer.from(readFileSync(path.join(root, 'docs', 'everdrive', t), 'utf8').replace(/\r?\n/g, '\r\n'), 'utf8'));

for (const f of files) for (const part of f.rel.split('/')) if (!fat83(part)) throw new Error(`not an 8.3 name: ${f.rel}`);
writeFileSync(path.join(root, '.tmp', 'everdrive', 'sd-files.json'), JSON.stringify(files, null, 1));
for (const f of files) console.log(`${f.sha256}  EverDrive (carte SD)/${f.rel}  (${f.bytes} B)`);
console.log(`everdrive-package: OK ${files.length} files in ${path.relative(root, sd)}`);
