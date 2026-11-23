import { useCallback, useEffect, useState } from 'react';
import type { HistoryItem } from '../../core/project/proposal';
import { go, useApp } from '../app-context';
import { play } from '../sounds';
import { Button, DIRECTOR_NAMES, Frame, Portrait, PORTRAITS } from '../ui';

export function HistoryScreen() {
  const { t, pick, locale, project, setProject, toast } = useApp();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const reload = useCallback(async () => setItems(await window.blum.history.list()), []);
  useEffect(() => {
    void reload();
  }, [reload, project]);

  const act = async (undo: boolean) => {
    const r = undo ? await window.blum.history.undo() : await window.blum.history.redo();
    if (r.ok) {
      play(undo ? 'back' : 'select');
      setProject(r.value);
      toast(undo ? t('history.undone') : t('history.redone'), 'info');
    } else toast(pick(r), 'danger');
    await reload();
  };

  const time = (iso: string) => new Date(iso).toLocaleString(locale === 'fr' ? 'fr-CA' : 'en-CA', { dateStyle: 'short', timeStyle: 'short' });

  return (
    <main className="screen" data-testid="screen-history" style={{ gridTemplateRows: 'auto 1fr' }}>
      <div className="topbar">
        <Button icon="back" onClick={() => go('hub')} sound="back">
          {t('nav.hub')}
        </Button>
        <h1 className="grow shadow gold">{t('nav.history')}</h1>
        <span className="dim digits" data-testid="history-count">
          {t('history.count', { n: items.filter((i) => i.state === 'applied').length })}
        </span>
        <Button icon="undo" onClick={() => void act(true)} disabled={!project?.canUndo} testid="undo">
          {t('history.undo')}
        </Button>
        <Button icon="redo" onClick={() => void act(false)} disabled={!project?.canRedo} testid="redo">
          {t('history.redo')}
        </Button>
      </div>
      <Frame title={t('history.list')} className="scroll" testid="history-list">
        {items.length === 0 ? <p className="muted">{t('history.empty')}</p> : null}
        {items.map((it) => (
          <div key={it.id} className={`history-row ${it.state}`}>
            {PORTRAITS[it.director] ? <Portrait director={it.director} small /> : <span />}
            <span className="muted">{time(it.ts)}</span>
            <span style={{ color: `var(--c-dir-${it.director})`, fontFamily: 'var(--font-display)', fontSize: 8 }}>
              {DIRECTOR_NAMES[it.director] ?? t('history.manual')}
            </span>
            <span>{pick(it.summary)}</span>
            <span className={`badge ${it.state === 'applied' ? 'success' : 'muted'}`}>{it.state === 'applied' ? t('history.applied') : t('history.undoneBadge')}</span>
          </div>
        ))}
      </Frame>
    </main>
  );
}
