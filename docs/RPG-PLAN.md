# THE LEGEND OF BLUM (BLUM game 3): RPG engine plan

Version 1, 2026-10-21 (step BLUMZ-PLAN, agent Atlas). Inputs: `runs\prompts\BLUMZ-BRIEF.md` (Fred, 2026-10-21 05:15), the game bible `THE_LEGEND_OF_BLUM_GAME_BIBLE_DRAFT_v1.md` (content pack, working copy in `NES-BLUM-FACTORY-ASSETS\legend\_source-v1\`, never shipped), `docs/PLAN.md`, `docs/RACER-PLAN.md`, `RUNNER-BLUM.md`, the engine and racer code and their tests.

Markers: **[DÉCISION FRED]** = choisi au nom de Fred, à confirmer (liste complète en section 10). **[U]** = pas encore vérifié, la première étape qui y touche le vérifie.

---

## 0. Résumé pour Fred

- **À dire clairement :** la bible dit « le builder fonctionne déjà, aucun développement demandé ». Ce n'est pas vrai pour ce jeu. L'usine sait faire deux genres : le jeu de plateforme BLUM et le jeu de course SEBRING. Elle ne sait pas encore faire un RPG (carte vue de dessus, dialogues, inventaire, sauvegarde, combats au tour par tour). Il faut un troisième moteur dans NES BLUM FACTORY, construit exactement comme SEBRING : un essai technique d'abord (fait aujourd'hui), puis un moteur complet piloté par des fichiers de données, des robots de test, et les deux émulateurs (Mesen et celui de l'app).
- **L'essai technique marche.** Une ROM d'essai tourne : Blum marche dans l'appartement de Madame Bélanger, se cogne aux murs, aux meubles et à elle ; il lui parle et la fenêtre de dialogue affiche « Salut Blum ! Ça va, garçon ? », « Garde-la à côté de toi. », « Très bien, élève ! » avec tous les accents (é è à ç ô, majuscules et minuscules) ; il reçoit la clochette ; il sort par la droite, l'écran glisse vers la cour comme dans les jeux d'aventure de l'époque ; il touche la Terreur des Crayons, le combat commence (Attaque / Pouvoir / Objet / Défense), il gagne avec le Coup de cartable du Guerrier, puis il repart. Même résultat image par image dans Mesen et dans l'émulateur de l'app, aucun ralentissement, et il reste les trois quarts du temps de calcul de chaque image.
- **Même cartouche que BLUM et SEBRING** (MMC3, 8 Ko de RAM), mêmes outils (cc65, FamiStudio). BLUM.nes et SEBRING.nes ne sont pas touchés, tous leurs tests restent verts.
- **Le jeu complet tient dans la cartouche** avec de la marge : environ 20 des 32 banques de programme et 85 des 128 Ko de graphismes, grâce à peu de cartes réutilisées d'une année à l'autre (Chénier sert 7 ans, Jean-Eudes 5 ans), des changements de couleurs et des décors de combat partagés.
- **Proposition de durée :** environ 2 heures pour tout le jeu (CH00 à CH06), 7 chapitres courts, sans combats aléatoires (les ennemis sont visibles sur la carte), un niveau gagné par chapitre. **[DÉCISION FRED]**
- **Prochaine étape :** une « tranche verticale » jouable : le prologue chez Madame Bélanger (choix de classe, Magdi, Nivoix, la clochette, un petit combat) + Chénier maternelle et 1re année (Terreur des Crayons, Marie-Claude et sa dictée mortelle). Tu la joues 15 à 20 minutes et tu valides avant qu'on fabrique le reste.
- **Sauvegarde :** je propose une vraie sauvegarde à pile (comme les vrais RPG de l'époque). Il faut savoir si la cartouche de Blum a une pile. Sinon : un code de chapitre à noter (6 lettres). **[DÉCISION FRED]**
- **Ce qu'il me faut de toi** (section 10) : le titre final, pile oui/non, la durée, quelles « propositions » de la bible on garde, où apparaît Mainguy, qui est Bernard, les photos de Bordeaux et de Saint-Pétersbourg (ou on invente).
- **Vie privée :** aucune adresse, aucun numéro de maison, aucun code postal, aucun lien de carte nulle part (jeu, app, guide, générique). La rue d'Anjou est une rue simplifiée sans nom. Les photos servent de modèles seulement, tout est redessiné en pixel art.

---

## 1. What the spike proved (BLUMZ-PLAN step 2)

ROM: `rpg/spike/` built by `src/core/rpg/build-spike.ts` (world.json -> `gen/world.inc` + `gen/world-data.inc` + `gen/chr.bin`, then ca65 + ld65 from the pinned cc65 toolchain), header `4E 45 53 1A 10 10 40 08 00 00 07` (`DEFAULT_CARTRIDGE`), 393 232 bytes. Pure ca65 like the SEBRING spike. Run: `npm run test:rpg-mesen` (holds `.tmp/gate.lock`), jsnes twin `tests/engine/rpg-spike.test.ts` in `npm run test:engine`.

Route (bot, identical decisions in both emulators because input depends only on the probe): walk up into Madame Bélanger, talk (3 pages), receive `ITEM_CLOCHE` (flag), walk down to the exit row, walk right off the screen, scroll transition, walk right into the crayon enemy, battle (Pouvoir de classe first, then Attaque x3), win, back on the map, walk on.

| Check | Mesen 2 (testrunner) | jsnes (app emulator) |
|---|---|---|
| 1 500 frames, whole route (dialogue, transition, battle won, walking on) | done, 2.9 s | done |
| State changes (state/room/dialogue page/battle sub-state/turn/cursor) | 40, same frames as jsnes | 40 |
| Lag frames | 0 | 0 |
| Free CPU, worst frame | 22 008 cycles (74 % idle) | 22 008 |
| VRAM bytes per NMI, peak | 70 (cap 80) | 70 |
| Shots (13: start, walk, dialogue x3, after dialogue, mid-scroll, room 2, battle intro/menu/power/win, after battle) | 13/13, same frames | 13/13 |
| Dialogue + battle text readable (every glyph of 7 lines, palette-agnostic check on Mesen PNGs) | pass | pass (exact colours) |
| Final probe (state, room, px, py, flags, xp, turn, HP, nametable, VRAM peak) | identical | identical |
| Mesen processes left | 0 | - |

Shots: `runs\reports\BLUMZ-PLAN-mesen-*.png`, `BLUMZ-PLAN-jsnes-*.png`, side by side in `BLUMZ-PLAN-spike-contact-sheet.png`; numbers in `BLUMZ-PLAN-spike-report.json`.

Spike size: code 2 670 B + data 2 449 B (2 rooms, 12 text pages, 1 KiB battle screen) + startup 396 B, all in the fixed banks. CHR: 150 BG tiles (backdrop 1 + font 103 + window frame 9 + map and battle-enemy tiles 37 after dedupe, `spike-art.ts`), 38 sprite tiles.

Tests added: `tests/rpg-spike-world.test.ts` (unit, 4: compiler output, font with lower case + accents, French refusals: long line, unknown glyph, unknown tile, one-way exit, start in a wall, battle text vs numbers), `tests/engine/rpg-spike.test.ts` (engine, 7: cartridge, route + 0 lag + VRAM peak + free CPU, collision with walls and the NPC, dialogue glyphs on screen page by page, transition picture half indoor / half outdoor, battle text + outcome, dirty boot), `scripts/rpg-mesen.mjs` (Mesen, 8 checks R1-R8).

Known limits of the spike (on purpose): one NPC, one battle, 2 rooms with horizontal exits only, no menu, no save, fixed damage, text pages padded to 56 bytes (no compression), no music. Known font alias: BLUM's capital `Ô` (7-row cell) has the same pixels as the new lower-case `ô`; harmless, documented in the unit test.

---

## 2. Engine design

### 2.1 Where the RPG lives

```
rpg/
  spike/                 engine spike (this step): cfg/spike.cfg, src/spike.s (pure ca65), data/world.json.
                         Kept buildable as the reference for the VRAM buffer, window and transition code.
  cfg/legend_mmc3.cfg    (M1) bank model of section 3
  src/crt0.s             (M1) fork of engine/src/crt0.s: reset, MMC3, WRAM, probe, FamiStudio init
  src/core.s             (M1) asm: NMI + VRAM buffer, metatile row/column emit, collision, metasprites,
                         text typewriter, window draw/restore (ported from the spike)
  src/*.c, legend.h      (M1) cc65 C: state machine, map scripts, menus, battle logic, save
  lib/                   forks of the shared libs only if the NMI must differ (header says what changed)
  legend/                (M1) the game's data: section 5 (JSON, French text)
src/core/rpg/
  spike-*.ts, build-spike.ts   spike compiler + build (this step)
  schema.ts, compile/*.ts      (M1) zod schemas + one compiler per data kind -> gen/*.s (one bank each)
  validate.ts                  (M1) section 6
  run.ts                       (M1) probe, bots per class, shot list (jsnes + Mesen share it)
tests/rpg-*.test.ts, tests/engine/rpg-*.test.ts, tests/mesen/rpg-*.lua, scripts/rpg-*.mjs
```

Shared and never edited: `engine/lib/*`, `engine/audio/famistudio_ca65.s`, the toolchain, `headerForCartridge`, CHR codec, PNG codec, `RomHarness`, gate lock, `fetch-mesen.mjs`, the music pipeline (`scripts/music/`), export/fiche cartouche, `gift.mjs`. Same rules as the racer (RACER-PLAN 2.1).

**C or asm.** Unlike the racer (raster kernel every line), an RPG frame is light: the spike used 26 % of the CPU in its busiest frame, in asm. Rule for M1: per-frame or per-byte work in asm (NMI, VRAM buffer, row/column emit, collision, OAM, typewriter, decompression); everything event-driven in cc65 C (state machine, scripts, menus, battle turns, save). C is easier for the next agents to extend with content.

### 2.2 One frame (as in the spike)

```
NMI     if the main thread finished its frame: VRAM buffer -> PPU (<= 80 bytes), OAM DMA, scroll values
        for the next frame (double buffered); else count a lag frame. Then scroll + PPUCTRL, FamiStudio.
main    pad, state update (writes the VRAM buffer, never the PPU), OAM, probe, idle (counted).
```

The main thread never writes the PPU. Every nametable change goes through the buffer `[hi][lo][len][bytes]...[$FF]`, at most 80 payload bytes per frame (2 metatile rows = 64 + headers). Measured NMI cost at 70 bytes: about 1 700 cycles of the 2 270 of vblank, OAM DMA included; FamiStudio runs after the PPU part, outside vblank time pressure.

### 2.3 Maps

- Screen = 16 x 15 metatiles of 16 x 16 px (240 bytes), full 256 x 240 playfield, **no permanent HUD on the map** (HP shows in the menu and in battles): no IRQ split needed while walking or scrolling. **[DÉCISION FRED]** (alternative: a 2-row status bar with an MMC3 IRQ split, costs ~1 day.)
- Area = grid of screens (for example Chénier: 4 x 3). Each area has one metatile set (<= 64 metatiles), one BG CHR bank (R1, 128 tiles) and one palette set (4 BG + 4 sprite palettes). All screens of an area share them, so an edge scroll never changes palettes or tiles.
- Metatile record: 4 tile indices + 1 attribute byte: bits 0-1 palette, bit 2 solid, bit 3 counter (talk across, like a teacher's desk), bit 4 trigger (step event), bit 5 water/hole (blocks, reserved), bits 6-7 free.
- **Edge transitions** (Zelda-like slide): left/right as in the spike (vertical mirroring, next screen streamed into the other nametable in 16 frames, then X scroll 4 px/frame for 64 frames, Blum carried 232 px). Up/down: MMC3 mirroring switched to horizontal (`$A000 = 1`) at the start of the transition, next screen streamed into the other nametable, Y scroll 4 px/frame over 60 frames (240 px; the 240-line nametable means Y wraps at 240, handled by using the coarse-Y 0-29 rows only), mirroring back after. [U] M1 verifies the vertical slide on Mesen (the spike only did horizontal).
- **Door/stair transitions** (between areas: house -> street, street -> school): palette fade to black (4 frames), new CHR bank + palettes + screen streamed (16 frames), fade in. No mid-frame tricks.
- Storage: raw 240 bytes per screen. Whole game about 60 screens = 14 KiB raw; no compression needed (optional 2:1 RLE later if a chapter bank overflows).

### 2.4 Collision and entities

- Feet hitbox 10 x 8 px (x+3..x+12, y+8..y+15), 4 corners against the metatile solid bit, as in the spike. Movement 1 px/frame (walk), 4 directions, no diagonal.
- Entities per screen: up to 6 (NPCs, objects, visible enemies, signs as metatiles). Sprite budget: 16 px wide metasprites, so at most 4 on one line with Blum (8 hardware sprites); the validator refuses a screen with more than 3 entities on the same 16-px band; OAM order cycled each frame (BLUM's cycling) so an overflow flickers instead of hiding.
- NPCs can be static or follow a short loop path (data: list of steps). Talking = A with the point in front of Blum inside the NPC box (spike `try_talk`).
- Enemies are **visible on the map** (touch = battle), no random encounters: the game stays short and every fight is a written gag. **[DÉCISION FRED]** A beaten enemy sets its flag and disappears.

### 2.5 Dialogue window and text

- Window 30 x 6 tiles at the top or bottom (opposite to Blum), 2 lines of 28 characters per page, typewriter 2 characters per frame, A = next page, B = finish the page at once. Speaker name on the first line ("Madame Bélanger :") as in the spike, optional portrait later (bonus).
- Window open = 3 frames of box rows + 1 frame of attributes; close = the room rows redrawn from the map data (no screen copy in RAM needed). Sprites behind the window are hidden.
- Choices: `Oui / Non` and up to 4 options (class choice, save) with a cursor sprite.
- Font: BLUM's capitals, digits and punctuation (`src/core/engine-data/art/font.ts`, unchanged) + new lower case a-z and é è ê ë à â ç î ï ô û ù ü (8-row cell, descenders), 103 glyphs, `src/core/rpg/spike-art.ts`. Québec typography: space before `! ? : ;`, « » quotes, apostrophes folded to `'`.
- Text encoding (full game): 1 byte per glyph (< $70), control codes ($F0-$FF: new line, new page, wait, player name, item name, choice), and DTE (one byte = a frequent pair of letters, $70-$EF = 128 pairs chosen per chapter by the compiler). Expected gain on French text: 30-40 % [U].

### 2.6 Menu (Start)

`Objets / Classe / Sauvegarder` (+ `Statut` line on top: PV, niveau, chapitre). Drawn as windows over the map (same draw/restore code as dialogue).
- Objets: list of owned items, name + 1-line description + the current hint for the open puzzle it serves. Puzzle items are **never used from the menu**: facing an obstacle and pressing A asks « Utiliser la clochette ? Oui / Non » if Blum owns a matching item. One input path, no item-on-target fiddling, no wrong-item dead ends.
- Classe: the class name, its 3 tiers of power (unlocked ones named, locked ones `???`), one gag line.
- Sauvegarder: battery save (section 2.8) or the chapter code if no battery.

### 2.7 Battles

- Screen drawn in the off-screen nametable (spike): message window top, enemy art in the middle (BG tiles, its own CHR bank R1 + battle palette), Blum on the right (sprite, era + class pose), menu + status windows bottom.
- 1 to 3 enemies (bosses usually alone or with summons). Commands: **Attaque**, **Pouvoir** (class power, costs Énergie, refilled at each save point/chapter), **Objet** (consumables only: collation, jus, etc.; quest items are not here), **Défense** (halves damage, some mechanics require it), **Fuite** (normal enemies only, never bosses).
- Allies: Magdi, Nivoix, Maxi, Paul, Mainguy appear as one-shot « interventions » (a battle item that calls a friend: heal, distract, a joke that skips the enemy turn). Bible: friends always on Blum's side, never playable heroes: keeps one hero sprite set.
- Formula: damage = power + level x 2 - enemy defence, minimum 1, ±1 variation from an 8-bit LFSR seeded by frame count at battle start (deterministic per input sequence: bots stay reproducible). Numbers live in `classes.json`/`battles.json`; the builder (us) tunes them by simulation (section 6.3).
- **Enemy and boss scripts:** each enemy = 1 to 3 mechanics + a turn pattern. Bytecode interpreted by fixed code (like BLUM's boss DSL, `src/core/engine-data/boss-dsl.ts`: no addresses, no unbounded loops). Mechanic kinds (closed list, extended only with an engine change):

| Kind | Meaning | Bible example |
|---|---|---|
| `charge(n, dmg, counter)` | n-turn countdown shown in text, then big damage unless the player used `counter` (Défense / Pouvoir / an item) during the countdown | Marie-Claude « Dictée mortelle » (Défense to survive) |
| `stun(chance_turns)` | Blum skips the next turn unless he defended this turn | Huguette « Regard paralysant » |
| `reflect(turns)` | Attaque bounces for n turns, Pouvoir or Défense passes | Rodolphe « Ballon infernal » |
| `summon(kind, max)` | adds 1 minion (max 2), killing minions first is optional | DR flûte (notes), DR violon (stronger notes) |
| `multi(hits, dmg)` | several small hits | Roger Rudy « Rayons capillaires » |
| `heal(pct)` | heals once below a threshold | Directeur Final |
| `steal(item_kind)` | takes a consumable (never a quest item) | Bernard |
| `phase(hp_pct, art)` | changes art/mechanics at an HP threshold | Monstera Apocalyptique (3 phases) |
| `confiscate(item, return_event)` | story-only, outside battle: item removed and returned by a scripted event | Surveillant Suprême (validator proves the return) |

- Levels: **one level per chapter end** (visible upgrade, the bible's rule), stats per level and class in `classes.json`; XP is shown as a score and gives a small mid-chapter bonus at fixed thresholds only (no grinding). **[DÉCISION FRED]**
- Game over: gag screen (bible reference « Game Over mariage » redrawn, text not fixed), then continue at the last save point with full PV. No lost items, ever.

### 2.8 Flags, inventory, save (PRG-RAM)

| WRAM | Content |
|---|---|
| $6000-$60FF | save slot A (256 B): magic `LGBZ`, version, chapter, area, screen, x, y, facing, class, level, PV, Énergie, XP, 256 event flags (32 B), 32 quest item bits (4 B), 16 consumable counts, play time, checksum (16-bit) |
| $6100-$61FF | save slot B (same layout): written alternately, the newest valid checksum wins (a power cut during a save never loses both) |
| $6200-$62FF | live game state (same layout as a slot, saving = copy + checksum) |
| $6300-$6FFF | work RAM: current screen collision buffer, entity tables, decompressed text page, battle state |
| $7F00-$7FFF | test probe (section 8), test builds only write cheats |

- **Battery save (proposed):** cartridge `battery: true` -> NES 2.0 header byte 6 bit 1 set, byte 10 = PRG-NVRAM 8 KiB (`headerForCartridge` already supports it). Mesen keeps a `.sav` by itself. The app's jsnes player does not persist WRAM today: M1 adds « save WRAM per ROM » in the play screen (small, isolated) [U]. Real hardware: only if Blum's cartridge/flasher board has a battery. **[DÉCISION FRED]**
- **Fallback without battery:** a 6-letter chapter code shown at each chapter start (chapter, class, level, quest items: < 30 bits + checksum), typed on the title screen. Cheap because the story is linear.

### 2.9 Blum's eras and the 5 classes

- Era sprite swap: Blum's sprite CHR bank (R2, 1 KiB: 4 directions x 2 walk frames + battle poses) per era: `enfant` (CH00-CH01), `ado` (CH02, red cardigan + grey trousers, mandatory), `étudiant` (CH03), `adulte` (CH04-CH06), `marié` (wedding scene). Green tuque welcome on the child and student sprites (BLUM link). Base sprite redrawn: hands free, no religious object, no striped outfit (bible section 3, brief).
- Classes change **battle powers only** (plus a few lines and the power animation). Quest items work for every class: there is no class-gated puzzle anywhere (the validator enforces it, section 6). Power table (bible section 4), 3 tiers unlocked at CH01, CH02-CH03, CH06:

| Class | Primaire | Secondaire / université | Finale | Effect kind |
|---|---|---|---|---|
| Guerrier | Coup de cartable | Frappe du lendemain de veille | Épée du destin | strong single hit |
| Mage | Étincelle | Boule de code | Tempête arcanique | hits all enemies |
| Voleur | Vol de gomme | Esquive des examens | Ombre légendaire | hit + steal a consumable / dodge next turn |
| Archer | Projectile de papier | Tir de précision | Flèche du destin | ignores defence / reflect |
| Nécromancien | Insecte réanimé | Réanime une plante | Armée des anciens boss (gag) | summons a helper for 2 turns |

Every mechanic has an answer that every class has (Défense, Objet, plain Attaque), so no boss requires a given class; the validator's battle sim proves it (6.3).

### 2.10 Music and sound

FamiStudio, same pipeline as BLUM and SEBRING (`scripts/music/`). Slice: titre, Anjou (carte), école, combat, victoire (jingle). Full game: + boss, Jean-Eudes, université, Bordeaux, Saint-Pétersbourg (neige), mariage, générique; about 12 songs + 12 SFX, 2 sound banks (8 KiB each) [U] sizes measured in A1.

---

## 3. Bank and memory map (whole game CH00-CH06)

### 3.1 PRG (256 KiB = 32 x 8 KiB, MMC3 PRG mode 0)

$8000 = R6 (data bank, swapped per need), $A000 = R7 (code overlay: battle / menu+save / cutscenes), $C000 = bank 30 and $E000 = bank 31 fixed (16 KiB core: reset, NMI, VRAM buffer, map engine, collision, text, sound driver, C runtime).

| Banks | Content | Estimate |
|---|---|---|
| 0 | CH00 data: 3 screens, NPCs, scripts, text | 4 KiB |
| 1-2 | CH01 data (Chénier, 10 screens reused 7 years) + text | 14 KiB |
| 3-4 | CH02 data (Jean-Eudes, 8 screens) + text | 11 KiB |
| 5-6 | CH03 data (UdeM + appartement, 8 screens) + text | 12 KiB |
| 7 | CH04 + CH05 data (Bordeaux 5 screens, Canada reuses CH01/CH03 screens) + text | 7 KiB |
| 8-9 | CH06 data (Saint-Pétersbourg, 6 screens) + text + credits text | 10 KiB |
| 10-11 | battles: enemy stats, mechanic scripts, battle background nametables (RLE) | 9 KiB |
| 12-13 | screens: title, year cards, Atlantic mini-map, wedding, credits, game over (RLE nametables) | 10 KiB |
| 14 | code overlay: battle (C + asm) | <= 8 KiB [U] |
| 15 | code overlay: menu, save, chapter code, title | <= 6 KiB [U] |
| 16 | code overlay: cutscene/script interpreter extras, credits | <= 4 KiB |
| 26-27 | sound: FamiStudio songs + SFX | <= 16 KiB [U] |
| 30-31 | fixed core | budget 16 KiB, checked from the ld65 map like BLUM (`bankUsage`) |
| rest (17-25, 28-29) | free | ~88 KiB |

Rule (same as BLUM): code in R7 may call fixed code, never another overlay; data in R6 is copied/used by fixed code only while mapped (bank switch through the shadow protocol, NMI-safe).

### 3.2 CHR (128 KiB = 128 x 1 KiB)

BG $0000: R0 (2 KiB) = **UI bank**, fixed: font (103 tiles), window frame (9), common map tiles (16). R1 (2 KiB) = area tileset or battle art, swapped. Sprites $1000: R2 Blum era, R3 NPC set, R4 enemies/objects, R5 FX + cursor.

| Content | Units | Size |
|---|---|---|
| UI bank (font + window + common) | 1 x 2 | 2 KiB |
| Area tilesets (128 tiles each): Bélanger apartment (palette swap = Montréal apartment CH03), Anjou house + street, Chénier outside, Chénier inside (classes, corridor, gym), Jean-Eudes outside, Jean-Eudes inside, UdeM campus, Bordeaux street/office/bar, Saint-Pétersbourg snow street, family house + ceremony hall | 10 x 2 | 20 KiB |
| Battle backgrounds: classroom, schoolyard/gym, apartment, street (shared by all chapters, palette per chapter) | 4 x 2 | 8 KiB |
| Boss/enemy art (BG tiles, up to 64 x 64 px): 13 bosses + 8 normal enemy kinds, 2 per 2 KiB bank on average | 11 x 2 | 22 KiB |
| Blum eras (enfant, ado, étudiant, adulte, marié) | 5 x 1 | 5 KiB |
| NPC sets per area (16 metasprites each) | 8 x 1 | 8 KiB |
| Map enemies/objects per area | 6 x 1 | 6 KiB |
| FX: class powers (5 classes x 3 tiers, 8 tiles each), hits, cursor | 2 x 1 | 2 KiB |
| Title, year cards, wedding, credits portraits (stylised), game over | 12 x 1 | 12 KiB |
| **Total** | | **~85 KiB of 128** |

### 3.3 Reuse plan (what keeps the game small)

- **One school per stage of life, many years:** CH01 Chénier = 10 screens used by 7 years; each year changes 1-2 NPC lines, the boss, and a palette (seasons: fall, winter, spring). CH02 Jean-Eudes = 8 screens for 5 years. CH03 = 4 campus screens + 4 apartment screens for 7 years, of which 3 years are « montage » text cards.
- **Palette swaps:** Bélanger's apartment tiles = Montréal apartment (CH03) = Canada apartment (CH05) with other palettes and furniture metatiles. Chénier's corridor tiles = Jean-Eudes corridor with stone palette [U] (A1 decides if the stone look needs its own tiles).
- **Shared battle backgrounds:** 4 backgrounds for every battle, palette per chapter.
- **Enemy palette variants:** normal enemies come in 2-3 colour variants (stronger = other palette), like the era's games.
- **CH05 has no new map:** Anjou house screen (CH01) + apartment (CH03) + the Atlantic mini-map screen (also used in CH04 arrival).

---

## 4. One chapter, the game loop

Bible section 7, made concrete for the engine: a chapter is a list of **years/steps**; each step = year card (« 2e année ») -> map with 2-4 NPCs who give lines and maybe an item -> one small obstacle (puzzle or a door gated by a flag) -> the boss (visible, in its room) -> victory -> level up (at chapter end) -> next year card. The engine knows only maps, NPCs, events, flags, items and battles; « years » are just events that change flags and reload NPC sets.

---

## 5. Data schema (JSON, French text)

JSON with zod schemas (as BLUM and SEBRING; no YAML dependency). The bible's YAML puzzle example maps 1:1 to the `puzzles.json` record. Folder `rpg/legend/`:

```
game.json          title, start (CH00), eras, level table, class list ref, credits
classes.json       5 classes: id, name, 3 power tiers (name, kind, power, cost, unlock chapter), lines
items.json         id, name, description, kind (quest | consumable), critical, sprite
chapters/CH0x.json steps (years), areas used, start position, chapter end event, level reward
areas/<id>.json    tileset, palettes, screen grid, exits (edges), doors (to area/screen/x/y), music
screens/<id>.json  16 x 15 rows of metatile characters (like world.json rooms), entities
tilesets/<id>.json metatile characters -> art from the A1 kit, attribute bits
npcs.json          id, name, sprite, era range, placement per step, dialogue per step, gives/takes
dialogue/CH0x.json id -> pages (French), auto-wrapped to 28 x 2 by the compiler, speaker
puzzles.json       requires -> unlocks, hints, action, success, failure, recovery
battles.json       enemies + bosses: stats, art, background, mechanics (section 2.7), rewards, flag
```

Examples:

```json
{ "id": "PUZ_PORTE_FINALE", "chapter": "CH06", "obstacle": "porte-freres",
  "requires": { "items": ["ITEM_CLOCHE"], "flags": ["CH06_FRERES_PARLE"] },
  "unlocks": { "flags": ["CH06_PORTE_OUVERTE"], "exits": ["spb-ceremonie"] },
  "hints": ["Tu te souviens de la petite cloche de Madame Bélanger ?", "Ici, le mécanisme réagit à un son clair."],
  "action": "use", "success": "DLG_PORTE_OUVERTE", "failure": "DLG_PORTE_RIEN",
  "recovery": "item-permanent" }
```

```json
{ "id": "BOSS_MARIE_CLAUDE", "chapter": "CH01", "step": "1re", "art": "marie-claude", "background": "classe",
  "stats": { "pv": 40, "attack": 4, "defence": 1 },
  "mechanics": [{ "kind": "charge", "turns": 2, "damage": 14, "counter": "defend", "text": "DLG_DICTEE" }],
  "pattern": ["attack", "charge", "attack", "attack"], "flee": false,
  "reward": { "xp": 10, "flags": ["CH01_1RE_FINIE"], "items": [] } }
```

```json
{ "id": "ITEM_CLOCHE", "name": "Clochette", "kind": "quest", "critical": true,
  "description": "La petite clochette de Madame Bélanger. Elle sonne clair." }
```

**Build step (like SEBRING's tracks):** `src/core/rpg/compile/` reads everything, runs the validator (section 6; any error stops the build, French/English messages like BLUM), then emits one `.s` per bank: per chapter (screens, metatiles, NPC/entity tables, event scripts, DTE text), battles, screens, plus `gen/legend.inc` constants (flag ids, item ids, bank numbers) shared by C (`legend.h`, generated) and asm. The compiler is the only place that knows the binary layout; sizes per bank are checked before ld65 (clear error « CH01 : texte 9,2 Ko, maximum 8 Ko »). The spike already does this on a small scale (`spike-world.ts`: checks then `world.inc` + `world-data.inc`).

Art: the A1 kit in `NES-BLUM-FACTORY-ASSETS\legend\` is imported like the SEBRING kit (`racer:kit` pattern): PNG + palette files -> CHR banks, checked with the CHROMA tools (`src/core/convert/`).

---

## 6. Validator design (`src/core/rpg/validate.ts`)

Runs on the data before every build and in `npm test`. Messages in French (English twin), with the file and id.

### 6.1 Progression graph and softlock check

- Nodes = locations (area/screen + walkable component inside a screen, computed from metatile solidity and entity boxes). Edges = exits/doors, each with an optional `requires` (flags/items).
- Events = talk, step trigger, puzzle use, battle win, chapter end: `requires` -> `unlocks` (flags, items, exits) and optional `removes` (only for consumables or confiscations with a return event).
- Algorithm per chapter: from the chapter start state, fixpoint: fire every event whose location is reachable and requirements are met, add its unlocks, repeat until nothing changes. **Error** if the chapter end event never fires.
- **Softlock check:** the state space is small (linear story, < 20 relevant flags per chapter), so explore every reachable state (BFS over flag/item sets, bounded at 10 000 states, error if exceeded). From **every** reachable state the chapter end must still be reachable. Catches one-way exits, removals, an NPC who leaves with a needed item, a door that closes behind.
- Cross-chapter: items and flags persist; `ITEM_CLOCHE` must be obtained in CH00 and required by `PUZ_PORTE_FINALE` in CH06 (bible section 10, explicit rule).

### 6.2 Every class can clear every blocking puzzle

- A puzzle's `requires` may only name items and flags. Any class-specific requirement (`class`, `power`) is an **error** unless the puzzle lists alternatives covering all 5 classes. Result: the progression graph above is class-independent, proven once.

### 6.3 Every class can win every blocking battle

- Battle simulator in TS from the same data and the same formula as the ROM (shared constants). For each blocking battle x each class at the level the chapter guarantees: simple player policy (use the counter the mechanic asks for when the text warns, Pouvoir when Énergie allows, heal under 30 %, else Attaque) with the worst-case damage roll. **Error** if a class loses or needs more than N turns (N = 12 for bosses, 6 for normal enemies) or ends with less than 15 % PV with all consumables used. Warning if a class wins in fewer than 2 turns (too easy).
- The ROM's bots (section 8) replay the same policy per class in jsnes and Mesen: the simulator and the ROM must agree on the outcome (engine test).

### 6.4 Critical items cannot be lost

- `critical: true` items: exactly one source event, at least 2 hints in reachable dialogue before the puzzle that needs them, no `removes` except a `confiscate` whose return event is reachable from every state before the next puzzle that needs the item (Secondaire 3 « Surveillant Suprême »), not sellable, not droppable, not usable in battle. Bible section 6 contract fields (ID, source, inventory state, obstacle, hints, action, success, recovery) are required fields of the schema, so a missing one is a schema error.

### 6.5 Text and taste

- Every page fits 28 x 2 after wrapping; every glyph is in the font; Québec typography; no emoji or pictographs; every `DLG_*` referenced exists and every one defined is used.
- Privacy: refuses Canadian postal-code patterns, house-number + street patterns, URLs, and the words of a list kept outside the repo-visible game text (the list itself contains no address); same scan on credits, metadata, the guide and the fiche cartouche.
- Names: only the locked real names from the bible (Blum, Ekaterina, Madame Bélanger, Magdi, Nivoix, Maxi, Paul, Mainguy, Marie-Claude, Huguette, Rodolphe, DR, Roger Rudy, M. Gélinas, Bernard); any other capitalised person name must be in `fictional_names` (Terreur des Crayons, Surveillant Suprême, the ex's fictional name, ...).

Tests: fixtures that softlock on purpose (one-way exit, consumed critical item, class-gated puzzle, confiscation without return, boss a Nécromancien cannot beat), each must produce its error; the real data must produce 0 errors.

---

## 7. Scope

### 7.1 Full game, CH00 to CH06

| Chapter | Screens (new / reused) | NPCs (named) | Bosses / battles | Items (quest) | Puzzles (blocking) | Est. PRG | Est. CHR new | Play time |
|---|---|---|---|---|---|---|---|---|
| CH00 Madame Bélanger | 3 / 0 | Mme Bélanger, Magdi, Nivoix | 1 mini (tutorial: « Mouton de poussière », fictional) | CLOCHE | 0 (class choice, use an object) | 4 KiB | apartment tileset 2, NPC set 1, Blum enfant 1, UI 2 | 8-10 min |
| CH01 Chénier (maternelle-6e) | 10 / 0 (house, street, yard x2, corridor x2, class x2, gym, secret room) | Maxi, Paul, Mainguy [DÉCISION], teachers, kids (fictional) | 7: Terreur des Crayons, Marie-Claude, Huguette, Rodolphe, DR I, Roger Rudy, DR II | BILLET, FLUTE, VIOLON | 2: PUZ_COULEUR (billet), PUZ_MUR_FISSURE (violon) | 14 KiB | 2 tilesets 4, NPC 2, enemies 1, bosses 8, year cards 1 | 30-35 min |
| CH02 Jean-Eudes (sec. 1-5) | 8 / 0 | classmates (fictional), Bernard [DÉCISION] | 5: M. Gélinas, Bernard, Surveillant Suprême, Professeur Fantôme, Directeur Final | LATIN | 2: PUZ_INSCRIPTION (latin), confiscation + return | 11 KiB | 2 tilesets 4, NPC 1, Blum ado 1, bosses 6 | 20-25 min |
| CH03 UdeM + appartement (7 ans) | 8 / 0 (+ 3 montage cards) | coloc (fictional), party guests | 4: Compilateur Maudit, Démon des Maths, l'Ex (fictional name), Monstera Apocalyptique (3 phases) + 2 normal | FEUILLE, CALC (optional) | 1 + 1 optional: PUZ_CPP (feuille), PUZ_CODE_CHIFFRES | 12 KiB | campus 2 (apartment = CH00 swap), NPC 1, Blum étudiant 1, bosses 6 | 20-25 min |
| CH04 Bordeaux (4 jalons) | 5 / 0 | Ekaterina (meeting scene, not a battle), coworkers (fictional) | 2: Patron Tyrannique, Seigneur de la Gueule de Bois + bureaucrate (normal) | BOUTEILLE | 1: work/party quest -> bouteille | 5 KiB | Bordeaux 2, NPC 1, Blum adulte 1, bosses 3 | 12-15 min |
| CH05 Retour au Canada | 0 / 2 + Atlantic map | (Ekaterina absent: letter/phone gag) | 0 | - | 0 | 2 KiB | - | 3 min |
| CH06 Saint-Pétersbourg | 6 / 0 | Ekaterina, cousins, frères (fictional individuals) | 3 thugs (normal, palette variants), cousin (PUZ_COUSIN), frères (final boss, comic) | BAGUE | 2: PUZ_COUSIN (bouteille), PUZ_PORTE_FINALE (cloche) + EVENT_MARIAGE | 10 KiB | 2 tilesets 4, NPC 1, Blum marié 1, bosses 3, wedding + credits 6 | 15-20 min |
| **Total** | **~40 new screens** | | **22 boss/mini + ~8 normal kinds** | **9** | **8 + 1 optional** | **~58 KiB data** | **~85 KiB** | **~2 h** |

Bible coverage check: 7 steps of Chénier, 5 of Jean-Eudes, 7 university years (4 boss years + 3 montage), Bordeaux, Russia; red/grey uniform; DR flute -> violin; Roger Rudy distinct (sun hair); C++ requires the plant leaf; plant boss in phases; object from the start used at the end; every class finishes (validator); Ekaterina met in Bordeaux, wedding in Saint-Pétersbourg (bible section 12, all 11 boxes have a home).

Taste rules applied in content: teachers, DR and the ex caricatured by role and attitude only; the ex has a fictional name; the CH03 leaf stays a cartoon fantasy (« CONSCIENCE C++ » is a text-and-palette gag, no realistic depiction, no instructions); Ekaterina is never a prize and never fought; thugs are fictional individuals.

### 7.2 Vertical slice (BLUMZ-M2): CH00 + CH01 maternelle and 1re

| Part | Content |
|---|---|
| Title | « THE LEGEND OF BLUM » placeholder title [DÉCISION FRED], Commencer / Continuer |
| CH00 | 3 screens (salon, cuisine, entrée), Madame Bélanger, Magdi, Nivoix; class choice (5 classes, Oui/Non confirm); ITEM_CLOCHE; tutorial: open the menu, look at the item, one mini battle; save point |
| CH01 maternelle | house + street + schoolyard + corridor + class (5 screens); Maxi, Paul (+ Mainguy if Fred says so); Terreur des Crayons (visible boss, 1 mechanic: `multi`) |
| CH01 1re | same screens, autumn palette; ITEM_BILLET from the secretary (fictional) after a small errand; PUZ_COULEUR: corridor door needs the billet (2 hints); Marie-Claude (2 mechanics: `charge` « Dictée mortelle » countered by Défense, plain attack) |
| End | « Fin de la tranche : merci d'avoir joué ! » + save; level up shown |
| Music | 4 songs + victory jingle, 8 SFX |
| Length | 15-20 minutes |
| Acceptance | ROM `release\handover\LEGEND-OF-BLUM-SLICE.nes` (not in the gift); validator 0 errors; bots for **each of the 5 classes** finish the slice in jsnes and Mesen with the same outcome, 0 lag; battle sim = ROM outcome per class; dirty boot; save/continue round trip (battery and chapter code); BLUM.nes, SEBRING.nes byte-identical; Fred plays it and says go |

---

## 8. Probe and tests

Probe at $7F00 (WRAM), magic `BLMZ`, frozen layout from the spike, extended and never reordered:

| Offset | Field | Offset | Field |
|---|---|---|---|
| $00-$03 | magic `BLMZ` | $11 | enemy PV (first enemy) |
| $04 | version | $12 | Blum PV |
| $05 | state (0 boot, 1 map, 2 scroll, 3 dialogue, 4 battle; M1: 5 menu, 6 title, 7 cutscene, 8 game over) | $13 | menu/battle cursor |
| $06 | room/screen | $14 | lag frames |
| $07 | x | $15 | flags (spike: bit 0 clochette, bit 1 crayons) |
| $08-$09 | frame | $16-$17 | idle loops last frame (x 14 = free cycles) |
| $0A | y | $18-$19 | minimum idle since frame 4 |
| $0B | facing | $1A | XP |
| $0C | nametable on screen | $1B | battle turn |
| $0D | transition offset | $1C | dialogue sub-state |
| $0E | dialogue page | $1D | VRAM buffer peak bytes |
| $0F | typed characters | $1E | quest items count |
| $10 | battle sub-state | $1F | talks |
| $20-$23 | next scroll X, nametable, window row, stream step | M1: $24 chapter, $25 area, $26 class, $27 level, $28 Énergie, $30-$4F flags (256 bits), $50-$53 quest items, $60 test cheats |

Tiers (TEST-STRATEGY, one heavy job at a time, `.tmp/gate.lock`): unit (`npm test`: schemas, compiler, validator + softlock fixtures, battle sim, text wrapping/DTE round trip, privacy scan), engine (`npm run test:engine`: jsnes, the slice per class by bot, save round trip, dirty boot, 0 lag, free CPU, shots), Mesen (`npm run test:rpg-mesen`: same bots, same state-change trace frame by frame, text readable, vertical slide timing, 0 lag, no Mesen process left), QA (playthrough + soak pattern of `scripts/qa-*.mjs`).

---

## 9. Milestones (no deadline from Fred; SEBRING stays the Friday gift)

| Step | Who | Gate |
|---|---|---|
| BLUMZ-PLAN | Atlas | this document + spike (done) |
| BLUMZ-A1 slice art + music kit | Muse | Blum enfant redrawn (hands free, no stripes, green tuque), CH00 apartment + Anjou/Chénier tilesets, 6 NPCs, 2 bosses + 1 mini + 2 normal, UI bank check, battle background, title placeholder, 4 songs + jingle + 8 SFX; CHROMA budgets green; no address anywhere; contact sheet |
| BLUMZ-M1 engine | Atlas | C + asm core from the spike, vertical slide, doors, menu, save (battery + code), battle with mechanics, compiler + validator + battle sim, probe, bots x5 classes, test tiers; demo data only |
| BLUMZ-M2 slice | Atlas | slice content (7.2) with the A1 kit, `LEGEND-OF-BLUM-SLICE.nes` + fiche, all acceptance of 7.2 |
| BLUMZ-W | Warden | review verdict |
| Fred plays | Fred | go / changes |
| BLUMZ-M3..M6 | Atlas + Muse | CH01 2e-6e, CH02, CH03, CH04-CH06 (mostly data + art), then the full ROM, gift integration (new version) |

---

## 10. [DÉCISION FRED]

1. **Titre final.** « THE LEGEND OF BLUM » est en anglais alors que le jeu est en français. Proposition : « LA LÉGENDE DE BLUM » à l'écran titre, fichier `LEGEND-OF-BLUM.nes`. Ou garder l'anglais (clin d'oeil aux jeux de l'époque).
2. **Sauvegarde à pile oui/non.** Oui si la cartouche de Blum a une pile (à vérifier sur son modèle). Sinon : code de chapitre de 6 lettres.
3. **Durée du jeu complet.** Proposition : environ 2 heures (7 chapitres de 3 à 35 minutes). Plus court possible : Chénier en 4 années au lieu de 7 (les 3 autres en cartes de texte).
4. **Combats.** Proposition : ennemis visibles sur la carte, pas de combats aléatoires, un niveau par chapitre, pas de « grind ».
5. **Pas de barre d'état permanente sur la carte** (PV visibles dans le menu et en combat). Proposition : oui (plus simple, plus d'écran pour la carte).
6. **Quelles « propositions » de la bible on garde** : clochette comme fil rouge (je recommande de garder), violon qui ouvre le mur, livre de latin, bouteille pour le cousin, répartition des profs par année, noms des pouvoirs, noms des boss inventés (Terreur des Crayons, Surveillant Suprême, Professeur Fantôme, Directeur Final, Compilateur Maudit, Démon des Maths, Monstera Apocalyptique, Patron Tyrannique, Seigneur de la Gueule de Bois). Par défaut : on garde tout.
7. **Mainguy : première apparition.** Proposition : Chénier, 2e année (nouvel élève), pour ne pas surcharger la tranche.
8. **Bernard : qui est-ce ?** Nom réel gardé mais rôle à préciser (« bum » du secondaire 2). Proposition : élève plus vieux qui rackette les collations, battu par un gag, devient presque sympathique.
9. **L'Ex : nom fictif.** Proposition : « l'Ex Terrifiante » sans prénom, ou un prénom inventé que tu choisis.
10. **Photos Bordeaux et Saint-Pétersbourg** manquantes (et l'appartement de Madame Bélanger). Sans photos : on invente des lieux typiques (quais et façades claires à Bordeaux, neige, coupoles et portail à Saint-Pétersbourg).
11. **L'immeuble « à confirmer »** du dossier 05 : est-ce l'appartement universitaire (4½ sur deux plateaux) ? Par défaut : oui, simplifié.
12. **Le mini-combat du prologue** : ennemi inventé « Mouton de poussière » chez Madame Bélanger. OK ?
13. **Exclamations russes** (bible section 8) : 3 ou 4 mots en alphabet latin seulement (pas de cyrillique dans la police). OK ?
14. **Version / place dans le cadeau** : la tranche n'entre pas dans le cadeau CADEAU-BLUM. Le jeu complet ira dans une version suivante du cadeau, quand il sera fini.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Text volume overflows chapter banks | DTE per chapter + size check per bank in the compiler; CH01 and CH03 already have 2 banks; free PRG ~88 KiB |
| Vertical slide on real hardware (mirroring switch mid-game) | switch only during the stream phase (screen still static), Mesen-verified in M1; fallback: fade transition for vertical edges |
| Battery not on Blum's cartridge | chapter code fallback, decided before M1 |
| cc65 C too slow for battle animations | animations are table-driven asm (OAM build), C only picks the next step |
| Content scope creep (bible is rich) | the scope table 7.1 is the contract; new ideas go to a « bonus » list cut first |
| Real people depicted badly | role/attitude caricature only, the validator's name list, Fred validates the slice before any other chapter |

---

## 12. BLUMZ-M1 as built (2026-10-21, Atlas)

M1 delivered the engine **and** the slice content of 7.2 in one step (the chain asked for it): `rpg/src/*.s`, `rpg/legend/*.json`, `src/core/rpg/legend/*.ts`, ROM `release/handover/LEGEND-OF-BLUM-SLICE.nes` (`npm run legend:handover`, byte-identical double build, not in the gift).

- **Deviation from 2.1 (C for event logic):** the whole engine is ca65, like the spike and SEBRING; the story logic is not C but **data**: an event-script VM (`rpg/src/vm.s`, 25 ops: say, choice, if flag/item/choice, set/clear, give, battle, warp, class choice, card, save, heal, level up, music, sfx, chapter, the end, per-class line). Scripts are written as JSON trees in `rpg/legend/scripts.json` and compiled to bytecode next to the French text. Later chapters = more JSON, no engine code. No cc65 runtime in the ROM.
- **Banks (measured):** WORLD (bank 0) 4 564 B, TEXT (bank 1, scripts + all text, no DTE yet) 6 347 / 8 192 B, SCREENS (banks 2-3) 10 nametables, SOUND bank 29 2 353 B, fixed $C000 7.6 KiB and $E000 3.9 KiB used of 16 KiB. CHR 25 / 128 KiB. Next chapters need DTE or one text bank per chapter (the script table already carries addresses per script; a bank byte per script is the planned step).
- **Engine features:** 16x15 metatile screens, slides left/right **and up/down (MMC3 mirroring switched to horizontal during the slide, proven frame-identical in Mesen)**, doors and cross-area edges with fades, up to 8 entities per screen (NPCs face Blum, animated enemies, invisible doors and objects, talk across counters), "tap turns, hold walks", windows over the map (speaker name in the frame), typewriter (B = fast), Oui/Non choices, Start menu (status, Objets with descriptions, Classe, Sauvegarder), 256 flags + 32 quest items + collations, battles (Attaque, Pouvoir per class: hit / all / steal / pierce / summon, Objet, Défense, Fuite; enemy moves attack, multi, warn + blast, heal, stun), level ups from scripts, battery save in 2 slots with sequence + 16-bit checksum and Continuer on the title.
- **Not done in M1 (said plainly):** 1 enemy per battle (no 2-3 enemy targeting); enemy mechanics reflect, summon, steal, phase, confiscate; chapter-code fallback without battery; DTE text compression; the app's jsnes player does not keep the battery RAM between sessions (Mesen and real carts do).
- **Validator (section 6) runs in `npm test` and before every build:** progression BFS over (screen, walkable area, flags, items, level) with every script executed symbolically, softlock check including every save point as a reload state (it caught a real one: a save after the last boss), puzzles may require items/flags only, critical items one source, hints said before the puzzle, every battle simulated for the 5 classes at the guaranteed level from a retry (full PV and Énergie, no collation, worst rolls), one-page battle messages, glyphs, privacy, speaking names.
- **Tests:** `tests/legend-data.test.ts` (unit, 14), `tests/engine/legend-slice.test.ts` (jsnes, 10: 5 classes to the end card, ROM = simulator, save/Continuer, dirty boot, stun + heal fixture), `npm run test:legend-mesen` (28 checks: the 5 classes replayed in Mesen frame by frame, text readable, the 10-minute random soak identical), `npm run legend:soak` (10 min random + 5 classes with random bursts).
