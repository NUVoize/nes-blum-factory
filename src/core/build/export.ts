// Export (PLAN §7.4): <Titre>.nes, split <Titre>-PRG.bin / <Titre>-CHR.bin for chip programmers, the
// cartridge sheet in French and English (values read back from the ROM header, CRC32 + SHA-1 of every
// file, the bold PRG-RAM line, steps per flasher family, « Composants » notices), optional .dbg and zip.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { hex, parseHeader, type NesHeader } from '../nes/header.js';
import { crc32Hex } from '../util/crc32.js';

export interface Notice {
  /** Component name as shown on the sheet. */
  name: string;
  licence: string;
  text: string;
}

/** Components compiled into every exported ROM (W0 P1-4), with their licence files in resources/licenses. */
export const ROM_COMPONENTS: Array<{ name: string; licence: string; file: string }> = [
  { name: 'nesdoug.lib (Doug Fraker)', licence: 'MIT', file: 'nesdoug-MIT.txt' },
  { name: 'neslib (Shiru)', licence: 'domaine public / public domain', file: 'neslib-public-domain.txt' },
  { name: 'FamiStudio sound engine (Mathieu Gauthier)', licence: 'MIT', file: 'FamiStudio-sound-engine-notice.txt' },
  { name: 'cc65 runtime library', licence: 'zlib', file: 'cc65-zlib.txt' },
];

export function loadNotices(licensesDir: string): Notice[] {
  return ROM_COMPONENTS.map((c) => {
    const p = path.join(licensesDir, c.file);
    if (!existsSync(p)) throw new Error(`notice manquante : ${c.file}`);
    let text = readFileSync(p, 'utf8');
    // the FamiStudio notice file points to the MIT text: ship both together
    if (c.file === 'FamiStudio-sound-engine-notice.txt' && existsSync(path.join(licensesDir, 'FamiStudio-MIT.txt'))) {
      text += '\n\n' + readFileSync(path.join(licensesDir, 'FamiStudio-MIT.txt'), 'utf8');
    }
    return { name: c.name, licence: c.licence, text: text.replace(/\r\n/g, '\n').trim() };
  });
}

export interface FileFacts {
  name: string;
  bytes: number;
  crc32: string;
  sha1: string;
}

export interface SheetFacts {
  title: string;
  header: NesHeader;
  headerHex: string;
  files: FileFacts[];
  appVersion: string;
  date: string;
}

export interface ExportInput {
  title: string;
  rom: Uint8Array;
  notices: Notice[];
  appVersion: string;
  date?: Date;
  /** ld65 debug file for Mesen (optional). */
  dbg?: string | null;
  /** The project as a .blum.zip (optional). */
  projectZip?: Uint8Array | null;
}

export interface ExportResult {
  /** File name -> bytes, in the order they are written. */
  files: Array<{ name: string; bytes: Uint8Array }>;
  facts: SheetFacts;
}

/** A file name Windows accepts, accents kept (they are fine outside cc65). */
export function fileTitle(title: string): string {
  const t = title
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return t || 'Mon jeu';
}

const facts = (name: string, b: Uint8Array): FileFacts => ({
  name,
  bytes: b.length,
  crc32: crc32Hex(b),
  sha1: createHash('sha1').update(b).digest('hex').toUpperCase(),
});

/** PRG and CHR parts of an iNES / NES 2.0 file (no trainer). */
export function splitRom(rom: Uint8Array): { header: NesHeader; prg: Uint8Array; chr: Uint8Array } {
  const header = parseHeader(rom);
  if (header.trainer) throw new Error('ROM avec trainer : non prise en charge');
  const prg = rom.slice(16, 16 + header.prgRomBytes);
  const chr = rom.slice(16 + header.prgRomBytes, 16 + header.prgRomBytes + header.chrRomBytes);
  if (prg.length !== header.prgRomBytes || chr.length !== header.chrRomBytes) throw new Error('ROM plus courte que son en-tête');
  return { header, prg, chr };
}

export function exportFiles(input: ExportInput): ExportResult {
  const t = fileTitle(input.title);
  const { header, prg, chr } = splitRom(input.rom);
  const nesName = `${t}.nes`;
  const files: Array<{ name: string; bytes: Uint8Array }> = [
    { name: nesName, bytes: input.rom },
    { name: `${t}-PRG.bin`, bytes: prg },
    { name: `${t}-CHR.bin`, bytes: chr },
  ];
  const sheetFacts: SheetFacts = {
    title: input.title,
    header,
    headerHex: hex(input.rom.subarray(0, 16)),
    files: files.map((f) => facts(f.name, f.bytes)),
    appVersion: input.appVersion,
    date: (input.date ?? new Date()).toISOString().slice(0, 10),
  };
  const enc = new TextEncoder();
  files.push({ name: `${t} - fiche cartouche.html`, bytes: enc.encode(cartridgeSheet(sheetFacts, input.notices, 'fr')) });
  files.push({ name: `${t} - cartridge sheet.html`, bytes: enc.encode(cartridgeSheet(sheetFacts, input.notices, 'en')) });
  if (input.dbg) files.push({ name: `${t}.dbg`, bytes: enc.encode(input.dbg) });
  if (input.projectZip) files.push({ name: `${t}.blum.zip`, bytes: input.projectZip });
  return { files, facts: sheetFacts };
}

// ---------- the sheet ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const kib = (b: number) => `${b / 1024}`;

const T = {
  fr: {
    doc: 'fiche cartouche',
    lead: 'Tout ce qu’il faut pour mettre ce jeu sur une vraie cartouche NES.',
    cart: 'La cartouche',
    mapper: 'Mapper (puce de la cartouche)',
    mapperValue: (n: number) => `${n} (MMC3, cartes TxROM)`,
    submapper: 'Sous-mapper',
    prg: 'Programme (PRG-ROM)',
    chr: 'Graphismes (CHR-ROM)',
    wram: 'RAM de la cartouche (PRG-RAM)',
    battery: 'Pile de sauvegarde',
    yes: 'oui',
    no: 'non',
    mirroring: 'Miroir des écrans',
    mirroringValue: 'piloté par le jeu, MMC3',
    region: 'Région',
    format: 'Format de l’en-tête',
    headerBytes: 'Les 16 octets de l’en-tête',
    ko: 'Ko',
    ramRule: 'Carte avec 8 Ko de PRG-RAM obligatoire (type TKROM/TSROM, ou n’importe quelle cartouche flash). Sans elle, le jeu plante.',
    files: 'Les fichiers',
    file: 'Fichier',
    size: 'Taille',
    bytes: 'octets',
    use: 'Pour quoi',
    useNes: 'cartouches flash, émulateurs',
    usePrg: 'puce du programme (graveur de puces)',
    useChr: 'puce des graphismes (graveur de puces)',
    how: 'Comment flasher',
    steps: [
      ['Cartouche flash type EverDrive N8 ou PowerPak', 'Copie le fichier .nes sur la carte SD, mets la carte dans la cartouche, choisis le jeu dans le menu.'],
      ['Programmeur INL (INL-retro)', 'Choisis le mapper MMC3, PRG 256 Ko, CHR 128 Ko, puis écris le fichier .nes. Vérifie que la carte a sa PRG-RAM de 8 Ko.'],
      ['Carte MMC3 réinscriptible (TKROM/TSROM ou compatible)', 'Utilise l’outil fourni avec la carte et le fichier .nes ; il lit l’en-tête et place le programme et les graphismes.'],
      ['Graveur de puces (TL866 et similaires)', 'Grave -PRG.bin sur la puce du programme (256 Ko) et -CHR.bin sur la puce des graphismes (128 Ko). Compare les CRC32 ci-dessus après la gravure.'],
    ] as Array<[string, string]>,
    check: 'Après le flash : le jeu doit s’allumer sur l’écran titre avec « APPUIE SUR START ». S’il reste noir, vérifie la PRG-RAM et le mapper.',
    components: 'Composants',
    componentsLead: 'Chaque ROM faite avec NES BLUM FACTORY contient ces bibliothèques. Leurs licences demandent que ces notices accompagnent le jeu.',
    made: (v: string, d: string) => `Fait avec NES BLUM FACTORY ${v}, le ${d}.`,
    lang: 'fr',
  },
  en: {
    doc: 'cartridge sheet',
    lead: 'Everything you need to put this game on a real NES cartridge.',
    cart: 'The cartridge',
    mapper: 'Mapper (cartridge chip)',
    mapperValue: (n: number) => `${n} (MMC3, TxROM boards)`,
    submapper: 'Submapper',
    prg: 'Program (PRG-ROM)',
    chr: 'Graphics (CHR-ROM)',
    wram: 'Cartridge RAM (PRG-RAM)',
    battery: 'Battery save',
    yes: 'yes',
    no: 'no',
    mirroring: 'Mirroring',
    mirroringValue: 'set by the game, MMC3',
    region: 'Region',
    format: 'Header format',
    headerBytes: 'The 16 header bytes',
    ko: 'KiB',
    ramRule: 'PRG-RAM 8 KiB required (TKROM/TSROM-class board, or any flash cart). Without it, the game crashes.',
    files: 'The files',
    file: 'File',
    size: 'Size',
    bytes: 'bytes',
    use: 'Used for',
    useNes: 'flash carts, emulators',
    usePrg: 'program chip (chip programmer)',
    useChr: 'graphics chip (chip programmer)',
    how: 'How to flash',
    steps: [
      ['Flash cart such as EverDrive N8 or PowerPak', 'Copy the .nes file to the SD card, put the card in the cartridge, pick the game in the menu.'],
      ['INL programmer (INL-retro)', 'Pick mapper MMC3, PRG 256 KiB, CHR 128 KiB, then write the .nes file. Check that the board has its 8 KiB PRG-RAM.'],
      ['Rewritable MMC3 board (TKROM/TSROM or compatible)', 'Use the tool that comes with the board and the .nes file; it reads the header and places the program and the graphics.'],
      ['Chip programmer (TL866 and similar)', 'Burn -PRG.bin on the program chip (256 KiB) and -CHR.bin on the graphics chip (128 KiB). Compare the CRC32 above after burning.'],
    ] as Array<[string, string]>,
    check: 'After flashing: the game must start on the title screen with "PRESS START". If it stays black, check the PRG-RAM and the mapper.',
    components: 'Components',
    componentsLead: 'Every ROM made with NES BLUM FACTORY contains these libraries. Their licences ask for these notices to travel with the game.',
    made: (v: string, d: string) => `Made with NES BLUM FACTORY ${v}, on ${d}.`,
    lang: 'en',
  },
} as const;

export function cartridgeSheet(f: SheetFacts, notices: Notice[], locale: 'fr' | 'en'): string {
  const t = T[locale];
  const h = f.header;
  const ram = h.prgRamBytes + h.prgNvramBytes;
  const row = (label: string, key: string, value: string, cls = '') => `<tr${cls ? ` class="${cls}"` : ''}><th>${esc(label)}</th><td data-k="${key}">${esc(value)}</td></tr>`;
  const use = [t.useNes, t.usePrg, t.useChr];
  const fileRows = f.files
    .map(
      (x, i) =>
        `<tr><td class="mono" data-file="${esc(x.name)}">${esc(x.name)}</td><td class="num" data-k="bytes">${x.bytes} ${t.bytes}</td><td class="mono" data-k="crc32">${x.crc32}</td><td class="mono small" data-k="sha1">${x.sha1}</td><td>${esc(use[i] ?? '')}</td></tr>`,
    )
    .join('\n');
  const steps = t.steps.map(([who, what]) => `<li><b>${esc(who)}</b> : ${esc(what)}</li>`).join('\n');
  const comps = notices.map((n) => `<section class="notice"><h3>${esc(n.name)} <span class="lic">${esc(n.licence)}</span></h3><pre>${esc(n.text)}</pre></section>`).join('\n');
  return `<!doctype html>
<html lang="${t.lang}">
<head>
<meta charset="utf-8">
<meta name="generator" content="NES BLUM FACTORY ${esc(f.appVersion)}">
<title>${esc(f.title)} - ${esc(t.doc)}</title>
<style>
  :root { --ink: #181830; --paper: #f8f8f0; --line: #b8b8c8; --gold: #b07800; --accent: #3050a0; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 15px/1.5 "Segoe UI", system-ui, sans-serif; }
  main { max-width: 900px; margin: 0 auto; padding: 32px 28px 48px; }
  header { border: 4px solid var(--ink); box-shadow: 6px 6px 0 var(--accent); padding: 16px 20px; margin-bottom: 24px; background: #fff; }
  h1 { margin: 0; font-size: 28px; letter-spacing: 1px; }
  h1 small { display: block; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 3px; color: var(--accent); }
  h2 { font-size: 18px; border-bottom: 3px solid var(--ink); padding-bottom: 4px; margin: 28px 0 12px; text-transform: uppercase; letter-spacing: 2px; }
  h3 { font-size: 15px; margin: 0 0 6px; }
  table { border-collapse: collapse; width: 100%; background: #fff; }
  th, td { border: 2px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top; }
  th { font-weight: 600; }
  .facts th { width: 38%; }
  .files td:nth-child(4) { width: 34%; }
  .mono { font-family: Consolas, "Courier New", monospace; }
  .small { font-size: 12px; word-break: break-all; }
  .num { white-space: nowrap; }
  .must { border: 4px solid var(--gold); background: #fff6d8; padding: 12px 16px; margin: 16px 0; font-weight: 800; font-size: 16px; }
  ol li { margin: 6px 0; }
  .notice { background: #fff; border: 2px solid var(--line); padding: 12px; margin: 10px 0; }
  .lic { font-weight: 400; color: var(--accent); font-size: 13px; margin-left: 8px; }
  pre { white-space: pre-wrap; font: 12px/1.4 Consolas, "Courier New", monospace; margin: 0; }
  footer { margin-top: 32px; font-size: 13px; color: #505068; }
  @media print { header { box-shadow: none; } body { background: #fff; } }
</style>
</head>
<body>
<main>
<header>
  <h1><small>${esc(t.doc)}</small><span data-k="title">${esc(f.title)}</span></h1>
  <p>${esc(t.lead)}</p>
</header>

<p class="must" data-k="ram-rule"><strong>${esc(t.ramRule)}</strong></p>

<h2>${esc(t.cart)}</h2>
<table class="facts">
${row(t.mapper, 'mapper', t.mapperValue(h.mapper))}
${row(t.submapper, 'submapper', String(h.submapper))}
${row(t.prg, 'prg', `${kib(h.prgRomBytes)} ${t.ko}`)}
${row(t.chr, 'chr', `${kib(h.chrRomBytes)} ${t.ko}`)}
${row(t.wram, 'prgram', `${kib(ram)} ${t.ko}`, 'gold')}
${row(t.battery, 'battery', h.battery ? t.yes : t.no)}
${row(t.mirroring, 'mirroring', `${t.mirroringValue} (bit ${h.mirroringBit})`)}
${row(t.region, 'region', h.region.toUpperCase())}
${row(t.format, 'format', h.format === 'nes2' ? 'NES 2.0' : 'iNES')}
${row(t.headerBytes, 'header', f.headerHex)}
</table>

<h2>${esc(t.files)}</h2>
<table class="files">
<tr><th>${esc(t.file)}</th><th>${esc(t.size)}</th><th>CRC32</th><th>SHA-1</th><th>${esc(t.use)}</th></tr>
${fileRows}
</table>

<h2>${esc(t.how)}</h2>
<ol>
${steps}
</ol>
<p>${esc(t.check)}</p>

<h2 data-k="components">${esc(t.components)}</h2>
<p>${esc(t.componentsLead)}</p>
${comps}

<footer>${esc(t.made(f.appVersion, f.date))}</footer>
</main>
</body>
</html>
`;
}
