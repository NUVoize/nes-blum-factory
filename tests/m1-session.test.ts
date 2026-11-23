import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DirectorEvent } from '../src/shared/api';
import { KeyVault, type Cipher } from '../src/main/key-vault';
import { safeFolderName, Session } from '../src/main/session';
import { defaultSettings, SettingsStore } from '../src/main/settings';
import { tempDir } from './helpers';

const plainCipher: Cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from([...Buffer.from(s)].map((b) => b ^ 0x5a)),
  decryptString: (b) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString(),
};

function makeSession() {
  const home = tempDir();
  const userData = path.join(home, 'userdata');
  const events: DirectorEvent[] = [];
  const s = new Session({
    userData,
    bundledPrices: path.resolve(import.meta.dirname, '..', 'config', 'prices.json'),
    settings: new SettingsStore(path.join(userData, 'settings.json'), defaultSettings(path.join(home, 'projects'))),
    vault: new KeyVault(path.join(userData, 'key.bin'), plainCipher),
    version: '0.1.0',
    electron: 'test',
    smoke: true,
    forceOffline: true,
    emit: (e) => events.push(e),
    log: () => {},
    chooseSavePath: async () => path.join(home, 'export.zip'),
    chooseOpenPath: async () => path.join(home, 'export.zip'),
  });
  return { s, events, home };
}

describe('M1 main session (window.blum backend, no Electron)', () => {
  it('M1-T1 new project -> director offline flow -> approve -> undo, all through the IPC handlers', async () => {
    const { s, events } = makeSession();
    expect(s.listProjects()).toEqual([]);
    const created = s.createProject('Mon jeu: 1/2');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(path.basename(created.value.dir)).toBe('Mon jeu 12.blum');
    expect(s.listProjects()).toHaveLength(1);

    const sent = await s.send('story', 'Bonjour');
    expect(sent.ok && sent.value.text).toMatch(/^Mode hors ligne/);
    expect(events.at(-1)).toEqual({ director: 'story', type: 'done' });
    expect(s.chat('story').map((c) => c.role)).toEqual(['user', 'assistant']);

    const p = s.offline('story', 'ciel');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const approved = s.approve(p.value.id);
    expect(approved.ok && approved.value.storyTitle).toBe('NUAGE PERDU');
    expect(approved.ok && approved.value.canUndo).toBe(true);
    const undone = s.undo();
    expect(undone.ok && undone.value.storyTitle).toBe('MON JEU: 1/2');
    expect(s.history().map((h) => h.state)).toEqual(['undone']);

    const exported = await s.exportZip();
    expect(exported.ok).toBe(true);
    s.closeProject();
    const imported = await s.importZip();
    expect(imported.ok && imported.value.storyTitle).toBe('MON JEU: 1/2');
    s.closeProject();
  });

  it('M1-T8 payloads from the renderer are validated; key status never carries the key', () => {
    const { s } = makeSession();
    expect(s.createProject('').ok).toBe(false);
    expect(s.createProject({ evil: true }).ok).toBe(false);
    expect(s.offline('story', 'pas-un-modele').ok).toBe(false);
    expect(() => s.chat('hacker')).toThrow();
    const saved = s.keySave('sk-ant-api03-abcdefghijklmnopqrstuvwxyz-1234');
    expect(saved.ok && saved.value.masked).toBe('sk-ant-…1234');
    expect(JSON.stringify(s.keyStatus())).not.toContain('abcdefghijklmnop');
    expect(s.info().provider).toBe('offline');
    expect(s.setSettings({ uiScale: 7 }).ok).toBe(false);
    expect(s.setSettings({ uiScale: 3 }).ok).toBe(true);
    expect(safeFolderName('  <>:"/\\|?*  ')).toBe('Mon jeu');
  });
});
