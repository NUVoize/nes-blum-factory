// M5 unit tier: error catalog (M5-T2), BOULON split + fix loop with the FakeProvider (M5-T3, the real
// rebuild is in tests/engine/m5-build.test.ts), export files and cartridge sheet (M5-T4).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { explain, explainIssue, UNKNOWN_NOTE } from '../src/core/build/errors';
import { exportFiles, fileTitle, loadNotices, splitRom } from '../src/core/build/export';
import { BuildFixLoop, fixRequest, MAX_FIX_ATTEMPTS } from '../src/core/build/fix-loop';
import type { BuildReport } from '../src/core/build/pipeline';
import { splitStageOps } from '../src/core/directors/boulon';
import { DirectorRuntime } from '../src/core/directors/runtime';
import { FakeProvider } from '../src/core/llm/fake';
import { pricesSchema } from '../src/core/llm/prices';
import { headerForCartridge, parseHeader } from '../src/core/nes/header';
import { ProjectStore } from '../src/core/project/store';
import { validateProjectDocs } from '../src/core/schema/documents';
import type { Level } from '../src/core/schema/engine-docs';
import { DEFAULT_CARTRIDGE } from '../src/core/schema/project';
import type { Story } from '../src/core/schema/story';
import { crc32Hex } from '../src/core/util/crc32';
import { createHash } from 'node:crypto';
import { tempDir } from './helpers';

const ROOT = path.resolve(import.meta.dirname, '..');
const FIX = path.join(ROOT, 'tests', 'fixtures');
const prices = pricesSchema.parse(JSON.parse(readFileSync(path.join(ROOT, 'config', 'prices.json'), 'utf8')));

describe('M5-T2 error catalog', () => {
  // 10 recorded toolchain failures (scripts/record-build-errors.mjs, real cc65 V2.19 outputs) + validator texts
  const RECORDED: Array<[file: string, id: string, fr: RegExp]> = [
    ['build-errors/cc65-syntax.txt', 'c-error', /code C du moteur a une faute \(syntax\.c, ligne 2\)/],
    ['build-errors/cc65-undeclared.txt', 'undeclared', /« hero_speed »/],
    ['build-errors/cc65-include.txt', 'missing-include', /gen\/stage\.h/],
    ['build-errors/ca65-opcode.txt', 'asm-error', /opcode\.s, ligne 2/],
    ['build-errors/ca65-range.txt', 'value-range', /300 \(de 0 à 255/],
    ['build-errors/ca65-include.txt', 'missing-include', /missing\.inc/],
    ['build-errors/ld65-unresolved.txt', 'unresolved-symbol', /« _hero_tick »/],
    ['build-errors/ld65-bank-overflow.txt', 'data-bank-full', /banque 3 ne rentre plus \(412 octets de trop\)/],
    ['build-errors/ld65-code-overflow.txt', 'engine-code-full', /616 octets de trop dans le code fixe/],
    ['build-errors/ld65-duplicate.txt', 'duplicate-symbol', /« _boss_tick » est défini deux fois/],
    ['ld65/sound-overflow.txt', 'sound-bank-full', /musique est pleine \(1647 octets/],
  ];

  it('M5-T2 every recorded cc65/ca65/ld65 failure gets a known French and English explanation', () => {
    expect(RECORDED.length).toBeGreaterThanOrEqual(10);
    for (const [file, id, fr] of RECORDED) {
      const text = readFileSync(path.join(FIX, file), 'utf8');
      const [p] = explain(text, 'compile');
      expect(p!.id, file).toBe(id);
      expect(p!.known, file).toBe(true);
      expect(p!.what.fr, file).toMatch(fr);
      for (const part of [p!.what, p!.why, p!.fix]) {
        expect(part.fr.length, file).toBeGreaterThan(10);
        expect(part.en.length, file).toBeGreaterThan(10);
        expect(part.en, file).not.toBe(part.fr);
      }
      // the noise ld65 prints for unused segments never reaches Blum
      expect(p!.raw).not.toMatch(/does not exist/);
    }
  });

  it('M5-T2 validator and process failures map to catalog entries, the too-wide stage carries a split hint', () => {
    const wide = explainIssue({ doc: 'levels/niveau-2.json', path: '/width', severity: 'error', fr: 'niveau trop large : 160 colonnes, soit 10 écrans (max 8 écrans)', en: 'stage too wide: 160 columns, 10 screens (max 8)' }, 'validate');
    expect(wide.id).toBe('stage-too-wide');
    expect(wide.hint).toEqual({ kind: 'split-stage', stage: 'niveau-2', width: 160 });
    expect(wide.what.fr).toMatch(/10 écrans/);
    const cases: Array<[string, string]> = [
      ['compilateur cc65 introuvable dans C:\\x', 'toolchain-missing'],
      ['Error: spawnSync C:\\Blum\\resources\\toolchain\\cc65\\bin\\cc65.exe EPERM', 'tool-blocked'],
      ['Error: spawnSync cc65.exe ETIMEDOUT', 'tool-timeout'],
      ['dossier de construction avec espace ou accent : C:\\Users\\Blum Québec', 'build-path'],
      ['les niveaux ne rentrent plus dans la cartouche', 'stages-full'],
      ['les textes du jeu prennent 2300 octets, la cartouche leur réserve 2048 : raccourcis', 'text-too-long'],
      ['en-tête NES différent : 4E 45 53 1A 10 10 41 08 00 00 07 00 00 00 00 00 au lieu de …', 'header-mismatch'],
      ['taille de ROM inattendue : 393216 octets au lieu de 393232', 'rom-size'],
      ['sonde absente après 600 images', 'run-no-probe'],
      ['images en retard : 3', 'run-lag'],
    ];
    for (const [text, id] of cases) {
      const [p] = explain(text, 'compile');
      expect(p!.id, text).toBe(id);
      expect(p!.what.en.length).toBeGreaterThan(5);
    }
    expect(explain('images en retard : 3', 'run')[0]!.severity).toBe('warning');
  });

  it('M5-T2 an unknown error is shown raw with the « pas encore connue » note', () => {
    const raw = 'ld65: Error: Something nobody has seen before at 0xC0FFEE';
    const [p] = explain(raw, 'compile');
    expect(p!.known).toBe(false);
    expect(p!.id).toBe('unknown');
    expect(p!.raw).toBe(raw);
    expect(p!.what.fr).toBe(raw);
    expect(p!.why).toEqual(UNKNOWN_NOTE);
    expect(p!.why.fr).toMatch(/pas encore connue/);
    expect(p!.why.en).toMatch(/not known yet/);
  });
});

// ---------- M5-T3 (unit part) ----------

/** A new project whose first stage is made 10 screens wide by hand (as an old or hand-edited file would be). */
function oversizedProject(): { dir: string; level: Level } {
  const dir = path.join(tempDir(), 'Trop long.blum');
  const s = ProjectStore.create(dir, { title: 'Trop long', locale: 'fr' });
  const level = structuredClone(s.docs()['levels/niveau-1.json']) as unknown as Level;
  s.close();
  const extra = 160 - level.width;
  // repeat the flat middle of the stage: ground stays continuous, the exit stays at the far end
  level.grid = level.grid.map((row) => [...row.slice(0, 20), ...Array.from({ length: extra }, (_, i) => row[16 + (i % 4)]!), ...row.slice(20)]);
  level.entities = level.entities.map((e) => (e.col >= 20 ? { ...e, col: e.col + extra } : e));
  level.width = 160;
  writeFileSync(path.join(dir, 'levels', 'niveau-1.json'), JSON.stringify(level, null, 2));
  return { dir, level };
}

/** The unit-tier build: the pipeline's document step (the cc65 steps run in the engine tier). */
function validateOnly(store: ProjectStore): BuildReport {
  const problems = validateProjectDocs(store.docs()).map((i) => explainIssue(i, 'validate'));
  const ok = !problems.some((p) => p.severity === 'error');
  return { ok, title: '', at: '', ms: 0, steps: [{ id: 'validate', ok, ms: 0 }], problems, banks: [], chr: [], rom: null, run: null };
}

describe('M5-T3 BOULON fix loop (FakeProvider)', () => {
  it('M5-T3 an oversized stage opens read-only; BOULON proposes a split; approving it repairs the project', async () => {
    const { dir } = oversizedProject();
    const store = ProjectStore.open(dir);
    expect(store.readOnly).toBe(true);
    const report = validateOnly(store);
    expect(report.ok).toBe(false);
    const wide = report.problems.find((p) => p.id === 'stage-too-wide')!;
    expect(wide.hint).toEqual({ kind: 'split-stage', stage: 'niveau-1', width: 160 });

    const provider = new FakeProvider([[{ text: 'Le niveau est trop long : je le coupe en deux.' }, { tool: 'propose_split_stage', input: { stage: 'niveau-1' } }], [{ text: 'Approuve la proposition, puis je reconstruis.' }]]);
    const runtime = new DirectorRuntime({ store, provider, prices });
    let builds = 0;
    const loop = new BuildFixLoop({
      build: () => (builds++, validateOnly(store)),
      ask: (r, attempt, max) => runtime.send('build', fixRequest(r, attempt, max)),
    });
    const first = await loop.step();
    expect(first.state).toBe('proposed');
    if (first.state !== 'proposed') throw new Error('no proposal');
    // BOULON saw the problem in plain words, with the attempt count
    const asked = provider.requests[0]!.messages.at(-1)!.content[0] as { text: string };
    expect(asked.text).toMatch(/essai 1 sur 5/);
    expect(asked.text).toMatch(/stage-too-wide/);
    expect(provider.requests[0]!.tools.map((t) => t.name)).toContain('propose_split_stage');
    const proposal = first.proposals[0]!;
    expect(proposal.director).toBe('build');
    expect(proposal.state).toBe('pending');
    expect(proposal.summary.fr).toMatch(/Couper « .* » \(10 écrans\) en deux niveaux/);

    // nothing written before Blum approves
    expect(JSON.parse(readFileSync(path.join(dir, 'levels', 'niveau-1.json'), 'utf8')).width).toBe(160);
    runtime.approve(proposal.id);
    expect(store.readOnly).toBe(false);

    const second = await loop.step();
    expect(second.state).toBe('green');
    expect(second.attempts).toBe(2);
    expect(builds).toBe(2);
    const docs = store.docs();
    const a = docs['levels/niveau-1.json'] as unknown as Level;
    const b = docs['levels/niveau-1-b.json'] as unknown as Level;
    expect(a.width + b.width).toBe(160);
    expect(Math.max(a.width, b.width)).toBeLessThanOrEqual(128);
    const story = docs['story.json'] as unknown as Story;
    expect(story.worlds[0]!.stages.map((s) => s.id)).toEqual(['niveau-1', 'niveau-1-b']);
    expect(validateProjectDocs(docs).filter((i) => i.severity === 'error')).toEqual([]);
    // the history says who did it; undo is allowed again
    expect(store.history().at(-1)?.director).toBe('build');
    expect(store.canUndo()).toBe(true);
    store.close();
  });

  it('M5-T3 the loop stops at 5 builds with a clear message', async () => {
    const red: BuildReport = {
      ok: false,
      title: '',
      at: '',
      ms: 0,
      steps: [{ id: 'compile', ok: false, ms: 0 }],
      problems: explain(readFileSync(path.join(FIX, 'build-errors', 'ld65-bank-overflow.txt'), 'utf8'), 'compile'),
      banks: [],
      chr: [],
      rom: null,
      run: null,
    };
    let builds = 0;
    let asks = 0;
    const loop = new BuildFixLoop({
      build: () => (builds++, red),
      ask: async () => (asks++, { proposals: [{ id: `p${asks}` } as never], text: '', failure: null }),
    });
    const states: string[] = [];
    for (let i = 0; i < 8; i++) states.push((await loop.step()).state);
    expect(MAX_FIX_ATTEMPTS).toBe(5);
    expect(builds).toBe(5);
    expect(asks).toBe(4);
    expect(states).toEqual(['proposed', 'proposed', 'proposed', 'proposed', 'stopped', 'stopped', 'stopped', 'stopped']);
    const last = loop.last!;
    if (last.state !== 'stopped') throw new Error('not stopped');
    expect(last.reason.fr).toMatch(/BOULON s’arrête après 5 essais/);
    expect(last.reason.fr).toMatch(/banque 3/);
    expect(last.reason.en).toMatch(/BOULON stops after 5 attempts/);
  });

  it('M5-T3 the split keeps every enemy, ends part one on an exit and refuses a full world', () => {
    const { dir, level } = oversizedProject();
    const store = ProjectStore.open(dir);
    const docs = store.docs();
    const out = splitStageOps(docs, { stage: 'niveau-1' });
    const a = out.ops[0]!.op === 'set' ? (out.ops[0]!.value as unknown as Level) : null;
    const b = out.ops[1]!.op === 'set' ? (out.ops[1]!.value as unknown as Level) : null;
    expect(a!.entities.length + b!.entities.length).toBe(level.entities.length);
    const exitId = 9; // jardin exit metatile
    expect(a!.grid.some((row) => row[a!.width - 1] === exitId)).toBe(true);
    const full = structuredClone(docs);
    const story = full['story.json'] as unknown as Story;
    story.worlds[0]!.stages.push({ id: 'x2', name: { fr: 'x' } }, { id: 'x3', name: { fr: 'x' } }, { id: 'x4', name: { fr: 'x' } });
    expect(() => splitStageOps(full, { stage: 'niveau-1' })).toThrow(/déjà 4 niveaux/);
    store.close();
  });
});

// ---------- M5-T4 ----------

function fakeRom(): Uint8Array {
  const header = headerForCartridge(DEFAULT_CARTRIDGE);
  const rom = new Uint8Array(16 + 256 * 1024 + 128 * 1024);
  rom.set(header);
  for (let i = 16; i < rom.length; i++) rom[i] = (i * 7 + (i >> 9)) & 0xff;
  return rom;
}

const cell = (html: string, k: string) => new RegExp(`data-k="${k}">([^<]*)<`).exec(html)?.[1];
const sha1 = (b: Uint8Array) => createHash('sha1').update(b).digest('hex').toUpperCase();

describe('M5-T4 export files and cartridge sheet', () => {
  const notices = loadNotices(path.join(ROOT, 'resources', 'licenses'));

  it('M5-T4 PRG + CHR after the header equal the .nes byte for byte; sheet values equal the parsed header and the file hashes', () => {
    const rom = fakeRom();
    const out = exportFiles({ title: 'Blum: le jardin?', rom, notices, appVersion: '0.1.0', date: new Date('2026-10-23T18:00:00Z'), dbg: 'version major=2', projectZip: new Uint8Array([0x50, 0x4b, 5, 6]) });
    const t = fileTitle('Blum: le jardin?');
    expect(t).toBe('Blum le jardin');
    const names = out.files.map((f) => f.name);
    expect(names).toEqual([`${t}.nes`, `${t}-PRG.bin`, `${t}-CHR.bin`, `${t} - fiche cartouche.html`, `${t} - cartridge sheet.html`, `${t}.dbg`, `${t}.blum.zip`]);
    const [nes, prg, chr] = out.files;
    const joined = new Uint8Array(16 + prg!.bytes.length + chr!.bytes.length);
    joined.set(nes!.bytes.subarray(0, 16));
    joined.set(prg!.bytes, 16);
    joined.set(chr!.bytes, 16 + prg!.bytes.length);
    expect(Buffer.compare(Buffer.from(joined), Buffer.from(nes!.bytes))).toBe(0);
    expect(prg!.bytes.length).toBe(256 * 1024);
    expect(chr!.bytes.length).toBe(128 * 1024);

    const h = parseHeader(rom);
    const dec = new TextDecoder();
    for (const [name, locale] of [[`${t} - fiche cartouche.html`, 'fr'], [`${t} - cartridge sheet.html`, 'en']] as const) {
      const html = dec.decode(out.files.find((f) => f.name === name)!.bytes);
      expect(html).toMatch(new RegExp(`<html lang="${locale}">`));
      expect(cell(html, 'mapper')).toMatch(new RegExp(`^${h.mapper} \\(MMC3`));
      expect(cell(html, 'submapper')).toBe(String(h.submapper));
      expect(cell(html, 'prg')).toBe(`${h.prgRomBytes / 1024} ${locale === 'fr' ? 'Ko' : 'KiB'}`);
      expect(cell(html, 'chr')).toBe(`${h.chrRomBytes / 1024} ${locale === 'fr' ? 'Ko' : 'KiB'}`);
      expect(cell(html, 'prgram')).toBe(`${(h.prgRamBytes + h.prgNvramBytes) / 1024} ${locale === 'fr' ? 'Ko' : 'KiB'}`);
      expect(cell(html, 'battery')).toBe(h.battery ? (locale === 'fr' ? 'oui' : 'yes') : locale === 'fr' ? 'non' : 'no');
      expect(cell(html, 'mirroring')).toMatch(new RegExp(`\\(bit ${h.mirroringBit}\\)$`));
      expect(cell(html, 'region')).toBe(h.region.toUpperCase());
      expect(cell(html, 'header')).toBe('4E 45 53 1A 10 10 40 08 00 00 07 00 00 00 00 00');
      for (const f of [nes!, prg!, chr!]) {
        const rowRe = new RegExp(`data-file="${f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">[^<]*</td><td class="num" data-k="bytes">(\\d+) [a-zé]+</td><td class="mono" data-k="crc32">([0-9A-F]{8})</td><td class="mono small" data-k="sha1">([0-9A-F]{40})</td>`);
        const m = rowRe.exec(html);
        expect(m, `${locale} ${f.name}`).not.toBeNull();
        expect(Number(m![1])).toBe(f.bytes.length);
        expect(m![2]).toBe(crc32Hex(f.bytes));
        expect(m![3]).toBe(sha1(f.bytes));
      }
      // the bold PRG-RAM requirement line
      const must = /<p class="must" data-k="ram-rule"><strong>([^<]+)<\/strong><\/p>/.exec(html)?.[1];
      expect(must).toBe(
        locale === 'fr'
          ? 'Carte avec 8 Ko de PRG-RAM obligatoire (type TKROM/TSROM, ou n’importe quelle cartouche flash). Sans elle, le jeu plante.'
          : 'PRG-RAM 8 KiB required (TKROM/TSROM-class board, or any flash cart). Without it, the game crashes.',
      );
      // « Composants » with the nesdoug.lib MIT, neslib and FamiStudio notices
      expect(html).toMatch(locale === 'fr' ? /<h2 data-k="components">Composants<\/h2>/ : /<h2 data-k="components">Components<\/h2>/);
      expect(html).toMatch(/nesdoug\.lib \(Doug Fraker\) <span class="lic">MIT<\/span>/);
      expect(html).toMatch(/Permission is hereby granted, free of charge/);
      expect(html).toMatch(/neslib \(Shiru\)/);
      expect(html).toMatch(/Public Domain/i);
      expect(html).toMatch(/FamiStudio sound engine/);
      // flasher families
      for (const w of ['EverDrive', 'INL', 'TKROM/TSROM', 'TL866']) expect(html).toContain(w);
      // no pictographs on a deliverable (Fred's rule)
      expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('M5-T4 known CRC32 vectors and the split refuses a short ROM', () => {
    expect(crc32Hex(new TextEncoder().encode('123456789'))).toBe('CBF43926');
    expect(crc32Hex(new Uint8Array())).toBe('00000000');
    expect(() => splitRom(fakeRom().subarray(0, 1000))).toThrow(/plus courte/);
  });
});
