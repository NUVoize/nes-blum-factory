// Builds the LEGEND OF BLUM engine spike ROM (rpg/spike): world.json -> gen/ (world.inc, world-data.inc,
// chr.bin), then ca65 + ld65 from the factory's pinned cc65 toolchain. Same cartridge as BLUM and SEBRING
// (DEFAULT_CARTRIDGE: MMC3, 256 KiB PRG, 128 KiB CHR, 8 KiB PRG-RAM). Argument arrays, no shell.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseLabels, toolchainPresent, type Toolchain } from '../build/engine-build.js';
import { headerForCartridge } from '../nes/header.js';
import { DEFAULT_CARTRIDGE } from '../schema/project.js';
import { compileWorld, parseWorld, type CompiledWorld } from './spike-world.js';

export interface RpgSpikeBuild {
  ok: boolean;
  rom: Uint8Array | null;
  log: string;
  labels: Map<string, number>;
  world: CompiledWorld | null;
}

export function buildRpgSpike(spikeDir: string, toolchain: Toolchain, workDir: string): RpgSpikeBuild {
  const fail = (log: string, world: CompiledWorld | null = null): RpgSpikeBuild => ({ ok: false, rom: null, log, labels: new Map(), world });
  if (/[\s\u0080-￿]/.test(workDir)) return fail(`build folder has a space or accent: ${workDir}`);
  if (!toolchainPresent(toolchain)) return fail(`cc65 toolchain not found in ${toolchain.dir}`);
  let world: CompiledWorld;
  try {
    world = compileWorld(parseWorld(JSON.parse(readFileSync(path.join(spikeDir, 'data', 'world.json'), 'utf8'))));
  } catch (e) {
    return fail(`world.json: ${e instanceof Error ? e.message : String(e)}`);
  }

  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(path.join(workDir, 'gen'), { recursive: true });
  mkdirSync(path.join(workDir, 'obj'), { recursive: true });
  for (const d of ['cfg', 'src']) cpSync(path.join(spikeDir, d), path.join(workDir, d), { recursive: true });
  const gen = (name: string, data: Uint8Array | string) => writeFileSync(path.join(workDir, 'gen', name), data);
  gen('header.bin', headerForCartridge(DEFAULT_CARTRIDGE));
  gen('chr.bin', world.art.chr);
  gen('world.inc', world.inc);
  gen('world-data.inc', world.data);

  const bin = (t: string) => path.join(toolchain.dir, 'bin', `${t}.exe`);
  let log = '';
  const run = (tool: string, args: string[]): boolean => {
    const r = spawnSync(bin(tool), args, { cwd: path.join(workDir, 'src'), encoding: 'utf8', timeout: 60_000, windowsHide: true, env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' } });
    log += `${tool} ${args.join(' ')}\n${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}`;
    return r.status === 0;
  };
  const ok =
    run('ca65', ['-g', '-I', path.join(workDir, 'gen'), '--bin-include-dir', path.join(workDir, 'gen'), '-o', path.join(workDir, 'obj', 'spike.o'), path.join(workDir, 'src', 'spike.s')]) &&
    run('ld65', ['-C', path.join(workDir, 'cfg', 'spike.cfg'), '-o', path.join(workDir, 'rpg-spike.nes'), '-m', path.join(workDir, 'spike.map'), '-Ln', path.join(workDir, 'labels.txt'), '--dbgfile', path.join(workDir, 'spike.dbg'), path.join(workDir, 'obj', 'spike.o')]);
  if (!ok) return fail(log, world);
  const labelsPath = path.join(workDir, 'labels.txt');
  const labels = existsSync(labelsPath) ? parseLabels(readFileSync(labelsPath, 'utf8')) : new Map<string, number>();
  return { ok: true, rom: new Uint8Array(readFileSync(path.join(workDir, 'rpg-spike.nes'))), log, labels, world };
}
