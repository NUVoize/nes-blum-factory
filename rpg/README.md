# THE LEGEND OF BLUM RPG engine (BLUM game 3)

Plan: `docs/RPG-PLAN.md` (section 12 = what BLUMZ-M1 built). This folder never touches `engine/` (BLUM) or
`racer/` (SEBRING); it only reuses BLUM's FamiStudio engine file (`engine/audio`, copied at build time, never
edited).

| Path | What |
|---|---|
| `src/legend.s` | the engine (ca65, MMC3): constants, RAM map, reset, NMI, main loop; includes the modules below and the generated data |
| `src/core.s` | VRAM buffer, pad, banks, flags and items, numbers, palettes and fades, the screen loader (fade out, banks, stream, fade in) |
| `src/map.s` | walking, collision, talking (also across a counter), touching, screen edges, the slide (horizontal and vertical), sprites |
| `src/dialog.s` | windows over the map, French text pages, typewriter, choices (Oui / Non) |
| `src/vm.s` | the event script VM (the story is bytecode in the text bank) |
| `src/menu.s` | title, cards, class choice, the Start menu, the battery save (2 slots + checksum) |
| `src/battle.s` | turn-based battles: Attaque, Pouvoir de classe, Objet, Défense, Fuite; enemy moves attack, multi, warn + blast, heal, stun |
| `src/probe.s` | the test probe at $7F00 |
| `cfg/legend.cfg` | ld65 map: BLUM's cartridge + battery (MMC3, 256 KiB PRG, 128 KiB CHR, 8 KiB battery PRG-RAM) |
| `legend/*.json` | the game's content: `game`, `areas` (screens, exits, entities), `scripts` (events + French text), `battles`, `classes`, `items`, `puzzles`, `cards`; `route.json` = the test bot's route |
| `kit/` | the BLUMZ-A1 art + music kit, imported by `npm run legend:kit` (do not edit by hand) |
| `spike/` | the BLUMZ-PLAN spike, kept buildable (`npm run test:rpg-mesen`) |

Build: `src/core/rpg/legend/build.ts` (data -> validator -> compiler -> `gen/` -> ca65 + ld65). The compiler
(`compile.ts`) is the only place that knows the binary layout; the validator (`validate.ts`) refuses a softlock,
a class-gated puzzle, a battle one class cannot win (`sim.ts`), a critical item with 0 or 2 sources, text that
does not fit or uses a missing glyph, private data and undeclared speaking names.

Tests: `npm test` (`tests/legend-data.test.ts`: real data 0 errors + fixtures that must fail), `npm run
test:engine` (`tests/engine/legend-slice.test.ts`: the bot plays the whole slice with each class in jsnes, save
and Continuer, dirty boot, stun and heal), `npm run test:legend-mesen` (same inputs replayed in Mesen frame by
frame + the random soak trace), `npm run legend:soak` (10 minutes random + the 5 classes with random bursts).
ROM for Fred: `npm run legend:handover` -> `release/handover/LEGEND-OF-BLUM-SLICE.nes` + fiche cartouche (not in
the gift package).
