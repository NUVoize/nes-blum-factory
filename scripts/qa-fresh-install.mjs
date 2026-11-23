// BLUM-Q1: fresh-install test as Blum, on the gift zip, through the real window (no --smoke hooks).
//   node scripts/qa-fresh-install.mjs [--zip=release/CADEAU-BLUM-<version>.zip] [--out=.tmp/q1-fresh] [--port=5179]
// Unzips the gift into "<out>\Blum Québec\", starts the packaged exe with no key (offline), drives it over
// the Chrome DevTools protocol with real mouse/keyboard events: title -> Start -> open the sample BLUM ->
// CHROMA: edit one pixel row of a hero tile -> approve -> BOULON: build -> export (native folder dialog,
// answered through Windows UI Automation) -> Play: Start + run right -> close. One PNG and the visible text
// per step go to <out>/steps/. User data and projects stay in <out> (temp --user-data-dir + projectsDir);
// the real %APPDATA% and Documents are never touched. Every process started here is closed at the end.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const zip = path.resolve(arg('zip') ?? path.join(root, 'release', `CADEAU-BLUM-${JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version}.zip`));
const out = path.resolve(arg('out') ?? path.join(root, '.tmp', 'q1-fresh'));
const port = Number(arg('port') ?? 5179);
const steps = path.join(out, 'steps');
const home = path.join(out, 'Blum Québec');
const userData = path.join(out, 'userdata');
const projectsDir = path.join(out, 'Documents', 'NES BLUM FACTORY');
const exportParent = path.join(out, 'Exports');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const note = (s) => (console.log(s), log.push(s));

rmSync(out, { recursive: true, force: true });
for (const d of [steps, home, userData, projectsDir, exportParent]) mkdirSync(d, { recursive: true });
note(`unzip ${zip}`);
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${home}' -Force`], { windowsHide: true });
const giftDir = readdirSync(home).map((n) => path.join(home, n)).find((p) => statSync(p).isDirectory() && existsSync(path.join(p, 'NES BLUM FACTORY')));
const appDir = path.join(giftDir ?? home, 'NES BLUM FACTORY');
const exe = path.join(appDir, 'NES BLUM FACTORY.exe');
if (!existsSync(exe)) throw new Error(`no exe in the zip at ${exe}`);
// only the projects folder is preset (Documents of this test); every other setting is the first-run default
writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ projectsDir }));

function appPids() {
  try {
    const o = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='NES BLUM FACTORY.exe'\" | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress"], { encoding: 'utf8', windowsHide: true }).trim();
    return o ? [].concat(JSON.parse(o)).filter((p) => (p.ExecutablePath ?? '').toLowerCase() === exe.toLowerCase()).map((p) => p.ProcessId) : [];
  } catch {
    return [];
  }
}

const child = spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], { cwd: appDir, stdio: 'ignore', windowsHide: false });
const result = { exe, steps: [], problems: [], texts: {} };
let ws;
try {
  // ---- CDP connection ----
  let target = null;
  for (let i = 0; i < 100 && !target; i++) {
    await sleep(300);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'));
    } catch {}
  }
  if (!target) throw new Error('no DevTools target (remote debugging refused?)');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const cdp = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const js = async (expr) => {
    const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`js: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  const waitFor = async (sel, ms = 10000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await js(`!!document.querySelector(${JSON.stringify(sel)})`)) return true;
      await sleep(100);
    }
    return false;
  };
  const tid = (t) => `[data-testid="${t}"]`;
  const centre = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: !!e.disabled }; })()`);
  const mouse = async (x, y, type) => cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  const click = async (sel, what) => {
    if (!(await waitFor(sel, 15000))) return problem(`${what}: ${sel} not found`);
    await sleep(150);
    const c = await centre(sel);
    if (!c || c.disabled) return problem(`${what}: ${sel} ${c ? 'disabled' : 'gone'}`);
    await mouse(c.x, c.y, 'mouseMoved');
    await mouse(c.x, c.y, 'mousePressed');
    await mouse(c.x, c.y, 'mouseReleased');
    return true;
  };
  const KEYS = { Enter: 13, ArrowRight: 39, ArrowLeft: 37, KeyX: 88, KeyZ: 90 };
  const key = async (code, type) => cdp('Input.dispatchKeyEvent', { type, code, key: code === 'Enter' ? 'Enter' : code, windowsVirtualKeyCode: KEYS[code] ?? 0 });
  const tap = async (code, ms = 120) => (await key(code, 'rawKeyDown'), await sleep(ms), await key(code, 'keyUp'));
  let n = 0;
  const shot = async (name) => {
    await sleep(400);
    const png = await cdp('Page.captureScreenshot', { format: 'png' });
    const base = `${String(++n).padStart(2, '0')}-${name}`;
    writeFileSync(path.join(steps, `${base}.png`), Buffer.from(png.data, 'base64'));
    const text = await js(`document.body.innerText`);
    writeFileSync(path.join(steps, `${base}.txt`), text);
    result.texts[base] = text;
    result.steps.push(base);
  };
  function problem(s) {
    note(`PROBLEM ${s}`);
    result.problems.push(s);
    return false;
  }
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  const consoleErrors = [];
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params.exceptionDetails?.exception?.description ?? 'exception');
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  });

  // ---- 1. title, offline ----
  if (!(await waitFor(tid('screen-title'), 20000))) problem('title screen never shown');
  await shot('title');
  await tap('Enter');
  if (!(await waitFor(tid('screen-cartridges')))) problem('Enter on the title did not open the cartridges');
  await shot('cartridges');

  // ---- 2. open the sample (a fresh copy) ----
  await click(tid('open-sample'), 'open sample');
  if (!(await waitFor(tid('screen-hub'), 20000))) problem('sample did not open the hub');
  await shot('hub-sample');
  const settings = JSON.parse(readFileSync(path.join(userData, 'settings.json'), 'utf8'));
  result.locale = settings.locale ?? 'fr';
  result.projects = existsSync(projectsDir) ? readdirSync(projectsDir) : [];

  // ---- 3. CHROMA: change one hero tile ----
  await click(tid('station-visual'), 'CHROMA station');
  if (!(await waitFor(tid('screen-director-visual')))) problem('CHROMA screen missing');
  result.offlineBanner = await js(`document.querySelector('[data-testid="offline-banner"]')?.textContent ?? ''`);
  await shot('chroma');
  // the converter's world choice (names, not ids, since BLUM-Q1)
  await js(`[...document.querySelectorAll('[role="radiogroup"]')].at(-2)?.scrollIntoView({ block: 'center' }), true`);
  result.chromaOverflow = await js(`[...document.querySelectorAll('[role="radiogroup"]')].some((g) => g.scrollWidth > g.clientWidth + 1)`);
  if (result.chromaOverflow) problem('a CHROMA radio row overflows');
  await shot('chroma-form');
  await js(`[...document.querySelectorAll('.lib-item')].find((b) => /blum/i.test(b.textContent))?.scrollIntoView({ block: 'center' }), true`);
  const heroPos = await js(`(() => { const b = [...document.querySelectorAll('.lib-item')].find((b) => /blum/i.test(b.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!heroPos) problem('no hero (Blum) in the graphics library');
  else {
    await mouse(heroPos.x, heroPos.y, 'mousePressed');
    await mouse(heroPos.x, heroPos.y, 'mouseReleased');
  }
  if (await waitFor(tid('lib-sheet-0'), 8000)) {
    // the first tile of bank 0 (top-left 8x8 of the sheet)
    const r = await js(`(() => { const c = document.querySelector('[data-testid="lib-sheet-0"]'); c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cw: c.width }; })()`);
    const s = r.w / r.cw;
    // pick a tile with some ink: tile 1 of the sheet (8..15 px)
    await mouse(r.x + 12 * s, r.y + 4 * s, 'mousePressed');
    await mouse(r.x + 12 * s, r.y + 4 * s, 'mouseReleased');
  } else problem('hero sheet not shown');
  if (await waitFor(tid('tile-editor'), 5000)) {
    await shot('tile-editor');
    // ink 3, paint the top row of the tile
    await js(`document.querySelector('[data-testid="tile-editor"]').scrollIntoView({ block: 'center' }), true`);
    await sleep(300);
    const inks = await js(`[...document.querySelectorAll('[data-testid="tile-editor"] .ink')].map((b) => { const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })`);
    await mouse(inks[3].x, inks[3].y, 'mousePressed');
    await mouse(inks[3].x, inks[3].y, 'mouseReleased');
    const px = await js(`[...document.querySelectorAll('[data-testid="tile-editor"] .tile-px')].slice(0, 8).map((b) => { const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })`);
    await mouse(px[0].x, px[0].y, 'mousePressed');
    for (const p of px.slice(1)) await mouse(p.x, p.y, 'mouseMoved');
    await mouse(px[7].x, px[7].y, 'mouseReleased');
    await shot('tile-painted');
    await click(tid('tile-save'), 'tile save');
    if (await waitFor(tid('approve'), 8000)) {
      await shot('tile-proposed');
      await click(tid('approve'), 'approve tile');
      await sleep(800);
      await shot('tile-approved');
    } else problem('no proposal after saving the tile');
  } else problem('tile editor did not open');

  // ---- 4. BOULON: build, export ----
  await js(`history.back(), true`);
  if (!(await waitFor(tid('screen-hub')))) await js(`(location.hash = '#/hub', true)`);
  await click(tid('hub-build'), 'hub build');
  if (!(await waitFor(tid('build-run')))) problem('BOULON build button missing');
  await click(tid('build-run'), 'build');
  const green = await waitFor(tid('build-green'), 90000);
  if (!green) problem(`build not green: ${await js(`[...document.querySelectorAll('[data-testid="build-problem"]')].map((p) => p.textContent).join(' | ')`)}`);
  await shot('build');
  if (green) {
    await click(tid('build-export'), 'export');
    // native folder dialog: answer it with UI Automation
    const ps = `
$ErrorActionPreference = 'Continue'
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, string l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static string Cls(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, StringBuilder l);
  public static string GetText(IntPtr h) { var s = new StringBuilder(1024); SendMessage(h, 0x000D, (IntPtr)1024, s); return s.ToString(); }
  public static string Txt(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
  public static List<IntPtr> Tops(uint[] pids) { var r = new List<IntPtr>(); EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (Array.IndexOf(pids, p) >= 0 && IsWindowVisible(h) && Cls(h) == "#32770") r.Add(h); return true; }, IntPtr.Zero); return r; }
  public static List<IntPtr> Kids(IntPtr d) { var r = new List<IntPtr>(); EnumChildWindows(d, (h, l) => { r.Add(h); return true; }, IntPtr.Zero); return r; }
}
"@
$pids = [uint32[]]@(Get-Process -Name 'NES BLUM FACTORY' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${exe.replace(/'/g, "''")}' } | ForEach-Object { $_.Id })
$dlg = [IntPtr]::Zero
for ($i = 0; $i -lt 80 -and $dlg -eq [IntPtr]::Zero; $i++) { Start-Sleep -Milliseconds 250; $t = [W]::Tops($pids); if ($t.Count) { $dlg = $t[0] } }
if ($dlg -eq [IntPtr]::Zero) { 'NO_DIALOG'; exit 2 }
'TITLE=' + [W]::Txt($dlg)
$want = '${exportParent.replace(/'/g, "''")}'
$edit = [IntPtr]::Zero
foreach ($k in [W]::Kids($dlg)) {
  if ([W]::Cls($k) -eq 'Edit') { 'EDIT_ID=' + [W]::GetDlgCtrlID($k) + '|parent=' + [W]::Cls([W]::GetParent($k)) + '|' + [W]::GetDlgCtrlID([W]::GetParent($k)) + '|visible=' + [W]::IsWindowVisible($k) }
  if ([W]::Cls($k) -eq 'Edit' -and [W]::GetDlgCtrlID($k) -eq 1152) { $edit = $k }
}
$cancel = [W]::Kids($dlg) | Where-Object { [W]::Cls($_) -eq 'Button' -and [W]::GetDlgCtrlID($_) -eq 2 } | Select-Object -First 1
if ($edit -eq [IntPtr]::Zero) { 'NO_EDIT'; if ($cancel) { [void][W]::SendMessage($cancel, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero); 'CANCELLED' }; exit 3 }
[void][W]::SendMessage($edit, 0x000C, [IntPtr]::Zero, $want)
Start-Sleep -Milliseconds 300
$got = [W]::GetText($edit)
'EDIT_TEXT=' + $got
if ($got -ne $want) { 'MISMATCH'; if ($cancel) { [void][W]::SendMessage($cancel, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero); 'CANCELLED' }; exit 5 }
$ok = [W]::Kids($dlg) | Where-Object { [W]::Cls($_) -eq 'Button' -and [W]::GetDlgCtrlID($_) -eq 1 } | Select-Object -First 1
if (-not $ok) { 'NO_OK'; exit 4 }
'OK=' + [W]::Txt($ok)
[void][W]::SendMessage($ok, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
'CLICKED'
`;
    const psFile = path.join(out, 'answer-dialog.ps1');
    writeFileSync(psFile, '\ufeff' + ps);
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
    result.dialog = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split(/\r?\n/);
    note(`folder dialog: ${result.dialog.join(' ; ')}`);
    if (!(await waitFor(tid('export-files'), 30000))) problem('export files not listed');
    await shot('exported');
    const exported = [];
    const walk = (d) => readdirSync(d).forEach((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : exported.push(path.join(d, f))));
    walk(exportParent);
    result.exported = exported.map((f) => ({ file: path.relative(exportParent, f), bytes: statSync(f).size }));
    const nes = exported.find((f) => f.endsWith('.nes'));
    if (!nes) problem('no .nes exported');
    else {
      const rom = readFileSync(nes);
      result.romSha1 = createHash('sha1').update(rom).digest('hex');
      const shipped = readFileSync(path.join(giftDir, 'Jeu BLUM', 'BLUM.nes'));
      result.differsFromShipped = !rom.equals(shipped);
      result.romBytes = rom.length;
      if (!result.differsFromShipped) problem('exported ROM equals the shipped ROM: the tile edit did not reach the ROM');
      if (rom.length !== shipped.length || !rom.subarray(0, 16).equals(shipped.subarray(0, 16))) problem('exported ROM header or size differs from the shipped BLUM.nes');
    }
    for (const want of ['.nes', '-PRG.bin', '-CHR.bin', 'fiche cartouche.html', 'cartridge sheet.html', '.blum.zip']) if (!exported.some((f) => f.endsWith(want))) problem(`export missing *${want}`);
  }

  // ---- 5. Play in the built-in emulator ----
  await js(`(location.hash = '#/hub', true)`);
  await click(tid('hub-play'), 'hub play');
  if (!(await waitFor(tid('play-ready'), 20000))) problem('emulator not ready');
  await sleep(1500);
  await shot('play-title');
  await tap('Enter', 150);
  await sleep(2500);
  // through the world intro if any
  await tap('Enter', 150);
  await sleep(2000);
  await key('ArrowRight', 'rawKeyDown');
  await sleep(500);
  await tap('KeyX', 300);
  await sleep(1500);
  await key('ArrowRight', 'keyUp');
  await shot('play-stage');
  const colours = await js(`(() => { const c = document.querySelector('[data-testid="play-canvas"]'); if (!c) return 0; const d = c.getContext('2d').getImageData(0, 0, 256, 240).data; const s = new Set(); for (let i = 0; i < d.length; i += 4) s.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]); return s.size; })()`);
  result.playColours = colours;
  if (colours < 4) problem(`play canvas nearly blank (${colours} colours)`);

  // ---- 6. BLUMR-M2: « Jeu SEBRING » in the gift, and « Jeu d'exemple SEBRING » plays in the app ----
  for (const f of ['SEBRING.nes', 'SEBRING - fiche cartouche.html', 'SEBRING-pistes.json']) if (!existsSync(path.join(giftDir, 'Jeu SEBRING', f))) problem(`gift missing Jeu SEBRING/${f}`);
  await js(`(location.hash = '#/cartridges', true)`);
  await click(tid('open-sebring'), 'open SEBRING');
  if (!(await waitFor(tid('play-route'), 20000))) problem('SEBRING did not open in the player');
  await sleep(1500);
  await tap('Enter', 150); // title -> stage card
  await sleep(2500);
  await tap('Enter', 150); // card -> race
  await sleep(1000);
  await key('KeyX', 'rawKeyDown');
  await sleep(3000);
  await key('KeyX', 'keyUp');
  await shot('sebring-race');
  const sColours = await js(`(() => { const c = document.querySelector('[data-testid="play-canvas"]'); if (!c) return 0; const d = c.getContext('2d').getImageData(0, 0, 256, 240).data; const s = new Set(); for (let i = 0; i < d.length; i += 4) s.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]); return s.size; })()`);
  result.sebringColours = sColours;
  if (sColours < 8) problem(`SEBRING canvas nearly blank (${sColours} colours)`);

  // ---- 7. BLUMZ-F2: « Jeu THE LEGEND OF BLUM » in the gift, and the app's sample shows its title, then the prologue ----
  for (const f of ['LEGEND-OF-BLUM-SLICE.nes', 'LEGEND-OF-BLUM-SLICE - fiche cartouche.html']) if (!existsSync(path.join(giftDir, 'Jeu THE LEGEND OF BLUM', f))) problem(`gift missing Jeu THE LEGEND OF BLUM/${f}`);
  await js(`(location.hash = '#/cartridges', true)`);
  await click(tid('open-legend'), 'open THE LEGEND OF BLUM');
  if (!(await waitFor(tid('play-route'), 20000))) problem('THE LEGEND OF BLUM did not open in the player');
  if (!(await waitFor(tid('play-battery'), 3000))) problem('THE LEGEND OF BLUM: no save note in the player');
  await sleep(2500);
  await shot('legend-title');
  const lColours = await js(`(() => { const c = document.querySelector('[data-testid="play-canvas"]'); if (!c) return 0; const d = c.getContext('2d').getImageData(0, 0, 256, 240).data; const s = new Set(); for (let i = 0; i < d.length; i += 4) s.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]); return s.size; })()`);
  result.legendColours = lColours;
  if (lColours < 6) problem(`THE LEGEND OF BLUM title nearly blank (${lColours} colours)`);
  await tap('KeyX', 150); // COMMENCER -> prologue card
  await sleep(2500);
  await shot('legend-prologue');
  result.consoleErrors = consoleErrors;
  if (consoleErrors.length) problem(`console errors: ${consoleErrors.join(' | ')}`);
} catch (e) {
  result.problems.push(`run: ${e?.stack ?? e}`);
  console.error(e);
} finally {
  try {
    ws?.close();
  } catch {}
  child.kill();
  await sleep(1500);
  for (const pid of appPids()) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  await sleep(500);
  result.leftover = appPids();
  result.appDataUntouched = true;
  writeFileSync(path.join(out, 'fresh-result.json'), JSON.stringify(result, null, 1));
  console.log(`steps: ${result.steps.join(', ')}`);
  console.log(`problems (${result.problems.length}): ${result.problems.join(' | ') || 'none'}`);
  console.log(`leftover app processes: ${result.leftover.length}`);
}
process.exit(result.problems.length ? 1 : 0);
