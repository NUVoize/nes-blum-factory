// M5 engine tier: the full BuildPipeline with the real cc65 toolchain and the 600-frame headless run
// (M5-T1), BOULON's fix loop rebuilding green after an approved split (M5-T3), export of a real ROM (M5-T4).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportFiles, loadNotices } from '../../src/core/build/export';
import { BuildFixLoop, fixRequest } from '../../src/core/build/fix-loop';
import { runPipeline, type PipelineResult } from '../../src/core/build/pipeline';
import { defaultToolchain } from '../../src/core/build/engine-build';
import { DirectorRuntime } from '../../src/core/directors/runtime';
import { FakeProvider } from '../../src/core/llm/fake';
import { pricesSchema } from '../../src/core/llm/prices';
import { headerForCartridge, hex, parseHeader } from '../../src/core/nes/header';
import { ProjectStore } from '../../src/core/project/store';
import type { Level } from '../../src/core/schema/engine-docs';
import { DEFAULT_CARTRIDGE } from '../../src/core/schema/project';
import type { Json } from '../../src/core/util/json-pointer';
import { tempDir } from '../helpers';
import { demoProjectDocs, ENGINE_DIR, harness, JSNES, ROOT, startPlay, writeShot } from './rom';

const prices = pricesSchema.parse(JSON.parse(readFileSync(path.join(ROOT, 'config', 'prices.json'), 'utf8')));
const REPORTS = 'C:\\DEV\\CODEX\\NOVA-COCKPIT\\runs\\reports';

const MANIFEST = { format: 'nbf-project', schemaVersion: 1, id: '01J0000000000000000000TEST', title: 'BLUM DEMO', locale: 'fr', engineDataVersion: 1, createdAt: '2026-10-19T12:00:00.000Z', updatedAt: '2026-10-19T12:00:00.000Z' };
/** The demo game as a project folder holds it (manifest included). */
const demoProject = () => ({ 'project.json': MANIFEST, ...demoProjectDocs() }) as Record<string, Json>;

let n = 0;
function pipeline(docs: Record<string, Json>, assets: Record<string, Uint8Array> = {}, startLevel?: number): PipelineResult {
  return runPipeline({
    docs,
    assets,
    engineDir: ENGINE_DIR,
    toolchain: defaultToolchain(ROOT),
    workDir: path.join(ROOT, '.tmp', 'm5-builds', `b${n++}`),
    jsnes: JSNES,
    ...(startLevel !== undefined ? { emit: { startLevel } } : {}),
  });
}

/** Copy an engine-tier shot next to the swarm reports (×2 PNG). */
function shot(h: ReturnType<typeof harness>, name: string): void {
  const file = writeShot(h, name);
  try {
    mkdirSync(REPORTS, { recursive: true });
    copyFileSync(file, path.join(REPORTS, `${name}.png`));
  } catch {
    /* reports folder is optional outside box-01 */
  }
}

describe('M5-T1 one-click build of the demo project', () => {
  it('M5-T1 the pipeline is green on every step and the ROM is valid', () => {
    const r = pipeline(demoProject());
    const { report } = r;
    expect(report.problems.filter((p) => p.severity === 'error')).toEqual([]);
    expect(report.steps.map((s) => [s.id, s.ok])).toEqual([
      ['validate', true],
      ['compile', true],
      ['rom', true],
      ['run', true],
    ]);
    expect(report.ok).toBe(true);
    expect(report.title).toBe('BLUM DEMO');
    expect(r.rom!.length).toBe(393232);
    expect(report.rom!.header).toBe(hex(headerForCartridge(DEFAULT_CARTRIDGE)));
    expect(report.rom!.bytes).toBe(393232);
    expect(report.run).toMatchObject({ probe: true, advancing: true, blank: false });
    expect(report.run!.frames).toBe(600);
    expect(report.run!.lagFrames).toBe(0);
    // budget bars: every PRG area and CHR bank within capacity, the SOUND bank among them
    expect(report.banks.length).toBeGreaterThan(2);
    for (const b of report.banks) expect(b.used, b.fr).toBeLessThanOrEqual(b.capacity);
    expect(report.banks.some((b) => b.fr === 'banque SOUND')).toBe(true);
    for (const c of report.chr) expect(c.used, c.name).toBeLessThanOrEqual(c.capacity);
    expect(r.dbg).toMatch(/^version\s/m);
  });
});

describe('M5-T3 fix loop with a real rebuild', () => {
  it('M5-T3 oversized stage -> BOULON (FakeProvider) proposes a split -> approve -> rebuild green; both stages boot', async () => {
    const dir = path.join(tempDir(), 'Long.blum');
    const s0 = ProjectStore.create(dir, { title: 'Long', locale: 'fr' });
    const level = structuredClone(s0.docs()['levels/niveau-1.json']) as unknown as Level;
    s0.close();
    const extra = 160 - level.width;
    level.grid = level.grid.map((row) => [...row.slice(0, 20), ...Array.from({ length: extra }, (_, i) => row[16 + (i % 4)]!), ...row.slice(20)]);
    level.entities = level.entities.map((e) => (e.col >= 20 ? { ...e, col: e.col + extra } : e));
    level.width = 160;
    writeFileSync(path.join(dir, 'levels', 'niveau-1.json'), JSON.stringify(level, null, 2));

    const store = ProjectStore.open(dir);
    expect(store.readOnly).toBe(true);
    const provider = new FakeProvider([[{ tool: 'propose_split_stage', input: { stage: 'niveau-1' } }], [{ text: 'Approuve, puis je reconstruis.' }]]);
    const runtime = new DirectorRuntime({ store, provider, prices });
    const reports: PipelineResult[] = [];
    const loop = new BuildFixLoop({
      build: () => {
        const r = pipeline(store.docs(), store.assets());
        reports.push(r);
        return r.report;
      },
      ask: (rep, a, max) => runtime.send('build', fixRequest(rep, a, max)),
    });
    const first = await loop.step();
    expect(first.state).toBe('proposed');
    expect(first.report.steps[0]).toMatchObject({ id: 'validate', ok: false });
    expect(first.report.problems[0]!.id).toBe('stage-too-wide');
    if (first.state !== 'proposed') throw new Error('no proposal');
    runtime.approve(first.proposals[0]!.id);
    const second = await loop.step();
    expect(second.state).toBe('green');
    expect(second.attempts).toBe(2);
    expect(second.report.steps.every((st) => st.ok === true)).toBe(true);
    store.close();

    // the second stage is a real stage: a debug start on it reaches play with the hero on the ground
    const docs = reports.at(-1)!;
    const h = harness(docs.rom!);
    startPlay(h);
    h.step(30);
    expect(h.probe().stage).toBe(0);
    shot(h, 'BLUM-M5-rom-split-part1');
    const reopened = ProjectStore.open(dir);
    const second2 = pipeline(reopened.docs(), reopened.assets(), 1);
    reopened.close();
    expect(second2.report.problems.filter((p) => p.severity === 'error')).toEqual([]);
    expect(second2.report.ok).toBe(true);
    const h2 = harness(second2.rom!);
    startPlay(h2);
    h2.step(30);
    const p2 = h2.probe();
    expect(p2.stage).toBe(1);
    expect(p2.flags & 1).toBe(1); // grounded
    shot(h2, 'BLUM-M5-rom-split-part2');
  });
});

describe('M5-T4 export of a real ROM', () => {
  it('M5-T4 split bins rebuild the .nes, the sheet header matches the cartridge profile', () => {
    const r = pipeline(demoProject());
    const out = exportFiles({ title: 'BLUM DEMO', rom: r.rom!, notices: loadNotices(path.join(ROOT, 'resources', 'licenses')), appVersion: '0.1.0', dbg: r.dbg });
    const [nes, prg, chr] = out.files;
    expect(Buffer.concat([Buffer.from(nes!.bytes.subarray(0, 16)), Buffer.from(prg!.bytes), Buffer.from(chr!.bytes)]).equals(Buffer.from(nes!.bytes))).toBe(true);
    const h = parseHeader(r.rom!);
    expect(h).toMatchObject({ mapper: 4, prgRomBytes: 262144, chrRomBytes: 131072, prgRamBytes: 8192, battery: false, region: 'ntsc', format: 'nes2' });
    expect(out.facts.files.map((f) => f.name)).toEqual(['BLUM DEMO.nes', 'BLUM DEMO-PRG.bin', 'BLUM DEMO-CHR.bin']);
    const dir = path.join(ROOT, '.tmp', 'm5-export');
    mkdirSync(dir, { recursive: true });
    for (const f of out.files) writeFileSync(path.join(dir, f.name), f.bytes);
    // the exported ROM boots like the built one
    const hh = harness(nes!.bytes);
    hh.step(90);
    expect(hh.probe().magic).toBe('BLUM');
    shot(hh, 'BLUM-M5-rom-export-title');
  });
});
