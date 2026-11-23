import { useEffect, useMemo, useState } from 'react';
import { buildFontBank } from '../../core/engine-data/builtin-chr';
import { screenBytes, storyScreens, TEXT_BANK_BYTES, TEXT_LINES } from '../../core/engine-data/text-screens';
import type { Proposal } from '../../core/project/proposal';
import { STORY_LIMITS, type Story } from '../../core/schema/story';
import { useApp } from '../app-context';
import { play } from '../sounds';
import { BudgetMeter, Button, Frame, Radio } from '../ui';

// PLUME's form (MILESTONES M4b): the whole story.json as fields. "Proposer" sends it through the same
// propose_story tool the AI uses, so the budgets, the text screens and the starter stages are checked
// exactly the same way.

type Draft = Omit<Story, 'schemaVersion'>;
type World = Draft['worlds'][number];

const FONT = buildFontBank();

const slug = (prefix: string, taken: string[]) => {
  for (let i = 1; ; i++) if (!taken.includes(`${prefix}-${i}`)) return `${prefix}-${i}`;
};

function draftOf(s: Story): Draft {
  const { schemaVersion: _v, ...rest } = structuredClone(s);
  return rest;
}

export function StoryPanel({ onProposal }: { onProposal: (p: Proposal) => void }) {
  const { t, pick, project, toast, info } = useApp();
  const story = project?.docs['story.json'] as Story | undefined;
  const [draft, setDraft] = useState<Draft | null>(story ? draftOf(story) : null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(story ? draftOf(story) : null), [story]);

  const screens = useMemo(() => (draft ? storyScreens({ schemaVersion: 1, ...draft }) : []), [draft]);
  const textBytes = useMemo(() => screens.reduce((n, s) => n + screenBytes(s, FONT, draft?.romLocale ?? 'fr').length, 0), [screens, draft]);
  if (!draft || !story) return null;

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const setWorld = (i: number, patch: Partial<World>) => set({ worlds: draft.worlds.map((w, j) => (j === i ? { ...w, ...patch } : w)) });
  const allStages = draft.worlds.flatMap((w) => w.stages.map((s) => s.id));
  const linesOf = (kind: 'intro' | 'ending', world?: number) => screens.find((s) => s.kind === kind && s.world === world)?.lines.length ?? 0;
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(story));
  const stageCount = draft.worlds.reduce((n, w) => n + w.stages.length, 0);

  const propose = async () => {
    setBusy(true);
    const r = await window.blum.directors.manual('story', 'propose_story', draft);
    setBusy(false);
    if (r.ok) (play('success'), onProposal(r.value), toast(t('editor.proposed'), 'success'));
    else (play('error'), toast(pick(r), 'danger'));
  };

  const addWorld = () => {
    if (draft.worlds.length >= STORY_LIMITS.worlds) return;
    const id = slug('monde', draft.worlds.map((w) => w.id));
    const stage = slug('niveau', allStages);
    set({ worlds: [...draft.worlds, { id, name: { fr: `Monde ${draft.worlds.length + 1}` }, theme: '', stages: [{ id: stage, name: { fr: `Niveau ${stageCount + 1}` } }] }] });
  };

  return (
    <>
      <Frame title={t('plume.form')} className="scroll" testid="story-form">
        <div className="stack">
          <label className="stack">
            <span className="label">{t('plume.title')}</span>
            <input className="field" maxLength={24} value={draft.title} onChange={(e) => set({ title: e.target.value.toUpperCase() })} data-testid="story-title" />
          </label>
          <label className="stack">
            <span className="label">{t('plume.premise')}</span>
            <textarea className="field" maxLength={400} rows={2} value={draft.premise.fr} onChange={(e) => set({ premise: { ...draft.premise, fr: e.target.value } })} />
          </label>
          <div className="row">
            <span className="label">{t('plume.romLocale')}</span>
            <Radio on={draft.romLocale === 'fr'} onSelect={() => set({ romLocale: 'fr' })} label="FRANÇAIS" />
            {info?.features.romEnglish ? <Radio on={draft.romLocale === 'en'} onSelect={() => set({ romLocale: 'en' })} label="ENGLISH" /> : null}
          </div>
          {draft.worlds.map((w, i) => (
            <section key={w.id} className="world-card" data-testid="story-world">
              <div className="row">
                <h3 className="gold">{t('doc.world', { n: i + 1 })}</h3>
                <input className="field name-field" maxLength={24} value={w.name.fr} onChange={(e) => setWorld(i, { name: { ...w.name, fr: e.target.value } })} aria-label={t('plume.worldName')} />
                <Button onClick={() => set({ worlds: draft.worlds.filter((_, j) => j !== i) })} disabled={draft.worlds.length <= 1} sound="back">
                  {t('editor.remove')}
                </Button>
              </div>
              <div className="row">
                <label className="row grow">
                  <span className="label">{t('plume.theme')}</span>
                  <input className="field name-field" maxLength={32} value={w.theme} onChange={(e) => setWorld(i, { theme: e.target.value })} />
                </label>
                <label className="row grow">
                  <span className="label">{t('plume.boss')}</span>
                  <input className="field name-field" maxLength={24} value={w.boss ?? ''} onChange={(e) => setWorld(i, { boss: e.target.value || undefined })} />
                </label>
              </div>
              <label className="stack">
                <span className="label">
                  {t('plume.intro')} <span className={linesOf('intro', i) > TEXT_LINES ? 'err-line' : 'dim'}>{t('plume.lines', { n: linesOf('intro', i), max: TEXT_LINES })}</span>
                </span>
                <textarea className="field" maxLength={280} rows={2} value={w.intro?.fr ?? ''} onChange={(e) => setWorld(i, { intro: e.target.value ? { ...w.intro, fr: e.target.value } : undefined })} placeholder={t('plume.introHint')} />
              </label>
              <div className="stack">
                {w.stages.map((st, k) => (
                  <div className="row" key={st.id}>
                    <span className="digits dim">{st.id}</span>
                    <input
                      className="field name-field"
                      maxLength={24}
                      value={st.name.fr}
                      onChange={(e) => setWorld(i, { stages: w.stages.map((s, m) => (m === k ? { ...s, name: { ...s.name, fr: e.target.value } } : s)) })}
                      aria-label={t('plume.stageName')}
                    />
                    <Button onClick={() => setWorld(i, { stages: w.stages.filter((_, m) => m !== k) })} disabled={w.stages.length <= 1} sound="back">
                      {t('editor.remove')}
                    </Button>
                  </div>
                ))}
                <div className="row">
                  <Button
                    onClick={() => setWorld(i, { stages: [...w.stages, { id: slug('niveau', allStages), name: { fr: `Niveau ${stageCount + 1}` } }] })}
                    disabled={w.stages.length >= STORY_LIMITS.stagesPerWorld}
                    icon="plus"
                  >
                    {t('plume.addStage')}
                  </Button>
                </div>
              </div>
            </section>
          ))}
          <div className="row">
            <Button onClick={addWorld} disabled={draft.worlds.length >= STORY_LIMITS.worlds} icon="plus" testid="story-add-world">
              {t('plume.addWorld')}
            </Button>
          </div>
          <label className="stack">
            <span className="label">
              {t('plume.ending')} <span className={linesOf('ending') > TEXT_LINES ? 'err-line' : 'dim'}>{t('plume.lines', { n: linesOf('ending'), max: TEXT_LINES })}</span>
            </span>
            <textarea className="field" maxLength={400} rows={2} value={draft.ending.fr} onChange={(e) => set({ ending: { ...draft.ending, fr: e.target.value } })} />
          </label>
          <div className="row">
            <Button variant="primary" onClick={() => void propose()} disabled={busy || !dirty} testid="story-propose">
              {t('editor.propose')}
            </Button>
            <Button onClick={() => setDraft(draftOf(story))} disabled={!dirty} sound="back">
              {t('editor.reset')}
            </Button>
          </div>
        </div>
      </Frame>
      <Frame title={t('hub.budget')} className="scroll">
        <div className="stack">
          <BudgetMeter label={t('budget.worlds')} used={draft.worlds.length} max={STORY_LIMITS.worlds} cells={8} />
          <BudgetMeter label={t('budget.stages')} used={stageCount} max={STORY_LIMITS.worlds * STORY_LIMITS.stagesPerWorld} cells={16} />
          <BudgetMeter label={t('plume.textBank')} used={textBytes} max={TEXT_BANK_BYTES} cells={16} testid="story-text-budget" />
          <p className="muted small">{t('plume.textHint', { lines: TEXT_LINES })}</p>
          <p className="muted small">{t('plume.stubHint')}</p>
        </div>
      </Frame>
    </>
  );
}
