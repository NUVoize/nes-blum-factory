import { useEffect, useState } from 'react';
import type { BuildReport } from '../../core/build/report';
import type { DirectorId } from '../../core/project/proposal';
import type { ExportView } from '../../shared/api';
import type { MessageKey } from '../../shared/i18n';
import { go, useApp } from '../app-context';
import { play } from '../sounds';
import { Button, DialogBox, DIRECTOR_NAMES, Frame, Portrait } from '../ui';

// « Ta première cartouche » (MILESTONES M6): five steps, one per director, offline end to end (M6-T5).
// Every change is a normal proposal approved through the same IPC as the panels: history and undo work.
const STEPS: DirectorId[] = ['story', 'visual', 'movement', 'level', 'build'];
const STORY_CHOICES = ['jardin', 'usine', 'ciel'] as const;
const PRESETS = ['leger', 'lourd', 'flottant'] as const;

export function FirstScreen() {
  const { t, pick, project, setProject, toast } = useApp();
  const [step, setStep] = useState(0);
  const [done, setDone] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<BuildReport | null>(null);
  const [exported, setExported] = useState<ExportView | null>(null);
  const [hero, setHero] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    void window.blum.chroma.asset('graphics/heros-blum.png').then((b) => {
      if (!b) return;
      url = URL.createObjectURL(new Blob([new Uint8Array(b)], { type: 'image/png' }));
      setHero(url);
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [project?.dir]);

  if (!project) {
    return (
      <main className="screen" data-testid="screen-first">
        <Frame title={t('hub.noProject')}>
          <Button onClick={() => go('cartridges')}>{t('cart.title')}</Button>
        </Frame>
      </main>
    );
  }

  const director = STEPS[step]!;

  /** Offline template or preset -> proposal -> approved at once (the step's button is the approval). */
  const choose = async (dir: DirectorId, choice: string) => {
    setBusy(true);
    const p = await window.blum.directors.offline(dir, choice);
    if (!p.ok) {
      setBusy(false);
      play('error');
      toast(pick(p), 'danger');
      return;
    }
    const a = await window.blum.directors.approve(p.value.id);
    setBusy(false);
    if (!a.ok) {
      play('error');
      toast(pick(a), 'danger');
      return;
    }
    play('success');
    setProject(a.value);
    setDone((d) => ({ ...d, [step]: pick(p.value.summary) }));
  };

  const build = async () => {
    setBusy(true);
    setReport(null);
    const r = await window.blum.build.run();
    setBusy(false);
    if (!r.ok) {
      play('error');
      toast(pick(r), 'danger');
      return;
    }
    setReport(r.value);
    play(r.value.ok ? 'success' : 'error');
    if (r.value.ok) setDone((d) => ({ ...d, [step]: t('first.green', { bytes: r.value.rom?.bytes ?? 0 }) }));
  };

  const doExport = async () => {
    setBusy(true);
    const r = await window.blum.build.exportAll();
    setBusy(false);
    if (!r.ok) {
      play('error');
      toast(pick(r), 'danger');
      return;
    }
    setExported(r.value);
    toast(t('first.exported', { dir: r.value.dir }), 'success');
  };

  const canNext = step === 1 || step === 3 || done[step] !== undefined;
  const say = `first.s${step + 1}.say` as MessageKey;

  return (
    <main className="screen" data-testid="screen-first" style={{ gridTemplateRows: 'auto auto 1fr' }}>
      <div className="topbar">
        <Button icon="back" onClick={() => go('hub')} sound="back">
          {t('nav.hub')}
        </Button>
        <h1 className="grow shadow gold">{t('first.title')}</h1>
        <span className="dim" data-testid="first-step">
          {t('first.step', { n: step + 1 })}
        </span>
      </div>
      <nav className="first-steps" aria-label={t('first.title')}>
        {STEPS.map((id, i) => (
          <div key={id} className={`first-step ${i === step ? 'on' : ''} ${done[i] !== undefined || (i < step && (i === 1 || i === 3)) ? 'done' : ''}`}>
            <Portrait director={id} small />
            <span className="label" style={{ color: `var(--c-dir-${id})` }}>
              {DIRECTOR_NAMES[id]}
            </span>
          </div>
        ))}
      </nav>
      <Frame title={DIRECTOR_NAMES[director]} className="scroll" testid={`first-panel-${director}`}>
        <div className="first-body">
          <DialogBox director={director} text={t(say)} testid="first-dialog" />
          {step === 0 ? (
            <div className="stack">
              <span className="label">{t('first.s1.pick')}</span>
              <div className="choice-row">
                {STORY_CHOICES.map((c) => (
                  <Button key={c} onClick={() => void choose('story', c)} disabled={busy || done[0] !== undefined} testid={`first-story-${c}`}>
                    {t(`offline.${c}` as MessageKey)}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          {step === 1 ? (
            <div className="row">
              {hero ? <img className="hero-preview" src={hero} alt={t('first.s2.hero')} data-testid="first-hero" /> : null}
              <span className="label">{t('first.s2.hero')}</span>
            </div>
          ) : null}
          {step === 2 ? (
            <div className="stack">
              <span className="label">{t('first.s3.pick')}</span>
              <div className="choice-row">
                {PRESETS.map((c) => (
                  <Button key={c} onClick={() => void choose('movement', c)} disabled={busy || done[2] !== undefined} testid={`first-preset-${c}`}>
                    {t(`offline.${c}` as MessageKey)}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          {step === 3 ? (
            <p className="gold" data-testid="first-stages">
              {t('first.s4.stages', { n: project.stages })}
            </p>
          ) : null}
          {step === 4 ? (
            <div className="stack">
              <div className="row">
                <Button variant="primary" icon="build" onClick={() => void build()} disabled={busy} testid="first-build">
                  {busy && !report ? t('first.building') : t('first.build')}
                </Button>
                {report?.ok ? (
                  <>
                    <Button icon="play" onClick={() => go('play?rom=project')} testid="first-play">
                      {t('first.play')}
                    </Button>
                    <Button icon="export" onClick={() => void doExport()} disabled={busy} testid="first-export" sound="coin">
                      {t('first.export')}
                    </Button>
                  </>
                ) : null}
              </div>
              {report ? (
                <p className={report.ok ? 'ok-line' : 'err-line'} data-testid={report.ok ? 'first-green' : 'first-red'}>
                  {report.ok ? t('first.green', { bytes: report.rom?.bytes ?? 0 }) : t('first.red')}
                </p>
              ) : null}
              {exported ? (
                <ul className="stack" data-testid="first-exported">
                  {exported.files.map((f) => (
                    <li key={f.name} className="digits">
                      {f.name}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {done[step] !== undefined && step !== 4 ? (
            <p className="ok-line" data-testid="first-approved">
              {t('first.approved', { what: done[step]! })}
            </p>
          ) : null}
          <div className="row">
            {step < 4 ? (
              <Button variant="primary" onClick={() => setStep(step + 1)} disabled={!canNext || busy} testid="first-next">
                {t('first.next')}
              </Button>
            ) : (
              <Button onClick={() => go('hub')} testid="first-finish" sound="back">
                {t('first.finish')}
              </Button>
            )}
          </div>
          <p className="muted">{t('first.offline')}</p>
        </div>
      </Frame>
    </main>
  );
}
