// Dev-time: FamiStudio text -> FamiStudio sound engine data for ca65 (engine/audio/*.s, committed).
// Needs FamiStudio 4.5.3 (MIT) and a .NET 8 runtime; neither is shipped. Paths from the environment:
//   NBF_FAMISTUDIO = folder holding FamiStudio.exe     NBF_DOTNET_ROOT = folder of a .NET 8 runtime
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const fsDir = process.env.NBF_FAMISTUDIO ?? path.join(root, '.tmp', 'dl', 'famistudio');
const dotnet = process.env.NBF_DOTNET_ROOT ?? path.join(root, '.tmp', 'dl', 'dotnet');
const exe = path.join(fsDir, 'FamiStudio.exe');
if (!existsSync(exe)) {
  console.error(`music:export: FamiStudio.exe not found in ${fsDir} (set NBF_FAMISTUDIO)`);
  process.exit(1);
}
const audio = path.join(root, 'engine', 'audio');
const env = { ...process.env, DOTNET_ROOT: dotnet };

function run(args) {
  const out = execFileSync(exe, args, { env, encoding: 'utf8', timeout: 60_000, windowsHide: true });
  process.stdout.write(out);
  if (/error/i.test(out)) throw new Error('FamiStudio reported an error');
}

run([path.join(audio, 'src', 'music.txt'), 'famistudio-asm-export', path.join(audio, 'music.s'), '-famistudio-asm-format:ca65']);
run([path.join(audio, 'src', 'sfx.txt'), 'famistudio-asm-sfx-export', path.join(audio, 'sfx.s'), '-famistudio-asm-format:ca65']);

// The exporter writes a generated header with the local path; keep the committed files machine-neutral.
for (const f of ['music.s', 'sfx.s']) {
  const p = path.join(audio, f);
  const text = readFileSync(p, 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/^; .*[A-Z]:\\.*$/gm, '; (path removed)');
  writeFileSync(p, text);
}
console.log('music:export: engine/audio/music.s and sfx.s written');
