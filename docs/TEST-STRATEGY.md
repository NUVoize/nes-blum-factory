# NES BLUM FACTORY: test strategy

Everything a reviewer needs runs headless from the repo root on Windows (box-01), with no network (except `fetch:toolchain`), no visible window and no API key.

## 1. Tiers

| Tier | What | Command | Runs |
|---|---|---|---|
| Unit | `src/core` and `src/shared`: schemas, ops, journal, NES palette/CHR/header, converter, emitter, DSL, error catalog, i18n, tokens | `npm test` | every commit, < 30 s |
| Integration | ProjectStore on temp folders, zip, KeyVault with an injected cipher, providers with mocked fetch, director flows with FakeProvider | `npm test` | every commit |
| Engine / ROM | Real cc65 build of fixture projects + headless jsnes runs with input scripts and the RAM probe; dirty-boot runs; lag counter | `npm run test:engine` | from M2a, every milestone gate and any engine change |
| Engine-accurate | MesenCE 2.2.1 headless in test-runner mode (`--testrunner` + Lua, exit code from `emu.stop(code)`) on the same ROMs and input scripts | `npm run test:mesen` | M2a, M2b, M4a, M6 gates, and any change to reset/NMI/IRQ/bank code |
| UI smoke | Built Electron app in a hidden window (`--smoke`), one route per run or a route list, PNG per route, DOM checks | `npm run smoke` | every milestone gate |
| Package | Release zip extracted to a path with spaces and accents, packaged exe in `--smoke` mode, demo ROM built with the bundled cc65 | `npm run test:package` | M5, M6 |
| Manual | Defender scan, real cartridge (Fred/Blum), Warden review; Mesen screenshot only if the test runner is absent | — | M5, M6 |

The unit/integration tiers never need cc65, Electron or a GPU. The engine tier needs only cc65 (fetched) and Node. The accurate tier needs a dev-time MesenCE install (never shipped, never committed; path from `NBF_MESEN`).

### 1.1 Why an accurate tier (W0 P0-3)

jsnes is lenient exactly where homebrew dies on a real console. Each blind spot has a check:

| Real-hardware failure | jsnes | Check |
|---|---|---|
| MMC3 R6/R7/$8000 unspecified at power-on; reset must run in $E000-$FFFF | always boots | M2-T12 (map + source scan), Mesen tier |
| Uninitialised CPU RAM / WRAM | zeroes it | dirty boot M2-T11, tuning guard M2-T13 |
| VRAM writes outside vblank, NMI overrun | tolerant | Mesen Lua: no PPU write while rendering |
| MMC3 IRQ timing / revisions (latch 0) | approximate | latch never 0 (PLAN §5.4), Mesen: HUD split stable over 600 frames |
| Bank switch interrupted by NMI/IRQ | rarely visible | shadow-register rule + Mesen bank/music stress (M2-T16) |
| CPU overload (lag) | invisible | probe lag counter $7F14: 0 on demo/feature levels and the sample stages, < 5 % on the stress fixture |

**Mesen tier Lua checks:** boot to title then play; probe frame counter advances; no PPU write while rendering; HUD split scanline stable over 600 frames; the same input scripts give the same probe outcome as jsnes.

**MesenCE 2.2.1 test-runner mode: verified in M2a.** `npm run test:mesen` builds the demo ROM (and a bank-stress variant), runs `tests/mesen/*.lua` through `Mesen.exe --testrunner` (dev install: `node scripts/fetch-mesen.mjs`, portable, `.tmp/tools/mesen`), and checks: boot to title then play, probe frame counter, no `$2003/$2004/$2006/$2007/$4014` write while rendering, the demo stage cleared with 0 lag (same outcome as jsnes), `$2005` split line stable over 600 frames, the CHR switch inside the line-31 hblank, 0 bank errors and music playing under bank stress, and identical frames between the normal and stress ROMs.

## 2. Rules

- **Test IDs.** Acceptance tests carry their milestone ID in the name (`M3-T4 ...`). `npx vitest run -t "M3-T4"` runs one.
- **No network in tests.** Providers are mocked. A single optional live test (`NBF_LIVE_CLAUDE=1`) checks the real API with a cheap model. It is never part of the gate and never logs the key.
- **Determinism.** Fixed seeds for property tests and the converter. jsnes runs are frame-exact: same ROM + same input script = same framebuffer hash.
- **Fixtures are original.** Images in `tests/fixtures/img/` are made by us (procedural or hand-drawn). There are no commercial ROMs, no Nintendo assets and no third-party art. Test ROMs are built from our own engine.
- **Never weaken.** No `.skip`, no lowered counts, no lint disables. The test count in `RUNNER-BLUM.md` only goes up.
- **Temp folders only.** Tests write under `os.tmpdir()` or `.tmp/`, never in Documents or `%APPDATA%`. They use the same atomic-write code as the app.
- **Load limits (box-01).** Vitest runs with at most 4 workers. The engine tier runs serially (one cc65 build at a time). Heavy tiers never run in parallel with each other. GPU acceleration is disabled in smoke mode.
- **Gate lock.** Every heavy script (`test:engine`, `test:mesen`, `smoke`, `test:package`, `package`, the cc65 build in tests) takes `.tmp/gate.lock` (pid + start time + command). A second one waits up to 10 min then exits with "gate busy: <command> (pid)". A lock whose pid is dead is taken over. Milestones are sequential; an overlapping agent in a worktree runs no gate until the first one is done (MILESTONES "Calendar").
- **Floor first.** Gates require the Friday floor (PLAN §12.1). A stretch feature's acceptance cases join the gate when the feature is built; until then M4-T12 proves the feature is rejected and hidden.
- **Process hygiene.**
  - Every spawned process (Electron, cc65, ld65, Mesen) has a timeout and is killed in `finally`.
  - The smoke script checks that no Electron process from this repo is left.
  - Tests never open a visible window.

## 3. The ROM test harness (`src/core/emu`, M2)

- `loadRom(bytes, {prefill?})` -> jsnes instance with no audio output, frames captured to a buffer, and the palette overridden with our master palette table (PLAN §6). `prefill` = `0xFF` or a seeded random pattern written to CPU RAM and WRAM before reset (dirty boot).
- Input scripts are JSON: `[{"frames": 120, "hold": ["RIGHT"]}, {"frames": 1, "press": ["A"]}, ...]`. They are recorded from the in-app emulator ("enregistrer les entrées") or written by hand.
- Input scripts can start from a debug start (`START_LEVEL`) and from an `NBF_TEST_CHEATS` build (M6-T4). There is no single full-game recording: agents cannot play in real time, so scripts are written per stage and per boss.
- `probe()` reads the WRAM block at $7F00-$7F3F (PLAN §5.8) and returns typed fields, including `lagFrames` ($7F14).
- `frameHash()` = SHA-1 of the packed RGB buffer that jsnes `onFrame` delivers (256×240 × 32-bit), after the master palette override. It is not a palette-index buffer: jsnes does not expose one (W0 P2-2). Because the palette table is ours and fixed, the hash is stable.
- Helpers:
  - `runUntil(predicate, maxFrames)`;
  - `expectProbe({state: 3, ...})`;
  - `nametableTiles(region)` for text and tile checks.
- Each ROM test builds its fixture project once per file, through a cache keyed by the input hash.

## 4. UI smoke runner (`scripts/smoke.mjs`)

- M0: `electron . --smoke=<out.json>` opens a hidden window, waits for `[data-testid="app-title"]`, fonts and two paints, then writes JSON + PNG and exits. It is killed after 30 s.
- M1 adds `--smoke-route=<route>[,<route>...]` and `--smoke-locale=fr|en`.
  - Every screen root carries `data-testid="screen-<route>"`.
  - The runner checks it, checks there is no horizontal overflow and no console error, then captures a PNG.
- PNGs go to `.tmp/smoke/` (gitignored). Milestone evidence is copied to `C:\DEV\CODEX\NOVA-COCKPIT\runs\reports\BLUM-M<n>-*.png`.

## 5. What is not automated (and who checks)

| Check | Who | When |
|---|---|---|
| ROM on Mesen 2, only if the test-runner tier is unavailable | Conductor | before M6 (mandatory then) |
| ROM on a real cartridge (PRG-RAM board) | Fred / Blum | after handover |
| Look and feel, fun of the sample game | Fred | M6 |
| Real Claude quality of each director | Fred with his own key, if he chooses (agents never handle a key; the sample BLUM is a FakeProvider replay) | M6 or after |
| Defender / SmartScreen on the release zip | Conductor | M5 |
