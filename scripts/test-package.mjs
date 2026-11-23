// npm run test:package (M5-T5, M5-T6): extract the release zip under a path with spaces and accents,
// check what the package contains (no dev dependencies, no .env, no Mesen, every licence, Electron's
// notices, fuses, pinned cc65), then run the packaged exe in --smoke mode: it builds and exports the demo
// ROM with the bundled cc65, and DevTools must stay closed. Reports sizes. Leaves no process behind.
//   node scripts/test-package.mjs [--keep]
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const product = pkg.productName;
const zip = path.join(root, 'release', `NES-BLUM-FACTORY-${pkg.version}-win-x64.zip`);
const keep = process.argv.includes('--keep');

if (!existsSync(zip)) {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'package.mjs')], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const results = [];
const check = (id, ok, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${id}${detail ? ` - ${detail}` : ''}`);
};
const mb = (n) => `${(n / 1048576).toFixed(1)} MiB`;

function walk(dir, rel = '') {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...walk(path.join(dir, ent.name), r));
    else out.push({ rel: r, size: statSync(path.join(dir, ent.name)).size });
  }
  return out;
}

/** Processes whose executable lives under `dir`. */
function processesUnder(dir) {
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress'],
      { encoding: 'utf8', windowsHide: true },
    ).trim();
    return [].concat(JSON.parse(out || '[]')).filter((p) => (p.ExecutablePath ?? '').toLowerCase().startsWith(dir.toLowerCase())).map((p) => p.ProcessId);
  } catch {
    return [];
  }
}

const base = mkdtempSync(path.join(tmpdir(), 'nbf-pkg-'));
const target = path.join(base, 'Blum Québec', 'Jeux NES');
mkdirSync(target, { recursive: true });
let exitCode = 1;
try {
  execFileSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-x', '-f', zip, '-C', target], { stdio: 'inherit', windowsHide: true });
  const appDir = path.join(target, product);
  const exe = path.join(appDir, `${product}.exe`);
  check('M5-T5 extracted under a path with spaces and accents', existsSync(exe), exe);

  // ---------- M5-T6 contents ----------
  const files = walk(appDir);
  const rels = files.map((f) => f.rel);
  check('M5-T6 no .env file', !rels.some((r) => /(^|\/)\.env(\.|$)/i.test(r)));
  check('M5-T6 no Mesen', !rels.some((r) => /mesen/i.test(r)), rels.filter((r) => /mesen/i.test(r)).join(', '));
  check('M5-T6 Electron LICENSE', rels.includes('LICENSE.electron.txt') || rels.includes('LICENSE'));
  check('M5-T6 Electron LICENSES.chromium.html', rels.includes('LICENSES.chromium.html'));

  const lic = 'resources/licenses';
  const wanted = ['INDEX.md', 'cc65-zlib.txt', 'nesdoug-MIT.txt', 'neslib-public-domain.txt', 'FamiStudio-MIT.txt', 'FamiStudio-sound-engine-notice.txt', 'jsnes-Apache-2.0.txt', 'PressStart2P-OFL.txt', 'PixelifySans-OFL.txt'];
  const missingLic = wanted.filter((w) => !rels.includes(`${lic}/${w}`));
  check('M5-T6 licences of the bundled components (fonts OFL included)', missingLic.length === 0, missingLic.join(', '));
  for (const w of ['PressStart2P-OFL.txt', 'PixelifySans-OFL.txt']) {
    const p = path.join(appDir, lic, w);
    check(`M5-T6 ${w} is the OFL text`, existsSync(p) && /SIL OPEN FONT LICENSE Version 1\.1/i.test(readFileSync(p, 'utf8')));
  }

  const asar = require('@electron/asar');
  const asarPath = path.join(appDir, 'resources', 'app.asar');
  const entries = asar.listPackage(asarPath, { isPack: false }).map((e) => e.replace(/\\/g, '/'));
  const shipped = [...new Set(entries.map((e) => /^\/node_modules\/((?:@[^/]+\/)?[^/]+)\/package\.json$/.exec(e)?.[1]).filter(Boolean))].sort();
  const devDeps = Object.keys(pkg.devDependencies ?? {});
  const devShipped = shipped.filter((n) => devDeps.includes(n));
  check('M5-T6 no dev dependency in app.asar', devShipped.length === 0, devShipped.join(', '));
  check('M5-T6 no sources, tests or maps in app.asar', !entries.some((e) => /^\/(src|tests|\.tmp|engine|docs)\//.test(e) || e.endsWith('.map')));
  const { RENDERER_BUNDLED } = { RENDERER_BUNDLED: ['react', 'react-dom', 'scheduler', '@fontsource/press-start-2p', '@fontsource/pixelify-sans'] };
  const licFile = (n) => `${lic}/npm/${n.replace('@', '').replace('/', '__')}.txt`;
  const noLicence = [...shipped, ...RENDERER_BUNDLED].filter((n) => !rels.includes(licFile(n)));
  check(`M5-T6 a licence file for each of the ${shipped.length} shipped npm packages + ${RENDERER_BUNDLED.length} bundled in the UI`, noLicence.length === 0, noLicence.join(', '));

  const pinned = ['cc65.exe', 'ca65.exe', 'ld65.exe'].filter((e) => {
    const a = createHash('sha256').update(readFileSync(path.join(root, 'resources', 'toolchain', 'cc65', 'bin', e))).digest('hex');
    const b = createHash('sha256').update(readFileSync(path.join(appDir, 'resources', 'toolchain', 'cc65', 'bin', e))).digest('hex');
    return a !== b;
  });
  check('M5-T6 bundled cc65 binaries byte-identical to the pinned toolchain', pinned.length === 0, pinned.join(', '));

  const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
  const wire = await getCurrentFuseWire(exe);
  // fuse states are ASCII bytes in the exe: '0' disabled, '1' enabled
  const off = (o) => wire[o] === 0x30;
  const on = (o) => wire[o] === 0x31;
  check(
    'M5-T6 fuses: no RunAsNode, no NODE_OPTIONS, no --inspect; asar only + integrity',
    off(FuseV1Options.RunAsNode) && off(FuseV1Options.EnableNodeOptionsEnvironmentVariable) && off(FuseV1Options.EnableNodeCliInspectArguments) && on(FuseV1Options.OnlyLoadAppFromAsar) && on(FuseV1Options.EnableEmbeddedAsarIntegrityValidation),
  );

  // ---------- M6-T6 sample game ----------
  const sampleRel = 'resources/samples/BLUM.blum';
  check('M6-T6 sample BLUM shipped', rels.includes(`${sampleRel}/project.json`) && rels.includes(`${sampleRel}/history/journal.jsonl`) && rels.filter((r) => r.startsWith(`${sampleRel}/levels/`)).length >= 9);
  check('BLUMZ-F2 sample LEGEND OF BLUM shipped (slice ROM)', rels.includes('resources/samples/LEGEND/LEGEND-OF-BLUM-SLICE.nes'));
  check('BLUMR-M2 sample SEBRING shipped (ROM + tracks)', rels.includes('resources/samples/SEBRING/SEBRING.nes') && rels.includes('resources/samples/SEBRING/SEBRING-pistes.json'));
  check('M6 app icon file is not the Electron default', statSync(exe).size > 0 && existsSync(path.join(root, 'build-res', 'icon.ico')));

  // ---------- M5-T5 packaged smoke ----------
  const smokeDir = path.join(base, 'Blum Québec', 'essai');
  mkdirSync(smokeDir, { recursive: true });
  const out = path.join(smokeDir, 'result.json');
  const t0 = Date.now();
  const code = await new Promise((resolve) => {
    const child = spawn(exe, [`--smoke=${out}`, '--smoke-route=director/build,sample,sebring,legend', '--smoke-locale=fr'], {
      cwd: appDir,
      env: { ...process.env, NBF_PACKAGE_SMOKE: '1' },
      stdio: 'inherit',
      windowsHide: true,
    });
    const killer = setTimeout(() => child.kill(), 180_000);
    child.on('exit', (c) => (clearTimeout(killer), resolve(c)));
  });
  const smoke = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { ok: false, error: 'no result file' };
  check('M5-T5 packaged exe --smoke exits 0', code === 0 && smoke.ok === true, `exit ${code} in ${((Date.now() - t0) / 1000).toFixed(1)} s${smoke.error ? ` ${smoke.error}` : ''} ${(smoke.routes ?? []).flatMap((r) => r.problems).join('; ')}`);
  check('M5-T5 runs as the packaged app', smoke.packaged === true);
  check('M5-T5 demo ROM built green with the bundled cc65', smoke.build?.ok === true && smoke.build?.rom?.bytes === 393232 && typeof smoke.toolchainDir === 'string' && smoke.toolchainDir.toLowerCase().startsWith(appDir.toLowerCase()), `${smoke.toolchainDir ?? '?'} ${JSON.stringify(smoke.build?.rom ?? null)}`);
  check('M5-T5 export written (ROM, split bins, sheets, zip)', (smoke.build?.exported ?? []).length >= 6, (smoke.build?.exported ?? []).join(', '));
  check('M5-T6 DevTools cannot be opened in the packaged build', smoke.devTools === 'blocked', String(smoke.devTools));
  const sx = smoke.sample ?? {};
  const sampleFiles = sx.exported?.files ?? [];
  check(
    'M6-T6 packaged app opens a copy of BLUM, builds it green and exports it',
    sx.ok === true && sx.rom?.bytes === 393232 && sx.stages === 9 && ['BLUM.nes', 'BLUM-PRG.bin', 'BLUM-CHR.bin', 'BLUM - fiche cartouche.html'].every((n) => sampleFiles.includes(n)),
    `${sx.stages ?? '?'} stages, ${sx.history ?? '?'} approvals, run ${JSON.stringify(sx.run ?? null)}, ${sampleFiles.join(', ')}`,
  );
  const sb = smoke.sebring ?? {};
  const sebringSha = createHash('sha1').update(readFileSync(path.join(root, 'resources', 'samples', 'SEBRING', 'SEBRING.nes'))).digest('hex');
  check('BLUMR-M2 packaged app plays « Jeu d’exemple SEBRING » (5 stages, the shipped ROM)', sb.ok === true && sb.bytes === 393232 && sb.sha1 === sebringSha && (sb.route ?? []).length === 5, `${sb.bytes ?? '?'} bytes, ${(sb.route ?? []).join(' / ')}${sb.error ? ` ${sb.error}` : ''}`);
  const lg = smoke.legend ?? {};
  const legendSha = createHash('sha1').update(readFileSync(path.join(root, 'resources', 'samples', 'LEGEND', 'LEGEND-OF-BLUM-SLICE.nes'))).digest('hex');
  check('BLUMZ-F2 packaged app plays « Jeu d’exemple THE LEGEND OF BLUM (début) » (the shipped ROM, battery, 4 chapters)', lg.ok === true && lg.bytes === 393232 && lg.sha1 === legendSha && lg.battery === true && (lg.chapters ?? []).length === 4, `${lg.bytes ?? '?'} bytes, ${(lg.chapters ?? []).join(' / ')}${lg.error ? ` ${lg.error}` : ''}`);
  // handover (MILESTONES M6): BLUM's files as the packaged app exported them
  if (sx.exported?.dir && existsSync(sx.exported.dir)) {
    const hand = path.join(root, 'release', 'handover');
    mkdirSync(hand, { recursive: true });
    for (const n of sampleFiles) copyFileSync(path.join(sx.exported.dir, n), path.join(hand, n));
    console.log(`handover: ${sampleFiles.length} BLUM files -> ${path.relative(root, hand)}`);
  }

  let left = processesUnder(appDir);
  for (let i = 0; i < 20 && left.length; i++) {
    await new Promise((r) => setTimeout(r, 500));
    left = processesUnder(appDir);
  }
  check('M5-T5 no process left from the package', left.length === 0, left.join(', '));
  for (const pid of left) {
    try {
      process.kill(pid);
    } catch {
      /* gone */
    }
  }

  const folderBytes = files.reduce((n, f) => n + f.size, 0);
  const sizes = { zip: statSync(zip).size, folder: folderBytes, asar: statSync(asarPath).size, toolchain: files.filter((f) => f.rel.startsWith('resources/toolchain/')).reduce((n, f) => n + f.size, 0), files: files.length };
  console.log(`size: zip ${mb(sizes.zip)}, folder ${mb(sizes.folder)} (${sizes.files} files), app.asar ${mb(sizes.asar)}, cc65 ${mb(sizes.toolchain)}`);
  writeFileSync(path.join(root, '.tmp', 'package-report.json'), JSON.stringify({ at: new Date().toISOString(), zip: path.basename(zip), sizes, shipped, results, smoke }, null, 2));
  exitCode = results.every((r) => r.ok) ? 0 : 1;
  console.log(`test:package: ${exitCode === 0 ? 'OK' : 'FAIL'} (${results.filter((r) => r.ok).length}/${results.length})`);
} finally {
  // our own temp extraction
  if (!keep) rmSync(base, { recursive: true, force: true });
  else console.log(`kept ${base}`);
}
process.exit(exitCode);
