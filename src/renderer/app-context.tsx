import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AppInfo, KeyStatusView, ProjectView, Settings } from '../shared/api';
import { DEFAULT_LOCALE, t as translate, type Locale, type MessageKey } from '../shared/i18n';
import { configureSound } from './sounds';

export interface ToastMsg {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'danger' | 'bloom';
}

interface Ctx {
  locale: Locale;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  /** Pick the text for the current locale from a {fr, en} pair coming from main. */
  pick: (m: { fr: string; en?: string }) => string;
  settings: Settings | null;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  info: AppInfo | null;
  keyStatus: KeyStatusView | null;
  refreshKey: () => Promise<void>;
  project: ProjectView | null;
  setProject: (p: ProjectView | null) => void;
  refreshProject: () => Promise<void>;
  toasts: ToastMsg[];
  toast: (text: string, kind?: ToastMsg['kind']) => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('AppProvider missing');
  return c;
}

let toastId = 0;

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [keyStatus, setKeyStatus] = useState<KeyStatusView | null>(null);
  const [project, setProject] = useState<ProjectView | null>(null);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const locale: Locale = settings?.locale ?? DEFAULT_LOCALE;

  const refreshProject = useCallback(async () => setProject(await window.blum.projects.current()), []);
  const refreshKey = useCallback(async () => setKeyStatus(await window.blum.key.status()), []);

  useEffect(() => {
    void (async () => {
      const [s, i] = await Promise.all([window.blum.settings.get(), window.blum.app.info()]);
      if (i.smoke) document.documentElement.classList.add('smoke');
      setSettings(s);
      setInfo(i);
      await refreshKey();
      await refreshProject();
    })();
    const onChanged = () => void refreshProject();
    window.addEventListener('blum:project-changed', onChanged);
    return () => window.removeEventListener('blum:project-changed', onChanged);
  }, [refreshKey, refreshProject]);

  useEffect(() => {
    document.documentElement.lang = locale;
    if (settings) {
      document.documentElement.style.setProperty('--px', String(settings.uiScale));
      configureSound(settings.volume, settings.muted);
    }
  }, [locale, settings]);

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    const r = await window.blum.settings.set(patch);
    if (r.ok) setSettings(r.value);
  }, []);

  const toast = useCallback((text: string, kind: ToastMsg['kind'] = 'info') => {
    const id = ++toastId;
    setToasts((ts) => [...ts.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 4000);
  }, []);

  const value: Ctx = {
    locale,
    t: (key, vars) => translate(locale, key, vars),
    pick: (m) => (locale === 'en' ? (m.en ?? m.fr) : m.fr),
    settings,
    updateSettings,
    info,
    keyStatus,
    refreshKey,
    project,
    setProject,
    refreshProject,
    toasts,
    toast,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

// ---------- hash router ----------

export function useRoute(): string {
  const read = () => (location.hash.replace(/^#\/?/, '') || 'title').split('?')[0]!;
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

/** The full hash (route + query), for screens that read their query. */
export function useHash(): string {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function go(route: string): void {
  location.hash = `#/${route}`;
}
