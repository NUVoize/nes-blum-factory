// BLUMEV-M: iNES 1.0 copies for the EverDrive SD card (scripts/everdrive-header.mjs).
import { describe, expect, it } from 'vitest';
import { GIFT_ROMS, crc32, ines1Copy } from '../scripts/everdrive-header.mjs';

function nes20(battery: boolean): Buffer {
  const rom = Buffer.alloc(16 + 16 * 16384 + 16 * 8192);
  Buffer.from([0x4e, 0x45, 0x53, 0x1a, 0x10, 0x10, battery ? 0x42 : 0x40, 0x08, 0, 0, battery ? 0x70 : 0x07, 0, 0, 0, 0, 0]).copy(rom);
  for (let i = 16; i < rom.length; i++) rom[i] = (i * 7) & 0xff;
  return rom;
}

describe('BLUMEV-M EverDrive header', () => {
  it('keeps PRG/CHR and header bytes 0-6, zeroes bytes 7-15 (battery bit kept)', () => {
    for (const battery of [false, true]) {
      const src = nes20(battery);
      const out = ines1Copy(src);
      expect(out.length).toBe(src.length);
      expect(out.subarray(16).equals(src.subarray(16))).toBe(true);
      expect([...out.subarray(0, 16)]).toEqual([0x4e, 0x45, 0x53, 0x1a, 0x10, 0x10, battery ? 0x42 : 0x40, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      expect(src[7]).toBe(0x08); // the original is untouched
    }
  });
  it('refuses anything that is not the gift layout (NES 2.0, mapper 4, submapper 0, 8 KiB RAM)', () => {
    const bad = [
      (b: Buffer) => { b[7] = 0; }, // already iNES 1.0
      (b: Buffer) => { b[6] = 0x10; }, // mapper 1
      (b: Buffer) => { b[8] = 0x40; }, // submapper 4
      (b: Buffer) => { b[10] = 0x09; }, // 32 KiB PRG-RAM
      (b: Buffer) => { b[6] |= 0x04; }, // trainer
      (b: Buffer) => { b[0] = 0; },
    ];
    for (const f of bad) {
      const b = nes20(false);
      f(b);
      expect(() => ines1Copy(b)).toThrow();
    }
  });
  it('short FAT32-safe SD names, only LEGEND has the battery', () => {
    expect(GIFT_ROMS.map((r) => r.sd)).toEqual(['BLUM.nes', 'SEBRING.nes', 'LEGEND.nes']);
    for (const r of GIFT_ROMS) expect(r.sd).toMatch(/^[A-Z0-9]{1,8}\.nes$/i);
    expect(GIFT_ROMS.filter((r) => r.battery).map((r) => r.id)).toEqual(['LEGEND']);
  });
  it('crc32 matches the standard check value', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });
});
