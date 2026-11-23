// « Jeu d'exemple THE LEGEND OF BLUM (début) » (BLUMZ-F2): the vertical slice ROM the app plays
// (resources/samples/LEGEND, written by npm run legend:handover), its chapters for the side panel, and the
// battery file the app keeps per sample (8 KiB PRG-RAM, the same bytes Mesen writes in its .sav).
// No Node imports (renderer-safe).

export const LEGEND_FOLDER = 'LEGEND';
export const LEGEND_ROM = 'LEGEND-OF-BLUM-SLICE.nes';
export const LEGEND_TITLE = 'THE LEGEND OF BLUM';
/** Battery RAM: $6000-$7FFF. */
export const LEGEND_BATTERY_BYTES = 8192;
export const LEGEND_BATTERY_ADDR = 0x6000;
/** iNES 16 + 256 KiB PRG + 128 KiB CHR (MMC3, battery). */
export const LEGEND_ROM_BYTES = 16 + 256 * 1024 + 128 * 1024;

/** What the slice contains, in play order (rpg/legend/cards.json). */
export const LEGEND_CHAPTERS: Array<{ fr: string; en: string }> = [
  { fr: 'Prologue : chez Madame Bélanger', en: 'Prologue: at Madame Bélanger’s' },
  { fr: 'Chapitre 1 : la maternelle', en: 'Chapter 1: kindergarten' },
  { fr: 'Chapitre 1 : la 1re année', en: 'Chapter 1: grade 1' },
  { fr: 'À SUIVRE', en: 'To be continued' },
];

/** null when the bytes are the slice's cartridge (iNES, MMC3, battery-backed PRG-RAM), else why not (FR + EN). */
export function checkLegendRom(rom: Uint8Array): { fr: string; en: string } | null {
  const ines = rom[0] === 0x4e && rom[1] === 0x45 && rom[2] === 0x53 && rom[3] === 0x1a;
  const mapper = ((rom[6] ?? 0) >> 4) | ((rom[7] ?? 0) & 0xf0);
  const battery = ((rom[6] ?? 0) & 2) !== 0;
  if (!ines || rom.length !== LEGEND_ROM_BYTES || mapper !== 4 || !battery) {
    return { fr: 'la ROM de THE LEGEND OF BLUM est abîmée', en: 'the THE LEGEND OF BLUM ROM is damaged' };
  }
  return null;
}
