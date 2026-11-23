import { useCallback, useEffect, useRef, useState } from 'react';
import { OFFLINE_CHOICES } from '../../core/directors/specs';
import { OFFLINE_REPLIES } from '../../core/llm/offline';
import type { DirectorId, Proposal } from '../../core/project/proposal';
import type { Cartridge } from '../../core/schema/project';
import type { ChatLine } from '../../shared/api';
import type { MessageKey } from '../../shared/i18n';
import { go, useApp } from '../app-context';
import { play } from '../sounds';
import { BudgetMeter, Button, DialogBox, DIRECTOR_NAMES, Frame, ProposalCard } from '../ui';
import { BoulonPanel } from './BoulonPanel';
import { ChromaPanel } from './ChromaPanel';
import { LevelPanel } from './LevelPanel';
import { MovementPanel } from './MovementPanel';
import { StoryPanel } from './StoryPanel';

/** Directors with an editor panel (M4b); the others show their document read-only. */
const EDITOR_DIRECTORS: DirectorId[] = ['story', 'movement', 'level', 'build'];

function formatUsd(v: number, locale: 'fr' | 'en'): string {
  const s = v < 0.01 ? v.toFixed(4) : v.toFixed(2);
  return locale === 'fr' ? `${s.replace('.', ',')} $` : `$${s}`;
}

/** Centre panel for the directors without an editor yet (BOULON: M5): their document, read-only. */
function DocView() {
  const { t, project } = useApp();
  if (!project) return null;
  const c = project.docs['cartridge.json'] as Cartridge;
  return (
    <dl className="kv">
      <dt>{t('doc.mapper')}</dt>
      <dd>{t('doc.mapperValue', { n: c.mapper })}</dd>
      <dt>{t('doc.prg')}</dt>
      <dd>{t('doc.kib', { n: c.prgRomKiB })}</dd>
      <dt>{t('doc.chr')}</dt>
      <dd>{t('doc.kib', { n: c.chrRomKiB })}</dd>
      <dt>{t('doc.wram')}</dt>
      <dd className="gold">{t('doc.wramValue', { n: c.prgRamKiB })}</dd>
    </dl>
  );
}

export function DirectorScreen({ director }: { director: DirectorId }) {
  const { t, pick, locale, info, keyStatus, project, setProject, refreshProject, toast } = useApp();
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const offline = info?.provider === 'offline' || !keyStatus?.hasKey;

  const reload = useCallback(async () => {
    const [c, p] = await Promise.all([window.blum.directors.chat(director), window.blum.directors.proposals(director)]);
    setChat(c);
    setProposals(p);
  }, [director]);

  useEffect(() => {
    void reload();
    setLive('');
    return window.blum.directors.onEvent((e) => {
      if (e.director !== director) return;
      if (e.type === 'text') setLive((s) => s + e.text);
      else if (e.type === 'proposal') setProposals((ps) => [...ps, e.proposal]);
      else if (e.type === 'error') (play('error'), toast(pick(e), 'danger'));
      else if (e.type === 'done') {
        setLive('');
        void reload();
      }
    });
  }, [director, reload, pick, toast]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [chat, live]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setInput('');
    setChat((c) => [...c, { ts: new Date().toISOString(), role: 'user', text }]);
    const r = await window.blum.directors.send(director, text);
    if (!r.ok) toast(pick(r), 'danger');
    setBusy(false);
    await reload();
  };

  const decide = async (id: string, approve: boolean) => {
    setBusy(true);
    const r = approve ? await window.blum.directors.approve(id) : await window.blum.directors.reject(id);
    setBusy(false);
    if (r.ok) {
      setProject(r.value);
      if (approve) (play('success'), toast(t('proposal.appliedToast'), 'success'));
    } else (play('error'), toast(pick(r), 'danger'));
    await reload();
  };

  const offlinePick = async (choice: string) => {
    const r = await window.blum.directors.offline(director, choice);
    if (r.ok) setProposals((ps) => [...ps, r.value]);
    else toast(pick(r), 'danger');
    await refreshProject();
  };

  const onPanelProposal = (p: Proposal) => {
    setProposals((ps) => [...ps, p]);
    void refreshProject();
  };

  const lastAssistant = [...chat].reverse().find((c) => c.role === 'assistant');
  const dialogText = live || lastAssistant?.text || t(`dir.${director}.hello` as MessageKey);
  const pending = proposals.filter((p) => p.state === 'pending');
  const recent = proposals.filter((p) => p.state !== 'pending').slice(-3).reverse();
  const choices = OFFLINE_CHOICES[director] ?? [];
  const spent = chat.reduce((n, c) => n + (c.costUsd ?? 0), 0);

  return (
    <main className={`screen director`} data-testid={`screen-director-${director}`}>
      <div className="topbar">
        <Button icon="back" onClick={() => go('hub')} sound="back">
          {t('nav.hub')}
        </Button>
        <h1 className="grow shadow" style={{ color: `var(--c-dir-${director})` }}>
          {DIRECTOR_NAMES[director]}
          <span className="dim" style={{ fontSize: 8, marginLeft: 12 }}>
            {t(`dir.${director}.role` as MessageKey)}
          </span>
        </h1>
        <span className="badge info">{t('dir.spent', { cost: formatUsd(spent, locale) })}</span>
      </div>

      <div className={`director-main ${director === 'visual' ? 'chroma' : EDITOR_DIRECTORS.includes(director) ? 'editor' : ''}`}>
        <Frame title={t('dir.chat')} className="scroll">
          <div className="stack">
            {offline ? (
              <div className="offline" data-testid="offline-banner">
                {pick(OFFLINE_REPLIES[director]!)}
                {choices.length ? (
                  <div className="row" style={{ marginTop: 8 }}>
                    {choices.map((c) => (
                      <Button key={c} onClick={() => void offlinePick(c)} testid={`offline-${c}`}>
                        {t(`offline.${c}` as MessageKey)}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            <DialogBox director={director} text={dialogText} testid="dialog-box" />
            <div className="chat-log" ref={logRef}>
              {chat.slice(-8).map((c, i) => (
                <div key={i} className={`bubble ${c.role}`}>
                  {c.text}
                  {c.failure ? <span className="cost gold">{pick(c.failure)}</span> : null}
                  {c.role === 'assistant' && c.costUsd ? <span className="cost">{t('dir.cost', { cost: formatUsd(c.costUsd, locale) })}</span> : null}
                </div>
              ))}
            </div>
            <textarea
              className="field"
              value={input}
              placeholder={t('dir.placeholder')}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              data-testid="chat-input"
            />
            <div className="row">
              <Button variant="primary" onClick={() => void send()} disabled={busy || !input.trim()} testid="chat-send">
                {busy ? t('dir.thinking') : t('dir.send')}
              </Button>
              {busy ? (
                <Button onClick={() => void window.blum.directors.cancel(director)} sound="back">
                  {t('nav.cancel')}
                </Button>
              ) : null}
            </div>
          </div>
        </Frame>
        {director === 'visual' ? (
          <ChromaPanel onProposal={onPanelProposal} />
        ) : director === 'story' ? (
          <StoryPanel onProposal={onPanelProposal} />
        ) : director === 'movement' ? (
          <MovementPanel onProposal={onPanelProposal} />
        ) : director === 'level' ? (
          <LevelPanel onProposal={onPanelProposal} />
        ) : director === 'build' ? (
          <BoulonPanel onProposal={onPanelProposal} />
        ) : (
          <>
            <Frame title={t('dir.document')} className="scroll">
              <DocView />
            </Frame>
            <Frame title={t('hub.budget')} className="scroll">
              <div className="stack">
                <BudgetMeter label={t('budget.worlds')} used={project?.worlds ?? 0} max={8} cells={8} />
                <BudgetMeter label={t('budget.stages')} used={project?.stages ?? 0} max={32} cells={16} />
                <p className="muted" style={{ fontSize: 14 }}>
                  {t('dir.estimate')}
                </p>
              </div>
            </Frame>
          </>
        )}
      </div>

      <Frame title={t('dir.tray', { n: pending.length })} testid="proposal-tray">
        <div className="tray">
          {pending.length === 0 && recent.length === 0 ? <p className="muted">{t('dir.trayEmpty')}</p> : null}
          {pending.map((p) => (
            <ProposalCard key={p.id} proposal={p} busy={busy} onApprove={() => void decide(p.id, true)} onReject={() => void decide(p.id, false)} testid="proposal-card" />
          ))}
          {recent.map((p) => (
            <ProposalCard key={p.id} proposal={p} />
          ))}
        </div>
      </Frame>
    </main>
  );
}
