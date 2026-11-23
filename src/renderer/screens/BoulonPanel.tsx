import { useCallback, useEffect, useRef, useState } from 'react';
import type { Problem } from '../../core/build/errors';
import type { BuildReport } from '../../core/build/report';
import type { Proposal } from '../../core/project/proposal';
import type { Cartridge } from '../../core/schema/project';
import type { ExportView, FixView } from '../../shared/api';
import type { MessageKey } from '../../shared/i18n';
import { useApp } from '../app-context';
import { play } from '../sounds';
import { BudgetMeter, Button, Frame } from '../ui';

// BOULON (PLAN §7): one-click build with a plain report, the fix loop (proposals only, 5 builds max) and
// the export (ROM, split .bin, cartridge sheets).

function ProblemCard({ p }: { p: Problem }) {
  const { t, pick } = useApp();
  return (
    <article className={`problem ${p.severity}`} data-testid="build-problem" data-id={p.id}>
      <div className="row">
        <span className={`badge ${p.severity === 'error' ? 'danger' : ''}`}>{t(p.severity === 'error' ? 'boulon.error' : 'boulon.warning')}</span>
        {!p.known ? <span className="badge muted">{t('boulon.unknown')}</span> : null}
        {p.doc ? <span className="digits dim">{p.doc}</span> : null}
      </div>
      <dl className="kv stacked">
        <dt>{t('boulon.what')}</dt>
        <dd>{pick(p.what)}</dd>
        <dt>{t('boulon.why')}</dt>
        <dd>{pick(p.why)}</dd>
        <dt>{t('boulon.how')}</dt>
        <dd className="gold">{pick(p.fix)}</dd>
      </dl>
      {p.raw && (!p.known || p.step === 'compile') ? (
        <details>
          <summary className="dim">{t('boulon.raw')}</summary>
          <pre className="raw">{p.raw}</pre>
        </details>
      ) : null}
    </article>
  );
}

function Steps({ report, busy }: { report: BuildReport | null; busy: boolean }) {
  const { t } = useApp();
  const ids = ['validate', 'compile', 'rom', 'run'] as const;
  return (
    <ol className="build-steps" data-testid="build-steps">
      {ids.map((id) => {
        const s = report?.steps.find((x) => x.id === id);
        const state = busy ? 'busy' : s?.ok === true ? 'ok' : s?.ok === false ? 'ko' : 'idle';
        return (
          <li key={id} className={`lamp-row ${state}`} data-testid={`build-step-${id}`} data-state={state}>
            <span className="lamp" aria-hidden="true" />
            <span className="grow">{t(`boulon.step.${id}` as MessageKey)}</span>
            {s && s.ok !== null && !busy ? <span className="digits dim">{t('boulon.seconds', { n: (s.ms / 1000).toFixed(1) })}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

export function BoulonPanel({ onProposal }: { onProposal: (p: Proposal) => void }) {
  const { t, pick, locale, project, toast } = useApp();
  const [report, setReport] = useState<BuildReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [fix, setFix] = useState<FixView | null>(null);
  const [exported, setExported] = useState<ExportView | null>(null);
  const waiting = useRef<string[]>([]);

  useEffect(() => {
    void window.blum.build.last().then((r) => r && setReport(r));
  }, []);

  const run = async () => {
    setBusy(true);
    setExported(null);
    const r = await window.blum.build.run();
    setBusy(false);
    if (!r.ok) return (play('error'), toast(pick(r), 'danger'));
    setReport(r.value);
    setFix(null);
    play(r.value.ok ? 'success' : 'error');
  };

  const repair = useCallback(
    async (again: boolean) => {
      setBusy(true);
      const r = await window.blum.build.fix(again);
      setBusy(false);
      if (!r.ok) return (play('error'), toast(pick(r), 'danger'));
      setFix(r.value);
      setReport(r.value.report);
      waiting.current = r.value.proposals.map((p) => p.id);
      for (const p of r.value.proposals) onProposal(p);
      play(r.value.state === 'green' ? 'success' : r.value.state === 'proposed' ? 'select' : 'error');
    },
    [onProposal, pick, toast],
  );

  // Blum approved (or refused) BOULON's repair in the tray: rebuild at once, as the next attempt
  useEffect(() => {
    if (fix?.state !== 'proposed' || waiting.current.length === 0) return;
    let live = true;
    void window.blum.directors.proposals('build').then((ps) => {
      if (!live) return;
      const mine = ps.filter((p) => waiting.current.includes(p.id));
      if (mine.length === 0 || mine.some((p) => p.state === 'pending')) return;
      const approved = mine.some((p) => p.state === 'approved');
      waiting.current = [];
      if (approved) void repair(true);
      else setFix((f) => (f ? { ...f, state: 'no-fix', reason: { fr: 'Réparation refusée.', en: 'Repair refused.' } } : f));
    });
    return () => {
      live = false;
    };
  }, [project, fix, repair]);

  const doExport = async () => {
    setBusy(true);
    const r = await window.blum.build.exportAll();
    setBusy(false);
    if (!r.ok) return toast(pick(r), r.fr.includes('annulée') ? 'info' : 'danger');
    setExported(r.value);
    play('coin');
    toast(t('boulon.exported', { dir: r.value.dir }), 'success');
  };

  const errors = report?.problems.filter((p) => p.severity === 'error') ?? [];
  const warnings = report?.problems.filter((p) => p.severity === 'warning') ?? [];
  const c = project?.docs['cartridge.json'] as Cartridge | undefined;
  const kib = (n: number) => (locale === 'fr' ? `${(n / 1024).toLocaleString('fr-CA', { maximumFractionDigits: 1 })} Ko` : `${(n / 1024).toLocaleString('en-CA', { maximumFractionDigits: 1 })} KiB`);
  const banks = (report?.banks ?? []).filter((b) => b.used > 0);

  return (
    <>
      <Frame title={t('boulon.report')} className="scroll" testid="build-panel">
        <div className="stack">
          <div className="row">
            <Button variant="primary" big onClick={() => void run()} disabled={busy || !project} testid="build-run">
              {busy ? t('boulon.building') : t('boulon.build')}
            </Button>
            {report && !report.ok ? (
              <Button onClick={() => void repair(fix?.state === 'proposed' || fix?.state === 'no-fix')} disabled={busy || fix?.state === 'stopped'} testid="build-fix">
                {t('boulon.fix')}
              </Button>
            ) : null}
            {report?.ok ? (
              <Button onClick={() => void doExport()} disabled={busy} testid="build-export" sound="coin">
                {t('boulon.export')}
              </Button>
            ) : null}
          </div>

          <Steps report={report} busy={busy} />

          {report ? (
            <p className={report.ok ? 'ok-line' : 'err-line'} data-testid={report.ok ? 'build-green' : 'build-red'}>
              {report.ok ? t('boulon.green') : t('boulon.red', { n: errors.length })}
            </p>
          ) : (
            <p className="muted">{t('boulon.never')}</p>
          )}

          {fix ? (
            <div className={`fix-state ${fix.state}`} data-testid="build-fix-state" data-state={fix.state}>
              <span className="badge info">{t('boulon.attempt', { n: fix.attempts, max: fix.max })}</span>{' '}
              {fix.state === 'proposed' ? t('boulon.proposed') : fix.reason ? pick(fix.reason) : fix.state === 'green' ? t('boulon.fixed') : ''}
            </div>
          ) : null}

          {report?.ok && report.rom ? (
            <dl className="kv" data-testid="build-rom">
              <dt>{t('boulon.rom')}</dt>
              <dd className="digits">{kib(report.rom.bytes)}</dd>
              <dt>{t('boulon.crc')}</dt>
              <dd className="digits">{report.rom.crc32}</dd>
              <dt>{t('boulon.header')}</dt>
              <dd className="digits">{report.rom.header}</dd>
              {report.run ? (
                <>
                  <dt>{t('boulon.run')}</dt>
                  <dd>{t('boulon.runValue', { frames: report.run.frames, lag: report.run.lagFrames })}</dd>
                </>
              ) : null}
            </dl>
          ) : null}

          {[...errors, ...warnings].map((p, i) => (
            <ProblemCard key={`${p.id}-${i}`} p={p} />
          ))}

          {exported ? (
            <div className="stack" data-testid="export-files">
              <p className="ok-line">{t('boulon.exported', { dir: exported.dir })}</p>
              <ul className="files">
                {exported.files.map((f) => (
                  <li key={f.name}>
                    <span className="digits">{f.name}</span> <span className="dim">{kib(f.bytes)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </Frame>
      <Frame title={t('hub.budget')} className="scroll" testid="build-budget">
        <div className="stack">
          {c ? (
            <dl className="kv stacked">
              <dt>{t('doc.mapper')}</dt>
              <dd className="digits">{t('doc.mapperValue', { n: c.mapper })}</dd>
              <dt>{t('doc.prg')}</dt>
              <dd className="digits">{t('doc.kib', { n: c.prgRomKiB })}</dd>
              <dt>{t('doc.chr')}</dt>
              <dd className="digits">{t('doc.kib', { n: c.chrRomKiB })}</dd>
              <dt>{t('doc.wram')}</dt>
              <dd className="gold">{t('doc.wramValue', { n: c.prgRamKiB })}</dd>
            </dl>
          ) : null}
          {banks.length ? <h3 className="sub">{t('boulon.banks')}</h3> : null}
          {banks.map((b) => (
            <BudgetMeter key={b.fr} label={pick(b)} used={b.used} max={b.capacity} cells={8} testid="bank-meter" />
          ))}
          {report?.chr.length ? <h3 className="sub">{t('boulon.chr')}</h3> : null}
          {(report?.chr ?? []).map((b, i) => (
            <BudgetMeter key={`${b.name}-${i}`} label={locale === 'fr' ? `${t('boulon.chrBank', { n: b.bank1k })} ${b.name}` : t('boulon.chrBank', { n: b.bank1k })} used={b.used} max={b.capacity} cells={8} />
          ))}
        </div>
      </Frame>
    </>
  );
}
