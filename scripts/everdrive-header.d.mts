export interface GiftRom { id: string; file: string; sd: string; magic: string; battery: boolean }
export const GIFT_ROMS: GiftRom[];
export function ines1Copy(rom: Buffer): Buffer;
export function crc32(buf: Uint8Array): number;
