# SEBRING (BLUM game 2): racer plan

Version 1, 2026-10-21 (step BLUMR-PLAN, agent Atlas). Input: `runs\prompts\BLUMR-BRIEF.md` (Fred, 2026-10-21 01:45), this factory's `docs/PLAN.md`, `docs/MILESTONES.md`, `RUNNER-BLUM.md`, the engine and the test tier.

Markers: **[DÉCISION FRED]** = choisi au nom de Fred, à confirmer. **[U]** = pas encore vérifié, la première étape qui y touche le vérifie.

---

## 0. Résumé pour Fred

- **État au 21 octobre (après BLUMR-FIX) :** le jeu est fait et emballé dans le cadeau `CADEAU-BLUM-1.1.0.zip`. 5 étapes d'Anjou au centre-ville, titre, fin « BONNE FÊTE BLUM ! » avec feux d'artifice, générique, radio, pause, secret tempête de neige. La revue Warden (BLUMR-W) a trouvé un vrai défaut, corrigé : quand le temps est écoulé, une seule pression sur Start fait maintenant continuer à tout moment pendant les 10 secondes (avant, elle était ignorée environ les deux tiers du temps). Corrigé aussi : une auto devant ne saute plus de côté pendant une image dans les changements de virage. Les deux émulateurs donnent le même résultat, accidents compris. Reste à faire : 10 minutes d'essai par toi (personne n'a encore joué ni écouté la musique), et tes deux [DÉCISION FRED] (version 1.1.0, titre).
- **Le plus dur est déjà prouvé.** Une ROM d'essai tourne : une route en fausse 3D comme dans les jeux de course de l'époque, avec des virages à gauche et à droite, une côte, un sommet de côte, des bandes rouges et blanches qui défilent plus vite quand on accélère, un ciel de coucher de soleil avec des immeubles qui glissent dans les virages, et une décapotable blanche (conducteur à tuque verte) qu'on dirige. Elle marche pareil dans Mesen (l'émulateur le plus exact) et dans l'émulateur de l'app, sans aucun ralentissement sur 60 secondes de conduite.
- **Même cartouche que BLUM** (MMC3, 8 Ko de RAM), mêmes outils (cc65, FamiStudio). Le jeu BLUM n'est pas touché, tous ses tests restent verts.
- **Le budget est connu :** la route prend environ les deux tiers du temps de calcul de chaque image. Il reste environ 10 000 cycles par image pour la circulation, les collisions et la musique : assez, à condition d'écrire les parties rapides en assembleur.
- **Pour vendredi (le plancher) :** une ROM jouable avec 5 étapes d'Anjou au centre-ville, un écran titre, une fin « BONNE FÊTE BLUM ! », chrono, points de contrôle, 3 continues, des voitures et des cônes à éviter. Le reste (autobus, déneigeuse, nids-de-poule, 3 radios, mode tempête, éditeur de pistes dans l'app) vient ensuite, dans cet ordre, seulement si le plancher est vert.
- **Le titre :** on garde « SEBRING : ANJOU – CENTRE-VILLE ». Proposition : « SEBRING : DE L'ANJOU AU CENTRE-VILLE » à l'écran titre (plus naturel à lire), le nom de fichier reste `SEBRING.nes`. **[DÉCISION FRED]**
- **Une limite à connaître :** dans l'émulateur de l'app, une petite bande de quelques pixels peut apparaître au bord droit de l'écran (défaut connu de cet émulateur, probablement aussi dans BLUM, à vérifier). Sur Mesen et sur la vraie cartouche, l'image est propre.

---

## 1. What the spike proved (BLUMR-PLAN step 2)

ROM: `racer/spike/` built by `src/core/racer/build-spike.ts` (ca65 + ld65 from the pinned cc65 toolchain), header `4E 45 53 1A 10 10 40 08 00 00 07` (BLUM's cartridge, `DEFAULT_CARTRIDGE`), 393 232 bytes. Run: `node scripts/racer-spike.mjs [--publish]` (holds `.tmp/gate.lock`).

| Check | Mesen 2.2.1 (testrunner) | jsnes (app emulator) |
|---|---|---|
| 3600 frames (60 s) driven by the bot, all 10 demo track segments visited | done, 9.9 s | done |
| Lag frames | 0 | 0 |
| Free CPU, worst frame (uphill: 135 kernel lines) | 10 080 cycles (66 % busy) | 10 080 cycles |
| Free CPU, average | 11 692 cycles | 11 686 cycles |
| Kernel writes per road line (5 frames logged, flat and uphill) | `$2005` X at dots 267-279, `$2006` low at 279-291, CHR R0 at 291-303: all inside hblank (257-320) on every line | n/a (scanline renderer) |
| HUD -> backdrop split (IRQ #1) | 4-write lands on line 16 dots 0-70, on a plain sky line: invisible | same picture |
| Probe at frame 3600 (seg, curve, speed, x, hill, distance, phase) | identical to jsnes | identical to Mesen |
| Screens: straight, 4 consecutive stripe frames, left, right, uphill, crest, hard left, hard right | 11/11 | 11/11 |
| Mesen processes left | 0 | - |

Shots: `runs\reports\BLUMR-PLAN-mesen-*.png`, `BLUMR-PLAN-jsnes-*.png`, side by side in `BLUMR-PLAN-spike-contact-sheet.png`; numbers in `BLUMR-PLAN-spike-report.json`.

Flicker: none. The spike uses 16 sprites, at most 5 on a line (car row + driver head). Traffic will change this (section 3.4).

Known jsnes difference (documented, not fixed): jsnes draws exactly 32 tiles per line starting at the fine-X offset, so the rightmost `X & 7` pixels of each line show the backdrop colour. With a different X per road line this is a small jagged strip on the right edge. Mesen and hardware draw the 33rd tile. BLUM should show the same strip when it scrolls with fine X ≠ 0 [U]. Fix candidate (bonus, BLUMR-FIX or later): a racer-only override of jsnes `renderBgScanline` in `NesSession`, guarded by a test that BLUM frames stay byte-identical.

Regression test: `tests/engine/racer-spike.test.ts` (engine tier, 6 tests): header and size, 0 lag + all segments + >= 8000 free cycles, road centre moves left/right on curves and stays put near the car, horizon rises >= 13 lines uphill and the crest cuts the far road, stripes change between consecutive frames on the road but not on the HUD, car kept on the road.

---

## 2. Architecture

### 2.1 Where the racer lives

```
racer/
  spike/                 engine spike (this step): cfg/spike.cfg, src/spike.s (pure ca65). Kept as the reference
                         for kernel timing; M1 copies the kernel out of it, the spike stays buildable.
  cfg/sebring_mmc3.cfg   (M1) BLUM bank model (section 3.3), own WRAM map
  src/crt0.s             (M1) fork of engine/src/crt0.s: reset/MMC3/WRAM/probe/FamiStudio init, racer NMI
  src/kernel.s           (M1) road kernel + IRQ #1/#2 handlers, from the spike
  src/hot.s              (M1) asm hot paths: traffic projection, OAM build, HUD digits, multiply
  src/game.c, racer.h    (M1) cc65 C: title, stage flow, timer, checkpoints, continues, crash states
  lib/neslib_racer.s     (M1) fork of engine/lib/neslib.s with the racer NMI (live-block copy, IRQ #1 arm)
src/core/racer/
  road-data.ts           road geometry, curve/hill/row tables (single source of truth, used by spike and M1)
  spike-assets.ts        spike CHR/nametables/palette (placeholder art drawn in code)
  build-spike.ts         spike build; M1 adds build-racer.ts (cc65 -> ca65 -> ld65, same Toolchain)
  spike-run.ts           probe layout, bot, shot list (jsnes + Mesen share it)
  (M1) track.ts          zod schema for tracks/*.json + validator; emit.ts -> gen/tracks.s
tests/engine/racer-*.test.ts   jsnes tier
tests/mesen/racer-*.lua        Mesen tier, driven by scripts/racer-*.mjs
```

Shared, never edited for the racer: `engine/lib/nesdoug.*`, `engine/lib/mmc3_code.asm`, `engine/lib/mmc3.h`, `engine/audio/famistudio_ca65.s` and `NoteTables/`. The racer build copies them into its work folder next to the racer sources, exactly as `buildRom` copies `engine/`. Anything that must differ (NMI) is a fork under `racer/lib/` with a header saying what changed, like the BLUM forks. Result: `engine/` hash is unchanged, so every BLUM build, test and shipped ROM stays byte-identical.

Tools reused as-is: cc65 V2.19 (pinned SHA-256, `resources/toolchain`), `headerForCartridge`, `encodeTile`/CHR codec, `encodePng`/`decodePng`, `RomHarness`/`NesSession` (jsnes), the gate lock, `fetch-mesen.mjs`, the FamiStudio CLI music pipeline (`scripts/music/`), the export/fiche cartouche code (`src/core/build/export.ts`) and `gift.mjs`. The CHROMA converter (`src/core/convert/`) converts A1 art (car, traffic, backdrops) into tiles + budgets.

### 2.2 One frame

```
line   0-15   HUD (NT0 rows 0-15): text BG + digit sprites              scroll from the NMI
line  15      IRQ #1: 4-write backdrop scroll (X parallax, Y hill shift), arms IRQ #2
line  16-hy-1 backdrop: sky + skyline + far grass (NT rows 16-119)
line  hy-3    IRQ #2: kernel prologue (save regs, R6 = road bank, select R0, first line)
line  hy-239  road kernel: per line X (curve), Y (hill row), CHR R0 (stripe A/B)
241           NMI: OAM DMA, live <- next (finished frames only), HUD scroll, arm IRQ #1, music
rest          main thread: game logic (interrupted by IRQ #2, resumes after line 239)
```

`hy` (first road line) = 120 flat, down to 105 uphill. Double buffer: main writes the `next` block, the NMI copies it to `live` only when the frame is finished (the BLUM M2 lesson: never let an IRQ read half-updated values).

---

## 3. MMC3 raster plan

### 3.1 Kernel (racer/spike/src/spike.s, `irq_kernel`)

Per screen line the kernel picks a nametable row (hills) and an X scroll for that row (curves), and swaps CHR R0 between the two road variants (stripes):

- Nametable: vertical mirroring, 512 px wide. Rows 120-239 hold one straight perspective road centred at x 256 (edges are straight lines to the vanishing point; road + rumble + centre line = 56 unique tiles of 128). A curve is only X scroll per row (`X = 128 - c * K * m^2`, m = lines above the bottom), a hill is only a row choice per line (row table per hill level).
- Stripes: CHR R0 = bank 0 (variant A: white rumble, white centre dash) or 2 (variant B: red rumble, no dash), same tile indices. Bank per row = `(zTab[row] + phase) & mask[row]`, `z = 1000 / n` (n = lines below the horizon), phase += speed / 256 per frame. Rows within 24 lines of the horizon are frozen to A (would alias).
- Writes per line, for line N+1, during line N: `$2006` high and `$2005` Y anywhere (they only touch t), then in hblank `$2005` X (fine X, coarse X into t), `$2006` low (v = t), `$8001` R0. The three hblank writes are 4 cycles apart, preloaded in X/Y/A.
- Loop = exactly one scanline: 113 or 114 cycles, a fraction accumulator (`adc #$AB`, branch taken on 2 lines of 3) gives 341/3 = 113.67 on average, no drift (measured: the same dots on line 104 and line 238).
- Tables: hill table (bytes 0-135) and curve table (bytes 136-255, pointer at page + 16, indexed by row) share each 256-byte page, so `(ptr),y` never crosses a page (a crossing costs a cycle and would drift every following line). Two 8 KiB road banks = 64 curve levels (32 each), every hill level copied in both. Row tables (z, $2006 high, $2006 low, stripe mask) are 4 page-aligned 256-byte tables in the fixed bank. `.assert` keeps the loop in one page.

Cycle budget (measured on Mesen, NTSC frame = 29 780 cycles):

| Part | Cycles per frame |
|---|---|
| Kernel, flat (IRQ on line 117 to line 239: ~122 lines x 113.67) | ~13 900 |
| Kernel, max uphill (~137 lines) | ~15 600 |
| NMI (live copy 13 bytes, OAM DMA 513, scroll, IRQ arm) | ~700 |
| IRQ #1 | ~80 |
| Spike game logic (pad, speed, track, car, scroll pointers, OAM 16 sprites, probe) | ~2 000 |
| **Free (measured), worst / average** | **10 080 / 11 690** |

So the full game has about 12 000 cycles per frame for everything that is not the road (spike logic included): FamiStudio (~1 500-2 500 with 1 song + SFX [U] measured in M1), traffic, collisions, HUD, state machine. cc65 C is several times slower than asm: rule for M1 = per-frame loops (traffic projection, OAM build, digit conversion, multiplies) in `hot.s`, C only for flow and per-event logic. Gate: engine-tier test fails under 2 000 free cycles in the worst frame of every stage; target >= 3 000.

Cheap wins if needed: IRQ #2 one line later (saves ~114 cycles, needs a shorter prologue), shorter max uphill (each hill line = 114 cycles), road ending at line 231 with a bottom dashboard (8 lines = 900 cycles).

### 3.2 Hardware rules (racer additions to PLAN 5.3)

- MMC3 IRQ latch never 0: latches used are 16 (IRQ #1) and `hy - 19` = 86-101 (IRQ #2). Reload through `$C001` before each arm, acknowledge with `$E000` first thing in each handler. No dependence on old/new MMC3 IRQ behaviour (only latch 0 differs).
- Standard A12 layout: BG at $0000 (R0/R1, 2 KiB), sprites at $1000 (R2-R5), 8x8 sprites only (8x16 would let sprites fetch from $0000 and clock the counter wrongly).
- The kernel writes `$8000`/`$8001`. In M1 it follows the BLUM shadow protocol: save `mmc3_8000` and `BP_BANK_8000`, set R6 + select R0, restore both before `rti`, so an IRQ landing inside `bank_swap_common` is safe. Prologue cost is inside the existing 99-cycle pad. Music (NMI, vblank) and the kernel (lines >= 102) never overlap.
- Reset code, NMI, IRQ, vectors in $E000-$FFFF; PRG mode 0 set before anything leaves that bank (the spike does this).
- The main thread never writes PPU registers; only NMI, IRQ #1 and the kernel do.

### 3.3 PRG budget (256 KiB = 32 x 8 KiB)

BLUM's bank model (ADR-11): $8000 = R6 swapped, $A000 = bank 29 set once, $C000 = bank 30, $E000 = bank 31. 24 KiB fixed.

| Bank | Content | Size |
|---|---|---|
| 0-1 | road banks: 64 curve levels + 26 hill levels (kernel maps one per frame) | 16 KiB (2 more banks give 128 curve levels if the far road steps are visible: 3.5 px per level today) |
| 2-6 | one per stage: track segments, traffic/object lists, backdrop nametable (RLE), palettes, stage text | <= 8 KiB each |
| 7 | title, ending, credits screens (RLE nametables, text) | ~6 KiB |
| 28 | SOUND: FamiStudio data, 3 radio songs + title/ending/checkpoint jingles + SFX | <= 8 KiB [U] |
| 29-31 fixed | C game, kernel + row tables (1 KiB), neslib/nesdoug/mmc3, hot.s, FamiStudio engine | budget 24 KiB, checked from the ld65 map like BLUM (`bankUsage`) |
| rest | free | ~150 KiB |

### 3.4 CHR budget (128 KiB = 128 x 1 KiB)

| Units | Content |
|---|---|
| per stage 4 KiB | road variants A + B (R0, 2 + 2 KiB). Same 56-tile layout; A-40 may get a 4-lane variant (still < 128 tiles) |
| per stage 2 KiB | backdrop + HUD font (R1): sky, skyline/landmark, far grass, HUD text. Spike uses 19 of 128 |
| 4 KiB | title + ending screens (R0/R1 pairs) |
| R2 1 KiB | player: Sebring rear view straight/left/right, spin (4 frames), flip (2 frames), driver tuque |
| R3-R4 2 KiB | traffic at 3 sizes each: car, STM-style bus (original livery, no logo), déneigeuse, cone, nid-de-poule |
| R5 1 KiB | HUD digits, checkpoint/time text sprites, smoke, fireworks |
| total | ~5 x 6 + 4 + 4 = 38 KiB of 128 |

Traffic sizes are pre-drawn (no runtime scaling): depth -> size 0/1/2 by `z` thresholds. Sprites per line: player row 4 + driver 1 + one near traffic object (up to 4) = 9 > 8. Rule: at most 1 traffic object within the player's 24 lines, OAM order cycled every frame (BLUM's OAM cycling) so an overflow flickers instead of hiding the same sprite; the validator caps traffic density per segment; flicker counted by the Mesen tier and reported (like BLUM Q1).

### 3.5 Palettes

4 BG palettes: road (universal asphalt + grass/red/white), sky, skyline, HUD (colour 3 = top sky colour so the HUD split line cannot show). Dusk to night per stage = palette sets only (5 sets, A1 picks them through the CHROMA palette tools). Never $0D, same NES palette table as BLUM (`src/core/nes/palette.ts`).

---

## 4. Track data format (data-driven, like BLUM)

`tracks/<stage>.json`, zod schema in `src/core/racer/track.ts` (M1), emitted to `gen/tracks.s` (one stage bank each):

```json
{
  "schemaVersion": 1,
  "id": "anjou",
  "name": { "fr": "Ville d'Anjou", "en": "Ville d'Anjou" },
  "palette": "coucher-de-soleil",
  "backdrop": "galeries-anjou",
  "timeStart": 60,
  "segments": [
    { "length": 120, "curve": 0, "hill": 0, "traffic": 1 },
    { "length": 220, "curve": -24, "hill": 0, "traffic": 2, "objects": [{ "at": 40, "kind": "cone", "lane": -1 }] },
    { "length": 80, "curve": 0, "hill": 0, "checkpoint": { "addTime": 25 } }
  ]
}
```

- `length`: distance units of 256 (distance += speed each frame, 1 unit = 1.2 frames at 210 km/h). `curve` -32..31 (target; the engine eases 1 level / 2 frames), `hill` -10..15 (crest..uphill, 1 level / 4 frames), `traffic` 0-3 density, `objects` placed at an offset with a lane (-1, 0, 1), `checkpoint` adds seconds. Emitted record: 6 bytes (length 2, curve, hill, traffic, flags) + an object list.
- Validator (errors in FR/EN like BLUM): ranges, total length vs `timeStart` + checkpoint time at 80 % of max speed (stage must be finishable with 2 crashes), curve change per segment playable, traffic density vs sprite budget, max 1 hill level change per 4 frames reachable within the segment.
- Future « genre Course » in the app (bonus, after the gift): TABLEAU-like segment editor on this file; the emitter is the only place that knows the binary.

---

## 5. Floor vs bonus

**Floor for Friday 2026-10-23 (never cut):**
1. `release\handover\SEBRING.nes` (MMC3, 8 KiB PRG-RAM, same cartridge as BLUM) + fiche cartouche FR/EN (existing export code).
2. Title screen (Start), 5 stages in route order: Ville d'Anjou (Galeries d'Anjou), Autoroute Métropolitaine, rue Sherbrooke Est (Stade olympique tower), Plateau / avenue du Parc (croix du Mont-Royal), Centre-ville (finish line), dusk to night palettes.
3. Driving: left/right steer, A gas, B brake, Start pause; speedometer km/h, timer, distance to the next checkpoint.
4. Traffic: cars + cones at least; hitting them or leaving the road = spin, small time penalty.
5. Checkpoints add time; time out = continue from the stage start, 3 continues, then title.
6. Ending « BONNE FÊTE BLUM ! » + credits with the cc65/neslib/nesdoug/FamiStudio notices; at least 1 original song + engine/crash/checkpoint SFX.
7. No emoji, French first, original art and music, no "Rad Racer"/Nintendo/Square names or assets, no brand logo on the car.
8. Gift CADEAU-BLUM with a new version number, the second game, and a FR/EN guide page (controls + route).

**Bonus, in cut order (last one cut first):** 3 radio stations on Select (« Radio Anjou 104,5 », « Métropolitaine FM », « Centre-ville Nuit ») · STM-style bus, déneigeuse, nids-de-poule · flip crash (spin is floor) · per-stage landmark art beyond a skyline silhouette · fireworks at the finish · « Jeu d'exemple SEBRING » on the app start screen · snow storm mode (secret honk combo on the title) · jsnes right-edge fix · 30 s trailer · track editor in the app.

---

## 6. Test plan

### 6.1 Tiers (same as BLUM, TEST-STRATEGY)

| Tier | Command | Racer content |
|---|---|---|
| unit | `npm test` | road tables (page rules, ranges, monotonic rows), track schema + validator + emitter, CHR/palette budgets, probe contract (TS <-> `racer.h`) |
| engine (jsnes) | `npm run test:engine` | spike test (now); M1+: every stage cleared by the bot with time left, crash path, time-out -> continue path, 3 continues -> title, title -> 5 stages -> ending + credits chain, 0 lag, free CPU guard, dirty boot (0xFF + seeded RAM), shots |
| accurate (Mesen) | `node scripts/racer-spike.mjs` (now), `npm run test:racer-mesen` (M1) | kernel write dots inside hblank on every stage (flat, max uphill, crest, hardest curve), HUD split, same probe outcome as jsnes for every stage replay, 0 lag, Mesen processes left = 0 |
| QA | `scripts/qa-*.mjs` pattern | title -> ending playthrough both emulators, soak (18 runs, 0 hang/softlock), fresh install of the gift |

All heavy scripts take `.tmp/gate.lock`; one at a time on box-01.

### 6.2 Probe ($7F00, WRAM, like BLUM 5.8)

Spike layout (frozen for the spike, extended in M1, never reordered):

| Offset | Field | Offset | Field |
|---|---|---|---|
| $00-$03 | magic `SBRG` | $0E | stripe phase |
| $04 | version | $0F | off-road |
| $05 | state (spike: 3 = driving) | $10-$11 | distance (units of 256) |
| $06 | segment | $12-$13 | backdrop X (9 bits) |
| $07 | curve (signed) | $14 | lag frames (NMI before the frame finished) |
| $08-$09 | frame | $16-$17 | idle loops last frame (x 14 = free cycles) |
| $0A | speed (km/h) | $18-$19 | minimum idle since frame 4 |
| $0B | car x | M1: $1A time left, $1B continues, $1C crashes, $1D stage, $1E checkpoint, $1F radio song, $20-$2F traffic (lane, depth), $40 test cheats (test builds only) |
| $0C | hill (signed) | | |
| $0D | first road line `hy` | | |

M1 states: 0 boot, 1 title, 2 stage intro, 3 driving, 4 crash, 5 checkpoint, 6 time over / continue prompt, 7 ending, 8 credits.

### 6.3 Bots

- Spike bot (`spikeBot`, `racer-spike.lua`): hold A, steer back to x 128. Identical decisions in both emulators because input depends only on the probe.
- M1 race bot: hold A, target lane = the free lane read from the traffic probe ($20-$2F), brake when a traffic object is within the near depth band in the same lane and no lane is free. A crash bot (steer into the first car) and an idle bot (no gas: time-out path) cover the other paths. Bot scripts are frozen per stage like BLUM's stage scripts and replayed in Mesen.

---

## 7. Milestones

Calendar (sequential, one heavy job at a time):

| Step | Who | When | Gate |
|---|---|---|---|
| BLUMR-PLAN | Atlas | Wed 21 morning | this doc + spike (done) |
| BLUMR-M1 engine floor | Atlas | Wed 21 day | acceptance below; checkpoint Wed 22:00 |
| BLUMR-A1 art + music | Muse | Wed 21 evening (files disjoint from M1; the Conductor decides parallel or after) | acceptance below |
| BLUMR-M2 stages + package | Atlas | Thu 22 day | checkpoint Thu 16:00 |
| BLUMR-W review | Warden | Thu 22 evening | verdict |
| BLUMR-FIX | Atlas | Thu night / Fri 23 morning | all W P0/P1, gift rebuilt |

Automatic cuts (no discussion): Wed 22:00 M1 not green -> traffic = cars only, no flip, no radio. Thu 16:00 M2 not green -> plain skyline backdrops for all stages, 1 song. Thu 22:00 -> no bonus work at all, FIX only.

### BLUMR-M1: engine floor

Deliverables: `racer/` engine (section 2.1) from the spike kernel; cc65 C game; track schema + validator + emitter; one test track per feature + a 5-stage placeholder set; FamiStudio wired (1 placeholder song, engine/crash/checkpoint SFX); title (placeholder), stage intro, ending, credits text; probe M1 layout.

Acceptance:
- M1-T1 `tsc -b` 0, `npm test` and `test:engine` green, BLUM counts unchanged or higher; BLUM engine hash unchanged (no file under `engine/` modified).
- M1-T2 racer ROM header = BLUM cartridge; ld65 map: fixed code <= 24 KiB, each bank <= 8 KiB.
- M1-T3 jsnes: race bot clears each of the 5 placeholder stages with time left, 0 lag, worst-frame free CPU >= 2 000 cycles (target 3 000) with music on.
- M1-T4 jsnes: crash bot -> state 4 then back to 3, time penalty applied; idle bot -> time over -> continue -> same stage start; 3 continues used -> title.
- M1-T5 jsnes: title -> 5 stages (cheat build) -> ending -> credits; "BONNE FÊTE BLUM !" text present in ROM text data.
- M1-T6 Mesen: kernel write dots inside 257-320 on flat, max uphill, crest and hardest-curve frames of each stage; HUD split invisible; same probe outcome as jsnes for each stage replay; 0 Mesen process left.
- M1-T7 dirty boot (0xFF and 3 seeds): reaches the title and drives 600 frames, 0 lag.
- M1-T8 track validator rejects: out-of-range curve/hill, stage not finishable in time, traffic over the sprite budget (FR + EN messages).

### BLUMR-A1: art and music (original only)

Deliverables: Sebring convertible rear view (late 90s / 2000s silhouette, no logo) straight/left/right + spin 4 + flip 2, driver with tuque verte; traffic sprites at 3 sizes (car, bus, déneigeuse, cone, nid-de-poule); 5 backdrops (Galeries d'Anjou, A-40 overpass, Stade olympique tower, croix du Mont-Royal, centre-ville towers + Place Ville Marie beacon), 5 palette sets dusk -> night; title and ending screens; 3 FamiStudio songs (invented stations) + title/ending jingles + SFX; `ASSETS.md` rows.

Acceptance: A1-T1 every asset through the CHROMA converter with 0 NES rule violations and inside the CHR budget (3.4); A1-T2 per-screen palette/tile budget validator green; A1-T3 sound bank <= 8 KiB, each song plays in FamiStudio CLI export (RMS > 0 every second); A1-T4 no emoji, no real station names, no brand logos, no third-party art (ASSETS.md origin column filled); A1-T5 contact sheet in `runs\reports\BLUMR-A1-*.png`.

### BLUMR-M2: stages, flow, package

Deliverables: the 5 real stage JSONs (route in section 5), A1 art and music wired, radio on Select if time (bonus), pause, HUD final, ending + credits, `release\handover\SEBRING.nes` + fiche cartouche FR/EN, gift CADEAU-BLUM new version (1.1.0 [DÉCISION FRED]) with `Jeu SEBRING\` folder and a guide page FR/EN (controls + route).

Acceptance: M2-T1 race bot clears all 5 stages in jsnes and Mesen with the same outcome, 0 lag, free CPU >= 2 000; M2-T2 full chain title -> ending -> credits without cheats with at most 1 continue (bot), both emulators; M2-T3 soak 18 runs x 3 min, 0 hang/softlock; M2-T4 shipped ROM rebuilds byte-identical, sha1 in the fiche; M2-T5 gift: fresh install check passes (BLUM still opens, builds, exports; SEBRING.nes plays in the app); M2-T6 Defender scan no threats; M2-T7 all BLUM tiers green (npm test, test:engine, test:mesen 34/34, test:package).

### BLUMR-W: Warden review

Read-only: independent rebuild, Mesen + jsnes playthrough, dirty boot, budget checks, rights/notices, gift contents, guide text. Verdict + P0/P1/P2 in `runs\reports\BLUMR-W-REVIEW.md`.

### BLUMR-FIX

All P0/P1 and cheap P2 test-first, gift rebuilt, RUNNER rows. Hardware test on Blum's MMC3 board stays open (as for BLUM).

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| CPU: ~12 000 cycles left for everything but the road; cc65 C is slow | hot loops in asm (`hot.s`), CPU guard in the engine tier, cheap wins in 3.1 |
| Sprite overflow with traffic next to the player | density cap in the validator, OAM cycling, flicker reported by the Mesen tier |
| IRQ timing on clone MMC3 boards | no latch 0, writes centred in hblank with 17+ dots of margin on both sides; hardware check open (same as BLUM) |
| jsnes right-edge strip | cosmetic, app only; bonus fix with a BLUM byte-identical guard |
| Far-road curve steps (3.5 px per level at the horizon) | 2 more road banks double the levels if A1/M2 shots show it |
| Time (2.5 days) | floor first, automatic cuts, sequential milestones |

---

## 9. BLUMR-M1 as built (Atlas, 2026-10-21)

### 9.1 Decisions that differ from sections 2-6

- **Pure ca65, no cc65 C** (was: C for flow + `hot.s`). The whole game is `racer/src/sebring.s` (about 2 700 lines). Reason: the kernel leaves ~12 000 cycles; C plus a forked neslib NMI would cost cycles and a second bank protocol for nothing the flow needs. Consequence: no neslib/nesdoug/mmc3_code in the racer ROM, so the credits name only what is in it (FamiStudio, MIT; cc65 tools). The plan's « credits with the neslib/nesdoug notices » becomes « notices of what ships ».
- **Bank protocol simplified**: R7 ($A000) = SOUND bank, set once at reset; music runs in the main thread (FamiStudio data never swapped out). R6 is a road bank for the whole race: the kernel sets it at its start, the NMI maps the live bank after copying `live` (so the main thread reads the live curve table there). Stage banks, text screens and nametables are mapped only by the loaders, with rendering, NMI and IRQ off. No shadow registers needed.
- **HUD on the background**: NT0 row 1 (one 32-tile row) copied by the NMI every race frame (`hud_buf`); the font lives in every stage backdrop bank (tiles $80+, bottom pixel row = sky colour, so the split line stays invisible). Messages (pause, checkpoint, time over, continue, radio station) replace the row.
- **Sound placeholder = BLUM's own songs and effects** (`engine/audio/music.s`, `sfx.s`, copied at build): title = song 0, radios = songs 1-3 (« RADIO ANJOU 104,5 », « MÉTROPOLITAINE FM », « CENTRE-VILLE NUIT »), stage finish 7, game over 8, ending 9; SFX crash, checkpoint, pothole bump, pause, time over, stage card. **No engine sound yet** (an endless engine SFX would take a music channel; A1 decides). A1 replaces the data, the index contract is `RACER_SOUND` in `build-racer.ts`.
- **Traffic projection**: depth z (1 unit = 1 distance unit = 1 stripe unit) -> lines below the horizon `n = 1000 / z` (`ntab`), hills through 26 inverse hill tables in the fixed bank (`inverseHill`), road centre from the live curve table, lane offset 60 % of the half width. Pre-drawn sizes 1x1 / 2x1 / 3x2 tiles. Collisions at depth 9-13 against the lane position at the car's line (`LANE_CAR` = 51 px). At most 5 objects before a new random car; random cars never fill the 3 lanes together.
- **Crashes**: vehicle hit at >= 180 km/h = flip (arc, upside down mid-air), else spin; leaving the road at >= 170 km/h = spin; pothole = -50 km/h, no crash. Penalty 2 s (`CRASH_PENALTY_S`) + the standing start. Recovery puts the car on the road centre at its line.
- **Continue**: time over shows « TEMPS ÉCOULÉ ! » / « START : CONTINUER (n) »; Start = same stage from its start (no card); 10 s without Start or 0 continues = game over screen (state 9, added to 6.2) -> title.
- **Title proposed on screen**: « SEBRING » / « DE L'ANJOU AU CENTRE-VILLE » (still [DÉCISION FRED]).
- **Mesen comparison by game frame**: the emulator frame number drifts by 1-2 frames between jsnes and Mesen at each load (vblank polling); the game's own frame counter does not, so outcomes are compared on it.

### 9.2 Probe (M1 layout, extends 6.2, never reordered)

| Offset | Field | Offset | Field |
|---|---|---|---|
| $1A | time left (s) | $30 | road centre x at the car's line |
| $1B | continues | $31 | paused |
| $1C | crashes (total) | $32-$33 | units to the next checkpoint / finish |
| $1D | stage (0-4, 5 after the last) | $34 | crash kind (1 spin, 2 flip) |
| $1E | checkpoint index | $35 | frames of the current second |
| $1F | radio station | $36 | stages cleared |
| $20-$27 | traffic lane per slot ($80 empty) | $37 | finish banner timer |
| $28-$2F | traffic depth per slot | $38-$3F | traffic kind per slot |
| $40 | test cheats (TEST_CHEATS builds only) | $41 | penalty seconds total |
| $43 | NMI mode (0 off, 1 text, 2 race) | $44 / $45 | title entries / continues used |

States: 0 boot, 1 title, 2 stage card, 3 driving, 4 crash, 5 checkpoint banner, 6 time over, 7 ending, 8 credits, 9 game over.

### 9.3 Measured (release ROM, race bot, title -> 5 stages -> ending -> credits -> title)

| | jsnes | Mesen 2.2.1 |
|---|---|---|
| frames (emulator / game) | 11 718 / 11 682 | 11 720 / 11 682 |
| stages cleared, time left | 32, 41, 42, 40, 38 s, 0 crashes | identical |
| lag frames | 0 | 0 |
| worst-frame free CPU (race frames, music on) | 4 592 cycles | 4 592 cycles |
| kernel writes ($2005 X / R0) | n/a | dots 267-281 / 291-305 on 20 frames (flat, max uphill, crest, hardest curve of each stage), all in hblank |
| HUD split | n/a | line 16, dots 1-14 (plain sky line) |

Fixed banks: $C000 bank 6.1 KiB of 8, $E000 bank 5.6 KiB of 8 (FamiStudio 1.8 KiB, inverse hill tables 3.1 KiB), sound bank 4.3 KiB.

---

## 10. BLUMR-M2 as built (Atlas, 2026-10-21)

### 10.1 What changed

- **A1 kit wired**: `scripts/import-sebring-kit.mjs` (`npm run racer:kit`) copies `NES-BLUM-FACTORY-ASSETS/sebring @ eb84ef4` into `racer/kit/` (CHR, stage banks, screens, palettes, sprite sheet JSON, FamiStudio export); `build-racer.ts` `loadKit` reads only that folder (the factory builds without the assets repo). Without a kit (tests: `kit: false`) the M1 placeholders and BLUM's sounds still build.
- **CHR layout**: units 0-3 road, 4+2i backdrops, 16-19 A1 sprites, 20-27 screens (title R0/R1, ending R0/R1). Stage bank: card palette added at `$8820`. Screens bank: 4 palettes at `+$1000`; `load_screen` maps R0/R1 per screen (`screen_r0/r1`), the card maps R1 = the stage backdrop (the postcard); `race_start` puts R0 back on road A.
- **Cards**: the kit postcard with the track's own « ÉTAPE n / 5 » and names (`kitCard`), so app-edited tracks show their text. Any palette on any backdrop (`stagePalette(look)` = the kit bytes for the kit pairs, tested).
- **Player**: 5 lean poses (hard / soft left, straight, mirrored right), hard pose when steering in a curve >= 16; spin 8 poses x 4 frames (mirrored half); flip with the roll pose at frames 8-15 and 48-55, upside down 16-47; driver head + shoulders, the sprout sways every 16 frames when moving.
- **Sound** (A1 contract `RACER_SOUND`, = `racer/kit/manifest.json`): title 0, radios 1-3 (« RADIO ANJOU 104,5 », « MÉTROPOLITAINE FM », « CENTRE-VILLE NUIT »), clear 4, game over 5, ending 6; SFX `rev` at 60 / 120 / 180 km/h, `skid` every 32 frames in curves >= 20 at >= 160 km/h, `start` at each stage start, `honk` on the title. No continuous engine loop (A1 decision).
- **Ending**: 8 firework bursts (small then large, 48 of every 128 frames, palettes 0 / 3) over the A1 night skyline.
- **Snow storm mode (secret, bonus)**: on the title, B honks (mark over the car); 3 honks then Select toggles it (checkpoint chime, 8 flakes on the title). In the race: white roadside (`SNOW_GRASS` $30, written to the PPU at load and kept over every scenery change), 8 flakes in the sky (lines 24-87, one per line), steering through a sideways speed (`slide`, +-2 px/frame, eases back every 4 frames). Probe `$46` snow, `$47` honks.
- **Credits**: the kit's « DESSINS ET MUSIQUE : BLUMR-A1 » line becomes « DESSINS ET MUSIQUE ORIGINAUX ».

### 10.2 The 5 real-route stages (`racer/tracks/`)

| Stage | Units | Clock (start + checkpoints) | Content |
|---|---|---|---|
| 1 Ville d'Anjou | 4 680 | 57 + 54 + 52 | boulevard des Galeries-d'Anjou, easy bends, cones, first potholes, climb to the A-40 |
| 2 Autoroute Métropolitaine | 5 540 | 56 + 53 + 51 + 35 | concrete roadside, sweepers, roadwork cones, slow bus, overpass up and over, plow |
| 3 Rue Sherbrooke Est | 4 840 | 50 + 49 + 48 + 28 | buses, Jardin botanique (dark grass), « potholes alley » |
| 4 Le Plateau - avenue du Parc | 5 080 | 56 + 48 + 50 + 29 | hills along the mountain, tighter bends (24-26), plow, potholes |
| 5 Centre-ville | 4 980 | 51 + 49 + 49 + 30 | traffic 2-3, buses, plow, cones, finish straight |

Clock per section = ceil(units / 33) + 6 s (8 for the first): every checkpoint is reachable at 64 % of full speed with 3 s to spare (tests/racer-m2.test.ts), the validator's 80 % + 2 crashes rule holds. Race bot (flat out, 0 crashes): 100.7 / 117.3 / 99.2 / 103.9 / 101.9 s, 64-81 s left at each finish, 31 540 game frames to the last finish line (about 9 min with cards and ending). A person (not flat out, a few crashes at 2 s + the restart) lands at about 10-12 minutes; not measured on a human.

### 10.3 App and package

- `src/core/racer/sebring-sample.ts`: the 5 tracks as one JSON (`SEBRING-pistes.json`, same schema and validator). `npm run racer:handover` builds twice (byte-identical or it refuses), writes `release/handover/SEBRING.nes`, split bins, « SEBRING - fiche cartouche.html » / cartridge sheet (BLUM's export code; notices = FamiStudio only), `.dbg`, the tracks file, and the same ROM + tracks into `resources/samples/SEBRING/`.
- App: rom source `sebring` (`session.sebringRom`): reads and validates the tracks file, then hands the prebuilt ROM to the built-in player; « Jeu d'exemple SEBRING » card on the cartridge shelf; the player shows race controls and the route; Help has a SEBRING section. Building the ROM from edited tracks inside the app is not done (the app ships no `racer/` sources); the tracks file is the contract for the future « genre Course ».
- Gift 1.1.0 [DÉCISION FRED, proposed in BLUMR-PLAN]: `Jeu SEBRING/` folder, LISEZ-MOI page 3 (FR + EN: route, controls, radio, rules, a hint for the secret), GUIDE-BLUM section.
- `npm run racer:soak`: 5 kinds (race, crash, idle, player-like random pad, random in snow mode) x 3 seeds x 3 min from dirty boots + one continuous 20-minute race session.

### 10.4 Measured

| | Result |
|---|---|
| ROM | 393 232 bytes, header = BLUM; fixed $C000 7.4 KiB of 8 (ROWTABS 1 024 + KERNEL 206 + CODE 4 227 + RODATA 2 142: 593 bytes left, move code to $E000 next), $E000 5.6 KiB, SOUND 2 799 B; SHA-1 FF345D8E..., CRC32 C336DD0C |
| jsnes / Mesen | same per-stage outcome (stage, time left, crashes, game frame), 0 lag, worst free CPU 3 472 cycles, kernel writes in hblank on 20 frames ($2005 dots 267-287, R0 291-311), HUD split line 16 |
| soak | 16 runs, 234 000 frames (65 min of play), 0 hang / softlock / lag |

## 11. BLUMR-FIX as built (Atlas, 2026-10-21)

Input: `runs\reports\BLUMR-W.md` (verdict GO with fixes). Every fix test-first: `tests/engine/racer-fix.test.ts` failed 3/3 on the M2 source, passes 3/3 after.

| Finding | Fix | Test |
|---|---|---|
| F1 (major) time over: Start compared only the low byte of the 16-bit timer, so a single press was ignored about 6.6 s of the 10 s window, mostly while « CONTINUER » showed | `timeover` `@input`: 16-bit compare, Start counts once timer < 600-30 (only the first 0.5 s is guarded) | one press at +2 s and +7 s continues (stage 0, distance 0, 2 continues left); one press every 30 frames from +40 to +590 continues; +10 is ignored |
| F2 (minor) traffic x read the live curve table with R6 still on the previous frame's road bank until IRQ #2: one-frame sideways jumps up to 102 px on bank flips | `nmi`: right after the `next -> live` copy, R6 = `k_bank` (19 cycles in vblank, then R0 selected again for the kernel); `project` comment fixed | stage 1 race bot: bank flips seen, 0 one-frame jumps (was 19 on the same run) |
| F3 kernel margin | no change; kernel timing re-measured unchanged ($2005 dots 267-282, R0 291-306) | test:racer-mesen |
| F4 crashes only checked in jsnes | `scripts/racer-mesen.mjs` second pass: crash bot (`CFG.kind = "crash"` in `tests/mesen/racer-m1.lua`, same policy as `racerBot(p, 'crash')`) until 8 crashes and back on the road | Mesen = jsnes crash by crash (kind, time left, game frame), spins and flips, a time over + continue inside, kernel writes in hblank mid-crash, 0 lag, free CPU min 4 718 |

ROM: SEBRING.nes 393 232 bytes, SHA-1 2A9985B8942E014385D9A5F9821B78814924A408, CRC32 098D4F02 (byte-identical double build); fixed $C000 589 bytes left (CODE 4 231). The Warden repro scripts (`runs\scratch-blumr-w\continue-window.mjs`, `bankglitch.mjs`) on the new handover ROM: every press after 0.5 s continues; 0 one-frame jumps. Gift `CADEAU-BLUM-1.1.0.zip` rebuilt (SHA-256 df6a347e...), BLUM.nes unchanged (00fa6928). Not redone: racer:soak (65 min) and qa-fresh-install; the change is 2 small code paths covered by the tests above.
