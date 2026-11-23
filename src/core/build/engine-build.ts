// Build a ROM from project documents: emit gen/, copy the engine template, run cc65 -> ca65 -> ld65
// (PLAN §7.1 steps 2-4). Node only (main process, tests, scripts); argument arrays, no shell, timeouts.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { emitProject, type EmitOptions, type EmitReport } from '../engine-data/emit.js';
import { bankUsage, parseLd65Map, type BankUsage, type Ld65Map } from '../nes/ld65-map.js';
import type { Issue } from '../schema/common.js';
import type { Json } from '../util/json-pointer.js';

export interface Toolchain {
  /** Folder holding bin/, include/, asminc/, lib/ of the cc65 NES subset. */
  dir: string;
}

export interface BuildStep {
  tool: string;
  args: string[];
  status: number | null;
  output: string;
  ms: number;
}

export interface BuildResult {
  ok: boolean;
  rom: Uint8Array | null;
  issues: Issue[];
  steps: BuildStep[];
  map: Ld65Map | null;
  mapText: string;
  labels: Map<string, number>;
  banks: BankUsage[];
  emit: EmitReport | null;
  workDir: string;
}

export const ENGINE_SOURCES = ['cfg', 'src', 'lib', 'audio'] as const;

export function defaultToolchain(repoRoot: string): Toolchain {
  return { dir: path.join(repoRoot, 'resources', 'toolchain', 'cc65') };
}

export function toolchainPresent(tc: Toolchain): boolean {
  return ['cc65.exe', 'ca65.exe', 'ld65.exe'].every((e) => existsSync(path.join(tc.dir, 'bin', e)));
}

/** ld65 -Ln label file: `al 00E123 .label` lines. */
export function parseLabels(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^al\s+([0-9A-Fa-f]+)\s+\.(\S+)/.exec(line);
    if (m) out.set(m[2]!, parseInt(m[1]!, 16));
  }
  return out;
}

export interface BuildInput {
  docs: Record<string, Json>;
  engineDir: string;
  toolchain: Toolchain;
  /** Empty or new folder, without spaces or accents (cc65 limitation). It is wiped first. */
  workDir: string;
  emit?: EmitOptions;
  /** Binary project files (graphics/<id>.chr). */
  assets?: Record<string, Uint8Array>;
  timeoutMs?: number;
}

export function buildRom(input: BuildInput): BuildResult {
  const { workDir, toolchain } = input;
  const timeout = input.timeoutMs ?? 60_000;
  const steps: BuildStep[] = [];
  const result = (partial: Partial<BuildResult>): BuildResult => ({
    ok: false,
    rom: null,
    issues: [],
    steps,
    map: null,
    mapText: '',
    labels: new Map(),
    banks: [],
    emit: null,
    workDir,
    ...partial,
  });

  if (/[\s\u0080-￿]/.test(workDir)) {
    return result({
      issues: [{ doc: '', path: '', severity: 'error', fr: `dossier de construction avec espace ou accent : ${workDir}`, en: `build folder has a space or accent: ${workDir}` }],
    });
  }
  if (!toolchainPresent(toolchain)) {
    return result({
      issues: [{ doc: '', path: '', severity: 'error', fr: `compilateur cc65 introuvable dans ${toolchain.dir}`, en: `cc65 toolchain not found in ${toolchain.dir}` }],
    });
  }

  const emitted = emitProject(input.docs, { ...input.emit, ...(input.assets ? { assets: input.assets } : {}) });
  if (!emitted.ok || !emitted.report) return result({ issues: emitted.issues, emit: emitted.report });

  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  for (const d of ENGINE_SOURCES) cpSync(path.join(input.engineDir, d), path.join(workDir, d), { recursive: true });
  for (const [rel, content] of Object.entries(emitted.files)) {
    const p = path.join(workDir, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  mkdirSync(path.join(workDir, 'obj'), { recursive: true });

  const bin = (t: string) => path.join(toolchain.dir, 'bin', `${t}.exe`);
  const run = (tool: string, args: string[], cwd: string): boolean => {
    const t0 = Date.now();
    const r = spawnSync(bin(tool), args, { cwd, encoding: 'utf8', timeout, windowsHide: true, env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' } });
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}`;
    steps.push({ tool, args, status: r.status, output, ms: Date.now() - t0 });
    return r.status === 0;
  };
  const inc = path.join(toolchain.dir, 'include');
  const asminc = path.join(toolchain.dir, 'asminc');
  const src = path.join(workDir, 'src');

  const ok =
    run('cc65', ['-Oirs', '-t', 'nes', '--add-source', '-I', inc, '-o', path.join(workDir, 'obj', 'game.s'), path.join(src, 'game.c')], src) &&
    run('ca65', ['-t', 'nes', '-g', '-I', asminc, '-o', path.join(workDir, 'obj', 'game.o'), path.join(workDir, 'obj', 'game.s')], src) &&
    run('ca65', ['-t', 'nes', '-g', '-I', asminc, '-I', src, '--bin-include-dir', path.join(workDir, 'audio'), '-o', path.join(workDir, 'obj', 'crt0.o'), path.join(src, 'crt0.s')], src) &&
    run('ca65', ['-t', 'nes', '-g', '-I', asminc, '-o', path.join(workDir, 'obj', 'data.o'), path.join(workDir, 'gen', 'data.s')], src) &&
    run(
      'ld65',
      [
        '-C', path.join(workDir, 'cfg', 'blum_mmc3.cfg'),
        '-o', path.join(workDir, 'game.nes'),
        '-m', path.join(workDir, 'game.map'),
        '-Ln', path.join(workDir, 'labels.txt'),
        '--dbgfile', path.join(workDir, 'game.dbg'),
        path.join(workDir, 'obj', 'crt0.o'),
        path.join(workDir, 'obj', 'game.o'),
        path.join(workDir, 'obj', 'data.o'),
        path.join(toolchain.dir, 'lib', 'nes.lib'),
      ],
      workDir,
    );

  const mapPath = path.join(workDir, 'game.map');
  const mapText = existsSync(mapPath) ? readFileSync(mapPath, 'utf8') : '';
  const map = mapText ? parseLd65Map(mapText) : null;
  const ldOut = steps.filter((s) => s.tool === 'ld65').map((s) => s.output).join('\n');
  const banks = bankUsage(ok ? map : null, ldOut);
  const labelsPath = path.join(workDir, 'labels.txt');
  const labels = ok && existsSync(labelsPath) ? parseLabels(readFileSync(labelsPath, 'utf8')) : new Map<string, number>();

  if (!ok) {
    const failed = steps[steps.length - 1]!;
    return result({
      issues: [
        ...emitted.issues,
        {
          doc: '',
          path: '',
          severity: 'error',
          fr: `${failed.tool} a échoué : ${failed.output.trim().split('\n').slice(0, 5).join(' / ')}`,
          en: `${failed.tool} failed: ${failed.output.trim().split('\n').slice(0, 5).join(' / ')}`,
        },
      ],
      map,
      mapText,
      banks,
      emit: emitted.report,
    });
  }
  const rom = new Uint8Array(readFileSync(path.join(workDir, 'game.nes')));
  return result({ ok: true, rom, issues: emitted.issues, map, mapText, labels, banks, emit: emitted.report });
}
