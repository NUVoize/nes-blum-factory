// jsnes wrapper shared by the in-app emulator (renderer) and the headless harness (tests, build check).
// No Node or DOM imports here. jsnes palette is replaced by our master palette (PLAN §6, W0 P0-2.5).
// jsnes is injected: its ESM build (src/) works for Vite and vitest, but its UMD build exports nothing
// to require() and its typings do not resolve under nodenext, so core never imports it directly.
import { NES_PALETTE } from '../nes/palette.js';

/** The part of jsnes 2.x we use (Apache-2.0, https://github.com/bfirsh/jsnes). */
export interface JsnesNes {
  frame(): void;
  loadROM(data: Uint8Array): void;
  buttonDown(controller: 1 | 2, button: number): void;
  buttonUp(controller: 1 | 2, button: number): void;
  toJSON(): unknown;
  fromJSON(data: unknown): void;
}
export interface JsnesModule {
  NES: new (opts: {
    onFrame?: (buffer: Uint32Array) => void;
    onAudioSample?: ((left: number, right: number) => void) | null;
    emulateSound?: boolean;
    sampleRate?: number;
  }) => JsnesNes;
}

/** jsnes Controller button numbers. */
export const BUTTONS = { A: 0, B: 1, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7 } as const;
export type ButtonName = keyof typeof BUTTONS;
export const BUTTON_NAMES = Object.keys(BUTTONS) as ButtonName[];

/** Our master palette in jsnes' 0xBBGGRR layout. */
export function jsnesPaletteTable(): Uint32Array {
  return Uint32Array.from(NES_PALETTE, (hex) => {
    const v = parseInt(hex.slice(1), 16);
    const r = (v >> 16) & 0xff;
    const g = (v >> 8) & 0xff;
    const b = v & 0xff;
    return (b << 16) | (g << 8) | r;
  });
}

// jsnes internals we rely on (stable across 2.x, typed loosely on purpose).
interface JsnesPpu {
  clipToTvSize: boolean;
  palTable: { curTable: Uint32Array; currentEmph: number; makeTables(): void; setEmphasis(e: number): void };
  spriteMem: Uint8Array;
  vramMem: Uint8Array;
  vramMirrorTable: Uint16Array;
  scanline: number;
}
interface JsnesInternals {
  cpu: { mem: Uint8Array };
  ppu: JsnesPpu;
  mmap: { write(address: number, value: number): void } | null;
}

export interface SessionOptions {
  onAudioSample?: (left: number, right: number) => void;
  sampleRate?: number;
}

export class NesSession {
  readonly nes: JsnesNes;
  /** Last completed frame, 256×240, jsnes 0xBBGGRR values. */
  frame = new Uint32Array(256 * 240);
  frames = 0;
  private rom: Uint8Array | null = null;
  private readonly held = new Set<ButtonName>();

  constructor(jsnes: JsnesModule, opts: SessionOptions = {}) {
    this.nes = new jsnes.NES({
      onFrame: (buf: Uint32Array) => {
        this.frame.set(buf);
      },
      onAudioSample: opts.onAudioSample ?? null,
      emulateSound: !!opts.onAudioSample,
      sampleRate: opts.sampleRate ?? 48000,
    });
  }

  private get internals(): JsnesInternals {
    return this.nes as unknown as JsnesInternals;
  }

  /** Master palette + full 256×240 frame (jsnes crops 8 px per edge by default). */
  applyPalette(): void {
    this.internals.ppu.clipToTvSize = false;
    const pt = this.internals.ppu.palTable;
    pt.curTable = jsnesPaletteTable();
    pt.makeTables();
    pt.currentEmph = -1;
    pt.setEmphasis(0);
  }

  /** PPU pattern memory as the mapper banked it in ($0000-$1FFF): what the PPU draws tiles from. */
  patternBytes(addr: number, len: number): Uint8Array {
    return this.internals.ppu.vramMem.slice(addr, addr + len);
  }

  load(rom: Uint8Array): void {
    this.rom = rom;
    this.nes.loadROM(rom);
    this.applyPalette();
    this.frames = 0;
    this.held.clear();
  }

  reset(): void {
    if (!this.rom) return;
    this.load(this.rom);
  }

  step(): void {
    this.nes.frame();
    this.frames++;
  }

  setButtons(buttons: Iterable<ButtonName>): void {
    const want = new Set(buttons);
    for (const b of BUTTON_NAMES) {
      if (want.has(b) && !this.held.has(b)) this.nes.buttonDown(1, BUTTONS[b]);
      if (!want.has(b) && this.held.has(b)) this.nes.buttonUp(1, BUTTONS[b]);
    }
    this.held.clear();
    for (const b of want) this.held.add(b);
  }

  /** CPU-visible RAM ($0000-$07FF) and cartridge WRAM ($6000-$7FFF). */
  get mem(): Uint8Array {
    return this.internals.cpu.mem;
  }

  peek(addr: number): number {
    return this.mem[addr]!;
  }

  poke(addr: number, value: number): void {
    this.mem[addr] = value & 0xff;
  }

  get oam(): Uint8Array {
    return this.internals.ppu.spriteMem;
  }

  nametableByte(addr: number): number {
    const ppu = this.internals.ppu;
    return ppu.vramMem[ppu.vramMirrorTable[addr]!]!;
  }

  /** jsnes scanline counter converted to the visible line (0-239; negative/>239 = vblank). */
  get scanline(): number {
    return this.internals.ppu.scanline - 21;
  }

  /** Wrap mapper writes (bank register read-back in tests). Returns an unhook function. */
  onMapperWrite(fn: (address: number, value: number) => void): () => void {
    const mmap = this.internals.mmap;
    if (!mmap) throw new Error('no ROM loaded');
    const orig = mmap.write.bind(mmap);
    mmap.write = (address: number, value: number) => {
      if (address >= 0x6000) fn(address, value);
      orig(address, value);
    };
    return () => {
      mmap.write = orig;
    };
  }

  saveState(): string {
    return JSON.stringify(this.nes.toJSON());
  }

  loadState(json: string): void {
    this.nes.fromJSON(JSON.parse(json));
    // The state carries the pad as it was when saved; `held` is ours. Release everything on both sides
    // so the next setButtons presses exactly what is wanted (a held button was never re-pressed, M6).
    for (const b of BUTTON_NAMES) this.nes.buttonUp(1, BUTTONS[b]);
    this.held.clear();
    this.applyPalette();
  }
}
