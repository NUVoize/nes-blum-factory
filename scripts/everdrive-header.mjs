// BLUMEV-M: iNES 1.0 copies of the gift ROMs for the EverDrive SD card. The NES 2.0 originals (release/handover,
// the PC app, the older gifts) stay as they are. Same game bytes, only header bytes 7-15 change:
//   byte 6 kept (mapper 4 low nibble, battery bit for LEGEND), byte 7 = 0 (iNES 1.0, mapper high nibble 0),
//   byte 8 = 0 (iNES 1.0: 8 KiB PRG-RAM), bytes 9-15 = 0 (NTSC, no unofficial byte 10 flags).
// Why: the original N8 OS documents no NES 2.0 support, and its unofficial iNES byte 10 reading of LEGEND's
// NES 2.0 byte 10 ($70 = 8 KiB battery PRG-NVRAM) would mean "no PRG-RAM, bus conflicts". iNES 1.0 mapper 4 is
// read the same way by every loader (N8, N8 Pro: rev B MMC3, no submapper, 8 KiB PRG-RAM).
export const GIFT_ROMS = [
  { id: 'BLUM', file: 'BLUM.nes', sd: 'BLUM.nes', magic: 'BLUM', battery: false },
  { id: 'SEBRING', file: 'SEBRING.nes', sd: 'SEBRING.nes', magic: 'SBRG', battery: false },
  { id: 'LEGEND', file: 'LEGEND-OF-BLUM-SLICE.nes', sd: 'LEGEND.nes', magic: 'BLMZ', battery: true },
];

/** NES 2.0 (mapper 4, submapper 0, PRG-RAM or PRG-NVRAM 8 KiB) -> iNES 1.0, same PRG/CHR. Throws on anything else. */
export function ines1Copy(rom) {
  const h = rom.subarray(0, 16);
  if (h.toString('latin1', 0, 4) !== 'NES\x1a') throw new Error('not an iNES file');
  if ((h[7] & 0x0c) !== 0x08) throw new Error('not a NES 2.0 header');
  const mapper = (h[6] >> 4) | (h[7] & 0xf0) | ((h[8] & 0x0f) << 8);
  if (mapper !== 4 || h[8] >> 4 !== 0 || h[9] !== 0) throw new Error(`unexpected mapper ${mapper} / submapper / size msb`);
  const battery = (h[6] & 2) !== 0;
  if (h[10] !== (battery ? 0x70 : 0x07) || h[11] !== 0 || h[12] !== 0) throw new Error('unexpected RAM / timing bytes');
  if ((h[6] & 0x0d) !== 0) throw new Error('unexpected trainer / four-screen / mirroring bits');
  const out = Buffer.from(rom);
  out.fill(0, 7, 16);
  return out;
}

let table;
export function crc32(buf) {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
