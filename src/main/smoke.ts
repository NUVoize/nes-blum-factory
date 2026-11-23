import { app, type BrowserWindow } from 'electron';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { APP_TITLE } from '../shared/app-info.js';
import type { Session } from './session.js';

// Hidden-window smoke runner (TEST-STRATEGY §4). One PNG per route, DOM checks, console errors,
// optional navigation flow title -> Enter -> cartridges -> new project -> hub (M1-T1).
export interface SmokeOptions {
  out: string;
  routes: string[];
  locale: 'fr' | 'en';
  flow: boolean;
}

export interface RouteResult {
  route: string;
  ok: boolean;
  png: string | null;
  problems: string[];
}

export const routeSlug = (route: string) => route.split('?')[0]!.replace(/\//g, '-');
/** PNG name: the route with its query (`director/movement?tab=bosses` -> `director-movement-bosses`). */
const pngSlug = (route: string) => route.replace(/\?tab=|\?/g, '-').replace(/[/=&]/g, '-');

/** Hash to open for a route: `play` plays the demo game (M2-T9). */
const routeHash = (route: string) => (route === 'play' ? 'play?rom=demo' : route === 'sample' ? 'hub' : route === 'sebring' ? 'play?rom=sebring' : route === 'legend' ? 'play?rom=legend' : route);

/** Extra DOM expectations per route. */
const EXPECT: Record<string, string[]> = {
  title: ['app-title'],
  cartridges: ['new-project'],
  hub: ['station-story', 'station-visual', 'station-movement', 'station-level', 'station-build'],
  settings: ['key-status'],
  history: ['history-list'],
  gallery: ['gallery-frame', 'gallery-dialog', 'gallery-proposal', 'gallery-budget'],
  play: ['play-canvas', 'play-ready'],
  sebring: ['play-canvas', 'play-ready', 'play-route'],
  legend: ['play-canvas', 'play-ready', 'play-route', 'play-battery'],
  help: ['help-flash', 'help-hw', 'help-unblock', 'help-smartscreen', 'help-mesen', 'help-key'],
  first: ['first-dialog', 'first-step'],
};

/** Per-route wait (ms) for the expected test ids: `play` builds a ROM with cc65, then runs 120 frames. */
const WAIT: Record<string, number> = { play: 45_000, 'play?tune=1': 60_000, 'director/visual': 20_000 };

/** M5-T1 / M5-T3: BOULON's panel (build, fix loop, export). */
const BUILD_EXPECT = ['build-panel', 'build-run', 'build-steps', 'build-budget'];
const BUILD_WAIT = 60_000;

/** M3-T8: CHROMA shows before/after, palettes and budget for an example picture. */
const CHROMA_EXPECT = ['chroma-workbench', 'chroma-before', 'chroma-after', 'chroma-budget', 'chroma-palettes', 'meter-palettes', 'chroma-tiles', 'chroma-library'];

const NEEDS_PROJECT = (r: string) => r === 'hub' || r === 'history' || r === 'first' || r.startsWith('director/') || r.startsWith('play?tune');

/**
 * M6-T1: visible text that overflows its box (not a scroll box, not an ellipsis on purpose), and raw
 * dictionary keys shown instead of a translation.
 */
const TEXT_CHECK = `(() => {
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || el.clientWidth === 0) continue;
    if (/auto|scroll/.test(cs.overflowX + cs.overflowY) || cs.textOverflow === 'ellipsis') continue;
    if (el.closest('.sr-only') || el.closest('svg')) continue;
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    if (!text) continue;
    if (el.scrollWidth > el.clientWidth + 1) out.push('overflow ' + el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0] + ': ' + text.slice(0, 40));
  }
  const keys = document.body.innerText.match(/\b(?:nav|hub|cart|first|help|settings|history|play|dir|boulon|tableau|beh|title|lang|common|offline|chroma|rebond|plume|budget|story|gallery|tray|key)\.[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)*\b/g) ?? [];
  for (const k of keys) out.push('raw key ' + k);
  return out;
})()`;

/** M4-T9: the editor panels (on top of the director checks). */
const EDITOR_EXPECT: Record<string, string[]> = {
  'director/story': ['story-form', 'story-world', 'story-text-budget', 'story-propose'],
  'director/movement': ['movement-panel', 'phys-jump', 'phys-doubleJump', 'phys-attack', 'physics-live'],
  'director/movement?tab=enemies': ['movement-panel', 'enemy-new', 'pattern-hopper', 'enemy-propose'],
  'director/movement?tab=bosses': ['movement-panel', 'boss-script', 'boss-propose'],
  'director/level': ['level-panel', 'level-grid', 'mt-palette', 'level-issues', 'level-propose'],
  'play?tune=1': ['play-canvas', 'play-ready', 'live-tuning'],
  'director/build': BUILD_EXPECT,
  'director/build?fix=1': BUILD_EXPECT,
};

export async function runSmoke(win: BrowserWindow, opts: SmokeOptions, session: Session): Promise<number> {
  const consoleErrors: string[] = [];
  win.webContents.on('console-message', (...args: unknown[]) => {
    // Electron >= 35 passes one event object with level/message; older versions pass positional args.
    const ev = args[0] as { level?: unknown; message?: unknown };
    const level = typeof ev?.level === 'string' ? ev.level : args[1] === 3 ? 'error' : '';
    const message = typeof ev?.message === 'string' ? ev.message : String(args[2] ?? '');
    if (level === 'error') consoleErrors.push(message);
  });

  const js = <T>(code: string) => win.webContents.executeJavaScript(code) as Promise<T>;
  const waitFor = (testid: string, ms = 10_000) =>
    js<boolean>(`new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        if (document.querySelector('[data-testid="${testid}"]')) resolve(true);
        else if (Date.now() - t0 > ${ms}) resolve(false);
        else setTimeout(tick, 50);
      };
      tick();
    })`);
  const settle = () =>
    js<void>(`document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 250)))))`);

  const result: Record<string, unknown> = {
    ok: false,
    electron: process.versions.electron,
    locale: opts.locale,
    packaged: app.isPackaged,
    toolchainDir: session.buildPaths()?.toolchainDir ?? null,
  };
  const timer = setTimeout(() => {
    writeFileSync(opts.out, JSON.stringify({ ...result, ok: false, error: 'timeout' }));
    process.exit(2);
  }, 150_000);

  try {
    await new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()));
    const routes: RouteResult[] = [];
    let flowOk: boolean | null = null;

    if (await waitFor('screen-title')) {
      result.title = await js<string>(`document.querySelector('[data-testid="app-title"]')?.textContent ?? null`);
    }

    if (opts.flow) {
      const steps: string[] = [];
      const step = async (name: string, ok: boolean) => {
        steps.push(`${name}:${ok ? 'ok' : 'FAIL'}`);
        return ok;
      };
      flowOk =
        (await step('title', await waitFor('screen-title'))) &&
        (await js<boolean>(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })), true`)) &&
        (await step('cartridges', await waitFor('screen-cartridges'))) &&
        (await js<boolean>(`document.querySelector('[data-testid="new-project"]').click(), true`)) &&
        (await step('form', await waitFor('create-project'))) &&
        (await js<boolean>(`document.querySelector('[data-testid="create-project"]').click(), true`)) &&
        (await step('hub', await waitFor('screen-hub')));
      result.flow = { ok: flowOk, steps };
    }

    for (const route of opts.routes) {
      const problems: string[] = [];
      if (NEEDS_PROJECT(route) && !session.current()) {
        const r = session.createProject('DEMO');
        if (!r.ok) problems.push(`create project: ${r.en}`);
        await js(`window.dispatchEvent(new Event('blum:project-changed')), true`);
      }
      // Seed real data through the normal proposal flow so the captures show it: an approved story
      // template (history, story panel) and a pending physics preset (proposal card in the tray).
      if (route === 'director/story' && session.history().length === 0) {
        const p = session.offline('story', 'jardin');
        if (p.ok) session.approve(p.value.id);
        await js(`window.dispatchEvent(new Event('blum:project-changed')), true`);
      }
      if (route.startsWith('director/movement') && !session.proposals('movement').some((p) => p.state === 'pending')) {
        session.offline('movement', 'flottant');
      }
      // a boss from the placeholder art, fought at the end of the demo stage (REBOND boss tab, TABLEAU grid)
      if ((route === 'director/movement?tab=bosses' || route === 'director/level') && !session.current()?.docs['actors/gros-castor.json']) {
        const b = session.manual('movement', 'propose_boss', {
          id: 'gros-castor',
          name: { fr: 'Gros castor', en: 'Big beaver' },
          hp: 6,
          damage: 1,
          graphics: 'graphics/boss-castor.json',
          script: 'phase\nvulnerable on\nwait 50\nshoot aimed 40\njump -16 64\nwait 40\nphase hp<=3\nflash 20\ncharge 40\nshoot spread 40\nwait 40',
          place: { level: 'niveau-1', col: 57, row: 10 },
        });
        if (b.ok) session.approve(b.value.id);
        else problems.push(`seed boss: ${b.en}`);
        await js(`window.dispatchEvent(new Event('blum:project-changed')), true`);
      }
      if (route === 'director/build?fix=1') {
        // M5-T3 in the app: a project whose first stage is 10 screens wide (as an old or hand-edited file)
        const created = session.createProject('TROP LONG');
        if (created.ok) {
          const dir = created.value.dir;
          session.closeProject();
          const file = path.join(dir, 'levels', 'niveau-1.json');
          const level = JSON.parse(readFileSync(file, 'utf8')) as { width: number; grid: number[][]; entities: Array<{ col: number }> };
          const extra = 160 - level.width;
          level.grid = level.grid.map((row) => [...row.slice(0, 20), ...Array.from({ length: extra }, (_, i) => row[16 + (i % 4)]!), ...row.slice(20)]);
          level.entities = level.entities.map((e) => (e.col >= 20 ? { ...e, col: e.col + extra } : e));
          level.width = 160;
          writeFileSync(file, JSON.stringify(level, null, 2));
          const opened = session.openProject(dir);
          if (!opened.ok || !opened.value.readOnly) problems.push('oversized project did not open read-only');
        } else problems.push(`create project: ${created.en}`);
        await js(`window.dispatchEvent(new Event('blum:project-changed')), true`);
      }
      if (route === 'sample') {
        // M6-T6: the bundled sample BLUM opens as a fresh copy, builds green and exports
        const opened = session.openSample();
        if (!opened.ok) problems.push(`sample: ${opened.en}`);
        else {
          await js(`window.dispatchEvent(new Event('blum:project-changed')), true`);
          const b = await session.buildRun();
          if (!b.ok || !b.value.ok) problems.push(`sample build: ${b.ok ? b.value.problems.map((p) => `${p.what.en} ${p.raw}`).join(' | ') : b.en}`);
          const e = b.ok && b.value.ok ? await session.buildExport() : null;
          if (e && !e.ok) problems.push(`sample export: ${e.en}`);
          result.sample = {
            ok: problems.length === 0,
            dir: opened.value.dir,
            stages: opened.value.stages,
            history: session.history().length,
            rom: b.ok ? b.value.rom : null,
            run: b.ok ? b.value.run : null,
            exported: e?.ok ? { dir: e.value.dir, files: e.value.files.map((f) => f.name) } : null,
          };
        }
      }
      if (route === 'sebring') {
        // BLUMR-M2: « Jeu d'exemple SEBRING » (tracks file checked, prebuilt ROM) plays in the built-in player
        const r = session.buildRom('sebring');
        if (!r.ok) problems.push(`sebring: ${r.en}`);
        result.sebring = r.ok ? { ok: true, bytes: r.value.rom.length, sha1: createHash('sha1').update(r.value.rom).digest('hex'), route: r.value.route?.map((n) => n.fr) ?? [] } : { ok: false, error: r.en };
      }
      if (route === 'legend') {
        // BLUMZ-F2: « Jeu d'exemple THE LEGEND OF BLUM (début) » (prebuilt slice ROM, battery kept in the user data)
        const r = session.buildRom('legend');
        if (!r.ok) problems.push(`legend: ${r.en}`);
        result.legend = r.ok ? { ok: true, bytes: r.value.rom.length, sha1: createHash('sha1').update(r.value.rom).digest('hex'), battery: r.value.battery === true, chapters: r.value.route?.map((n) => n.fr) ?? [] } : { ok: false, error: r.en };
      }
      await js(`(location.hash = '#/${routeHash(route)}', true)`);
      const slug = route === 'sample' ? 'hub' : route === 'sebring' || route === 'legend' ? 'play' : routeSlug(route);
      if (!(await waitFor(`screen-${slug}`))) problems.push(`missing data-testid=screen-${slug}`);
      for (const id of [...(EXPECT[route] ?? (route.startsWith('director/') ? ['offline-banner', 'dialog-box', 'proposal-tray'] : [])), ...(EDITOR_EXPECT[route] ?? [])]) {
        if (!(await waitFor(id, WAIT[route] ?? 3000))) problems.push(`missing data-testid=${id}`);
      }
      if (route === 'director/visual') {
        // drop the bundled example character, as Blum would with his own drawing
        if (await waitFor('chroma-example-character')) await js(`document.querySelector('[data-testid="chroma-example-character"]').click(), true`);
        for (const id of CHROMA_EXPECT) if (!(await waitFor(id, WAIT[route]))) problems.push(`missing data-testid=${id}`);
        const loaded = await js<boolean>(`new Promise((resolve) => { const t0 = Date.now(); const tick = () => { const a = document.querySelector('[data-testid="chroma-after"]'); if (a && a.complete && a.naturalWidth > 0) resolve(true); else if (Date.now() - t0 > 10000) resolve(false); else setTimeout(tick, 50); }; tick(); })`);
        if (!loaded) problems.push('chroma after image not loaded');
        // W1 P1-2: the example fits the demo world, so the first conversion keeps its colours (no hint)
        if (await js<boolean>(`!!document.querySelector('[data-testid="chroma-empty"], [data-testid="chroma-colour-hint"]')`)) problems.push('chroma example shows the colour hint or the empty text');
      }
      const click = (id: string) => js<boolean>(`(() => { const b = document.querySelector('[data-testid="${id}"]'); if (!b || b.disabled) return false; b.click(); return true; })()`);
      const capture = async (suffix: string) => {
        win.webContents.invalidate();
        await settle();
        writeFileSync(path.join(path.dirname(opts.out), `${opts.locale}-${pngSlug(route)}-${suffix}.png`), (await win.webContents.capturePage()).toPNG());
      };
      if (route === 'director/build') {
        // M5-T1: one click, report all green, ROM valid; then the export writes every file
        if (!(await click('build-run'))) problems.push('build-run not clickable');
        if (!(await waitFor('build-green', BUILD_WAIT))) problems.push(`build not green: ${await js<string>(`[...document.querySelectorAll('[data-testid="build-problem"]')].map((p) => p.textContent).join(' | ')`)}`);
        const lamps = await js<string[]>(`[...document.querySelectorAll('[data-testid^="build-step-"]')].map((l) => l.dataset.state)`);
        if (lamps.join() !== 'ok,ok,ok,ok') problems.push(`build lamps: ${lamps.join()}`);
        const report = session.buildLast();
        if (!report?.ok || report.rom?.bytes !== 393232 || !report.rom.header.startsWith('4E 45 53 1A')) problems.push(`ROM report: ${JSON.stringify(report?.rom)}`);
        result.build = { ok: report?.ok ?? false, rom: report?.rom ?? null, run: report?.run ?? null, ms: report?.ms ?? 0 };
        await capture('green');
        if (!(await click('build-export'))) problems.push('build-export not clickable');
        if (!(await waitFor('export-files', 20_000))) problems.push('export files not listed');
        else {
          const names = await js<string[]>(`[...document.querySelectorAll('[data-testid="export-files"] li .digits')].map((s) => s.textContent)`);
          (result.build as Record<string, unknown>).exported = names;
          for (const want of ['.nes', '-PRG.bin', '-CHR.bin', ' - fiche cartouche.html', ' - cartridge sheet.html', '.blum.zip']) {
            if (!names.some((n) => n.endsWith(want))) problems.push(`export missing *${want}`);
          }
        }
      }
      if (route === 'first') {
        // M6-T5: the five-step tour offline, end to end: story -> graphics -> movement -> stages -> build,
        // export, play
        const steps: string[] = [];
        const need = async (id: string, ms = 5000) => {
          const ok = await waitFor(id, ms);
          steps.push(`${id}:${ok ? 'ok' : 'FAIL'}`);
          if (!ok) problems.push(`first: missing ${id}`);
          return ok;
        };
        const fresh = session.createProject(opts.locale === 'fr' ? 'MA PREMIÈRE' : 'MY FIRST');
        if (!fresh.ok) problems.push(`create project: ${fresh.en}`);
        await js(`window.dispatchEvent(new Event('blum:project-changed')), true`);
        await js(`(location.hash = '#/first', true)`);
        if ((await need('first-story-jardin')) && (await click('first-story-jardin')) && (await need('first-approved'))) {
          await capture('1-story');
          await click('first-next');
          if (await need('first-panel-visual')) {
            await need('first-hero');
            await capture('2-visual');
            await click('first-next');
          }
          if ((await need('first-preset-leger')) && (await click('first-preset-leger')) && (await need('first-approved'))) {
            await click('first-next');
            if (await need('first-stages')) {
              await capture('4-level');
              await click('first-next');
            }
          }
          if ((await need('first-build')) && (await click('first-build')) && (await need('first-green', BUILD_WAIT))) {
            await capture('5-build');
            if ((await click('first-export')) && (await need('first-exported', 20_000))) {
              const names = await js<string[]>(`[...document.querySelectorAll('[data-testid="first-exported"] li')].map((s) => s.textContent)`);
              for (const want of ['.nes', '-PRG.bin', '-CHR.bin', '.blum.zip']) if (!names.some((n) => n.endsWith(want))) problems.push(`first: export missing *${want}`);
            }
          }
        }
        const story = session.current()?.docs['story.json'] as { title?: string } | undefined;
        const physics = session.current()?.docs['physics.json'] as { gravity?: number } | undefined;
        if (story?.title !== 'FLEUR EN FUITE') problems.push(`first: story not approved (${story?.title})`);
        if (physics?.gravity !== 28) problems.push(`first: preset not approved (${physics?.gravity})`);
        result.first = { ok: problems.length === 0, steps, history: session.history().length };
      }
      if (route === 'director/build?fix=1') {
        // M5-T3 in the app: red report -> BOULON proposes a split -> approve in the tray -> rebuild green
        if (!(await click('build-run'))) problems.push('build-run not clickable');
        if (!(await waitFor('build-red', BUILD_WAIT))) problems.push('oversized project did not build red');
        await capture('red');
        if (!(await click('build-fix'))) problems.push('build-fix not clickable');
        if (!(await waitFor('approve', BUILD_WAIT))) problems.push('no repair proposal in the tray');
        await capture('proposed');
        if (!(await click('approve'))) problems.push('approve not clickable');
        if (!(await waitFor('build-green', BUILD_WAIT))) problems.push('no green rebuild after the approved repair');
        const st = await js<string>(`document.querySelector('[data-testid="build-fix-state"]')?.dataset.state ?? ''`);
        if (st !== 'green') problems.push(`fix state ${st}`);
        result.fix = { ok: st === 'green', stages: session.current()?.stages ?? 0 };
      }
      await settle();
      if (route === 'play' || route.startsWith('play?')) {
        // press Start, then run right for a moment, so the capture shows the stage
        const key = (type: string, code: string) => js(`window.dispatchEvent(new KeyboardEvent('${type}', { code: '${code}', bubbles: true })), true`);
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        await key('keydown', 'Enter');
        await sleep(200);
        await key('keyup', 'Enter');
        await sleep(1200);
        await key('keydown', 'ArrowRight');
        await sleep(900);
        await key('keyup', 'ArrowRight');
        await sleep(300);
        // M2-T9: the emulator canvas is not blank (more than one colour after 120 frames)
        const colours = await js<number>(`(() => { const c = document.querySelector('[data-testid="play-canvas"]'); if (!c) return 0; const d = c.getContext('2d').getImageData(0, 0, 256, 240).data; const set = new Set(); for (let i = 0; i < d.length; i += 4) set.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]); return set.size; })()`);
        if (colours < 2) problems.push(`play canvas blank (${colours} colour)`);
      }
      const overflow = await js<boolean>(`document.documentElement.scrollWidth > window.innerWidth + 1`);
      if (overflow) problems.push('horizontal overflow');
      for (const p of await js<string[]>(TEXT_CHECK)) problems.push(p);
      if (route.startsWith('director/')) {
        const offline = await js<string>(`document.querySelector('[data-testid="offline-banner"]')?.textContent ?? ''`);
        const want = opts.locale === 'fr' ? 'mode hors ligne' : 'offline mode';
        if (!offline.toLowerCase().includes(want)) problems.push(`offline banner text: "${offline}"`);
      }
      if (route === 'director/visual') {
        // the hidden window can hand back its previous paint: force a fresh frame before the capture
        win.webContents.invalidate();
        await settle();
      }
      const png = path.join(path.dirname(opts.out), `${opts.locale}-${pngSlug(route)}.png`);
      writeFileSync(png, (await win.webContents.capturePage()).toPNG());
      if (route === 'director/visual') {
        // extra captures: a landscape as a full NES screen, and the single-tile pixel editor
        const shot = async (suffix: string) => {
          win.webContents.invalidate();
          await settle();
          writeFileSync(path.join(path.dirname(opts.out), `${opts.locale}-${slug}-${suffix}.png`), (await win.webContents.capturePage()).toPNG());
        };
        await js(`document.querySelector('[data-testid="chroma-example"]').click(), true`);
        const landscape = await js<boolean>(`new Promise((resolve) => { const t0 = Date.now(); const tick = () => { const a = document.querySelector('[data-testid="chroma-after"]'); if (a && a.complete && a.naturalWidth === 256) resolve(true); else if (Date.now() - t0 > 15000) resolve(false); else setTimeout(tick, 50); }; tick(); })`);
        if (!landscape) problems.push('landscape example not converted to a 256-wide screen');
        await shot('landscape');
        await js(`[...document.querySelectorAll('.lib-item')].find((b) => /Blum/.test(b.textContent))?.click(), true`);
        if (await waitFor('lib-sheet-0', 5000)) {
          await js(`(() => { const c = document.querySelector('[data-testid="lib-sheet-0"]'); c.scrollIntoView(); const r = c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 3, clientY: r.top + 3 })); return true; })()`);
          if (!(await waitFor('tile-editor', 3000))) problems.push('missing data-testid=tile-editor');
          else await js(`document.querySelector('[data-testid="tile-editor"]').scrollIntoView(), true`);
        } else problems.push('missing data-testid=lib-sheet-0');
        await shot('editor');
      }
      routes.push({ route, ok: problems.length === 0, png, problems });
    }

    // M5-T6: in the packaged build DevTools cannot be opened (webPreferences.devTools is false)
    let devToolsOk = true;
    if (app.isPackaged) {
      win.webContents.openDevTools({ mode: 'detach' });
      await new Promise((r) => setTimeout(r, 800));
      result.devTools = win.webContents.isDevToolsOpened() ? 'opened' : 'blocked';
      devToolsOk = result.devTools === 'blocked';
      if (!devToolsOk) win.webContents.closeDevTools();
    }

    // M1-T8 (smoke part): the renderer API exposes no key getter and no key material.
    const keyApi = await js<string[]>(`Object.keys(window.blum.key).sort()`);
    const apiText = await js<string>(`JSON.stringify(Object.keys(window.blum).map((k) => [k, Object.keys(window.blum[k])]))`);
    const keyApiOk = JSON.stringify(keyApi) === JSON.stringify(['clear', 'save', 'status', 'test']) && !/sk-ant/.test(apiText);
    result.keyApi = { ok: keyApiOk, keys: keyApi, api: JSON.parse(apiText) };

    const ok =
      result.title === APP_TITLE &&
      routes.every((r) => r.ok) &&
      flowOk !== false &&
      keyApiOk &&
      devToolsOk &&
      consoleErrors.length === 0;
    Object.assign(result, { ok, routes, consoleErrors });
    writeFileSync(opts.out, JSON.stringify(result, null, 2));
    clearTimeout(timer);
    return ok ? 0 : 1;
  } catch (err) {
    writeFileSync(opts.out, JSON.stringify({ ...result, ok: false, error: String(err), consoleErrors }));
    clearTimeout(timer);
    return 1;
  }
}
