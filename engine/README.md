# NES engine (ENGINE_DATA_VERSION 1)

Data-driven side-scrolling platformer for MMC3 (mapper 4), 256 KiB PRG, 128 KiB CHR, 8 KiB PRG-RAM.
Directors never edit these files: they write project JSON, and `src/core/engine-data/emit.ts` turns it
into `gen/` at build time (`gen/` only exists in the build folder, never here).

| Path | What | Origin |
|---|---|---|
| `cfg/blum_mmc3.cfg` | ld65 memory map (PLAN §5.3) | nesdoug 33_MMC3 cfg, bank model kept |
| `src/crt0.s` | reset, header, WRAM init, tuning guard, probe, FamiStudio init | nesdoug 33_MMC3 crt0 (MIT), modified |
| `src/game.c`, `src/engine.h` | the game: title, stage, player, enemies, HUD, probe | ours |
| `lib/mmc3_code.asm`, `lib/mmc3.h` | shadowed bank switching, IRQ command parser | nesdoug (MIT), `A12_INVERT = 0` |
| `lib/neslib.s`, `lib/neslib.h` | NMI, PPU/OAM/pads; NMI changed for the split, lag and sound | Shiru/nesdoug (public domain) |
| `lib/nesdoug.s`, `lib/nesdoug.h` | VRAM buffer helpers | nesdoug.lib 1.3 (MIT) |
| `audio/famistudio_ca65.s`, `audio/NoteTables/` | FamiStudio sound engine 4.5.0, unmodified | BleuBleu (notice kept) |
| `audio/music.s`, `audio/sfx.s` | our songs and SFX (generated from `audio/src/*.txt`) | ours |

Hardware rules (PLAN §5.3) are tested: reset/vectors/bank code in $E000-$FFFF, `$A001 = $80` at
reset, RAM/WRAM never trusted, every `$8000/$8001` write shadowed (bank_swap_common, irq_parser,
nmi_sound only), MMC3 IRQ latch never 0, HUD split timed on Mesen (`npm run test:mesen`).

Build flags (gen/config.inc): `NBF_TEST_BANKSTRESS` = bank-switch stress loop for M2-T16, test builds only.
