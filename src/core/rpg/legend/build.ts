// THE LEGEND OF BLUM (BLUMZ-M1): builds the ROM. rpg/legend/*.json + rpg/kit/ -> validator -> compiler ->
// gen/ (legend.inc, fixed.s, world.s, text.s, screens.s, chr.bin, header.bin), then ca65 + ld65 from the
// factory's pinned cc65 toolchain. The cartridge is BLUM's (MMC3, 256 KiB PRG, 128 KiB CHR, 8 KiB PRG-RAM)
// with the battery bit set (docs/RPG-PLAN.md 2.8). The FamiStudio engine is BLUM's file (engine/audio, never
// edited); songs and effects come from the kit. Argument arrays, no shell.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseLabels, toolchainPresent, type Toolchain } from '../../build/engine-build.js';
import { headerForCartridge } from '../../nes/header.js';
import { DEFAULT_CARTRIDGE } from '../../schema/project.js';
import { compileLegend, type CompiledLegend } from './compile.js';
import { loadLegendData, readLegendDocs, parseLegendData, type LegendData } from './data.js';
import { loadLegendKit } from './kit.js';
import { validateLegend, type LegendIssue } from './validate.js';

export const LEGEND_CARTRIDGE = { ...DEFAULT_CARTRIDGE, battery: true };

export interface LegendBuild {
  ok: boolean;
  rom: Uint8Array | null;
  log: string;
  labels: Map<string, number>;
  map: string;
  compiled: CompiledLegend | null;
  issues: LegendIssue[];
  data: LegendData | null;
}

export interface LegendBuildOptions {
  /** Raw data documents instead of rpg/legend/*.json (tests). */
  docs?: Record<string, unknown>;
}

export function buildLegend(rpgDir: string, engineDir: string, toolchain: Toolchain, workDir: string, opts: LegendBuildOptions = {}): LegendBuild {
  const fail = (log: string, extra: Partial<LegendBuild> = {}): LegendBuild => ({ ok: false, rom: null, log, labels: new Map(), map: '', compiled: null, issues: [], data: null, ...extra });
  if (/[\s\u0080-￿]/.test(workDir)) return fail(`build folder has a space or accent: ${workDir}`);
  if (!toolchainPresent(toolchain)) return fail(`cc65 toolchain not found in ${toolchain.dir}`);
  let data: LegendData;
  try {
    data = opts.docs ? parseLegendData(opts.docs) : loadLegendData(path.join(rpgDir, 'legend'));
  } catch (e) {
    return fail(`données : ${e instanceof Error ? e.message : String(e)}`);
  }
  const kit = loadLegendKit(path.join(rpgDir, 'kit'));
  let compiled: CompiledLegend;
  try {
    compiled = compileLegend(data, kit);
  } catch (e) {
    return fail(`compilation : ${e instanceof Error ? e.message : String(e)}`, { data });
  }
  const issues = validateLegend(data, compiled);
  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length) return fail(`validateur : ${errors.length} erreur(s)\n${errors.map((i) => `- ${i.fr}`).join('\n')}`, { data, compiled, issues });

  rmSync(workDir, { recursive: true, force: true });
  for (const d of ['gen', 'obj', 'src']) mkdirSync(path.join(workDir, d), { recursive: true });
  cpSync(path.join(rpgDir, 'cfg'), path.join(workDir, 'cfg'), { recursive: true });
  cpSync(path.join(rpgDir, 'src'), path.join(workDir, 'src'), { recursive: true });
  cpSync(path.join(engineDir, 'audio', 'famistudio_ca65.s'), path.join(workDir, 'src', 'famistudio_ca65.s'));
  cpSync(path.join(engineDir, 'audio', 'NoteTables'), path.join(workDir, 'src', 'NoteTables'), { recursive: true });
  writeFileSync(path.join(workDir, 'src', 'music.s'), kit.music);
  writeFileSync(path.join(workDir, 'src', 'sfx.s'), kit.sfx);
  const gen = (name: string, d: Uint8Array | string) => writeFileSync(path.join(workDir, 'gen', name), d);
  gen('header.bin', headerForCartridge(LEGEND_CARTRIDGE));
  gen('chr.bin', compiled.chr);
  gen('legend.inc', compiled.inc);
  gen('fixed.s', compiled.fixed);
  gen('world.s', compiled.world);
  gen('text.s', compiled.text);
  gen('screens.s', compiled.screens.join('\n'));

  const bin = (t: string) => path.join(toolchain.dir, 'bin', `${t}.exe`);
  let log = '';
  const run = (tool: string, args: string[]): boolean => {
    const r = spawnSync(bin(tool), args, { cwd: path.join(workDir, 'src'), encoding: 'utf8', timeout: 60_000, windowsHide: true, env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' } });
    log += `${tool} ${args.join(' ')}\n${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}`;
    return r.status === 0;
  };
  const gdir = path.join(workDir, 'gen');
  const sdir = path.join(workDir, 'src');
  const ok =
    run('ca65', ['-g', '-I', gdir, '-I', sdir, '--bin-include-dir', gdir, '--bin-include-dir', sdir, '-o', path.join(workDir, 'obj', 'legend.o'), path.join(sdir, 'legend.s')]) &&
    run('ld65', ['-C', path.join(workDir, 'cfg', 'legend.cfg'), '-o', path.join(workDir, 'legend.nes'), '-m', path.join(workDir, 'legend.map'), '-Ln', path.join(workDir, 'labels.txt'), '--dbgfile', path.join(workDir, 'legend.dbg'), path.join(workDir, 'obj', 'legend.o')]);
  if (!ok) return fail(log, { data, compiled, issues });
  const labelsPath = path.join(workDir, 'labels.txt');
  const labels = existsSync(labelsPath) ? parseLabels(readFileSync(labelsPath, 'utf8')) : new Map<string, number>();
  const map = readFileSync(path.join(workDir, 'legend.map'), 'utf8');
  return { ok: true, rom: new Uint8Array(readFileSync(path.join(workDir, 'legend.nes'))), log, labels, map, compiled, issues, data };
}

/** Raw documents of rpg/legend (tests mutate a copy to build fixtures). */
export function legendDocs(rpgDir: string): Record<string, unknown> {
  return readLegendDocs(path.join(rpgDir, 'legend'));
}
