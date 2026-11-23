# NES BLUM FACTORY: milestones M1-M6

Deadline: **Friday 2026-10-23 evening**, ready to give. Plan of record: `docs/PLAN.md`. Test rules: `docs/TEST-STRATEGY.md`.

Version 2 (BLUM-FIX0, applies Warden review `runs\reports\BLUM-W0-REVIEW.md`): M2 and M4 split in two, sequential only, Friday floor (PLAN §12.1) + dated checkpoints, new tests for real-hardware failures and world budgets.

## Calendar

**Sequential only.** One milestone at a time, one agent at a time on box-01 (box-01 load rule, W0 P0-4). If the Conductor wants overlap, the second agent works in a git worktree on its own branch, runs **no** gate (no `npm test`, no cc65 build, no smoke) until the first one has finished, and the Conductor merges.

| Milestone | Target | Builds on |
|---|---|---|
| M0 scaffold (BLUM-PLAN) | Mon 19, afternoon | — |
| M1 shell + design system + project model + agent framework + settings | Mon 19 evening -> Tue 20 noon | M0 |
| M2a toolchain, header, emitter v0, jsnes harness, MMC3 boot + title + probe, dirty boot, Mesen tier | Tue 20 afternoon | M1; **Fred's flasher answer (due Tue 20 09:00)** |
| M2b scrolling demo stage, floor physics, behaviours, walker, HUD IRQ, FamiStudio, `#/play` | Tue 20 evening -> Wed 21 morning | M2a |
| M3 visual director CHROMA (locked palettes, world budget validator) | Wed 21 | M2b |
| M4a REBOND engine side: floor movement, 4 enemies, boss DSL, ROM text screens | Wed 21 evening -> Thu 22 morning | M3 |
| M4b PLUME + REBOND + TABLEAU editors and director flows | Thu 22 morning -> noon | M4a |
| M5 build director end-to-end + export + packaging | Thu 22 afternoon -> 22:00 | M4b |
| M6 polish + bilingual + sample game BLUM | Fri 23 | M5 |

## Dated checkpoints (cuts are automatic, no discussion)

| When | If | Then |
|---|---|---|
| Tue 20 09:00 | no flasher answer from Fred | build MMC3; UNROM-512 is post-gift (PLAN ADR-2) |
| Wed 21 18:00 | M3 is not green | cut CHROMA to backgrounds + a single metasprite per actor |
| Thu 22 12:00 | M4a/M4b are not green | freeze features at the Friday floor; no stretch item starts |
| Thu 22 22:00 | always | **package freeze**. Friday is for M6 polish and the sample BLUM only |

**Friday floor and stretch:** PLAN §12.1 / §12.2. The M4, M5 and M6 gates require the floor only. Each stretch item has its own acceptance case, added to the gate only once the item is built, and hidden behind a feature flag until then.

## Gate for every milestone (headless, from the repo root)

```
npm run typecheck      # tsc -b, 0 errors
npm test               # vitest, all green, test count never lower than the previous row in RUNNER-BLUM.md
npm run build          # renderer + electron bundles (Vite + tsc)
npm run smoke          # hidden Electron window, exits 0, screenshots in .tmp/smoke/
npm run test:engine    # from M2a: real cc65 build + headless jsnes ROM tests (slow tier)
npm run test:mesen     # M2a, M2b, M4a, M6: Mesen test-runner tier (accurate tier, TEST-STRATEGY §1)
npm run test:package   # from M5: packaged app smoke
```

- **Nova's `npm run build` ban does not apply here.** That common rule protects Nova's `.next-prod`. This repo's build is Vite + tsc and it is required by the gate (W0 P1-10).
- Run the commands one after the other, never in parallel. Every heavy script takes `.tmp/gate.lock` (TEST-STRATEGY §2).
- **Green**: commit (`BLUM M<n>: <summary>`), append a row to `RUNNER-BLUM.md`, copy screenshots to `C:\DEV\CODEX\NOVA-COCKPIT\runs\reports\BLUM-M<n>-*.png`.
- **Red**: at most 2 fix strategies, then stop and write the failure in RUNNER-BLUM.md.
- **Never**: skip or weaken tests, leave processes behind, push anywhere.

Each acceptance test ID below must appear in the test name (`it('M1-T3 ...')`) so a reviewer can run one with `npx vitest run -t "M1-T3"`. M2a/M2b share the `M2-` prefix and M4a/M4b the `M4-` prefix; the table says which half owns each test.

---

## M1: shell, design system, project model, agent framework, settings

**Scope**
- `src/core` (pure TS): zod schemas, ProjectStore, ops, journal, undo/redo, zip, DirectorRuntime, LlmProvider (Anthropic, Offline, Fake), prices, usage log.
- `src/preload`: typed IPC.
- Main: KeyVault (safeStorage), process manager, IPC handlers, `.tmp/gate.lock` helper for heavy scripts.
- Renderer:
  - design system: tokens, 9-slice frame, fonts, cursor, synth sounds, i18n;
  - screens: title, cartridge select (original cartridge shape, PLAN §9.1), studio hub (5 stations, no editors yet), director panel shell with a working chat + proposal tray on the Fake/Offline provider, settings, history;
  - `#/gallery` route showing every component.
- Smoke runner supports `--smoke-route=<route>` and writes one PNG per route.
- Feature-flag mechanism for stretch items (PLAN §12.2): a flag off hides the UI and makes the validator reject the matching fields.

**Acceptance tests**

| ID | Test | How |
|---|---|---|
| M1-T1 | Shell navigation: title -> Enter -> cartridge select -> new project -> hub; each screen renders its `data-testid` root | `npm run smoke` with routes `title, cartridges, hub, director/story, settings, history, gallery`; 7 PNGs |
| M1-T2 | Design system: every colour token is a 15-bit step; no pictograph code points in `src/`; only the two chosen OFL fonts are loaded | vitest (CSS/token scan, source scan) |
| M1-T3 | Project create/open/save: folder layout matches PLAN §3; manifest valid; reopen gives an identical state | vitest on a temp dir |
| M1-T4 | Atomic writes and lock: a simulated crash between tmp write and rename leaves the old file intact; a second ProjectStore on the same folder is refused | vitest |
| M1-T5 | Transactions: approve applies ops + journal line + snapshot; undo restores byte-identical files; redo re-applies; the journal is append-only | vitest |
| M1-T6 | Proposal lifecycle with FakeProvider: tool call -> ops -> validation -> pending card -> approve writes / reject writes nothing; an invalid proposal (schema or budget) is never offered and returns a French reason; tool loop stops at the cap | vitest |
| M1-T7 | AnthropicProvider with a mocked fetch: request shape (model, tools, cache_control), streaming parse, usage -> cost from `config/prices.json`, shown as « estimation »; the client is built with an explicit `apiKey` and ignores `ANTHROPIC_API_KEY` set in the environment | vitest, no network |
| M1-T8 | KeyVault: stored file never contains the plaintext key; the renderer API exposes no key getter (`hasKey` and a masked suffix only); log redaction masks `sk-ant-` strings, including inside SDK error objects, `error.message` and request headers; a decrypt failure (key from another PC/user) gives « Clé à saisir de nouveau sur cet ordinateur »; `isEncryptionAvailable() = false` refuses to save, with a reason, and never writes plaintext | vitest (vault with injected cipher) + smoke check of `window.blum` keys |
| M1-T9 | Offline mode: with no key, every director panel opens, says "mode hors ligne" and offers its manual path | smoke route + vitest |
| M1-T10 | i18n: FR default; FR/EN key parity; no literal user-facing text in JSX (scan) | vitest |
| M1-T11 | Zip export/import round-trip gives identical document hashes; an import with `../` paths is refused | vitest |
| M1-T12 | Process hygiene: after smoke, no `electron.exe` from this repo is left | smoke script checks the process list |
| M1-T13 | Gate lock: a second heavy script started while `.tmp/gate.lock` is held waits or exits with a clear message; a stale lock (dead pid) is taken over | vitest |

**Exit evidence:** 7 route PNGs, test count, RUNNER-BLUM row.

---

## M2a: toolchain, boot, harness, accurate tier

**Precondition:** Fred's flasher answer (or the 09:00 default: MMC3, PLAN ADR-2).

**Scope**
- Toolchain: `scripts/fetch-toolchain.mjs` (official cc65 snapshot, SHA-256 pin, NES subset into `resources/toolchain/cc65`).
- Engine base: `engine/` = nesdoug 33_MMC3 **with its bank model as-is** (PLAN §5.3: only $8000 swapped, $A000-$FFFF fixed, SOUND bank swapped in NMI). Only listed deviation: the non-inverted CHR A12 layout (PLAN §5.4).
- Hardware boot rules of PLAN §5.3: reset + vectors in the last bank, `$A001 = $80`, RAM/WRAM initialised, tuning block copied from ROM with magic/version, shadowed bank switches.
- Title screen; probe block $7F00-$7F3F including the lag counter $7F14 (PLAN §5.8).
- `src/core/engine-data` emitter v0 and `src/core/nes`: header parser/writer, ld65 map parser.
- `src/core/emu`: headless jsnes harness (frames, input scripts, probe reader, framebuffer hash, RAM pre-fill for dirty boot, master palette override).
- `npm run test:mesen`: verify MesenCE 2.2.1 `--testrunner` **[U]**, then Lua scripts. If absent: record it in RUNNER-BLUM, M2-T10 becomes the manual check, due before M6.

**Acceptance tests**

| ID | Test | How |
|---|---|---|
| M2-T1 | Toolchain fetch is reproducible: SHA-256 matches; the binaries answer `--version` | `npm run fetch:toolchain`, then vitest (engine tier) |
| M2-T2 | Header: built ROM bytes 0-15 = `4E 45 53 1A 10 10 40 08 00 00 07 00 00 00 00 00`; size 393232; NES 2.0 parser round-trips the header fixtures (MMC3, MMC3+battery, NROM, broken; the mapper 30 fixture is "parse only, no claim" on its mirroring bits) | vitest |
| M2-T3 | Boot: 300 frames -> probe magic `BLUM`, state = title, frame counter advancing, framebuffer not uniform; pressing Start -> state = play | `npm run test:engine` |
| M2-T7 | Determinism: same ROM + same input script = same framebuffer hash at frame 600 | `npm run test:engine` |
| M2-T8 | Budget report: ld65 map parsed into a per-bank usage JSON (SOUND bank against 8 KiB); an oversized bank fixture gives an overflow entry | vitest |
| M2-T10 | Mesen tier: boot to title then play, probe frame counter advances, no PPU write while rendering. Manual Conductor screenshot `BLUM-M2-mesen.png` only if the test runner is absent | `npm run test:mesen` |
| M2-T11 | Dirty boot: CPU RAM $0000-$07FF and WRAM pre-filled with `$FF`, then with a seeded random pattern, before reset -> reaches title and play, and the probe trace over a scripted run is identical to the clean boot | `npm run test:engine` |
| M2-T12 | Hardware-boot layout: the ld65 map shows STARTUP, VECTORS, NMI/IRQ and the bank-switch routines in the last bank ($E000-$FFFF); the reset code writes `$A001 = $80`; no `$8000/$8001` store outside the shadow routine (source scan of `engine/`) | vitest (map + source scan) |
| M2-T13 | Tuning block guard: garbage in $7E00-$7EFF at power-on is replaced by the ROM defaults (magic/version check) | `npm run test:engine` |

The probe's location (WRAM vs internal RAM mirror) is decided by the first M2a test (PLAN §5.8 [U]).

---

## M2b: demo stage, floor physics, HUD, sound

**Scope**
- Engine: horizontal scrolling over the WRAM level buffer; player run, jump, variable jump, coyote time, jump buffer; behaviours solid / one-way / ladder / hazard / pit / checkpoint / exit / collectible; `walker`; OAM cycling; HUD with IRQ split (HUD/font CHR bank swap, latch never 0, content on tile rows 1-3); 1 demo stage of 4 screens.
- FamiStudio driver in the SOUND bank, 1 placeholder song + 2 SFX.
- Emitter v1 (physics, behaviours, level format, actors). `ENGINE_DATA_VERSION` 1 frozen at the end of M2b.
- Renderer `#/play` with jsnes (master palette override), keyboard + gamepad mapping, save/load state.

**Acceptance tests**

| ID | Test | How |
|---|---|---|
| M2-T4 | Movement: hold Right 120 frames -> player x grows by ≥ 100 px; tap A -> y goes up then returns to ground; holding A jumps higher than tapping (variable jump) | `npm run test:engine` |
| M2-T5 | Behaviours on the demo stage: walking into spikes sets dead + cause hazard; reaching the exit sets stage clear; touching a checkpoint then dying respawns at the checkpoint | `npm run test:engine` (input scripts) |
| M2-T6 | Data drives physics: building with `jumpVelocity` +25 % gives a measurably higher apex (probe) than the default build | `npm run test:engine` |
| M2-T9 | Preview: `#/play?rom=demo` shows a non-blank canvas (PNG); save state -> 60 frames -> load state gives the same framebuffer hash | smoke route + vitest |
| M2-T14 | OAM cycling: 5 enemies on one row with the player -> every enemy is visible in at least 1 of 2 consecutive frames (OAM read-back) | `npm run test:engine` |
| M2-T15 | Lag: the demo stage scripted run has **0 lag frames** (probe $7F14) | `npm run test:engine` |
| M2-T16 | Mesen tier: HUD split scanline stable over 600 frames; main loop switching banks continuously while music plays -> no framebuffer glitch, music keeps playing (bank-shadow stress) | `npm run test:mesen` |
| M2-T17 | HUD bank: the HUD rows use the HUD/font CHR bank and the playfield uses the world bank (nametable + bank register read-back); HUD content only on tile rows 1-3 | `npm run test:engine` |

---

## M3: visual director CHROMA (image -> NES graphics)

**Scope**
- `src/core/convert`: steps 1-8 of PLAN §6, in a worker, **clean-room** (NesTiler source never opened), with the **locked palette** mode as CHROMA's default and the free mode for a world's first palette set.
- One master-palette RGB table shared by converter, previews and jsnes.
- `src/core/nes/budgets`: world/scene budget validator (PLAN §6.1), wired into proposal validation and the build.
- Player frames carry their CHR `bank` (PLAN §5.4); the converter output contract is frozen at the end of M3.
- Pixel editor (single tile).
- CHROMA panel: drop zone, target kind, before/after, palette view, tile sheet, budget meters, metasprite frame list, director chat with proposals (settings + result), approve -> files.
- Original placeholder art set in the demo project (player in 2 banks, 4 floor enemies, 3 bosses ≤ 32 px, tilesets, HUD/font bank drawn by us).

**Acceptance tests**

| ID | Test | How |
|---|---|---|
| M3-T1 | Master palette table: 64 entries; `$0D` never chosen; OKLab nearest colour fixtures; the jsnes palette override equals the same table | vitest |
| M3-T2 | CHR codec: golden 8×8 patterns -> exact 16 bytes; decode(encode(x)) = x for random tiles | vitest |
| M3-T3 | Attribute rule: on 50 random/generated images, every 16×16 BG block uses only colours of one subpalette (≤ 3 + backdrop); ≤ 4 BG subpalettes | vitest (property test) |
| M3-T4 | Tile budget: output never has more than 256 unique BG tiles; lossy merge reaches the budget; the report counts match | vitest |
| M3-T5 | Metasprites: 16×24 / 16×32 frames split into 8×8 sprites with offsets/flip/palette; scanline counter flags > 8; total ≤ 64; player frames of one animation share a bank, ≤ 64 tiles per bank | vitest |
| M3-T6 | Fixtures (original images in `tests/fixtures/img/`: gradient photo-like, line drawing, character sheet): budget JSON and preview PNG hash snapshots | vitest |
| M3-T7 | Director flow (FakeProvider): drop image -> proposal -> approve -> `graphics/<id>.{png,json,chr}` written -> build -> the ROM frame region shows the new tiles (hash differs from placeholder) | vitest + `npm run test:engine` |
| M3-T8 | UI: CHROMA panel before/after + budget PNG in FR | smoke route `director/visual` |
| M3-T9 | World/scene budget validator: a player + 3 enemies converted in locked mode use ≤ 4 sprite subpalettes with the fixed roles; the same 4 images converted in free mode are rejected (> 4); a 5th BG subpalette, > 256 BG tiles, > 64 tiles in a sprite bank and a 40 px sprite boss are each rejected with a French reason; 9+ sprites on a scanline from the enemy placement give the flicker warning | vitest |

---

## M4a: REBOND engine side (floor features)

**Scope** (floor only, PLAN §12.1; stretch items only after the Thu 12:00 checkpoint is safe)
- Engine: double jump, ladder climb, projectile attack, hp + knockback + iframes (coyote and jump buffer from M2b).
- Enemies: `hopper`, `flyer`, `shooter` (plus `walker` from M2b).
- Boss DSL: compiler in core (8 ops, ≤ 2 phases on the floor) + interpreter in fixed code.
- Story text screens in the ROM with our own accented 2bpp font (font bank), ending + credits screen with the engine component notices.
- Test-only build flag `NBF_TEST_CHEATS` (PLAN §5.8).

**Acceptance tests**

| ID | Test | How |
|---|---|---|
| M4-T2 | ROM story text: the intro text screen shows (probe state 2); a French accented line renders the accent tiles (tile index check in the nametable) | `npm run test:engine` |
| M4-T3 | Movement features, one input script each on a feature test level. Floor (5 cases): double jump, ladder climb, projectile hit, knockback + iframes, coyote jump off a ledge edge. Stretch cases (wall grab + wall jump, swim, melee, door/pipe warp) join the gate only when built | `npm run test:engine` |
| M4-T4 | Enemy patterns: each of the 4 floor patterns behaves per spec within N frames (walker turns at a wall, hopper hops, flyer oscillates, shooter fires); stretch patterns join when built | `npm run test:engine` |
| M4-T5 | Boss DSL: parser/validator rejects out-of-range ops and > 8 op kinds; a 2-phase boss switches phase at its hp threshold (probe) and can be defeated by a scripted input | vitest + `npm run test:engine` |
| M4-T6 | Live tuning: poking `jumpVelocity` in the $7E00 block changes the jump in the running emulator without a rebuild | vitest (headless harness) |
| M4-T10 | Lag: every M4 feature level has **0 lag frames** over its scripted run; a stress fixture with 6 enemies + projectiles stays under 5 % lag frames | `npm run test:engine` |
| M4-T11 | Mesen tier: the feature levels and the boss fixture boot and run their scripts with the same probe outcome as jsnes | `npm run test:mesen` |
| M4-T12 | Stretch gating: with a stretch flag off, a proposal using that feature (e.g. `wallGrab.enabled = true`, a `turret` enemy, a 12-screen stage) is rejected with a French reason and the UI control is absent | vitest |

---

## M4b: PLUME, REBOND, TABLEAU editors and flows

**Scope**
- PLUME: story schema + form editor + proposals.
- REBOND: physics editor (sliders, presets, live poke of $7E00 in the emulator), enemy and boss forms.
- TABLEAU: grid editor (metatile paint, behaviour overlay, entities), level validator (size ≤ 8 screens on the floor, enemies per screen, spawn not in solid, world budget validator, **reachability warning** from a conservative run + jump + double-jump envelope BFS), proposals.

**Acceptance tests**

| ID | Test | How |
|---|---|---|
| M4-T1 | Story budgets: > 8 worlds, > 4 stages per world, or texts over the text bank budget are rejected with French reasons | vitest |
| M4-T7 | Level validator: spawn in solid, > 6 enemies on a screen, > 8 screens (floor) -> each rejected with a French reason; an exit outside the jump envelope gives the « la sortie semble inaccessible » **warning** (not a rejection); the demo levels pass with no warning | vitest |
| M4-T8 | Director flows (FakeProvider): PLUME proposes a 3-world story; REBOND a physics preset; TABLEAU a stage; all approved -> project builds -> stage playable to exit by an input script | vitest + `npm run test:engine` |
| M4-T9 | UI: PLUME, REBOND, TABLEAU panels PNG in FR and EN | smoke routes |

---

## M5: build director BOULON end-to-end, export, packaging

**Scope**
- BuildPipeline (PLAN §7.1, with the world budget validator and the lag readout), error catalog FR/EN, report UI.
- BOULON fix loop (proposals only, 5 attempts max).
- Export (ROM, split `-PRG.bin` / `-CHR.bin`, cartridge sheet with the PRG-RAM requirement and the « Composants » section, zip, dbg).
- electron-builder packaging, fetch + bundle toolchain, packaged smoke. No Mesen in the package.
- Packaged build: DevTools disabled, no `crashReporter` uploads.

**Acceptance tests**

| ID | Test | How |
|---|---|---|
| M5-T1 | One-click build of the demo project inside the app: report all green, ROM valid | smoke route `build` + vitest |
| M5-T2 | Error catalog: 10 recorded cc65/ld65/validator failures -> French and English explanations; an unknown error is shown raw with the "pas encore connue" note | vitest |
| M5-T3 | Fix loop (FakeProvider): oversized stage -> BOULON proposes a split -> approve -> rebuild green; the loop stops at 5 attempts with a clear message | vitest + `npm run test:engine` |
| M5-T4 | Export: the cartridge sheet values equal the parsed header (mapper, sizes, battery, mirroring, region) and the CRC32/SHA-1 of the exported files; `-PRG.bin` + `-CHR.bin` concatenated after the 16-byte header equal the `.nes` byte for byte; the sheet shows the bold PRG-RAM 8 KiB requirement line and a « Composants » section with the nesdoug.lib MIT, neslib and FamiStudio notices; the sheet exists in FR and EN | vitest |
| M5-T5 | Packaging: `npm run package` -> zip; extracted under a path with spaces and accents; `NES BLUM FACTORY.exe --smoke` exits 0 and builds the demo ROM with the bundled cc65 | `npm run test:package` |
| M5-T6 | Package contents: no `node_modules` dev dependencies, no `.env`, no Mesen; `licenses/` present for every bundled third-party component (font OFL texts included); Electron `LICENSE` and `LICENSES.chromium.html` present; DevTools cannot be opened in the packaged build; size reported | `npm run test:package` |
| M5-T7 | Defender scan of the extracted folder reports nothing (box-01, Conductor) | manual, note in RUNNER |

---

## M6: polish, bilingual, sample game BLUM

**Scope**
- Full FR/EN pass, title animation, sounds, onboarding ("Ta première cartouche": 5 steps through the 5 directors), empty/error states, offline coverage, usage panel, history panel polish, Help page (flashing guide incl. chip programmers and the PRG-RAM requirement, « Débloquer » the zip, SmartScreen note, MesenCE link).
- Sample game **BLUM** made *through the app* as a **FakeProvider replay of hand-authored proposals** (PLAN §12.3), approved through the normal flow:
  - floor: 3 worlds × 1 stage, 3 bosses, ending;
  - original art and the floor music library (3 songs + 6 SFX);
  - Fred decides whether to add one real Claude run himself.

**Acceptance tests**

| ID | Test | How |
|---|---|---|
| M6-T1 | Every route screenshot in FR and EN; no missing key, no overflowing text (DOM overflow check on each route) | smoke (all routes × 2 locales) |
| M6-T2 | No pictographs, no Nintendo terms in UI strings ("Nintendo", "Super Nintendo", "SNES", "Famicom" only allowed in Help's hardware compatibility text) | vitest scan |
| M6-T3 | BLUM project folder is valid (all schemas, world budget validator), builds green, header/size correct | `npm run test:engine` |
| M6-T4 | BLUM playthrough, no single full-game recording: one hand-written input script **per stage** from a debug start (`START_LEVEL`) reaches stage clear, one script per boss defeats it, and an `NBF_TEST_CHEATS` build (invincible + stage skip by probe poke) reaches the ending (probe state 7) within the frame limit | `npm run test:engine` |
| M6-T5 | Onboarding works offline end-to-end (new project -> build -> play -> export) | smoke flow |
| M6-T6 | Final package: M5-T5 + M5-T6 on the release build, BLUM project included as a sample | `npm run test:package` |
| M6-T7 | Warden review (read-only) + Fred sign-off + BLUM.nes on hardware if Fred can | manual |
| M6-T8 | Mesen tier on `BLUM.nes`: every stage script and the cheat run give the same probe outcome as jsnes; 0 lag frames on every stage | `npm run test:mesen` |

**Handover:**
- `NES-BLUM-FACTORY-1.0.0-win-x64.zip`
- `BLUM.nes`, `BLUM-PRG.bin`, `BLUM-CHR.bin`
- `BLUM - fiche cartouche.html`
- a one-page French guide for Blum (« Débloquer » the zip, enter his own API key on his PC, PRG-RAM board).
