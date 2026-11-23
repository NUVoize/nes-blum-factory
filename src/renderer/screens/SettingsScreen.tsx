import { Fragment, useEffect, useState } from 'react';
import type { UsageView } from '../../shared/api';
import { useApp } from '../app-context';
import { play } from '../sounds';
import { Button, DIRECTOR_NAMES, Frame, SliderPixel, Toggle } from '../ui';

function usd(v: number, locale: 'fr' | 'en'): string {
  const s = v.toFixed(2);
  return locale === 'fr' ? `${s.replace('.', ',')} $` : `$${s}`;
}

export function SettingsScreen() {
  const { t, pick, locale, settings, updateSettings, keyStatus, refreshKey, toast, project } = useApp();
  const [key, setKey] = useState('');
  const [usage, setUsage] = useState<UsageView | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void window.blum.usage.totals().then(setUsage);
  }, []);

  if (!settings) return <main className="screen" data-testid="screen-settings" />;

  const saveKey = async () => {
    const r = await window.blum.key.save(key);
    // a refused key stays in the field so Blum can fix it (W1 P2-8)
    if (r.ok) setKey('');
    await refreshKey();
    if (r.ok) (play('success'), toast(t('settings.keySaved'), 'success'));
    else (play('error'), toast(pick(r), 'danger'));
  };
  const testKey = async () => {
    setTesting(true);
    const r = await window.blum.key.test();
    setTesting(false);
    toast(r.ok ? t('settings.keyOk', { model: r.value.model }) : pick(r), r.ok ? 'success' : 'danger');
  };

  return (
    <main className="screen" data-testid="screen-settings" style={{ gridTemplateRows: 'auto 1fr' }}>
      <div className="topbar">
        <Button icon="back" onClick={() => history.back()} sound="back">
          {t('nav.back')}
        </Button>
        <h1 className="grow shadow gold">{t('nav.settings')}</h1>
        {project ? <span className="dim">{project.manifest.title}</span> : null}
      </div>
      <div className="cols scroll">
        <Frame title={t('settings.ai')}>
          <div className="stack">
            <p data-testid="key-status">
              {keyStatus?.hasKey ? t('settings.keyPresent', { masked: keyStatus.masked ?? '' }) : t('settings.keyAbsent')}
            </p>
            {keyStatus?.problem ? <p className="gold">{pick(keyStatus.problem)}</p> : null}
            {keyStatus && !keyStatus.encryptionAvailable ? <p className="gold">{t('settings.noEncryption')}</p> : null}
            <input
              className="field"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              placeholder={t('settings.keyPlaceholder')}
              onChange={(e) => setKey(e.target.value)}
              data-testid="key-input"
            />
            <div className="row">
              <Button variant="primary" onClick={() => void saveKey()} disabled={!key.trim()}>
                {t('settings.keySave')}
              </Button>
              <Button onClick={() => void testKey()} disabled={!keyStatus?.hasKey || testing}>
                {testing ? t('dir.thinking') : t('settings.keyTest')}
              </Button>
              <Button variant="danger" onClick={() => void window.blum.key.clear().then(refreshKey)} disabled={!keyStatus?.hasKey} sound="back">
                {t('settings.keyClear')}
              </Button>
            </div>
            <p className="muted">{t('settings.keyHelp')}</p>
          </div>
        </Frame>

        <Frame title={t('settings.models')}>
          <div className="stack">
            {(['directors', 'quality', 'chores'] as const).map((k) => (
              <label key={k} className="stack">
                <span className="label" style={{ fontSize: 8 }}>
                  {t(`settings.model.${k}`)}
                </span>
                <input
                  className="field digits"
                  value={settings.models[k]}
                  onChange={(e) => void updateSettings({ models: { ...settings.models, [k]: e.target.value } })}
                />
              </label>
            ))}
            <Toggle on={settings.qualityMax} onChange={(v) => void updateSettings({ qualityMax: v })} label={t('settings.qualityMax')} />
          </div>
        </Frame>

        <Frame title={t('settings.costs')}>
          <div className="stack">
            <dl className="kv">
              <dt>{t('settings.monthTotal')}</dt>
              <dd className="gold">{usage ? usd(usage.thisMonthUsd, locale) : ''}</dd>
              <dt>{t('settings.allTotal')}</dt>
              <dd>{usage ? usd(usage.costUsd, locale) : ''}</dd>
              <dt>{t('settings.calls')}</dt>
              <dd>{usage?.calls ?? 0}</dd>
              <dt>{t('settings.pricesDate')}</dt>
              <dd>{usage?.pricesCheckedAt ?? ''}</dd>
            </dl>
            <span className="label" style={{ fontSize: 8 }}>
              {t('settings.usageBy')}
            </span>
            {usage && Object.keys(usage.byDirector).length ? (
              <div className="usage-table" data-testid="usage-by-director">
                {Object.entries(usage.byDirector).map(([id, cost]) => (
                  <Fragment key={id}>
                    <span style={{ color: `var(--c-dir-${id})` }} className="label">
                      {DIRECTOR_NAMES[id] ?? id}
                    </span>
                    <span />
                    <span className="digits">{usd(cost, locale)}</span>
                  </Fragment>
                ))}
              </div>
            ) : (
              <p className="muted" data-testid="usage-by-director">
                {t('settings.usageNone')}
              </p>
            )}
            <p className="muted">{t('settings.estimate')}</p>
            <SliderPixel
              label={t('settings.cap')}
              value={settings.monthlyCapUsd ?? 0}
              min={0}
              max={100}
              step={5}
              format={(v) => (v === 0 ? t('settings.capNone') : usd(v, locale))}
              onChange={(v) => void updateSettings({ monthlyCapUsd: v === 0 ? null : v })}
            />
          </div>
        </Frame>

        <Frame title={t('settings.display')}>
          <div className="stack">
            <div className="row">
              <span className="label" style={{ fontSize: 8 }}>
                {t('title.language')}
              </span>
              {(['fr', 'en'] as const).map((l) => (
                <Button key={l} variant={settings.locale === l ? 'primary' : 'normal'} onClick={() => void updateSettings({ locale: l })}>
                  {t(l === 'fr' ? 'lang.fr' : 'lang.en')}
                </Button>
              ))}
            </div>
            <div className="row">
              <span className="label" style={{ fontSize: 8 }}>
                {t('settings.scale')}
              </span>
              {([1, 2, 3] as const).map((s) => (
                <Button key={s} variant={settings.uiScale === s ? 'primary' : 'normal'} onClick={() => void updateSettings({ uiScale: s })}>
                  {t('settings.scaleValue', { n: s })}
                </Button>
              ))}
            </div>
            <SliderPixel label={t('settings.volume')} value={settings.volume} min={0} max={100} step={5} format={(v) => `${v} %`} onChange={(v) => void updateSettings({ volume: v })} />
            <Toggle on={settings.muted} onChange={(v) => void updateSettings({ muted: v })} label={t('settings.mute')} />
            <dl className="kv">
              <dt>{t('settings.folder')}</dt>
              <dd>{settings.projectsDir}</dd>
            </dl>
          </div>
        </Frame>
      </div>
    </main>
  );
}
