# Art and sound assets

Every image and sound in the app, where it comes from and its licence. No Nintendo asset, logo, font, character or trade dress anywhere.

## ui-kit by Fred / Nova swarm, CC0

Source: `C:\DEV\CODEGOD\apps\NES-BLUM-FACTORY-ASSETS\ui-kit\` (BLUMA asset track, generated 2026-10-19 by the scripts in its `tools/`; licence CC0 1.0 per its `LICENCES.md`). Copied by BLUM-M1 on 2026-10-19 into `src/renderer/ui-kit/` (1x PNGs only; the @4x previews stay in the assets repo). The assets repo had no commit yet at copy time; every copied file was later checked byte-identical to assets commit `5ca541d` (BLUM-A1).

| Copied | Files | Used for |
|---|---|---|
| `widgets/*.png` (1x) + `widgets/manifest.json` | 9-slice frames (stone, gilded, inset), title bar, buttons, tabs, fields, checkbox, slider, progress, toasts, menu cursor arrow, press-start art | every window, button and control |
| `portraits/director-*.png` (64x64) | the 5 director portraits | hub stations, dialog boxes |
| `logo/logo.png`, `logo/splash-bonne-fete.png` | title logo, birthday splash (splash kept for M6) | title screen |
| `sounds/*.ogg` | cursor, select, back, error, success, coin, build-start, build-done blips | UI sounds |

Not copied: `cursor-hand` (a pointing glove; PLAN §9.4 asks for an original bud cursor), the kit's `tokens.css`/`kit.css` (the app keeps its own CSS with the kit palette snapped to SNES 15-bit steps, test M1-T2), the kit's font files (the same two OFL fonts come from `@fontsource`, see `THIRD_PARTY.md`), Silkscreen (not used).

## Drawn in this repo (own work, same licence as the app)

| File | What |
|---|---|
| `src/renderer/ui-kit/cursor-bud.png` | mouse cursor: a bud-shaped pointer, 12x16 art at 2x, drawn by BLUM-M1 |
| `src/renderer/BloomMark.tsx` | 9x9 flower monogram (M0) |
| `src/renderer/icons.tsx` | 16x16 pixel icons (save, load, undo, redo, play, build, export, settings, image, map, run, story, history, back, close) |
| `SeedPacket` in `src/renderer/ui.tsx` | the project "cartridge": an original seed-packet shape (no NES/SNES cart silhouette) |
| Typewriter blip in `src/renderer/sounds.ts` | WebAudio square wave, one pitch per director |
| `plus`, `tune`, `brush`, `flag` in `src/renderer/icons.tsx` | 16x16 pixel icons for the M4 editors |
| `HOPPER_FRAMES`, `FLYER_FRAMES`, `SHOOTER_FRAMES`, `SHOT_TILES` in `src/core/engine-data/art/builtin.ts` | built-in enemy drawings « sauteur », « volant », « cracheur » (16x16, 2 frames) and the two projectiles (8x8), drawn by BLUM-M4 |
| `buildBuiltinBoss` in `src/core/engine-data/builtin-chr.ts` | built-in boss « gros rampeur »: the M2 walker drawing scaled x2 (32x32) |

## sample-game by Fred / Nova swarm (BLUMA), original art

Source: `C:\DEV\CODEGOD\apps\NES-BLUM-FACTORY-ASSETS\sample-game\` at assets commit `b9574bf` (BLUM-A2): original pixel art written by code for this project, no Nintendo character, logo or font (its `README.md`, « Licence et origine »). Imported by BLUM-M3 on 2026-10-19 with `scripts/import-sample-art.mjs` (reads the assets repo, never writes it) into `src/core/engine-data/art/placeholder-art.ts`: CHR bytes + metasprite/metatile tables re-expressed in the converter contract.

| Imported | Used for |
|---|---|
| `gfx/hero/blum.json` + `chr/hero-bank{0,1,2}.chr` | the hero of every new project (`graphics/heros-blum`) |
| `gfx/common/common.json` + `chr/common.chr` | items and projectiles library (`graphics/objets`) |
| `gfx/tilesets/w{1..4}.json` + `chr/bg-w{1..4}.chr` | 4 world tilesets (`graphics/tuiles-*`, `tilesets/tuiles-*`; grab walls fall back to solid, water to empty, as the sample's `fallback`) |
| `gfx/enemies/w{1..4}.json` + `chr/enemies-w{1..4}.chr` | 4 enemy sheets, 2-4 enemies each (`graphics/ennemis-*`) |
| `gfx/bosses/*.json` + `chr/boss-*.chr` | 5 bosses, all 32 px wide (`graphics/boss-*`) |

Not imported: the sample's HUD font (the engine keeps its own font bank from M2), title/ending screen art (the ROM keeps its text title and text ending, M6 gap), the indexed PNG sheets (previews are re-rendered from the CHR with the master palette).

## M6: soundtrack, stage maps, sample game BLUM, app icon

| Source | Imported by | Into | Used for |
|---|---|---|---|
| `NES-BLUM-FACTORY-ASSETS\music\` @ `3c17713` (BLUM-A4, original soundtrack, FamiStudio text sources + their ca65 export) | `scripts/import-sample-music.mjs` | `engine/audio/music.s`, `sfx.s`, `src/*.txt`, `src/core/engine-data/audio-library.ts` | the built-in library: 11 songs (title, 4 world themes, boss, final, clear, game over, ending « Bonne fête Blum », press start) and 10 SFX; the engine plays jump, pickup, stomp, hurt, checkpoint (oneup), boss hit, plus the boss song, clear and game-over jingles and the ending song |
| `NES-BLUM-FACTORY-ASSETS\sample-game\levels\` @ `385a930` (BLUM-A3, 9 hand-drawn stage maps) | `scripts/import-sample-game.mjs` | `src/core/sample/blum-levels.ts` | TABLEAU's proposals in the sample game replay (items dropped: no item entities in the engine yet) |
| `NES-BLUM-FACTORY-ASSETS\sample-game\` design doc, `actors.json`, `palettes.json`, `physics.json` | hand-authored in `src/core/sample/blum.ts` | the sample's PLUME, CHROMA, REBOND proposals | story, palettes, physics, 8 enemies, 5 boss fights in the DSL |
| `scripts/import-sample-art.mjs` re-run on `385a930` | | `placeholder-art.ts` | same CHR bytes; the tileset behaviours now apply the maps' whole floor fallback (slippery walls and crates become solid, M6 fix) |
| own work | `scripts/make-icon.mjs` | `build-res/icon.ico`, `icon.png` | the app icon: the BloomMark flower on a navy tile, 16x16 pixels scaled |

The sample project itself (`resources/samples/BLUM.blum`) is made by `scripts/make-sample.mjs` (the replay) and holds no other asset than the placeholder art above.

## SEBRING art and music by Fred / Nova swarm (BLUMR-A1), original

Source: `C:\DEV\CODEGOD\apps\NES-BLUM-FACTORY-ASSETS\sebring\` at assets commit `eb84ef4` (+ `2a31dfd`, `.gitattributes` only) (BLUMR-A1, muse-ui, 2026-10-21):
original pixel art placed by code and an original FamiStudio soundtrack, no third-party art, no logo, no brand, no
emoji, no AI-generated image (its `README.md`). Imported by BLUMR-M2 on 2026-10-21 with `scripts/import-sebring-kit.mjs` into `racer/kit/` (reads the kit, never writes it).

| Imported | Used for | Origin |
|---|---|---|
| `engine/chr/sprites.chr` + `gfx/sprites/sprites.json` | player convertible (8 poses), Blum driver, traffic at 3 sizes, roadside props, fireworks / smoke / flag effects | drawn by code (`tools/gen_car.py`, `gen_traffic.py`) |
| `engine/chr/backdrop-{0..4}.chr`, `engine/stages/stage{0..4}.bin`, `gfx/backdrops/*.png` | the 5 Montréal horizons (Galeries d'Anjou, Métropolitaine, Stade olympique, mont Royal, centre-ville), their nametables, palettes and stage cards | drawn by code (`tools/gen_backdrops.py`), shapes only, no sign text |
| `engine/screens.bin`, `engine/chr/{title,ending}-r{0,1}.chr`, `engine/*-palette.bin` | title, ending « BONNE FÊTE BLUM ! », game over, credits | drawn by code (`tools/gen_screens.py`); big letters = the ROM font scaled |
| `palettes.json` | 5 palette sets dusk to night, sprite palettes (driver = BLUM hero palette) | `tools/sebpal.py` |
| `music/export/music.s`, `sfx.s` (sources `music/src/*.txt`) | 7 songs (title, 3 invented radio stations, clear, game over, ending birthday song) and 10 SFX | composed in `music/tools/songs.py`, `sfx.py`; original, nothing transcribed |

Not imported: the preview PNGs and mocks (`preview/`), the Python tools (dev only), the kit's copies of the ROM
font snapshot (`tools/romfont.json`, read from the app's `font.ts` when present).

The engine reads only `racer/kit/` (`src/core/racer/build-racer.ts` `loadKit`). BLUMR-M2 changes on top of the kit, in code: the stage cards get each track's own number and names (`kitCard`), the credits line « DESSINS ET MUSIQUE : BLUMR-A1 » becomes « DESSINS ET MUSIQUE ORIGINAUX » (`CREDITS_ART_LINE`), snow flakes reuse the second smoke tile. The app's « Jeu d'exemple SEBRING » (`resources/samples/SEBRING/`) is the release ROM + the 5 tracks, written by `npm run racer:handover`.

## Converter fixtures and examples (own work)

`tests/fixtures/img/*.png` (photo-like landscape, line drawing, "Pousse" character sheet, 3 enemies) are drawn from code by `scripts/make-fixture-images.mjs` (BLUM-M3). Two of them are shipped as CHROMA examples: `src/renderer/chroma/exemple-paysage.png` and `exemple-personnage.png`.

## Gaps (for later milestones)

- Portraits have one expression each; PLAN §9.5 asks for 3 (neutral, talking, happy). Placeholder: the same portrait for all three.
- The bud cursor has no 2-frame idle animation (CSS cursors cannot animate).
- `sample-game\` did not exist at M1; imported in M3 (art) and M6 (maps, music).
