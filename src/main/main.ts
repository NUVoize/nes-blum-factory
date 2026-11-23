import { app, BrowserWindow, dialog, ipcMain, safeStorage, session as electronSession } from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { APP_TITLE, SMOKE_FLAG } from '../shared/app-info.js';
import type { Channel, DirectorEvent } from '../shared/api.js';
import { redactForLog } from '../core/llm/redact.js';
import { BuildRunner } from './build-runner.js';
import { ConvertRunner } from './convert-runner.js';
import { KeyVault } from './key-vault.js';
import { ProcessManager } from './process-manager.js';
import { Session } from './session.js';
import { defaultSettings, SettingsStore } from './settings.js';
import { runSmoke, type SmokeOptions } from './smoke.js';

// Headless smoke mode (TEST-STRATEGY §4):
//   electron . --smoke=<result.json> [--smoke-home=<dir>] [--smoke-route=a,b] [--smoke-locale=fr|en] [--smoke-flow]
const argValue = (flag: string) => {
  const a = process.argv.find((x) => x.startsWith(flag));
  return a ? a.slice(flag.length) : null;
};
// The packaged app only accepts --smoke from the package test (M5-T5), never from a stray shortcut.
const smokeOutArg = app.isPackaged && process.env.NBF_PACKAGE_SMOKE !== '1' ? null : argValue(SMOKE_FLAG);
const smoke: SmokeOptions | null = smokeOutArg
  ? {
      out: path.resolve(smokeOutArg),
      routes: (argValue('--smoke-route=') ?? 'title').split(',').filter(Boolean),
      locale: argValue('--smoke-locale=') === 'en' ? 'en' : 'fr',
      flow: process.argv.includes('--smoke-flow'),
    }
  : null;

if (smoke) {
  app.disableHardwareAcceleration();
  // Tests never write in Documents or %APPDATA% (TEST-STRATEGY §2).
  const home = path.resolve(argValue('--smoke-home=') ?? path.join(path.dirname(smoke.out), 'home'));
  mkdirSync(home, { recursive: true });
  app.setPath('userData', path.join(home, 'userdata'));
}

const processes = new ProcessManager();
const converter = new ConvertRunner();
const builder = new BuildRunner();
let mainWindow: BrowserWindow | null = null;

function log(line: string): void {
  // Every log line goes through redaction (PLAN ADR-4).
  console.log(`[blum] ${redactForLog(line)}`);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: APP_TITLE,
    backgroundColor: '#080818',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: !app.isPackaged,
      // the hidden smoke window must keep its timers (emulator frames) at full speed
      backgroundThrottling: smoke === null,
    },
  });
  // No navigation away from the bundled UI, no popups.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  void win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
  return win;
}

/** cc65 cannot read paths with a space or a non-ASCII letter (PLAN §7.1 step 3). */
const plainPath = (p: string) => ![...p].some((ch) => ch.charCodeAt(0) > 127 || /\s/.test(ch));

/** Smoke builds stay inside the smoke home, unless its path has a space or an accent (packaged smoke, M5-T5). */
function smokeBuildRoot(userData: string): string | null {
  if (!smoke) return null;
  const p = path.join(path.dirname(userData), 'builds');
  return plainPath(p) ? p : path.join(buildRoot(), '..', 'smoke-builds');
}

/**
 * Build folder without spaces or accents: %LOCALAPPDATA% when its path is plain ASCII, else the Public
 * profile (a Windows user name like « Blum Québec » breaks cc65).
 */
function buildRoot(): string {
  const local = path.resolve(process.env.LOCALAPPDATA ?? path.join(app.getPath('appData'), '..', 'Local'), 'NESBlumFactory', 'builds');
  if (plainPath(local)) return local;
  return path.join(process.env.PUBLIC ?? String.raw`C:\Users\Public`, 'NESBlumFactory', 'builds');
}

/**
 * Bundled read-only resources (PLAN §8): next to the exe in the package (extraResources), in the repo
 * during development.
 */
function resource(...parts: string[]): string {
  return app.isPackaged ? path.join(process.resourcesPath, ...parts) : path.join(app.getAppPath(), ...parts);
}

function createSession(): Session {
  const userData = app.getPath('userData');
  const projectsDir = smoke
    ? path.join(path.dirname(userData), 'projects')
    : path.join(app.getPath('documents'), 'NES BLUM FACTORY');
  const defaults = defaultSettings(projectsDir);
  if (smoke) defaults.locale = smoke.locale;
  const settings = new SettingsStore(path.join(userData, 'settings.json'), defaults);
  if (smoke) settings.set({ locale: smoke.locale, projectsDir });
  const vault = new KeyVault(path.join(userData, 'key.bin'), safeStorage);
  return new Session({
    userData,
    bundledPrices: path.join(app.getAppPath(), 'config', 'prices.json'),
    settings,
    vault,
    version: app.getVersion(),
    electron: process.versions.electron,
    smoke: smoke !== null,
    forceOffline: smoke !== null,
    emit: (e: DirectorEvent) => mainWindow?.webContents.send('directors:event', e),
    log,
    chooseSavePath: async (name) => {
      if (!mainWindow) return null;
      const r = await dialog.showSaveDialog(mainWindow, { defaultPath: name, filters: [{ name: 'Zip', extensions: ['zip'] }] });
      return r.canceled ? null : (r.filePath ?? null);
    },
    rom: {
      engineDir: resource('engine'),
      toolchainDir: app.isPackaged ? resource('toolchain', 'cc65') : resource('resources', 'toolchain', 'cc65'),
      buildRoot: smokeBuildRoot(userData) ?? buildRoot(),
    },
    convert: (job) => converter.run(job),
    build: (input) => builder.run(input),
    licensesDir: app.isPackaged ? resource('licenses') : resource('resources', 'licenses'),
    samplesDir: app.isPackaged ? resource('samples') : resource('resources', 'samples'),
    chooseExportDir: async (name) => {
      if (smoke) return path.join(path.dirname(userData), 'exports', name);
      if (!mainWindow) return null;
      const r = await dialog.showOpenDialog(mainWindow, { title: name, properties: ['openDirectory', 'createDirectory'] });
      return r.canceled || !r.filePaths[0] ? null : path.join(r.filePaths[0], name);
    },
    chooseOpenPath: async () => {
      if (!mainWindow) return null;
      const r = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Zip', extensions: ['zip'] }] });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
  });
}

function registerIpc(s: Session): void {
  const handlers: Record<Channel, (...args: unknown[]) => unknown> = {
    'app:info': () => s.info(),
    'settings:get': () => s.getSettings(),
    'settings:set': (p) => s.setSettings(p),
    'key:status': () => s.keyStatus(),
    'key:save': (k) => s.keySave(k),
    'key:clear': () => s.keyClear(),
    'key:test': () => s.keyTest(),
    'projects:list': () => s.listProjects(),
    'projects:create': (t) => s.createProject(t),
    'projects:open': (d) => s.openProject(d),
    'projects:current': () => s.current(),
    'projects:close': () => s.closeProject(),
    'projects:export': () => s.exportZip(),
    'projects:import': () => s.importZip(),
    'projects:sample': () => s.openSample(),
    'directors:send': (d, t) => s.send(d, t),
    'directors:cancel': (d) => s.cancel(d),
    'directors:chat': (d) => s.chat(d),
    'directors:proposals': (d) => s.proposals(d),
    'directors:approve': (id) => s.approve(id),
    'directors:reject': (id) => s.reject(id),
    'directors:offline': (d, c) => s.offline(d, c),
    'directors:manual': (d, t, i) => s.manual(d, t, i),
    'history:list': () => s.history(),
    'history:undo': () => s.undo(),
    'history:redo': () => s.redo(),
    'usage:totals': () => s.usage(),
    'rom:build': (src) => s.buildRom(src),
    'rom:batteryLoad': (src) => s.batteryLoad(src),
    'rom:batterySave': (src, bytes) => s.batterySave(src, bytes),
    'build:run': () => s.buildRun(),
    'build:last': () => s.buildLast(),
    'build:fix': (again) => s.buildFix(again),
    'build:export': () => s.buildExport(),
    'chroma:drop': (png, name) => s.chromaDrop(png, name),
    'chroma:sources': () => s.chromaSources(),
    'chroma:preview': (req) => s.chromaPreview(req),
    'chroma:propose': (req) => s.chromaPropose(req),
    'chroma:editTile': (req) => s.chromaEditTile(req),
    'chroma:asset': (p) => s.chromaAsset(p),
  };
  for (const [channel, fn] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (event, ...args) => {
      // Only our own window may call in.
      if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('refused');
      try {
        return await fn(...args);
      } catch (e) {
        log(`${channel} ${redactForLog(e)}`);
        throw new Error('internal error');
      }
    });
  }
}

let appSession: Session | null = null;

void app.whenReady().then(() => {
  // Deny every permission request (camera, notifications…): the app needs none.
  electronSession.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  appSession = createSession();
  registerIpc(appSession);
  mainWindow = createWindow();
  if (smoke) {
    void runSmoke(mainWindow, smoke, appSession).then(async (code) => {
      appSession?.closeProject();
      processes.killAll();
      await converter.close();
      await builder.close();
      app.exit(code);
    });
  } else {
    mainWindow.once('ready-to-show', () => mainWindow?.show());
  }
});

app.on('before-quit', () => {
  appSession?.closeProject();
  processes.killAll();
  void converter.close();
  void builder.close();
});
app.on('window-all-closed', () => app.quit());

