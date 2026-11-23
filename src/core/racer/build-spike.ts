// Builds the SEBRING engine spike ROM (racer/spike): generated data -> gen/, then ca65 + ld65 from the
// factory's pinned cc65 toolchain. Same cartridge as BLUM (DEFAULT_CARTRIDGE: MMC3, 256 KiB PRG,
// 128 KiB CHR, 8 KiB PRG-RAM). Argument arrays, no shell (PLAN §7.1).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseLabels, toolchainPresent, type Toolchain } from '../build/engine-build.js';
import { headerForCartridge } from '../nes/header.js';
import { DEFAULT_CARTRIDGE } from '../schema/project.js';
import { CURVE_MIN, HILL_MIN } from './road-data.js';
import { buildSpikeAssets, type SpikeAssets } from './spike-assets.js';

export interface SpikeBuild {
  ok: boolean;
  rom: Uint8Array | null;
  log: string;
  labels: Map<string, number>;
  assets: SpikeAssets;
}

export interface SpikeOptions {
  /** Extra `NAME = value` lines for gen/spike.inc (timing calibration, test switches). */
  defines?: Record<string, number>;
}

export function buildSpike(spikeDir: string, toolchain: Toolchain, workDir: string, opts: SpikeOptions = {}): SpikeBuild {
  const assets = buildSpikeAssets();
  const fail = (log: string): SpikeBuild => ({ ok: false, rom: null, log, labels: new Map(), assets });
  if (/[\s\u0080-￿]/.test(workDir)) return fail(`build folder has a space or accent: ${workDir}`);
  if (!toolchainPresent(toolchain)) return fail(`cc65 toolchain not found in ${toolchain.dir}`);

  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(path.join(workDir, 'gen'), { recursive: true });
  mkdirSync(path.join(workDir, 'obj'), { recursive: true });
  for (const d of ['cfg', 'src']) cpSync(path.join(spikeDir, d), path.join(workDir, d), { recursive: true });
  const gen = (name: string, data: Uint8Array | string) => writeFileSync(path.join(workDir, 'gen', name), data);
  gen('header.bin', headerForCartridge(DEFAULT_CARTRIDGE));
  gen('chr.bin', assets.chr);
  gen('nametables.bin', assets.nametables);
  gen('palette.bin', assets.palette);
  gen('road0.bin', assets.roadBanks[0]!);
  gen('road1.bin', assets.roadBanks[1]!);
  gen('rowtabs.bin', assets.rowTables);
  const defs: Record<string, number> = {
    CURVE_MIN: CURVE_MIN & 0xff,
    HILL_MIN: HILL_MIN & 0xff,
    SPR_CAR0: assets.sprites.car[0],
    SPR_CAR_L: assets.sprites.car[1],
    SPR_CAR_R: assets.sprites.car[2],
    SPR_DRIVER: assets.sprites.driver,
    SPR_DIGITS: assets.sprites.digits,
    ...opts.defines,
  };
  gen('spike.inc', Object.entries(defs).map(([k, v]) => `${k} = ${v}\n`).join(''));

  const bin = (t: string) => path.join(toolchain.dir, 'bin', `${t}.exe`);
  let log = '';
  const run = (tool: string, args: string[]): boolean => {
    const r = spawnSync(bin(tool), args, { cwd: path.join(workDir, 'src'), encoding: 'utf8', timeout: 60_000, windowsHide: true, env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' } });
    log += `${tool} ${args.join(' ')}\n${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}`;
    return r.status === 0;
  };
  const ok =
    run('ca65', ['-g', '-I', path.join(workDir, 'gen'), '--bin-include-dir', path.join(workDir, 'gen'), '-o', path.join(workDir, 'obj', 'spike.o'), path.join(workDir, 'src', 'spike.s')]) &&
    run('ld65', ['-C', path.join(workDir, 'cfg', 'spike.cfg'), '-o', path.join(workDir, 'spike.nes'), '-m', path.join(workDir, 'spike.map'), '-Ln', path.join(workDir, 'labels.txt'), '--dbgfile', path.join(workDir, 'spike.dbg'), path.join(workDir, 'obj', 'spike.o')]);
  if (!ok) return fail(log);
  const labelsPath = path.join(workDir, 'labels.txt');
  const labels = existsSync(labelsPath) ? parseLabels(readFileSync(labelsPath, 'utf8')) : new Map<string, number>();
  return { ok: true, rom: new Uint8Array(readFileSync(path.join(workDir, 'spike.nes'))), log, labels, assets };
}
