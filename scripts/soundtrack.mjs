// npm run soundtrack (BLUMS-M): the gift's « Bande sonore » folder in release/handover/Bande sonore/:
// Fred's two original songs (NES-BLUM-FACTORY-ASSETS/Adventure Awaits.mp3 = version A, « (1) » = version B,
// read only, copied with clean names and checked byte for byte), the NES versions as WAV + NSF and the game's
// whole soundtrack as NSF (NES-BLUM-FACTORY-ASSETS/legend/music/soundtrack/, made by tools/soundtrack.py from the
// same scores as the ROM), and docs/BANDE-SONORE-LISEZ-MOI.txt. scripts/gift.mjs copies the folder.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const assets = path.resolve(root, '..', 'NES-BLUM-FACTORY-ASSETS');
const kit = path.join(assets, 'legend', 'music', 'soundtrack');
const out = path.join(root, 'release', 'handover', 'Bande sonore');

export const SOUNDTRACK_FILES = [
  [path.join(assets, 'Adventure Awaits.mp3'), 'Adventure Awaits - version A.mp3'],
  [path.join(assets, 'Adventure Awaits (1).mp3'), 'Adventure Awaits - version B.mp3'],
  [path.join(kit, 'Adventure Awaits - version A (NES).wav'), 'Adventure Awaits - version A (NES).wav'],
  [path.join(kit, 'Adventure Awaits - version B (NES).wav'), 'Adventure Awaits - version B (NES).wav'],
  [path.join(kit, 'Adventure Awaits (NES).nsf'), 'Adventure Awaits (NES).nsf'],
  [path.join(kit, 'The Legend of Blum - musique du jeu (NES).nsf'), 'The Legend of Blum - musique du jeu (NES).nsf'],
  [path.join(root, 'docs', 'BANDE-SONORE-LISEZ-MOI.txt'), 'LISEZ-MOI - Bande sonore.txt'],
];

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
for (const [from] of SOUNDTRACK_FILES) {
  if (!existsSync(from)) {
    console.error(`soundtrack: missing ${from} (the NES files: py -3.12 tools/soundtrack.py in NES-BLUM-FACTORY-ASSETS/legend/music)`);
    process.exit(1);
  }
}
mkdirSync(out, { recursive: true });
for (const [from, name] of SOUNDTRACK_FILES) {
  const to = path.join(out, name);
  copyFileSync(from, to);
  const h = sha(to);
  if (h !== sha(from)) {
    console.error(`soundtrack: ${name} differs from its source after the copy`);
    process.exit(1);
  }
  console.log(`soundtrack: ${name} (${statSync(to).size} B, sha256 ${h.slice(0, 16)}…)`);
}
console.log(`soundtrack: ${SOUNDTRACK_FILES.length} files -> ${path.relative(root, out)}`);
