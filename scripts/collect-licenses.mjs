// Copies the licence text of every npm package that ships inside the app into resources/licenses/npm/
// (main-process dependency tree + the packages Vite bundles into the renderer), and the OFL texts of the
// two fonts. M5-T6 checks that every shipped package has its file. Run after `npm install`.
//   node scripts/collect-licenses.mjs
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'resources', 'licenses', 'npm');
mkdirSync(out, { recursive: true });

/** Bundled by Vite into dist/renderer (devDependencies, but their code ships). */
export const RENDERER_BUNDLED = ['react', 'react-dom', 'scheduler', '@fontsource/press-start-2p', '@fontsource/pixelify-sans'];


const tree = execSync('npm ls --omit=dev --all --parseable', { cwd: root, encoding: 'utf8' })
  .split(/\r?\n/)
  .filter((l) => l.includes('node_modules'))
  .map((l) => l.slice(l.lastIndexOf('node_modules') + 'node_modules'.length + 1).replace(/\\/g, '/'));
const names = [...new Set([...tree, ...RENDERER_BUNDLED])].sort();

const fileName = (name) => `${name.replace('@', '').replace('/', '__')}.txt`;
const index = [];
for (const name of names) {
  const dir = path.join(root, 'node_modules', ...name.split('/'));
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const lic = readdirSync(dir).find((f) => /^(licen[sc]e|copying)(\.(md|txt))?$/i.test(f));
  // packages published without a licence file: the text from their source repository (scripts/licenses-extra)
  const extra = path.join(root, 'scripts', 'licenses-extra', fileName(name));
  if (!lic && !existsSync(extra)) throw new Error(`no licence file in ${name}`);
  const text = readFileSync(lic ? path.join(dir, lic) : extra, 'utf8').replace(/\r\n/g, '\n').trim();
  writeFileSync(path.join(out, fileName(name)), `${pkg.name} ${pkg.version} (${pkg.license})\n${pkg.homepage ?? ''}\n\n${text}\n`);
  index.push(`| ${pkg.name} | ${pkg.version} | ${pkg.license} | npm/${fileName(name)} |`);
}
writeFileSync(
  path.join(root, 'resources', 'licenses', 'INDEX.md'),
  [
    '# Licences of the components shipped in NES BLUM FACTORY',
    '',
    'Electron: `LICENSE.electron.txt` and `LICENSES.chromium.html` next to the exe.',
    '',
    '| Component | Version | Licence | File |',
    '|---|---|---|---|',
    '| cc65 (compiler, assembler, linker, nes.lib) | V2.19 Git 8d86ca7 | zlib | cc65-zlib.txt |',
    '| nesdoug.lib (engine, compiled into every ROM) | 2023 | MIT | nesdoug-MIT.txt |',
    '| neslib (engine, compiled into every ROM) | 2023 | public domain | neslib-public-domain.txt |',
    '| FamiStudio sound engine (compiled into every ROM) | 4.5 | MIT | FamiStudio-MIT.txt, FamiStudio-sound-engine-notice.txt |',
    '| jsnes (in-app emulator) | 2.1.0 | Apache-2.0 | jsnes-Apache-2.0.txt |',
    '| Press Start 2P font | 5.3.0 | SIL OFL-1.1 | PressStart2P-OFL.txt |',
    '| Pixelify Sans font | 5.3.0 | SIL OFL-1.1 | PixelifySans-OFL.txt |',
    ...index,
    '',
  ].join('\n'),
);
for (const [pkg, file] of [
  ['@fontsource/press-start-2p', 'PressStart2P-OFL.txt'],
  ['@fontsource/pixelify-sans', 'PixelifySans-OFL.txt'],
]) {
  const src = path.join(root, 'node_modules', ...pkg.split('/'), 'LICENSE');
  if (!existsSync(src)) throw new Error(`missing ${src}`);
  writeFileSync(path.join(root, 'resources', 'licenses', file), readFileSync(src, 'utf8').replace(/\r\n/g, '\n'));
}
console.log(`licences: ${names.length} npm packages + 2 fonts -> resources/licenses`);
