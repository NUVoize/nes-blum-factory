// BuildPipeline (PLAN §7.1): validate the documents (schemas + world/scene budgets), emit + compile with
// cc65, check the ROM (header against the cartridge profile, size, mapper, banks), run it headless for
// 600 frames, and report every step in plain French and English (error catalog, §7.2).
// Node only (main-process worker, tests). jsnes is injected (core never imports it).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { EmitOptions } from '../engine-data/emit.js';
import { RomHarness } from '../emu/harness.js';
import type { JsnesModule } from '../emu/nes-session.js';
import { headerForCartridge, hex, parseHeader, romSize } from '../nes/header.js';
import { validateProjectDocs } from '../schema/documents.js';
import { cartridgeSchema, DEFAULT_CARTRIDGE, type Cartridge } from '../schema/project.js';
import type { Story } from '../schema/story.js';
import { crc32Hex } from '../util/crc32.js';
import type { Json } from '../util/json-pointer.js';
import { buildRom, type Toolchain } from './engine-build.js';
import { explain, explainIssue, type Problem } from './errors.js';
import type { BuildReport, StepView } from './report.js';

export type { BuildReport, StepView };

export const SUPPORTED_MAPPERS = [4] as const;
export const RUN_FRAMES = 600;

export interface PipelineResult {
  report: BuildReport;
  rom: Uint8Array | null;
  /** ld65 debug file (Mesen), for the export. */
  dbg: string | null;
}

export interface PipelineInput {
  docs: Record<string, Json>;
  assets?: Record<string, Uint8Array>;
  engineDir: string;
  toolchain: Toolchain;
  workDir: string;
  /** Headless check; skipped when absent. */
  jsnes?: JsnesModule;
  runFrames?: number;
  /** Release builds never pass test options (testCheats, bankStress). */
  emit?: Pick<EmitOptions, 'startLevel'>;
  now?: () => Date;
}

const sortProblems = (ps: Problem[]) => [...ps.filter((p) => p.severity === 'error'), ...ps.filter((p) => p.severity === 'warning')];

export function runPipeline(input: PipelineInput): PipelineResult {
  const t0 = Date.now();
  const now = input.now ?? (() => new Date());
  const steps: StepView[] = (['validate', 'compile', 'rom', 'run'] as const).map((id) => ({ id, ok: null, ms: 0 }));
  const problems: Problem[] = [];
  const story = input.docs['story.json'] as unknown as Story | undefined;
  const report: BuildReport = {
    ok: false,
    title: story?.title ?? '',
    at: now().toISOString(),
    ms: 0,
    steps,
    problems,
    banks: [],
    chr: [],
    rom: null,
    run: null,
  };
  const done = (rom: Uint8Array | null, dbg: string | null): PipelineResult => {
    report.problems = sortProblems(problems);
    // green = every step ran and passed (the run step only when jsnes is given), no error left
    report.ok = steps.every((s) => s.ok === true || (s.id === 'run' && s.ok === null && !input.jsnes)) && !problems.some((p) => p.severity === 'error');
    report.ms = Date.now() - t0;
    return { report, rom, dbg };
  };
  const timed = <T>(i: number, fn: () => T): T => {
    const s = Date.now();
    try {
      return fn();
    } finally {
      steps[i]!.ms = Date.now() - s;
    }
  };

  // 1. documents: schemas, budgets, world/scene validator
  const issues = timed(0, () => validateProjectDocs(input.docs));
  for (const i of issues) problems.push(explainIssue(i, 'validate'));
  steps[0]!.ok = !issues.some((i) => i.severity === 'error');
  if (!steps[0]!.ok) return done(null, null);

  // 2. emit + cc65 / ca65 / ld65
  const built = timed(1, () =>
    buildRom({
      docs: input.docs,
      ...(input.assets ? { assets: input.assets } : {}),
      engineDir: input.engineDir,
      toolchain: input.toolchain,
      workDir: input.workDir,
      emit: { ...(input.emit?.startLevel !== undefined ? { startLevel: input.emit.startLevel } : {}) },
    }),
  );
  report.banks = built.banks.map((b) => ({ fr: b.label, en: b.labelEn, used: b.used, capacity: b.capacity }));
  report.chr = (built.emit?.chr ?? []).map((c) => ({ name: c.name, bank1k: c.bank1k, used: c.tiles, capacity: c.capacity }));
  if (!built.ok || !built.rom) {
    const failed = built.steps.at(-1);
    if (failed && failed.status !== 0) problems.push(...explain(failed.output, 'compile'));
    else for (const i of built.issues.filter((x) => x.severity === 'error')) problems.push(explainIssue(i, 'compile'));
    steps[1]!.ok = false;
    return done(null, null);
  }
  // the emitter re-runs the validators: a warning already listed by step 1 is not listed twice
  const seen = new Set(issues.map((i) => `${i.doc}|${i.path}|${i.fr}`));
  for (const i of built.issues.filter((x) => x.severity === 'warning' && !seen.has(`${x.doc}|${x.path}|${x.fr}`))) problems.push(explainIssue(i, 'compile'));
  steps[1]!.ok = true;
  const rom = built.rom;
  const dbgPath = path.join(built.workDir, 'game.dbg');
  const dbg = existsSync(dbgPath) ? readFileSync(dbgPath, 'utf8') : null;

  // 3. ROM checks
  timed(2, () => {
    const cart: Cartridge = cartridgeSchema.safeParse(input.docs['cartridge.json']).data ?? DEFAULT_CARTRIDGE;
    const want = headerForCartridge(cart);
    const got = rom.subarray(0, 16);
    const romProblems: Problem[] = [];
    if (hex(got) !== hex(want)) romProblems.push(...explain(`en-tête NES différent : ${hex(got)} au lieu de ${hex(want)}`, 'rom'));
    try {
      const h = parseHeader(rom);
      if (!(SUPPORTED_MAPPERS as readonly number[]).includes(h.mapper)) romProblems.push(...explain(`mapper non pris en charge : ${h.mapper}`, 'rom'));
      if (rom.length !== romSize(h)) romProblems.push(...explain(`taille de ROM inattendue : ${rom.length} octets au lieu de ${romSize(h)}`, 'rom'));
    } catch (e) {
      romProblems.push(...explain(`en-tête NES différent : ${(e as Error).message}`, 'rom'));
    }
    for (const b of built.banks) if (b.used > b.capacity) romProblems.push(...explain(`Segment ‘${b.segments[0] ?? b.area}’ overflows memory area ‘${b.area}’ by ${b.used - b.capacity} bytes`, 'rom'));
    for (const c of built.emit?.chr ?? []) if (c.tiles > c.capacity) romProblems.push(...explain(`banque de graphismes pleine : ${c.name} ${c.tiles}/${c.capacity}`, 'rom'));
    problems.push(...romProblems);
    steps[2]!.ok = romProblems.length === 0;
    report.rom = {
      bytes: rom.length,
      header: hex(got),
      sha1: createHash('sha1').update(rom).digest('hex'),
      crc32: crc32Hex(rom),
    };
  });
  if (!steps[2]!.ok) return done(rom, dbg);

  // 4. headless run: title, Start, then hold Right; probe signature, frame counter, picture, lag
  if (input.jsnes) {
    const jsnes = input.jsnes;
    timed(3, () => {
      const frames = input.runFrames ?? RUN_FRAMES;
      const h = new RomHarness(jsnes, rom);
      h.step(120);
      const titleBlank = h.frameUniform();
      h.step(2, ['START']);
      h.step(Math.max(0, frames - 222), ['RIGHT']);
      const before = h.probe().frame;
      h.step(100, ['RIGHT']);
      const p = h.probe();
      const probe = p.magic === 'BLUM';
      const advancing = p.frame !== before;
      const blank = titleBlank && h.frameUniform();
      report.run = { frames: h.frames, lagFrames: probe ? p.lagFrames : 0, probe, advancing, blank };
      const runProblems: Problem[] = [];
      if (!probe) runProblems.push(...explain('sonde absente après 600 images', 'run'));
      else if (!advancing) runProblems.push(...explain('jeu figé : le compteur d’images ne bouge plus', 'run'));
      if (blank) runProblems.push(...explain('écran vide : une seule couleur', 'run'));
      problems.push(...runProblems);
      if (probe && p.lagFrames > 0) problems.push(...explain(`images en retard : ${p.lagFrames}`, 'run'));
      steps[3]!.ok = runProblems.length === 0;
    });
  }
  return done(rom, dbg);
}
