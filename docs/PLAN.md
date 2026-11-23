# NES BLUM FACTORY: architecture plan

Version 2, 2026-10-19 (step BLUM-FIX0, agent Atlas: applies Warden review `runs\reports\BLUM-W0-REVIEW.md`, all P0/P1 and the cheap P2). Version 1: step BLUM-PLAN. Inputs: `runs\prompts\BLUM-BRIEF.md`, `runs\reports\BLUM-R-RESEARCH.md`, BRKN Scene Creator V3 (stages, directors, spec files) and Cold Call Arena (art direction, read only).

Review references such as (W0 P0-2) point to the Warden finding behind a rule.

Markers:
- **[DÉCISION FRED]** = décision prise au nom de Fred, à confirmer.
- **[U]** = not verified yet; the milestone that first touches it must verify it.

---

## 0. Résumé pour Fred

- **L'app :** une application Windows (Electron), livrée en dossier zippé. Blum double-clique sur `NES BLUM FACTORY.exe` et n'installe rien d'autre : le compilateur NES (cc65) et l'émulateur intégré sont dedans. Mesen n'est pas inclus (lien dans l'aide). **[DÉCISION FRED]**
- **Les directeurs :** cinq personnages, chacun avec son panneau : PLUME (histoire), CHROMA (graphismes), REBOND (mouvements), TABLEAU (niveaux), BOULON (construction de la ROM). Ils **proposent**, Blum **approuve**, et seulement ensuite on écrit dans le projet. Chaque proposition peut être annulée. Les noms sont **[DÉCISION FRED]**.
- **L'IA écrit des données, jamais du code.** Le moteur de jeu NES est écrit une fois à la main et testé. Les directeurs remplissent des fichiers (physique, niveaux, ennemis, boss, graphismes). Résultat : un jeu se construit toujours.
- **La cartouche : MMC3 (mapper 4)**, 256 Ko de programme, 128 Ko de graphismes, 8 Ko de RAM. C'est le format le mieux supporté par les flashers et les cartouches de dev. **[DÉCISION FRED]** Il faut une carte **avec 8 Ko de RAM** (type TKROM/TSROM, ou n'importe quelle cartouche flash type EverDrive) : sans cette RAM le jeu plante. Il nous manque une seule info : **le modèle exact du flasher de Blum, à donner avant mardi 20 à 9 h**. Le plan B (UNROM-512, mapper 30) coûte plus de deux jours : sans réponse, on fait MMC3 et le plan B passe après le cadeau.
- **Claude :** Blum entre sa propre clé API Anthropic. Elle est chiffrée par Windows et n'est jamais affichée ni écrite dans un journal. La connexion avec un compte claude.ai est interdite par Anthropic pour ce genre d'app. **Sans clé, l'app marche quand même** : éditeurs à la main et modèles prêts à l'emploi. **[DÉCISION FRED]**
- **Le look :** esprit menus 16 bits, cadres en pixels, police pixel libre, curseur et sons maison, thème « fleur » (Blum = bloom). Rien de Nintendo, aucun emoji.
- **Le calendrier :** une étape à la fois, jamais deux en même temps (la machine a planté deux fois sous charge). M1 lundi soir à mardi, M2a puis M2b mardi, M3 mercredi, M4a puis M4b mercredi à jeudi, M5 jeudi, M6 vendredi.
- **Le minimum garanti pour vendredi (« plancher ») :** courir, sauter, double saut, échelle, un tir, 4 ennemis, des boss simples, 3 mondes d'un niveau chacun, 3 musiques. Tout le reste (sauts muraux, nage, portes, autres ennemis…) est en bonus, seulement si on est en avance (section 12).
- **Le jeu d'exemple BLUM** est fait dans l'app en rejouant des propositions écrites à l'avance (les agents n'ont pas le droit d'utiliser une clé API). Fred peut décider d'en faire une vraie session lui-même.

---

## 1. Principles

1. **Data, not code.** Directors write validated JSON documents. A hand-written, tested engine reads them. No AI-written C or 6502 in v1. The Build director can only change data, engine options and boss/event scripts in a small DSL that the engine interprets (section 5.7).
2. **A project always builds.** Every proposal is checked against schemas and NES budgets before it is shown. Every engine input has min/max limits. A new project starts from a demo game that builds.
3. **Propose, approve, write.** Nothing reaches the project without a human approval. Every approval is a journaled, undoable transaction.
4. **Works offline.** No key or no network still gives a working app: manual editors, templates, build, play, export. AI is an accelerator, not a dependency.
5. **French first.** Default locale `fr` (Québec), English second. Every UI string comes from the dictionaries.
6. **Original look only.** No Nintendo logos, fonts, characters, hardware likeness or trade dress. No emoji or pictographs, no AI-cliché icons (sparkles, wands, robots).
7. **Headless-testable.** Core logic is pure TypeScript with no Electron import. ROMs are tested by a headless emulator with input scripts and a RAM probe. The UI is tested by a hidden-window smoke run that writes screenshots.
8. **Clean processes.** Every child process (cc65, ld65; Mesen in the dev-time test tier) runs with a timeout and is killed on app quit. Tests never leave windows or processes behind.
9. **One heavy job at a time.** Milestones run one after the other on box-01, never in parallel (box-01 load rule, W0 P0-4). Every heavy script (cc65 builds, engine tier, Mesen tier, smoke, package) takes the repo lock `.tmp/gate.lock` (TEST-STRATEGY §2).

---

## 2. Architecture

```
+-------------------------------- Electron app ---------------------------------+
|  Renderer (React, sandboxed)          |  Main process (Node)                   |
|  - Shell: title, cartridges, hub      |  - IPC handlers (typed, validated)     |
|  - Director panels (chat + proposals) |  - ProjectStore (files, journal, lock) |
|  - Editors: story, physics, actors,   |  - DirectorRuntime (prompt, tools,     |
|    level grid, tiles, pixel editor    |    proposals, tool-loop cap)           |
|  - Emulator view (jsnes, canvas,      |  - LlmProvider: Anthropic | Offline |  |
|    WebAudio, gamepad)                 |    Fake (tests)                        |
|  - Settings, export, usage readout    |  - KeyVault (safeStorage / DPAPI)      |
|                                       |  - BuildPipeline (emit, cc65, ld65,    |
|          preload: window.blum         |    validate, headless run, report)     |
|          (typed IPC, no Node)         |  - Converter worker (image -> CHR)     |
+---------------------------------------+----------------------------------------+
        |                                          |
        v                                          v
  src/core (pure TS, shared, unit-tested)    resources/ (packaged, read-only)
  - schemas (zod), project model, ops        - toolchain/cc65 (pinned)
  - nes/: palette, chr, header, budgets      - engine/ (C + asm template)
  - converter, engine-data emitter           - licenses/
  - directors: specs, prompts, validators
  - build: error catalog, report
```

### 2.1 Repository layout (target)

```
NES-BLUM-FACTORY/
  docs/                 PLAN, MILESTONES, TEST-STRATEGY
  src/
    core/               pure TS, no electron/react imports (lint test enforces it)
      schema/           zod schemas for every project document
      project/          ProjectStore, ops, journal, migrations, zip
      nes/              master palette, CHR codec, NES 2.0 header, ld65 map parser
        budgets/        world/scene budget validator (palettes, tiles, sprites per line; §6.1)
      convert/          image -> NES converter
      engine-data/      project JSON -> generated .s / .h
      directors/        DirectorSpec x5, prompt builders, tool schemas
      llm/              LlmProvider, AnthropicProvider, OfflineProvider, FakeProvider, prices
      build/            pipeline, error catalog (FR/EN), report
      emu/              headless jsnes harness, RAM probe reader, input scripts
    main/               Electron main: windows, IPC, KeyVault, process manager
    preload/            contextBridge API (typed)
    renderer/           React UI, design system, screens
    shared/             i18n dictionaries, app constants, IPC types
  engine/               NES engine source (C + ca65), cfg, demo project
  resources/            toolchain (fetched, gitignored), licences
  scripts/              smoke, fetch-toolchain, package
  tests/                vitest (unit, integration, rom, ui)
```

M0 (this step) ships only `src/main`, `src/renderer`, `src/shared`, `tests`, `scripts/smoke.mjs`. M1 adds `src/core` and `src/preload` (preload currently lives in `src/main/preload.ts`; M1 moves it).

### 2.2 Process and security boundaries

- Renderer: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict CSP, navigation and popups blocked. Done in M0.
- All file, network, AI and process access lives in main. IPC channels are a fixed list; every payload is parsed with zod in main.
- The API key never crosses IPC to the renderer. The renderer only sees `hasKey: boolean` and a masked suffix.
- No HTTP server in the shipped app. Vite dev server only during development, on port **5181** (`127.0.0.1`, strict port). Ports 3000/3001, 3025, 3456-3462, 4023, 1234, 5432, 8188, 11434/11435 are never used.

---

## 3. Project model and file format

A project is a plain folder, readable and diffable, named `<Titre>.blum/` under `Documents\NES BLUM FACTORY\` by default.

```
MonJeu.blum/
  project.json          manifest: format "nbf-project", schemaVersion, id (ULID), title, locale,
                        engineDataVersion, createdAt, updatedAt
  cartridge.json        cartridge profile: mapper, PRG/CHR/WRAM sizes, battery, region (section 5.1)
  story.json            title, premise, worlds[], stages[], bosses[], power-ups, ending, texts (fr/en)
  physics.json          player movement parameters (section 5.5)
  actors/<id>.json      player, enemies, bosses: graphics ref, AI pattern + params, hp, damage, drops
  scripts/<id>.json     boss phases and events in the script DSL (section 5.7)
  graphics/
    sources/<id>.png    original image as dropped (never modified)
    <id>.json           conversion settings + result (palettes, tile map, metasprite frames, budget)
    <id>.chr            generated 2bpp tiles
    palettes.json       palette sets per world (4 BG + 4 sprite subpalettes, backdrop); the source
                        of truth every conversion is locked to (§6.1)
  tilesets/<id>.json    metatiles: 4 tile indices, palette, behaviour (section 5.6)
  levels/<id>.json      size in screens, metatile grid (column RLE), entities, checkpoints, exits, music
  audio/library.json    song and SFX choices per world (from the built-in library)
  directors/<id>.jsonl  chat log per director (no keys, no raw API payloads)
  proposals/<id>.json   proposals with state pending | approved | rejected | superseded
  history/
    journal.jsonl       one line per applied transaction: id, director, ops, docs, hashes before/after
    snapshots/<txId>/   copies of every document the transaction changed, taken before the change
  build/                last ROM, logs, report, save states (excluded from zip export)
  .lock                 pid + start time; a second writer is refused
```

Rules:
- Every document has `schemaVersion`. Loading runs migrations up to the current version, then validates with zod. An invalid document opens read-only with a clear French message, never silently fixed.
- Writes are atomic: write `name.tmp`, flush, rename. A crash leaves the old file or the new file, never half of one.
- **Undo / redo** works per transaction: undo restores the snapshot and appends an `undo` entry to the journal (nothing is erased). The history panel lists transactions with director, time and summary.
- **Export**: zip of the folder without `build/` and `.lock`. **Import**: unzip to a new folder, validate every document, reject paths escaping the folder.
- IDs are stable ULIDs. Renaming a level or a world never changes its ID.
- Units: positions in pixels; speeds and accelerations in subpixels of 1/256 px per frame (8.8 fixed point, the engine's native unit). The UI shows px/frame with two decimals.

---

## 4. Agent framework (directors)

Inspired by Scene Creator V3 stages (inputs, outputs, bypass) and the nes-builder `StageDefinition`, with an approval step added.

### 4.1 Directors

| Id | Name **[DÉCISION FRED]** | Role | Writes | Bypass without AI |
|---|---|---|---|---|
| `story` | PLUME | idea -> NES-sized game: title, premise, worlds, stages, bosses, enemies, power-ups, ending, difficulty curve, all inside the cartridge budget | story.json, actors (stubs), audio/library.json | story form + 3 templates |
| `visual` | CHROMA | image -> real NES graphics; palettes, tilesets, metasprites, budget | graphics/*, tilesets/*, palettes | manual converter + pixel editor |
| `movement` | REBOND | player physics, attacks, enemy AI, boss patterns, as engine parameters | physics.json, actors/*, scripts/* | sliders with presets ("léger", "lourd", "flottant") |
| `level` | TABLEAU | stage maps, tile behaviours, enemy and item placement, boss arenas | levels/*, tilesets (behaviours) | grid editor |
| `build` | BOULON | assemble, compile, validate, run, explain problems, propose fixes, export | build/*, cartridge.json; fixes go through other documents as proposals | "Construire" button |

### 4.2 DirectorSpec

```ts
interface DirectorSpec {
  id: 'story' | 'visual' | 'movement' | 'level' | 'build';
  nameKey: MessageKey;            // i18n
  portrait: PortraitId;
  defaultModel: ModelId;          // section 10, ADR-4
  contextSlice(project): unknown; // only the documents this director needs, compacted
  systemPrompt(locale, limits): string; // NES limits + engine data contract + house rules
  tools: ToolSpec[];              // each tool produces Ops, never writes directly
  validate(ops, project): ValidationResult; // schemas + budgets + reachability (levels)
}
```

### 4.3 Proposal lifecycle

1. Blum chats in the director's dialog box (typewriter text, portrait).
2. The director answers in text and/or calls a tool, for example `propose_level`, `propose_physics` or `propose_palette_set`. Tool inputs are typed JSON schemas.
3. Core turns the tool call into **Ops** (`set`, `patch` with JSON Pointer, `add`, `remove`, `addAsset`) and dry-runs them on an in-memory copy. It then runs schema validation, budget checks (CHR tiles, PRG bank sizes, text bytes), the **world/scene budget validator** (§6.1: palettes, tiles and sprites per scanline across everything on screen at once, not per image) and director checks such as the level reachability warning (§5.6).
4. A failed check never reaches Blum as an option to approve. The failure goes back to the director as a tool error (at most 2 automatic retries), then shows as "PLUME n'a pas réussi : <raison>".
5. A valid proposal becomes a **card**: summary in French, diff (form view + raw JSON), budget delta bars, warnings. Buttons: **Approuver**, **Modifier puis approuver**, **Refuser**, **Demander un changement**.
6. Approve -> one transaction (snapshot, atomic writes, journal line). Optional automatic rebuild + preview.
7. Batch proposals (e.g. the 12 stages of a story) can be approved all at once or item by item, still by a human click.

### 4.4 LLM provider abstraction

```ts
interface LlmProvider {
  id: 'anthropic' | 'offline' | 'fake';
  available(): Promise<{ ok: boolean; reason?: string }>;
  send(req: {
    model: ModelId; system: SystemBlock[]; messages: Msg[]; tools: ToolSpec[];
    maxTokens: number; signal: AbortSignal;
  }): AsyncIterable<StreamEvent>; // text deltas, tool calls, final usage
}
```

- `AnthropicProvider`: `@anthropic-ai/sdk` Messages API, streaming, tool use, prompt caching on the large system prompts (engine contract + NES limits). Runs in main only.
  - The client is constructed with an explicit `apiKey` from KeyVault and SDK logging off. It never reads `ANTHROPIC_API_KEY` or any env-derived key, and main never forwards one (W0 P1-9).
- `OfflineProvider`: no network. It answers with deterministic templates and opens the manual editor. Directors show "mode hors ligne".
- `FakeProvider`: scripted fixtures for tests (inputs -> tool calls). Every director flow has a fake-driven test.
- Tool loop cap: 6 model turns per user message (Build director: 5 build attempts max per request).
- Cancel at any time (AbortSignal).

### 4.5 Usage and cost readout

- Every call records `{ts, projectId, director, model, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, costUsd}` in `%APPDATA%\NES BLUM FACTORY\usage.jsonl` and in the project's director log.
- Cost is computed locally from `config/prices.json`, which stores the date and source URL. The research prices must be **re-checked on the pricing page at M1** **[U]** (the Haiku 5.5 figure in the research looks an order of magnitude off, W0 P2-7). `prices.json` stays editable in the app data folder.
- Every amount is labelled **« estimation »**.
- UI: the cost of each answer under the bubble, totals per director, per session and per month in Settings. Optional monthly soft cap: at the cap, directors pause and ask.

---

## 5. Data-driven NES engine

### 5.1 Cartridge profile (default) **[DÉCISION FRED]**

| Field | Value |
|---|---|
| Mapper | 4 (MMC3, TxROM), NES 2.0 header, submapper 0 |
| PRG-ROM | 256 KiB (32 banks of 8 KiB), can grow to 512 KiB |
| CHR-ROM | 128 KiB (128 banks of 1 KiB), can grow to 256 KiB |
| PRG-RAM | 8 KiB at $6000-$7FFF, battery **off** by default. **Required**: TKROM/TSROM-class board or any flash cart. TLROM-style repro boards without PRG-RAM crash (stack and physics live there) (W0 P0-1) |
| Mirroring | software-controlled (MMC3 $A000) |
| Region | NTSC |
| Header | `4E 45 53 1A 10 10 40 08 00 00 07 00 00 00 00 00` (battery: byte 6 = `42`, byte 10 = `70`) |
| ROM size | 16 + 262144 + 131072 = **393232 bytes** |

**"PRG-RAM 8 KiB required (TKROM/TSROM-class board, or any flash cart)"** is printed on the cartridge sheet (§7.4) with a bold French line, and the engine enables it at reset (§5.3).

### 5.2 Language and libraries

- cc65 C for game logic. ca65 assembly for reset/NMI/IRQ, OAM upload, metatile collision hot loops and MMC3 bank switching.
- Base: nesdoug `33_MMC3` (MIT) for the cfg, crt0, IRQ and `banked_call`, **taken with its bank model as-is** (§5.3, W0 P1-1); neslib (public domain) and nesdoug.lib (MIT) for PPU, OAM, pads, VRAM buffer and metatiles. Movement and scroll logic are studied from nesdoug `17_Platformer` and `26_Full_Game`, then rewritten for the data contract.
- Music and SFX: FamiStudio sound engine (ca65 version), features limited to what the library songs use.

### 5.3 Memory map (MMC3 PRG mode 0)

This is nesdoug 33_MMC3's model, kept as-is (W0 P1-1): only $8000 is swapped; $A000-$FFFF never changes after init. There is no banked-code slot at $A000 in v1.

| CPU range | Content |
|---|---|
| $0000-$07FF | zero page, OAM buffer at $0200, engine state, VRAM buffer |
| $6000-$6FFF | decompressed level / collision buffer of the current stage: column-major, 16 bytes per column (13 used), so a cell is `$6000 + (x & $FFF0) + row` (M2: 4096 bytes for 16 screens, 2048 for the 8-screen floor) |
| $7000-$7DFF | cc65 C stack + BSS overflow |
| $7E00-$7EFF | **live tuning block**: copy of the physics parameters; the emulator preview can poke it without rebuilding |
| $7F00-$7F3F | **test probe block** (section 5.8) |
| $7F40-$7F7F | reserved |
| $7F80-$7FFF | save data (battery builds only): magic + version + data + checksum |
| $8000-$9FFF | swappable (R6): world data (level maps, metatiles, enemy tables, texts), `banked_call` code, and the SOUND bank while the NMI runs |
| $A000-$BFFF | fixed after init (R7 = bank 29, set once at reset like nesdoug's `set_prg_a000`): enemy AI, boss script interpreter, title, story screens |
| $C000-$DFFF | fixed (second-to-last bank): engine core, neslib, nesdoug.lib |
| $E000-$FFFF | fixed (last bank): reset code, NMI/IRQ, MMC3 bank-switch routines, vectors |

Bank numbers (256 KiB = banks 0-31): 0-27 data / `banked_call`, 28 SOUND, 29 at $A000, 30 at $C000, 31 at $E000. Budget: fixed code ≤ 24 KiB ($A000-$FFFF), SOUND bank = 1 × 8 KiB, data/banked_call banks ≤ 28 × 8 KiB. The ld65 map file is parsed after each build; per-bank usage (including the SOUND bank against 8 KiB) is shown in the budget panel and is a build error when exceeded.

**Engine rules (hardware boot, W0 P0-3 / P1-2 / P1-7).** jsnes does not catch any of these, so the Mesen tier and the dirty-boot test (TEST-STRATEGY §1) do.
- **Reset in $E000-$FFFF.** MMC3 R6, R7 and $8000 are unspecified at power-on. STARTUP and VECTORS stay in the last bank, as in nesdoug's cfg ("make sure the reset code is in e000-ffff"). The reset code sets R6/R7/CHR banks before anything leaves $E000. "Cleaning up" the cfg is forbidden.
- **WRAM enable.** Reset writes `$A001 = $80` (nesdoug `_set_wram_mode`), keep it when forking.
- **No trust in RAM at power-on.** All CPU RAM and WRAM is cleared or initialised by code. At reset the tuning block is copied from ROM defaults, guarded by a magic + version check, so garbage WRAM never becomes physics.
- **Shadowed bank switches.** Every `$8000/$8001` write goes through the shadow-register routine (nesdoug `bank_swap_common` stores `mmc3_8000` before writing). The NMI swaps in the SOUND bank, runs FamiStudio and restores the shadow. The IRQ (HUD split) does the same when it touches CHR banks.
- **Vblank budget.** Column updates, attribute writes, palette and OAM DMA fit in the NMI (about 2270 CPU cycles). No PPU write while rendering.
- **Battery builds.** WRAM is write-protected (`$A001 = $C0`) outside save writes. Probe writes happen before the protect, or the probe moves to internal RAM ($0700-$073F) in battery release builds.
- **Music.** One dedicated SOUND bank holds the FamiStudio data for every song and SFX (shared by all worlds), 8 KiB budget (W0 P1-2).

### 5.4 CHR layout (MMC3 CHR mode 0)

- Background at PPU $0000: 2 × 2 KiB banks = 256 tiles per world/scene (R0, R1).
- Sprites at PPU $1000: 4 × 1 KiB banks (R2-R5) = player (64 tiles), common (items, projectiles, HUD bits), world enemies, boss/extra.
- This is the standard A12 layout for the MMC3 IRQ (BG $0000, sprites $1000). nesdoug 33_MMC3 uses `A12_INVERT`; we deliberately do **not**. This is the one listed deviation from the nesdoug base, with its own M2a test (HUD split stable).
- 8×8 sprites in v1 (simpler converter, standard metasprites).
- Each world selects its banks at load: no runtime tile uploads, and the converter just emits aligned `.chr` banks.

**HUD (W0 P2-1, P2-8).**
- The HUD uses the MMC3 scanline IRQ for a fixed status bar, 2 metatiles high (y = 0..31). Content sits on tile rows 1-3 only, because NTSC TVs crop roughly the top 8 px.
- **HUD and font have their own BG CHR bank.** The NMI maps the HUD/font 2 KiB bank into R0. The IRQ at the end of the HUD maps the world's R0 back and sets the scroll. The world keeps its full 256 BG tiles. Story text screens use the same font bank.
- **IRQ latch is never 0** (MMC3A/NEC fire once, MMC3B/C fire every line, W0 P0-3.5).
- **Split timing (M2, measured on Mesen).** Reload value 30: the IRQ fires at the end of line 29; `$2000` and `$2005` land before line 31's dot 257, three short waits put the CHR R0 switch at dots 298-315 of line 31 (hblank), after its last fetch and before line 32's prefetch. HUD lines 30-31 are uniform. The playfield scroll is double-buffered: the main loop writes it, the NMI copies it into the split commands on finished frames only, so background and sprites move on the same frame (a Mesen bank-stress run caught the race).
- BG subpalette 0 is shared by the HUD and the world: its 3 colours are the HUD's, world tiles may use them. The world therefore has 4 BG subpalettes, one of them fixed by the HUD.

**Sprite palettes, fixed roles (W0 P0-2).** 0 = player, 1 = common (items, projectiles, HUD sprites), 2-3 = world enemies + boss.

**Player CHR (W0 P0-2.4).**
- A 16×32 frame is 8 tiles, so one 1 KiB bank holds at most 8 unique frames.
- The player owns up to **4 × 1 KiB banks** in CHR-ROM. R2 is switched per animation group by the NMI (one register write, cheap on MMC3).
- Rule for the converter output contract (frozen at M3): every frame carries its `bank` (0-3). All frames of one animation live in the same bank, ≤ 64 tiles per bank after dedupe.
- Floor grouping: bank 0 = idle, run ×3, hurt; bank 1 = jump, fall, climb, attack. Stretch animations (wall grab, swim) go to banks 2-3.
- **Built in M3.** `gen/data.s` has `_player_ms_bank` (one byte per player metasprite). The main loop sets `nbf_player_chr`; the NMI copies it into the HUD split array on finished frames only (with the OAM of the same frame), and the array's pre-frame `F9` command writes R2 in vblank. `irq_array` layout: `[0..1] F7 font`, `[2..3] F9 player bank`, `[4] split line`, `[5..6] $2000`, `[7..8] $2005`, `[9..11] waits`, `[12..13] F7 world bank`, `[14] FF`; the NMI rewrites offsets 3, 6 and 8 (M2-T12 checks both sides). Mesen tier re-run green after the change.

**Sprites on screen (W0 P0-2.3).**
- **OAM cycling.** The player is drawn first; enemies are drawn forward on even frames and backward on odd frames (M2), so with up to 6 enemies on one line every one is drawn at least every second frame: a 9th sprite on a line flickers instead of disappearing (M2-T14).
- 64 hardware sprites total; the world/scene validator (§6.1) checks the worst case per scanline.
- Bosses are ≤ 32 px wide as sprites (4 per line + the player's 2 = 6). Wider bosses would have to be BG-drawn, which is out of v1.

### 5.5 Player physics contract (`physics.json`)

All values are integers with enforced min/max (the editor and the validator share the same table):

| Group | Parameters |
|---|---|
| Ground | `walkAccel`, `runMax`, `friction`, `turnBoost` |
| Air | `gravity`, `maxFall`, `airControl` |
| Jump | `jumpVelocity`, `jumpCut` (variable height), `coyoteFrames`, `jumpBufferFrames` |
| Double jump | `enabled`, `velocity` |
| Walls | `wallGrab.enabled`, `wallSlideSpeed`, `wallJump.{x, y, lockFrames}` |
| Ladders | `climbSpeed`, `canJumpOff` |
| Water | `swim.enabled`, `swimGravity`, `strokeVelocity`, `maxSwimFall` |
| Attack | `melee.{enabled, frames, hitbox}`, `projectile.{enabled, speed, maxOnScreen, cooldown}` |
| Health | `hp`, `knockback.{x, y}`, `iframes` |
| Doors/pipes | `enterDelayFrames` |

**Friday floor vs stretch (§12).** The schema has every field from day one, so the contract never breaks. The engine implements the floor groups first: Ground, Air, Jump (incl. coyote + buffer), Double jump, Ladders, `projectile`, Health (hp + knockback + iframes). Walls, Water, `melee` and Doors/pipes are stretch: until they are built, their `enabled` flags are forced off by the validator, and their UI is hidden by a feature flag.

### 5.6 Tile behaviours (4 bits per metatile)

`0` empty, `1` solid, `2` one-way platform, `3` ladder, `4` wall (grabbable), `5` wall (slippery, no grab), `6` hazard (spikes, lava: kills), `7` water, `8` breakable, `9` collectible spawn, `10` checkpoint, `11` exit, `12` door/pipe entry (target room + spawn point), `13` conveyor left, `14` conveyor right, `15` reserved. Pits kill when the player falls below the screen.

Floor behaviours: solid, one-way, ladder, hazard, pit, checkpoint, exit, collectible. The others (walls, water, breakable, doors, conveyors) are stretch, rejected by the validator until built.

Levels: horizontal scrolling, one screen high (13 playfield rows of 16×16 under a 2-row HUD). **No vertical scrolling in v1.**
- **Floor:** single-room stages of ≤ 8 screens (128 metatile columns).
- **Stretch:** up to 16 screens wide (256 columns); rooms joined by doors/pipes for a vertical feel (a stage = up to 4 rooms).
- The decompressed stage lives in the WRAM level buffer (§5.3).

**Reachability is a warning, not a rejection (W0 P0-4.6).** A conservative jump-envelope BFS (run + jump + double jump only, current physics) warns "la sortie semble inaccessible". A full proof with wall jumps and doors is a research problem and is not attempted.

### 5.7 Enemies, bosses, script DSL

- Enemy AI patterns (enum + params): `walker` (turn at wall / at ledge), `patrol` (between two points), `hopper`, `flyer` (sine), `chaser` (horizontal homing), `shooter` (aimed or fixed), `turret`, `dropper`.
  - **Floor:** `walker`, `hopper`, `flyer`, `shooter`. The other 4 are stretch (rejected by the validator until built).
  - Per enemy: hp, contact damage, speed, projectile type, drop, graphics ref.
  - Sprite budget: at most 6 active enemies per screen, plus the per-scanline check of §6.1 (validator).
- Bosses: phases selected by hp thresholds. Each phase is a looped list of steps from a fixed op set of 8: `move_to x`, `wait n`, `jump vx vy`, `shoot pattern`, `spawn enemy`, `charge speed`, `vulnerable on|off`, `flash`. Floor: ≤ 2 phases.
  - Compiled by core to a byte stream; interpreted by the engine in fixed code at $A000 (§5.3).
  - This DSL is the only "behaviour" channel the Build director has. It cannot express anything that can crash the engine (validator + interpreter bounds).

### 5.8 Test probe (WRAM $7F00-$7F3F)

| Addr | Field |
|---|---|
| $7F00-$7F03 | magic `B L U M` |
| $7F04 | engine data version |
| $7F05 | game state: 0 boot, 1 title, 2 story text, 3 play, 4 dying, 5 stage clear, 6 boss, 7 ending, 8 game over |
| $7F06 / $7F07 | world / stage |
| $7F08-$7F09 | frame counter (LE) |
| $7F0A-$7F0B | player x in level pixels (LE) |
| $7F0C | player y |
| $7F0D / $7F0E | hp / lives |
| $7F0F | flags: b0 grounded, b1 ladder, b2 wall grab, b3 water, b4 invincible, b5 jumping, b6 dead |
| $7F10 | last event code (death cause, checkpoint, pickup, door) |
| $7F11 / $7F12 / $7F13 | boss hp / enemies alive / checkpoint id |
| $7F14 | **lag counter** (wraps at 255): frames where the NMI arrived before the main loop finished (W0 P0-3.3) |
| $7F15-$7F3F | reserved (probe grows here, never past $7F3F) |

The headless harness reads this block after each frame. jsnes 2.1 exposes $6000-$7FFF in `cpu.mem` for mapper 4 (verified in M2a), so the probe stays in WRAM. M2 also uses $7F15 (collectibles), $7F16-$7F17 (camera x) and $7F18 (bank-stress errors, test builds only).

Test-only build flag `NBF_TEST_CHEATS` (never in exported ROMs): invincible + stage skip by poking a probe-adjacent byte, so a test can reach the ending (state 7) without a full-game recording (M6-T4).

### 5.9 Game flow in the ROM

Title screen (logo tiles + "PRESS START" text) -> story text screen -> stages of world 1 -> boss -> story text -> ... -> ending -> credits. Lives with continue (as built in BLUM-FIX2: game over shows the continue line on the HUD row; Start = the first stage of the current world with START_LIVES, Select = title). Battery saves only if `cartridge.battery` is on.

ROM texts use one language chosen per project (`story.romLocale`), with a 2bpp font that includes French accented glyphs (é è ê à ç ô û ï ù É È À Ç). The font is drawn by us from scratch, never traced from a commercial game font (W0 P2-3).

The ending is followed by a short credits screen that also names the bundled engine components (nesdoug.lib MIT, neslib, FamiStudio engine) (W0 P1-4).

### 5.10 As built in M4 (BLUM-M4)

- **Fixed code layout.** $A000-$DFFF (banks 29-30) holds the core (11.6 KiB of 16). M4a added a `CODE2` segment in bank 31 **after** `STARTUP` (reset/NMI/IRQ/bank switching stay first, vectors at $FFFA): enemies, shots and the boss interpreter (`engine/src/actors.c`, `boss.c`). Still inside the "fixed code ≤ 24 KiB" budget of §5.3; M2-T12 (reset/vectors/NMI in $E000-$FFFF) unchanged and green. Free space after M4: about 4.6 KiB in $A000-$DFFF, about 130 bytes in bank 31: **new engine code goes to `CODE`, not `CODE2`.**
- **Speed rules (cc65).** Signed `int` compares call `tosicmp` (slow): overlap tests use the `IN_RANGE(a, b, lo, len)` unsigned trick; the enemy being updated is copied to zero-page scalars and written back once; `beh_at()` is in assembly (`engine/src/hot.s`). Profiled with `NBF_PROFILE=1 npm run test:engine -- tests/engine/profile-rom.test.ts` (cycles per function from the ld65 labels): the 6-enemy stress level went from 20 lag frames in 600 to 0.
- **Movement floor.** Double jump on a fresh A press in the air (reset on ground/ladder, probe flag b7), projectile on B (`projectile.*`, up to 3 player shots, sprite tile from the common bank R3), knockback + iframes through one `hurt_player()` (enemy contact, enemy shots, boss) with the actor's `damage`. Coyote/buffer/variable jump and ladders from M2b.
- **Enemies.** `actors/<id>.json` kind `enemy` gained optional `period`, `jump`, `amplitude`, `shotSpeed` (defaults in `ENEMY_DEFAULTS`). Engine tables `kind_p1` (byte) / `kind_p2` (word): hopper [frames between hops, jump speed], flyer [phase step = 256/period, wave px] on a 64-step sine, shooter [frames between shots, shot speed], walker [0, 0]. Kinds are per (actor, world) so tile numbers always point into that world's enemy bank (fixes an M2 latent bug when one enemy appears in 2 worlds). Up to 4 enemy/boss shots on screen.
- **Boss DSL.** `scripts/<id>.json` (`src/core/engine-data/boss-dsl.ts`): 1-2 phases on the floor (schema allows 4 for later), phase *n* starts at `hpBelow`, ≤ 16 steps per phase, each phase must wait or move once. 8 ops in fixed opcode order `move_to x speed`, `wait n`, `jump vx vy` (1/16 px), `shoot aimed|spread|rain speed`, `spawn <enemy>` (≤ 2 called enemies alive), `charge speed`, `vulnerable on|off`, `flash n`. Text form (`phase`, `phase hp<=3`, one op per line) for the REBOND form and the AI tool. Compiled to 3-byte steps into the **stage's** data bank (boss block: hp, damage, w, h, phases, CHR bank, 4 metasprite pointers, phase table; offsets in `emit.ts BOSS_BLOCK` and `engine/src/actor_vars.h`). The boss entity's kind byte is `0xF0`; one boss per stage. When it spawns, the camera glides (2 px/frame) to an arena that ends just past it and stays there; the player is kept on screen. Defeat = `EV_BOSS_DEFEATED`, stage clear. Boss graphics: `builtin:boss` (the walker drawn ×2) or a CHROMA graphic with role `boss`, in its own 1 KiB bank from 48 up (R5).
- **Text screens (§5.9).** World intros (`story.worlds[].intro`, new optional field, 280 chars), ending, credits (title + made with NES BLUM FACTORY + nesdoug.lib MIT, neslib public domain, FamiStudio MIT, cc65 zlib + authors). 28 letters × 10 lines, **one empty tile row between lines** (accents sit in the glyph's top row), heading row 3, prompt row 26. All screens share one data bank region, budget **2048 bytes** (`TEXT_BANK_BYTES`), checked by the story validator (M4-T1). Flow: title → intro of world 1 (state 2) → stages → ... → after the last stage, ending (state 7, `textScreen` 2) → credits (3) → title. A project without intros goes straight to play, as in M2.
- **Probe additions** ($7F19-$7F21): player shots, kills, enemy shots, boss phase, text screen, boss x (LE), player vx (LE). **$7F40** = test cheat byte (b0 invincible, b1 skip stage), only compiled with `NBF_TEST_CHEATS` (`emit` option `testCheats`, never in exported ROMs; a test proves a normal ROM ignores it).
- **Validators** (`src/core/schema/documents.ts`, `src/core/nes/levels.ts`): actors and boss scripts have real schemas; enemy patterns outside the floor, stretch tile behaviours used in a grid, stages > 8 screens, wall grab / swim / melee are refused with French reasons until their flag *and* engine support exist. TABLEAU's level validator: spawn in a wall, an actor in a wall, > 6 enemies in any 16-column window, > 1 boss (errors); no exit and no boss, or an exit outside the envelope (warnings). The envelope replays the engine's movement rules on the grid (run at full and half speed, full jump, double jump at the apex, ledges, ladders, one-way platforms, hazards and pits).
- **Directors.** REBOND: `propose_physics`, `propose_enemy`, `propose_boss` (DSL text). TABLEAU: `propose_level` (13 rows of characters + legend, or a numeric grid from the editor; a stage missing from the story is added to its world). PLUME: `propose_story` now adds a flat starter stage for every new stage id, so a project keeps building. Editors call the same tools through `directors:manual` (allow-list per director in `session.ts`).
- **UI.** PLUME form (worlds, stages, intros with line counts, ending, text budget meter), REBOND workshop (sliders grouped by §5.5 with units, presets, enemy and boss forms with previews, DSL editor with live errors, "Essayer en jeu"), live tuning drawer in `#/play?tune=1` (pokes $7E00, "Proposer" makes a REBOND proposal), TABLEAU grid editor (real metatile graphics, behaviour overlay, paint/erase/actors/start tools, width, live validator). Stretch controls are absent while their flag is off (`physicsControls`, `enemyPatternChoices`, M4-T12).

---

## 6. Asset pipeline (CHROMA)

The converter is our own TypeScript code, as recommended in research §1b. It runs in a Node worker (utility process) so the UI stays fluid.

**Clean-room rule (W0 P1-3).** The converter is written from the nesdev wiki/forum descriptions and PRISM_NES (MIT; credited in THIRD_PARTY if any logic is ported). **The builder never opens NesTiler source** (GPL-3). The NesTiler exe may serve as a black-box golden reference in dev tests only.

**Two modes.**
- **Locked palette set (default, used by CHROMA).** The world's `palettes.json` is the source of truth. Every image of that world is converted *into* its fixed subpalettes and fixed sprite roles (§5.4). Steps 3-4 below only pick, per block or sprite, which of the locked subpalettes fits best.
- **Free.** Used only to create a world's first palette set from a reference image. Steps 3-4 compute a new set, which becomes `palettes.json` after approval.

**One master palette RGB table** is used by the converter, the previews **and** jsnes (its palette is overridden at load), so "before/after" and the in-app emulator show the same colours for the same indices (W0 P0-2.5).

1. Resize to the target: full screen 256×240, tileset sheet, metasprite frame (16×16, 16×24, 16×32, 24×32 for bosses ≤ 32 px), portrait for story screens.
2. Snap pixels to the NES master palette in OKLab (exclude `$0D`, avoid `$1D` and the `$xE/$xF` columns).
3. Free mode: choose the backdrop that needs the fewest subpalettes.
4. Free mode: iterate the palette set per 16×16 attribute block (BG) or per sprite (4 subpalettes × 3 colours + backdrop). Locked mode: assign each block/sprite to the best locked subpalette allowed for its role.
5. Ordered dither (Bayer) by default; error diffusion as an option, with a tile-count warning.
6. Cut into 8×8 tiles, encode 2bpp, dedupe (+ H/V flip for sprites). Lossy merge by Hamming distance down to the budget.
7. Split metasprites into hardware sprites, then check ≤ 8 per scanline and the total count.
8. Write `.chr` banks aligned on 1/2 KiB, palette bytes, metatile tables, metasprite tables (with the player `bank` per frame, §5.4), before/after PNG, budget JSON.

### 6.1 World/scene budget validator (`src/core/nes/budgets`, W0 P0-2)

Converting one image correctly is not enough: the NES limits apply to everything on screen at once. This validator runs on **every proposal and every build**, over the world as a whole:

| Check | Limit |
|---|---|
| Distinct BG subpalettes in the world, HUD included | ≤ 4 |
| Distinct sprite subpalettes (player, enemies, items, projectiles, boss) | ≤ 4, with the fixed roles of §5.4 |
| BG tiles per CHR bank set (world tileset; HUD/font live in their own bank) | ≤ 256 |
| Sprite tiles per 1 KiB bank | ≤ 64 |
| Worst-case sprites per scanline: the level's enemy placement per screen + player + projectiles | ≤ 8, otherwise a warning "ça va clignoter" (OAM cycling, §5.4) |
| Boss width as sprites | ≤ 32 px |

Each failure gives a French reason and the actor or image responsible. Acceptance test M3-T9.

**The AI's role:** CHROMA chooses the crop, target kind and size, palette locks (shared across a world) and simplifications, then names frames and explains the result. The conversion itself is deterministic and testable.

**Limit, stated honestly:** Claude does not draw. Animation frames come from Blum's images (one frame per image, or a sheet), from the built-in pixel editor, or from simple automatic variants (mirror, 1-px bob, palette swap). The app ships an original placeholder set (player, 8 enemies, 3 bosses, 4 tilesets, font, title logo), so every new project can play right away.

NesTiler (GPL-3): only its exe, only as a black-box dev-time reference in tests if it is available on the machine. Never shipped, source never opened (clean-room rule above).

### 6.2 As built in M3

- Code: `src/core/convert/` (image, solve, tiles, convert, render, job), `src/core/nes/palette.ts` (frozen master table + OKLab), `src/core/nes/budgets/` (§6.1), `src/core/schema/graphics.ts` (**the frozen converter contract**), `src/core/directors/chroma.ts` + `chroma-tile.ts` (tools `propose_conversion`, `edit_tile`). Previews run in a `worker_threads` worker (`src/main/convert-worker.ts`); proposals run the same converter in main.
- Colour rules: the master-palette snap is plain OKLab and never picks `$0D`, `$0E`, `$1D-$1F`, `$2E`, `$2F`, `$3E`, `$3F` or `$20` (same white as `$30`). Inside a subpalette the pixel pick weighs lightness ×0.7 (keeps hue). Ordered Bayer 4×4 mixes two colours only when they are close (OKLab ≤ 0.3) and the mixture really is closer to the pixel. Optional 3×3 `smooth` before snapping (photo grain). Error diffusion stays behind its feature flag (not built).
- Free mode keeps the world's BG subpalette 0 (HUD) and solves 3 more; a free proposal also patches the world's set in `palettes.json`. The validator counts "the world's colours in every used slot + every differing free colour", so a free graphic not adopted by its world is refused (« convertis en mode verrouillé »).
- Contract details: sprite frames carry `bank` (0-3, player only), sprites `x 0-31`, `y 0-63` (imported bosses are 32 × 48), tiles relative to the frame's 1 KiB bank, `hotspot` = feet centre. The converter itself offers frames 16×16, 16×24, 16×32, 24×24, 24×32, 32×32. `actors/player.json` names the hero graphic; enemy actors may name 2 `frames`.
- Placeholder art: the BLUMA sample game (`NES-BLUM-FACTORY-ASSETS/sample-game` @ `b9574bf`) is imported by `scripts/import-sample-art.mjs` into `src/core/engine-data/art/placeholder-art.ts`; every new project gets 15 graphics (hero in 3 banks wired in, items, 4 tilesets + floor-safe `tilesets/*.json`, 4 enemy sheets, 5 bosses ≤ 32 px wide). HUD/font stays the engine's own bank (the sample font is not imported).

---

## 7. Build, validate, emulate, export (BOULON)

### 7.1 Build pipeline (main process, argument arrays, no shell)

1. Freeze a copy of the project documents (consistent snapshot).
2. Emit generated data with `src/core/engine-data`: `gen/*.s`, `gen/*.h`, `gen/*.chr`.
3. Copy the engine template to `%LOCALAPPDATA%\NESBlumFactory\builds\<projectId>\<n>\`, a path without spaces or accents (cc65 limitation). If `%LOCALAPPDATA%` itself has a space or an accent (a Windows user name like « Blum Québec »), the builds go under `%PUBLIC%\NESBlumFactory\builds\` (M2). The last 5 builds are kept; older ones are moved to an `old\` folder and cleared on startup.
4. Run `cc65 -Oirs -t nes`, then `ca65`, then `ld65 -C engine.cfg --dbgfile`. Each step has a 60 s timeout and its output is captured.
5. Validate:
   - NES 2.0 header bytes 0-15 against the cartridge profile.
   - File size = 16 + PRG + CHR.
   - Mapper whitelist.
   - Bank usage from the map file (SOUND bank ≤ 8 KiB included).
   - CHR banks, text sizes, and the world/scene budget validator (§6.1).
6. Headless run (jsnes in a worker):
   - 600 frames, probe magic present, frame counter advancing, framebuffer not uniform, lag counter reported.
   - Optional per-feature input scripts.
7. Report in plain French (and English): green/red steps, budget bars, and every problem with "quoi", "pourquoi" and "comment réparer".

### 7.2 Error catalog

Known cc65/ld65/validator messages map to French explanations and to a fix the director can propose. Example: `Segment "BANK3" overflows memory area "PRG3" by 412 bytes` becomes "Le monde 2 ne rentre plus dans sa banque (412 octets de trop). Je propose de couper le niveau 2-3 en deux salles." An unknown error shows the raw text plus "BOULON ne connaît pas encore cette erreur".

### 7.3 In-app emulator

- jsnes in the renderer: canvas 256×240 with integer scale (×2/×3/×4), WebAudio, 60 fps loop. Its palette is overridden with our master palette table (§6).
- Controls: keyboard mapping (default: arrows, X = A, Z = B, Enter = Start, Shift = Select) and Gamepad API mapping, both editable and saved in settings.
- Save states (jsnes `toJSON`/`fromJSON`) in `build/states/`, plus pause, reset, frame step.
- "Tester ce niveau": builds a variant ROM with a `START_LEVEL` constant.
- Live physics tuning: REBOND's sliders poke the $7E00 block in the running emulator, so there is no rebuild until Blum approves.
- Mesen is not bundled (W0 P1-5). Help links to the MesenCE release page for Blum's own accuracy checks.

### 7.4 Export

- `<Titre>.nes`.
- `<Titre>-PRG.bin` and `<Titre>-CHR.bin`: raw split binaries for EPROM/flash programmers (TL866-class) that burn chips for a repro board (W0 P0-1.4).
- `<Titre> - fiche cartouche.html` (FR + EN):
  - mapper 4 MMC3, PRG 256 KiB, CHR 128 KiB, PRG-RAM 8 KiB, battery yes/no, mirroring, NTSC, header bytes in hex, CRC32 + SHA-1 of the `.nes` and of both `.bin`;
  - a bold line: **« Carte avec 8 Ko de PRG-RAM obligatoire (type TKROM/TSROM, ou n'importe quelle cartouche flash). Sans elle, le jeu plante. »** / "PRG-RAM 8 KiB required (TKROM/TSROM-class board, or any flash cart)";
  - steps per flasher family (INL, EverDrive/PowerPak, generic MMC3 board, chip programmer with the split `.bin`);
  - a **« Composants »** section with the nesdoug.lib MIT notice, neslib and the FamiStudio engine notice, since every exported ROM contains them (W0 P1-4).
- `<Titre>.blum.zip` (project).
- Optional `<Titre>.dbg` for Mesen.

### 7.5 As built in M5 (BLUM-M5)

- `src/core/build/pipeline.ts` runs §7.1 steps 1-7 in a worker thread (`src/main/build-worker.ts`, jsnes imported dynamically): documents (schemas + budgets + world/scene validator), emit + cc65/ca65/ld65, ROM checks (16 header bytes against `headerForCartridge`, size, mapper whitelist `[4]`, every PRG area and CHR bank within capacity), then 600 frames headless: 120 frames of title, Start, Right held; probe signature, frame counter moving, picture not uniform, lag counter. Release builds never pass test options (cheats, bank stress).
- Report (`src/core/build/report.ts`): 4 steps (validate / compile / rom / run) with times, problems (errors then warnings), PRG bank bars in bytes, CHR bank bars in tiles, ROM size + header + SHA-1 + CRC32, run result.
- Error catalog (`src/core/build/errors.ts`): 29 entries (ld65 bank / SOUND / code overflow, unresolved and duplicate symbols, missing include, cc65 undeclared, ca65 range, generic C / asm errors, cc65 missing, exe blocked by Windows, timeout, build path, validator families, ROM checks, run checks, lag as a warning). Each gives « quoi / pourquoi / comment réparer » in FR + EN. Unknown text: raw, with « BOULON ne connaît pas encore cette erreur (pas encore connue) ». ld65's « segment does not exist » noise is dropped from the raw text. The 10 toolchain fixtures in `tests/fixtures/build-errors/` are real cc65 V2.19 outputs (`scripts/record-build-errors.mjs`).
- BOULON's tool `propose_split_stage` (`src/core/directors/boulon.ts`): cuts a stage near its middle where both sides stand on ground, part one ends on an exit, part two gets a spawn on ground and the enemies after the cut, the story lists the new stage right after (refused when the world already has 4 stages).
- Fix loop (`src/core/build/fix-loop.ts`): build -> red -> BOULON proposes (AI with a key; offline, the catalog's own fix hint through the same tool) -> Blum approves in the tray -> the panel rebuilds at once. 5 builds per request, then « BOULON s’arrête après 5 essais » with the first problem. Nothing is written without an approval.
- Store change: an invalid project still opens read-only, but an approved proposal whose result passes every check is accepted (a repair); undo/redo stay blocked until then. M1-T3 is unchanged (an edit that leaves the project invalid is still refused).
- Export (`src/core/build/export.ts`): `<Titre>.nes`, `-PRG.bin`, `-CHR.bin`, `<Titre> - fiche cartouche.html` (FR) and `<Titre> - cartridge sheet.html` (EN), `.dbg`, `.blum.zip`. The sheet reads its values back from the ROM header; CRC32 + SHA-1 of the three binaries; bold PRG-RAM line; 4 flasher families; « Composants » with nesdoug.lib MIT, neslib, FamiStudio and cc65 runtime notices. File names keep accents (only cc65 needs plain paths).
- UI: BOULON panel (build button, step lamps, report, problem cards, repair, export list), cartridge facts and bank bars on the right. Toast frame fixed (its 9-slice centre repeated the accent bar across the text).

---

## 8. Packaging

- electron-builder `dir` target, win-x64 -> `release\NES BLUM FACTORY\` zipped as `NES-BLUM-FACTORY-<version>-win-x64.zip`. No installer, no auto-update, no telemetry, no code signing.
  - The README explains the SmartScreen "Informations complémentaires > Exécuter quand même" step.
  - The French guide first says: right-click the zip > Propriétés > **Débloquer**, then extract. This removes the "Mark of the Web" from the bundled cc65 exes (W0 P2-6).
- `extraResources`: `toolchain/cc65` (NES subset: `cc65.exe`, `ca65.exe`, `ld65.exe`, `include/`, `asminc/`, `lib/nes.lib`, `cfg/`), `engine/`, `licenses/`. No Mesen.
- Electron's `LICENSE` and `LICENSES.chromium.html` stay in the package (M5-T6 asserts it). The OFL texts of the fonts go in `licenses/`.
- Packaged build: DevTools disabled, no Electron `crashReporter` uploads (W0 P1-9).
- The toolchain is fetched by `npm run fetch:toolchain` from the official cc65 snapshot URL, checked against the SHA-256 pinned in `THIRD_PARTY.md`, and gitignored. It is never committed.
- Packaged smoke: the zip is extracted to a temp path with spaces and accents (`Blum Québec\Jeux NES`), the exe runs in `--smoke` mode and builds the demo project inside the packaged app.

### 8.1 As built in M5

- `npm run package` (`scripts/package.mjs`, holds the gate lock): licences, `tsc -b`, Vite, electron-builder 26.15.3 `dir` win-x64 (`electron-builder.yml`), folder renamed `release\NES BLUM FACTORY\`, zipped with Windows' `tar.exe` as `release\NES-BLUM-FACTORY-<version>-win-x64.zip` (0.1.0: 144.5 MiB zip, 344.6 MiB folder, app.asar 18.0 MiB, cc65 4.8 MiB).
- `extraResources`: `toolchain/cc65` (3 exes, include, asminc, nes.lib, nes.cfg, VERSION.json; byte-identical to the pinned snapshot, no signing without a certificate), `engine/`, `licenses/`. The app finds them under `process.resourcesPath` when packaged.
- React, React DOM and the two fonts moved to devDependencies (Vite bundles them); app.asar only holds the main-process tree (zod, Anthropic SDK and its 7 dependencies, fflate, jsnes). `npm run licenses` (`scripts/collect-licenses.mjs`) copies a licence file for every shipped npm package (and the UI bundle) into `resources/licenses/npm/`, writes `resources/licenses/INDEX.md` and the two OFL texts. standardwebhooks ships no licence file: its repository's Apache-2.0 text is kept in `scripts/licenses-extra/` (npm metadata says MIT).
- Electron fuses: RunAsNode off, NODE_OPTIONS off, --inspect off, cookie encryption on, app only from asar, embedded asar integrity on. DevTools off when packaged (webPreferences). No crashReporter is ever started.
- `--smoke` in the packaged exe needs `NBF_PACKAGE_SMOKE=1` (the package test sets it); a smoke home with a space or an accent builds under `%LOCALAPPDATA%\NESBlumFactory\smoke-builds`.
- `npm run test:package` (`scripts/test-package.mjs`): M5-T5 + M5-T6 as 19 checks, report in `.tmp/package-report.json`.
- No app icon yet (Electron default): M6.

---

## 9. UI art direction and design system

### 9.1 Mood

16-bit menu era: chunky framed windows, banded gradients, pixel fonts, a blinking cursor, short square-wave blips, a "PRESS START" title. The theme is **"bloom factory"**: a flower that grows out of a little cartridge factory (pixel flower monogram, gears, conveyor). It is original art with no reference to Nintendo hardware, logos or characters, and no SNES controller colours (the four-colour button scheme is out).

Project "cartridges" in the UI use an **original shape** (e.g. a seed-packet / flower-pot cartridge), never the NES or SNES cart silhouette or label layout (trade dress, W0 P2-4).

### 9.2 Palette (SNES 15-bit steps: every channel a multiple of 8, test-enforced)

> **M1 update (BLUM-M1):** the app now uses the BLUMA ui-kit palette (navy windows, steel frames, bloom/gold accents) snapped to 15-bit steps, see `src/renderer/styles.css` and `ASSETS.md`. The table below is the M0 palette, kept for history. `--px` is unitless (art-pixel size = UI scale ×1/×2/×3), as in the ui-kit.

| Token | Hex | Use |
|---|---|---|
| `--c-ink` | `#080818` | app background bottom, text on light |
| `--c-night` | `#181040` | background top, chips |
| `--c-window-top` / `--c-window-bottom` | `#382878` / `#201850` | window gradient (8 bands in M1) |
| `--c-cream` | `#f8e8d0` | frame border, main text |
| `--c-shadow` | `#000008` | outlines, drop shadows |
| `--c-bloom` / `--c-bloom-dark` | `#f870a8` / `#c03878` | brand, active, approve |
| `--c-gold` | `#f8c848` | titles, cursor, highlights |
| `--c-leaf` | `#58d068` | success, budget OK |
| `--c-sky` | `#70d8f8` | info, focus ring, links |
| `--c-danger` | `#e84838` | errors, budget over |
| `--c-steel` (M1) | `#8890b0` | disabled |

Director colours: PLUME plum `#a058c8`, CHROMA bloom `#f870a8`, REBOND leaf `#58d068`, TABLEAU sky `#70d8f8`, BOULON gold `#f8c848`.

### 9.3 Typography

- **Press Start 2P** (OFL-1.1, via `@fontsource/press-start-2p`, latin + latin-ext so French accents work: verified in the M0 screenshot) for titles, buttons, labels and menus.
- **Body and chat text**: a more readable pixel font with French accents. Candidate: Pixelify Sans (OFL-1.1) **[U: verify licence and glyphs at M1]**. Fallback: Press Start 2P at 8/10 px.
- Sizes are multiples of 8 px. UI scale ×2 by default (Settings: ×1, ×2, ×3). No font smoothing.

### 9.4 Frames, components, cursor

- Base unit `--px` = one art pixel: 4 px in M0; from M1 it is derived from the UI scale setting (×1 = 2 px, ×2 = 4 px, ×3 = 6 px).
- Window: cream border, dark outline, stepped corners, banded gradient. 9-slice PNG frame drawn by us in M1, CSS fallback in M0.
- Components (M1 gallery route `#/gallery`):
  - Window, TitleBar, Menu (with cursor), Button, Tabs styled as cartridge labels.
  - DialogBox (portrait + typewriter text, skippable), ProposalCard, BudgetMeter (segmented like a life bar), Toast.
  - SliderPixel, Toggle, PaletteSwatch (NES colours with hex index), GridCanvas, EmulatorScreen with an original "Blum" console bezel.
- Cursor: an original pixel **seed/bud** pointer, 2-frame idle animation (no pointing glove).
- Icons: own inline-SVG pixel icons on a 16×16 grid (save, load, undo, play, build, export, settings, image, map, run, story). No emoji, no sparkles, no wand, no robot.

### 9.5 Director portraits

64×64 pixel portraits, hand-authored as indexed pixel arrays in code (like `BloomMark`) or PNGs drawn procedurally by the swarm. Each has 3 expressions (neutral, talking, happy) and a voice blip pitch for the typewriter. No ComfyUI needed. If ComfyUI is used for references: one job at a time on the RTX 5090 only, outputs redrawn by hand to the palette.

| Director | Look |
|---|---|
| PLUME | Quill-hat storyteller |
| CHROMA | Painter with a palette beret |
| REBOND | Athlete with spring shoes |
| TABLEAU | Architect with a tile helmet |
| BOULON | Mechanic with welding goggles |

### 9.6 Sounds

Synthesised at runtime with WebAudio (square, triangle, noise), so there are no sample files and nothing to license:
- cursor move, confirm, cancel, error buzz;
- approve fanfare (4 notes), build OK jingle, build fail jingle;
- typewriter blip per director.

Volume in Settings (default 40 %), mute toggle, all silent when the window is unfocused.

### 9.7 Screens

1. Title ("PRESS START" / "APPUIE SUR START").
2. Cartridge select: projects as cartridges, new / open / import zip.
3. Studio hub: the factory floor with 5 director stations + the cartridge budget overview + "Jouer" + "Construire".
4. Director panel: left = portrait + dialog/chat; centre = editor or preview; bottom = proposal tray; right = budget.
5. Play: emulator + controls + states.
6. Export: ROM, sheet, zip.
7. Settings: language, API key, models, cost cap, sound, controls, UI scale, folders.
8. History: transactions, undo/redo.

### 9.8 Accessibility

- Full keyboard navigation, menu cursor also driven by gamepad.
- Visible focus ring (`--c-sky`).
- `prefers-reduced-motion` stops blinking and typewriter (done in M0 for the title).
- Minimum text 8 px at ×1.
- Contrast: cream on window gradient ≥ 7:1.

---

## 10. Architecture decision records

### ADR-1: Application type. **[DÉCISION FRED]**

- **Decision:** Electron 44 + Vite 8 + React 19 + TypeScript 7 (strict, `tsc -b`). Shipped as a portable zipped folder.
- **Alternatives:**
  - Tauri v2: no Node, so cc65 needs sidecar plumbing and the Anthropic SDK needs a Node sidecar; WebView2 gamepad bug; Rust slows a 4-day build.
  - Local web app with launcher: ports, browser tabs, awkward key storage.
- **Consequences:** a ~100 MB zip [U, measured at M5]; native Node for processes and AI; `safeStorage` for the key; Chromium Gamepad + WebAudio.

### ADR-2: Mapper. **[DÉCISION FRED]**

- **Decision:** MMC3 (mapper 4) with CHR-ROM, profile in section 5.1. NROM is not offered.
- **Why:**
  - Supported by EverDrive N8/N8 Pro, PowerPak, INL boards and Chinese MMC3 repro boards.
  - Scanline IRQ for the HUD and boss arenas.
  - WRAM fits cc65's memory model.
  - 1 KiB CHR banks give each world and boss its own tiles without runtime uploads.
  - nesdoug ships an MIT MMC3 template.
- **Requirement:** the board must have 8 KiB PRG-RAM (TKROM/TSROM class, or any flash cart). TLROM-style repro boards without PRG-RAM are not supported (§5.1).
- **Fallback, re-estimated (W0 P0-1):** UNROM-512 (mapper 30, submapper 1, 32 KiB CHR-RAM) if Blum's hardware is a Kazzo, a ClusterM dumper or an INL/Broke Studio UNROM-512 board. It is **2+ days, not 1**, because the MMC3 design depends on WRAM everywhere:
  - no WRAM: C stack, BSS, level buffer (3328 bytes per 16-screen stage), tuning block and probe all have to fit in 2 KiB internal RAM next to ZP, stack, OAM and the VRAM buffer: a RAM re-architecture;
  - HUD: sprite-0 split instead of IRQ;
  - CHR: CHR-RAM + loader + compressed blobs in PRG;
  - emulator: jsnes has no mapper 30 (patch or binjnes);
  - and it lands on M2, the riskiest milestone.
- **Rule:** Fred answers the flasher question **by Tue 20 09:00**; it blocks M2a. With no answer, M2 builds MMC3 and UNROM-512 becomes **post-gift** work, not a fallback inside the week.
- **Chip programmers:** if the "flasher" is an EPROM/flash programmer (TL866-class) for a repro board, the split `-PRG.bin` / `-CHR.bin` export covers it (§7.4); the board still needs PRG-RAM.

### ADR-3: Tech stack.

- **Language and build:** TypeScript 7.0 strict everywhere (`tsc -b` with 3 projects: electron, renderer, tooling), Vite 8 for the renderer, vitest 5 for tests, npm as package manager.
  - npm, not bun: Electron's binary postinstall and electron-builder are best-tested on npm; the swarm gate uses npm too. **[DÉCISION FRED]**
- **Libraries:**
  - zod (schemas, IPC);
  - zustand (UI state, M1);
  - jsnes (emulator);
  - `@anthropic-ai/sdk` (AI);
  - electron-builder (packaging, M5);
  - image decoding in the converter: `pngjs` or Electron `nativeImage` (M3 picks; licence recorded).
- **NES side:** cc65 snapshot pinned by SHA-256, neslib + nesdoug.lib + nesdoug MMC3 template, FamiStudio sound engine.
- **Versions** are the ones resolved on 2026-10-19 (see `package.json`). Any upgrade is a separate commit.

### ADR-4: AI provider and key storage. **[DÉCISION FRED]**

- **Decision:** Anthropic API key only, entered by Blum in Settings.
  - Claude.ai login through the Agent SDK is ruled out: Anthropic does not allow third-party apps to offer claude.ai login (research §7, quoted).
  - The key is encrypted with Electron `safeStorage` (Windows DPAPI, same Windows user only) and stored in `%APPDATA%\NES BLUM FACTORY\key.bin`.
  - **DPAPI is per user and per machine (W0 P1-8).** A key set on box-01 does not decrypt on Blum's PC, and moving the folder to a new PC loses it. So Blum enters the key himself on his own PC (the French guide says so). Settings detects a decrypt failure and shows « Clé à saisir de nouveau sur cet ordinateur ».
  - If `safeStorage.isEncryptionAvailable()` is false, the app refuses to save the key and says why. **Never a plaintext fallback.**
  - The key stays in main only: never sent to the renderer, never logged, masked as `sk-ant-…XXXX`, redacted by a log filter (test). The redaction also covers SDK error objects, `error.message` and request headers.
  - SDK client built with an explicit `apiKey` and logging off; `ANTHROPIC_API_KEY` from the environment is never used (§4.4). Packaged build: DevTools off, no `crashReporter` uploads.
  - A "Tester la clé" button runs a tiny request and shows OK or a clear error (invalid key, no credit, network).
- **Calls:** Messages API (`@anthropic-ai/sdk`) with tools and prompt caching, not the Agent SDK. Directors need typed proposals, not file-editing agents, and the Agent SDK would ship a native CLI binary inside the app for no gain.
- **Models (editable in Settings):**

  | Use | Default model |
  |---|---|
  | Directors | `claude-sonnet-5-5` |
  | BOULON fix loop and PLUME first big story pass | `claude-opus-5-5` (Settings toggle "qualité maximale") |
  | Cheap chores (naming, translating texts FR<->EN) | `claude-haiku-5-5` |

- **Provider interface:** keeps room for Bedrock/Vertex later. An offline provider is always available.
- **Gift note:** Blum pays his own API usage. The cost readout and the soft monthly cap are there for that.

### ADR-5: Engine approach.

Data-driven engine, directors emit data only, bosses through a bounded DSL (section 5.7). No AI-written code in v1. If Blum wants custom code later, a "mode expert" can open the generated build folder; it is not part of the gift.

### ADR-6: Emulator.

- jsnes (Apache-2.0) embedded in the renderer and used headless in tests (fast tier). jsnes is lenient where homebrew dies on hardware (MMC3 power-on state, uninitialised RAM, PPU writes outside vblank, IRQ revisions, lag), so it is not the only check.
- **Mesen 2 (MesenCE 2.2.1, GPL-3.0) is a dev-time test tool, never shipped (W0 P1-5).** Bundling would be aggregation, but GPL-3 §6 would still require the source or a durable offer, and a link to a repo we do not control is weak. Help links to the MesenCE release page instead.
- **Automated accurate tier (W0 P0-3):** `npm run test:mesen` runs Mesen headless in test-runner mode (`--testrunner` + a Lua script, exit code from `emu.stop(code)`) at the M2a, M2b, M4a and M6 gates. Verified in M2a on MesenCE 2.2.1: `Mesen.exe --testrunner --timeout=<s> rom.nes script.lua` runs headless and returns the `emu.stop` code. It needs a portable `settings.json` next to the exe (otherwise the first-run setup dialog blocks) with `Debug.ScriptWindow.AllowIoOsAccess = true` (Lua writes its results to a file) and `Nes.Port1.Type = "NesController"` (for `emu.setInput`); `scripts/fetch-mesen.mjs` writes it. M2-T10 is therefore automated.

### ADR-7: Image converter.

Our own TypeScript (section 6). No existing converter is good, permissive and embeddable (research §1). Clean-room against NesTiler (GPL-3): its source is never opened; PRISM_NES (MIT) and the nesdev descriptions are the references.

### ADR-8: Music and SFX.

- **Decision:** FamiStudio sound engine in the ROM, plus a **built-in library of original songs and SFX** made by the swarm in FamiStudio, exported to ca65 at dev time and committed as source.
  - **Floor:** 3 songs (title, stage, boss) + 6 SFX.
  - **Stretch:** up to 6 songs (title, 3 world themes, boss, ending) + 12 SFX.
  - All of it lives in the single SOUND bank (8 KiB, §5.3).
- Directors only *pick* songs per world. No AI music director in v1 (stretch goal, cut first).
- If FamiStudio's CLI export cannot run headless on box-01, fall back to hand-written FamiTone2-format data or a 4-channel minimal driver of our own.

### ADR-9: Project format.

Plain folder of JSON + binary assets, transaction journal + snapshots, zip export (section 3). No database: Blum can back it up, diff it, or send it to Fred.

### ADR-10: Toolchain distribution.

Fetched at dev/package time from the official cc65 snapshot, verified by SHA-256, bundled in `extraResources`, never committed. The build runs in a no-space path. Unsigned exe AV risk is checked on box-01 Defender at M5.

### ADR-11: PRG bank model (BLUM-FIX0, W0 P1-1).

- **Decision:** take nesdoug 33_MMC3's model as-is: 24 KiB fixed code at $A000-$FFFF, data and `banked_call` code swapped at $8000, one SOUND bank swapped in by the NMI (§5.3).
- **Alternative rejected:** v1's swappable banked-code slot at $A000. It would change three core assumptions of the base on day 2 (fixed $A000, `banked_call` and music targeting $8000), each needing its own test.
- **One deviation kept:** the non-inverted CHR A12 layout (§5.4), because it is the standard configuration for the MMC3 IRQ with BG at $0000. Tested by M2-T16/T17.

### ADR-12: Friday floor and sequential milestones (BLUM-FIX0, W0 P0-4).

- **Decision:** the v1 scope was about twice the swarm's realistic throughput. Gates require only the Friday floor (§12.1); everything else is stretch behind feature flags, cut in the §12.2 order at the MILESTONES checkpoints. M2 and M4 are split in two. Milestones run one after the other, never in parallel on box-01.
- **Consequences:** the sample BLUM is 3 worlds × 1 stage; the player is tested by per-stage input scripts, not a full-game recording; the sample is a FakeProvider replay (§12.3).

---

## 11. Data contracts between milestones

| Contract | Owner | Frozen at |
|---|---|---|
| Project folder layout + `project.json` | M1 | end of M1 |
| Ops / Proposal / Transaction types | M1 | end of M1 |
| `ENGINE_DATA_VERSION` 1: physics, tile behaviours, level format, actors, script DSL, probe block (incl. lag counter) | M2a (probe, header) + M2b (rest) | end of M2b (M4 may add fields, never remove) |
| Converter output (`graphics/<id>.json`, `.chr`, player `bank` per frame) | M3 | end of M3 |
| Build report JSON | M5 | end of M5 |

Changing a frozen contract needs a migration and a RUNNER-BLUM note.

---

## 12. Risks, cuts, open questions

| Risk | Mitigation |
|---|---|
| 4-day deadline (scope was about 2× the throughput, W0 P0-4) | Friday floor below is the only thing gates require; everything else is stretch behind feature flags. M2 and M4 split in two. Sequential milestones. Dated checkpoints in MILESTONES. |
| Blum's flasher is not MMC3-capable, or the board has no PRG-RAM | Fred answers by Tue 20 09:00 (blocks M2a). No answer: MMC3, UNROM-512 post-gift (ADR-2). PRG-RAM requirement on the sheet. |
| jsnes differs from hardware (power-on state, dirty RAM, vblank overrun, IRQ revisions, lag) | Engine rules §5.3; automated Mesen tier; dirty-boot test; lag gate; HUD split tolerant to ±1 scanline. Fred/Blum check on the real cart. |
| Images converted one by one need more palettes than the PPU has | Locked palette mode + world/scene budget validator (§6.1). |
| cc65 nightly drift | Pinned snapshot + SHA-256. |
| Unsigned exe blocked by SmartScreen/AV | README instructions; Defender scan at M5. |
| Bad AI proposals | Schemas + budgets + validators + approval; offline editors always available. |
| API cost surprises for Blum | Per-call readout, totals, soft cap, Sonnet default. |
| French accents in ROM text | Custom font tiles with accents (section 5.9), test in M4. |

### 12.1 Friday floor (never cut, W0 P0-4)

This is what ships even if everything goes badly. It is the only scope the M4/M5/M6 gates require.

| Area | Floor |
|---|---|
| Movement | run, variable jump, coyote, jump buffer, double jump, ladder, one attack (projectile), hp + knockback + iframes |
| Behaviours | solid, one-way, ladder, hazard, pit, checkpoint, exit, collectible |
| Enemies | walker, hopper, flyer, shooter |
| Boss | the DSL with ≤ 8 ops, 2 phases |
| Stages | single room, ≤ 8 screens |
| Audio | 3 songs (title, stage, boss) + 6 SFX |
| Sample BLUM | 3 worlds × 1 stage + 1 boss each, plus ending |
| Editors | PLUME form, REBOND sliders, TABLEAU grid, CHROMA convert + single-tile edit |
| BOULON | build, report, export (`.nes`, split `.bin`, sheet, zip) |
| Platform | approval flow, undo, build validation, French UI, offline mode |

### 12.2 Stretch, in cut order

Built only when the floor is green, each behind a feature flag that hides its UI when not built. First in the list = first cut.

1. Wall grab / wall jump.
2. Swim.
3. Melee.
4. Doors/pipes/rooms (and stages > 8 screens).
5. Enemies 5-8 (`patrol`, `chaser`, `turret`, `dropper`).
6. Conveyors (and breakable tiles).
7. Extra songs and SFX (up to 6 + 12).
8. A second stage per world in the sample BLUM.
9. Error-diffusion dither.
10. English ROM text (the English UI stays).
11. Battery saves.
12. AI music (already out of v1).

The Mesen bundle is no longer in the cut list: it is out (ADR-6).

### 12.3 Sample game BLUM

Box-01 agents can neither enter nor read an API key (Nova rule: never read secrets). The sample BLUM is therefore made "through the app" as a **FakeProvider replay of hand-authored proposals**, approved through the normal proposal flow. **[DÉCISION FRED]** Fred decides whether he also does one real Claude run himself.

### 12.5 As built in M6 (BLUM-M6)

- **Music.** The BLUMA soundtrack (assets `music\` @ `3c17713`) replaces the M2 placeholder: 11 songs + 10 SFX in the SOUND bank (`scripts/import-sample-music.mjs` -> `engine/audio/*`, `src/core/engine-data/audio-library.ts`; ids 0/1 unchanged). The engine plays the stage song, the boss song when the boss appears (level header byte 15 = `bossMusic`, default `boss`), the clear and game-over jingles, the ending song (it runs on under the credits; intros stay silent), and the SFX jump, pickup, stomp (enemy killed), hurt, oneup (checkpoint), bosshit. The shot still uses the jump sound.
- **Sample game BLUM** (`src/core/sample/blum.ts`): 9 director chats replayed through `DirectorRuntime` + `FakeProvider` (zero tokens, no key): PLUME story (4 worlds, intros, ending « BONNE FÊTE BLUM ! »), CHROMA 4 palette sets, REBOND physics + 8 enemies + 5 bosses (boss DSL), TABLEAU 9 stages (BLUMA A3 maps, `scripts/import-sample-game.mjs`; items dropped: no item entities yet). Every proposal goes through dry-run validation and is approved: 28 journal entries. `npm run sample` writes `resources/samples/BLUM.blum` (shipped, copied into Documents by « Jeu d’exemple BLUM »). Scope is above the floor (3 x 1 + 3 bosses): 4 worlds, 9 stages, 5 bosses, because the maps were ready.
- **Floor fallback fix.** The placeholder tilesets now apply each map's whole `fallback` (slippery walls and crates solid), not only grab walls and water (`import-sample-art.mjs`).
- **Playthrough scripts (M6-T4).** `tests/engine/blum-scripts/<stage>.txt`: readable `<frames> <buttons>` lines from power-on of a `START_LEVEL` build, frozen; the test only replays them. Found by `scripts/blum-search.mjs` (dev only): go-explore over 8-frame chords in jsnes (a lost life allowed, a lag frame refused); boss stages in two phases (reach the boss at full hp, then a reactive fight policy tried with many parameter sets); every found script is replayed from power-on before it is written. Boss stages end on `EV_BOSS_DEFEATED`, so each boss has its own script. The cheat build reaches state 7 by poking $7F40 every 30 play frames. The jsnes runs write traces that `npm run test:mesen` replays (M6-T8, 10/10 same outcome, 0 lag). The 2-2 script was re-drawn with another seed after Mesen disagreed on one kill with the first one.
- **Emulator fix.** `NesSession.loadState` now releases the pad on both sides: the session's held-button cache survived a load, so a button held across a load was never pressed again (also affected « Charger l’état » in `#/play`).
- **UI.** « Ta première cartouche » (`#/first`, five steps through the five directors, offline: story template, graphics, movement preset, starter stages, build -> play -> export), Help (`#/help`: flash cart, chip programmer, PRG-RAM rule, « Débloquer », SmartScreen, Mesen, key, controls; the only place allowed to name the hardware), « Jeu d’exemple BLUM » and « Ta première cartouche » on the cartridge shelf + empty-shelf text, usage per director in Settings, history with portraits and a count, hub Build/Help buttons, title logo animation (reduced motion respected). Smoke checks every route in FR and EN for overflowing text and raw dictionary keys (M6-T1).
- **Package 1.0.0.** App icon (`scripts/make-icon.mjs`, BloomMark on a navy tile), sample shipped in `resources\samples`, the packaged smoke opens a copy of BLUM, builds and exports it (M6-T6); `release\handover\` gets BLUM's files and « Guide pour Blum.html » (`docs/GUIDE-BLUM.html`).
- **Content changes against BLUMA's files.** Yeti and Gros Frette deal 1 damage (2 in `actors.json`; hp kept at 10 and 12 as printed in the booklet) with longer vulnerable windows; three enemies left out where they made a lag frame (`LAG_TRIM` in `blum.ts`: 2 in 2-2, the snowman over the Yeti arena in 4-2); items dropped; the stretch tiles use the maps' own fallback.
- **Gaps.** No title/ending picture in the ROM (text screens), no item entities (hearts, poutine, syrup), shot without its own SFX, portraits with one expression, the sample still carries the unused demo stage `niveau-1` and `actors/rampeur.json` from the new-project template (not in the story, not built).

### 12.4 Open questions for Fred

1. **Blocking for M2a, answer by Tue 20 09:00:** Blum's flasher/cart model, and whether the board has 8 KiB PRG-RAM (changes ADR-2). No answer = MMC3, UNROM-512 post-gift.
2. Director names and look (PLUME, CHROMA, REBOND, TABLEAU, BOULON).
3. Does Blum already have an Anthropic API key with credit, or does Fred buy credit for him? Either way, Blum types the key on his own PC (DPAPI, ADR-4).
4. Should Fred's own art (BLUM character, a photo of Blum) go into the sample game? The visual director can convert it.
