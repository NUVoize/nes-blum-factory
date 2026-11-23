# SEBRING racer engine (BLUM game 2)

Plan: `docs/RACER-PLAN.md` (section 9 = M1 as built). This folder never touches `engine/` (BLUM): the
FamiStudio engine and BLUM's songs/effects (placeholder sound) are copied from `engine/audio` at build time.

| Path | What |
|---|---|
| `src/sebring.s` | the game, pure ca65: road kernel (from the spike), NMI/IRQ, title, stage card, race (drive, crash, checkpoint, time over, continue, pause, radio), ending, credits, game over, probe |
| `cfg/sebring.cfg` | ld65 map: BLUM cartridge (MMC3, 256 KiB PRG, 128 KiB CHR, 8 KiB PRG-RAM); banks 0-1 road, 2-6 stages, 7 text screens, 29 sound (R7), 30-31 fixed |
| `tracks/0N-*.json` | the 5 stages (placeholder geometry along the real route), schema + validator `src/core/racer/track.ts` |
| `spike/` | BLUMR-PLAN engine spike, kept buildable as the kernel timing reference |

Generated (never edited by hand): `src/core/racer/build-racer.ts` writes `gen/` (CHR, stage banks, text
screens, tables, `tracks.s`, `racer.inc`) from `racer-assets.ts` (placeholder art drawn in code) and the tracks.

Build defines (tests only): `START_STAGE`, `TIME_OVERRIDE` (seconds per stage), `TEST_CHEATS` ($7F40 bit 0
freezes the clock, bit 1 jumps to the next checkpoint).

Tests: `npm test` (`tests/racer-m1.test.ts`: tracks, validator, tables, assets, probe contract),
`npm run test:engine` (`tests/engine/racer-m1.test.ts`, jsnes bots), `npm run test:racer-mesen`
(`scripts/racer-mesen.mjs` + `tests/mesen/racer-m1.lua`: hblank timing + same outcome as jsnes).
