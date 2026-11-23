// iNES / NES 2.0 header (https://www.nesdev.org/wiki/NES_2.0). Parser + writer for the cartridge sheet,
// the build validation and the emitter (PLAN §5.1, §7.1).
import type { Cartridge } from '../schema/project.js';

export type Mirroring = 'horizontal' | 'vertical' | 'four-screen' | 'mapper';

export interface NesHeader {
  format: 'ines' | 'nes2';
  mapper: number;
  submapper: number;
  prgRomBytes: number;
  chrRomBytes: number;
  prgRamBytes: number; // volatile
  prgNvramBytes: number; // battery-backed
  chrRamBytes: number;
  battery: boolean;
  trainer: boolean;
  /** Bit 0 of byte 6. For software-mirroring mappers (MMC3) the bit is ignored by the hardware. */
  mirroringBit: 0 | 1;
  fourScreen: boolean;
  region: 'ntsc' | 'pal' | 'multi' | 'dendy';
}

export class HeaderError extends Error {}

const REGIONS = ['ntsc', 'pal', 'multi', 'dendy'] as const;

function shiftSize(nibble: number): number {
  return nibble === 0 ? 0 : 64 << nibble;
}

function sizeShift(bytes: number): number {
  if (bytes === 0) return 0;
  for (let s = 1; s < 16; s++) if (64 << s === bytes) return s;
  throw new HeaderError(`taille RAM non représentable en NES 2.0 : ${bytes}`);
}

export function parseHeader(bytes: ArrayLike<number>): NesHeader {
  if (bytes.length < 16) throw new HeaderError('fichier trop court pour un en-tête NES');
  if (bytes[0] !== 0x4e || bytes[1] !== 0x45 || bytes[2] !== 0x53 || bytes[3] !== 0x1a) {
    throw new HeaderError('signature « NES<EOF> » absente');
  }
  const b = (i: number) => bytes[i]!;
  const nes2 = (b(7) & 0x0c) === 0x08;
  const flags6 = b(6);
  const mapperLo = flags6 >> 4;
  const mapperMid = b(7) & 0xf0;
  if (!nes2) {
    return {
      format: 'ines',
      mapper: mapperMid | mapperLo,
      submapper: 0,
      prgRomBytes: b(4) * 16384,
      chrRomBytes: b(5) * 8192,
      prgRamBytes: (flags6 & 0x02) === 0 ? 8192 : 0,
      prgNvramBytes: (flags6 & 0x02) !== 0 ? 8192 : 0,
      chrRamBytes: b(5) === 0 ? 8192 : 0,
      battery: (flags6 & 0x02) !== 0,
      trainer: (flags6 & 0x04) !== 0,
      mirroringBit: (flags6 & 1) as 0 | 1,
      fourScreen: (flags6 & 0x08) !== 0,
      region: 'ntsc',
    };
  }
  const msb = b(9);
  const prgMsb = msb & 0x0f;
  const chrMsb = msb >> 4;
  if (prgMsb === 0x0f || chrMsb === 0x0f) throw new HeaderError('notation exposant des tailles ROM non prise en charge');
  return {
    format: 'nes2',
    mapper: ((b(8) & 0x0f) << 8) | mapperMid | mapperLo,
    submapper: b(8) >> 4,
    prgRomBytes: ((prgMsb << 8) | b(4)) * 16384,
    chrRomBytes: ((chrMsb << 8) | b(5)) * 8192,
    prgRamBytes: shiftSize(b(10) & 0x0f),
    prgNvramBytes: shiftSize(b(10) >> 4),
    chrRamBytes: shiftSize(b(11) & 0x0f),
    battery: (flags6 & 0x02) !== 0,
    trainer: (flags6 & 0x04) !== 0,
    mirroringBit: (flags6 & 1) as 0 | 1,
    fourScreen: (flags6 & 0x08) !== 0,
    region: REGIONS[b(12) & 0x03]!,
  };
}

export function writeHeader(h: Omit<NesHeader, 'format'>): Uint8Array {
  const out = new Uint8Array(16);
  out.set([0x4e, 0x45, 0x53, 0x1a]);
  const prgUnits = h.prgRomBytes / 16384;
  const chrUnits = h.chrRomBytes / 8192;
  if (!Number.isInteger(prgUnits) || !Number.isInteger(chrUnits)) throw new HeaderError('tailles ROM non alignées');
  out[4] = prgUnits & 0xff;
  out[5] = chrUnits & 0xff;
  out[6] = ((h.mapper & 0x0f) << 4) | (h.fourScreen ? 0x08 : 0) | (h.trainer ? 0x04 : 0) | (h.battery ? 0x02 : 0) | h.mirroringBit;
  out[7] = (h.mapper & 0xf0) | 0x08;
  out[8] = ((h.submapper & 0x0f) << 4) | ((h.mapper >> 8) & 0x0f);
  out[9] = ((chrUnits >> 8) << 4) | (prgUnits >> 8);
  out[10] = (sizeShift(h.prgNvramBytes) << 4) | sizeShift(h.prgRamBytes);
  out[11] = sizeShift(h.chrRamBytes);
  out[12] = REGIONS.indexOf(h.region);
  return out;
}

/** Header for a cartridge profile (PLAN §5.1). Battery builds keep the 8 KiB as NVRAM. */
export function headerForCartridge(c: Cartridge): Uint8Array {
  return writeHeader({
    mapper: c.mapper,
    submapper: c.submapper,
    prgRomBytes: c.prgRomKiB * 1024,
    chrRomBytes: c.chrRomKiB * 1024,
    prgRamBytes: c.battery ? 0 : c.prgRamKiB * 1024,
    prgNvramBytes: c.battery ? c.prgRamKiB * 1024 : 0,
    chrRamBytes: 0,
    battery: c.battery,
    trainer: false,
    mirroringBit: 0,
    fourScreen: false,
    region: c.region,
  });
}

export function romSize(h: NesHeader): number {
  return 16 + (h.trainer ? 512 : 0) + h.prgRomBytes + h.chrRomBytes;
}

export function hex(bytes: ArrayLike<number>): string {
  return Array.from(bytes, (v) => v.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}
