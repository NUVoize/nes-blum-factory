# Rows for NES-BLUM-FACTORY `ASSETS.md` (to paste by BLUMR-M2 when the kit is imported)

## SEBRING art and music by Fred / Nova swarm (BLUMR-A1), original

Source: `C:\DEV\CODEGOD\apps\NES-BLUM-FACTORY-ASSETS\sebring\` at assets commit `<sha>` (BLUMR-A1, muse-ui, 2026-10-21):
original pixel art placed by code and an original FamiStudio soundtrack, no third-party art, no logo, no brand, no
emoji, no AI-generated image (its `README.md`). Imported by BLUMR-M2 on `<date>` with `<script>` (reads the kit, never writes it).

| Imported | Used for | Origin |
|---|---|---|
| `engine/chr/sprites.chr` + `gfx/sprites/sprites.json` | player convertible (8 poses), Blum driver, traffic at 3 sizes, roadside props, fireworks / smoke / flag effects | drawn by code (`tools/gen_car.py`, `gen_traffic.py`) |
| `engine/chr/backdrop-{0..4}.chr`, `engine/stages/stage{0..4}.bin`, `gfx/backdrops/*.png` | the 5 Montréal horizons (Galeries d'Anjou, Métropolitaine, Stade olympique, mont Royal, centre-ville), their nametables, palettes and stage cards | drawn by code (`tools/gen_backdrops.py`), shapes only, no sign text |
| `engine/screens.bin`, `engine/chr/{title,ending}-r{0,1}.chr`, `engine/*-palette.bin` | title, ending « BONNE FÊTE BLUM ! », game over, credits | drawn by code (`tools/gen_screens.py`); big letters = the ROM font scaled |
| `palettes.json` | 5 palette sets dusk to night, sprite palettes (driver = BLUM hero palette) | `tools/sebpal.py` |
| `music/export/music.s`, `sfx.s` (sources `music/src/*.txt`) | 7 songs (title, 3 invented radio stations, clear, game over, ending birthday song) and 10 SFX | composed in `music/tools/songs.py`, `sfx.py`; original, nothing transcribed |

Not imported: the preview PNGs and mocks (`preview/`), the Python tools (dev only), the kit's copies of the ROM
font snapshot (`tools/romfont.json`, read from the app's `font.ts` when present).
