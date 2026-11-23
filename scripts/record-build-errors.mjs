// Records real cc65 / ca65 / ld65 failure outputs into tests/fixtures/build-errors/ (M5-T2). Run once with
// the pinned toolchain; the fixtures are committed so the catalog test never needs cc65.
//   node scripts/record-build-errors.mjs
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const tc = path.join(root, 'resources', 'toolchain', 'cc65');
const work = path.join(root, '.tmp', 'record-errors');
const outDir = path.join(root, 'tests', 'fixtures', 'build-errors');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
mkdirSync(outDir, { recursive: true });

const run = (tool, args) => {
  const r = spawnSync(path.join(tc, 'bin', `${tool}.exe`), args, { cwd: work, encoding: 'utf8', windowsHide: true });
  return { status: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};
const file = (name, text) => (writeFileSync(path.join(work, name), text), name);
const cfg = path.join(root, 'engine', 'cfg', 'blum_mmc3.cfg');
const cases = {
  'cc65-syntax': () => run('cc65', ['-Oirs', '-t', 'nes', file('syntax.c', 'void main(void) {\n  int x = ;\n}\n')]),
  'cc65-undeclared': () => run('cc65', ['-Oirs', '-t', 'nes', file('undeclared.c', 'void main(void) {\n  hero_speed = 3;\n}\n')]),
  'cc65-include': () => run('cc65', ['-Oirs', '-t', 'nes', file('include.c', '#include "gen/stage.h"\nvoid main(void) {}\n')]),
  'ca65-opcode': () => run('ca65', ['-t', 'nes', file('opcode.s', '.segment "CODE"\n  ldz #1\n')]),
  'ca65-range': () => run('ca65', ['-t', 'nes', file('range.s', '.segment "CODE"\n  lda #300\n')]),
  'ca65-include': () => run('ca65', ['-t', 'nes', file('inc.s', '.include "missing.inc"\n')]),
  'ld65-unresolved': () => {
    run('ca65', ['-t', 'nes', '-o', 'u.o', file('u.s', '.import _hero_tick\n.segment "CODE"\n  jsr _hero_tick\n')]);
    return run('ld65', ['-C', cfg, '-o', 'u.nes', 'u.o']);
  },
  'ld65-bank-overflow': () => {
    run('ca65', ['-t', 'nes', '-o', 'b.o', file('b.s', '.segment "BANK3"\n  .res 8604\n')]);
    return run('ld65', ['-C', cfg, '-o', 'b.nes', 'b.o']);
  },
  'ld65-code-overflow': () => {
    run('ca65', ['-t', 'nes', '-o', 'c.o', file('c.s', '.segment "CODE"\n  .res 17000\n')]);
    return run('ld65', ['-C', cfg, '-o', 'c.nes', 'c.o']);
  },
  'ld65-duplicate': () => {
    run('ca65', ['-t', 'nes', '-o', 'd1.o', file('d1.s', '.export _boss_tick\n.segment "CODE"\n_boss_tick: rts\n')]);
    run('ca65', ['-t', 'nes', '-o', 'd2.o', file('d2.s', '.export _boss_tick\n.segment "CODE"\n_boss_tick: rts\n')]);
    return run('ld65', ['-C', cfg, '-o', 'd.nes', 'd1.o', 'd2.o']);
  },
};
for (const [id, fn] of Object.entries(cases)) {
  const r = fn();
  // keep only the tool's text, with our temp folder replaced (fixtures stay machine-neutral)
  const text = r.output.split(work).join('<work>').split(cfg).join('<cfg>');
  writeFileSync(path.join(outDir, `${id}.txt`), text);
  console.log(`${id}: exit ${r.status}\n  ${text.trim().split('\n').join('\n  ')}`);
}
