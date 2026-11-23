import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { BlumApi, Channel, DirectorEvent } from '../shared/api.js';

// The only bridge between the UI and Node. Sandboxed preload: only `electron` may be required here,
// so the channel names are inlined and every type import is erased at compile time.
const call =
  (channel: Channel) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args);

const api: BlumApi = {
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
  app: { info: call('app:info') as BlumApi['app']['info'] },
  settings: {
    get: call('settings:get') as BlumApi['settings']['get'],
    set: call('settings:set') as BlumApi['settings']['set'],
  },
  // No getter for the key itself: status gives hasKey + a masked suffix only (PLAN ADR-4).
  key: {
    status: call('key:status') as BlumApi['key']['status'],
    save: call('key:save') as BlumApi['key']['save'],
    clear: call('key:clear') as BlumApi['key']['clear'],
    test: call('key:test') as BlumApi['key']['test'],
  },
  projects: {
    list: call('projects:list') as BlumApi['projects']['list'],
    create: call('projects:create') as BlumApi['projects']['create'],
    open: call('projects:open') as BlumApi['projects']['open'],
    current: call('projects:current') as BlumApi['projects']['current'],
    close: call('projects:close') as BlumApi['projects']['close'],
    exportZip: call('projects:export') as BlumApi['projects']['exportZip'],
    importZip: call('projects:import') as BlumApi['projects']['importZip'],
    openSample: call('projects:sample') as BlumApi['projects']['openSample'],
  },
  directors: {
    send: call('directors:send') as BlumApi['directors']['send'],
    cancel: call('directors:cancel') as BlumApi['directors']['cancel'],
    chat: call('directors:chat') as BlumApi['directors']['chat'],
    proposals: call('directors:proposals') as BlumApi['directors']['proposals'],
    approve: call('directors:approve') as BlumApi['directors']['approve'],
    reject: call('directors:reject') as BlumApi['directors']['reject'],
    offline: call('directors:offline') as BlumApi['directors']['offline'],
    manual: call('directors:manual') as BlumApi['directors']['manual'],
    onEvent(cb) {
      const listener = (_e: IpcRendererEvent, ev: DirectorEvent) => cb(ev);
      ipcRenderer.on('directors:event', listener);
      return () => ipcRenderer.removeListener('directors:event', listener);
    },
  },
  history: {
    list: call('history:list') as BlumApi['history']['list'],
    undo: call('history:undo') as BlumApi['history']['undo'],
    redo: call('history:redo') as BlumApi['history']['redo'],
  },
  usage: { totals: call('usage:totals') as BlumApi['usage']['totals'] },
  rom: {
    build: call('rom:build') as BlumApi['rom']['build'],
    batteryLoad: call('rom:batteryLoad') as BlumApi['rom']['batteryLoad'],
    batterySave: call('rom:batterySave') as BlumApi['rom']['batterySave'],
  },
  build: {
    run: call('build:run') as BlumApi['build']['run'],
    last: call('build:last') as BlumApi['build']['last'],
    fix: call('build:fix') as BlumApi['build']['fix'],
    exportAll: call('build:export') as BlumApi['build']['exportAll'],
  },
  chroma: {
    drop: call('chroma:drop') as BlumApi['chroma']['drop'],
    sources: call('chroma:sources') as BlumApi['chroma']['sources'],
    preview: call('chroma:preview') as BlumApi['chroma']['preview'],
    propose: call('chroma:propose') as BlumApi['chroma']['propose'],
    editTile: call('chroma:editTile') as BlumApi['chroma']['editTile'],
    asset: call('chroma:asset') as BlumApi['chroma']['asset'],
  },
};

contextBridge.exposeInMainWorld('blum', api);
