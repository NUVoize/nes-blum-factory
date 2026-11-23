import { useEffect, useMemo, useRef, useState } from 'react';
import { BOSS_OPS, parseBossScript, formatBossScript, type BossScript } from '../../core/engine-data/boss-dsl';
import { controlValue, DEFAULT_BOSS_TEXT, enemyPatternChoices, newEnemyInput, PATTERN_FR, physicsControls, type PhysicsControl, type PhysicsGroup } from '../../core/directors/rebond';
import type { Proposal } from '../../core/project/proposal';
import { ENEMY_DEFAULTS, ENEMY_LIMITS, type BossActor, type EnemyActor, type Level } from '../../core/schema/engine-docs';
import type { GraphicsDoc } from '../../core/schema/graphics';
import type { Palettes } from '../../core/schema/misc';
import { PHYSICS_PRESETS, type Physics } from '../../core/schema/physics';
import type { Story } from '../../core/schema/story';
import type { MessageKey } from '../../shared/i18n';
import { go, useApp } from '../app-context';
import { builtinFrame, drawMetasprite, type Triple } from '../nes-draw';
import { play } from '../sounds';
import { Button, Frame, Radio, SliderPixel, Tabs, Toggle } from '../ui';

// REBOND's panel (MILESTONES M4b): hero physics as sliders (+ presets and a live test in the emulator),
// enemy and boss forms. Every "Proposer" goes through the tools the AI uses (propose_physics,
// propose_enemy, propose_boss): same Ops, same validation, approval in the tray.

const GROUPS: PhysicsGroup[] = ['ground', 'air', 'jump', 'doubleJump', 'ladders', 'attack', 'health', 'walls', 'water', 'melee', 'doors'];

export function formatControl(c: PhysicsControl, v: number, locale: 'fr' | 'en'): string {
  const num = (x: number, d: number) => (locale === 'fr' ? x.toFixed(d).replace('.', ',') : x.toFixed(d));
  switch (c.unit) {
    case 'speed':
      return `${num(v / 256, 2)} px`;
    case 'accel':
      return num(v / 256, 3);
    case 'ratio':
      return `${Math.round((v * 100) / 256)} %`;
    case 'frames':
      return locale === 'fr' ? `${v} im.` : `${v} fr.`;
    case 'bool':
      return v ? '1' : '0';
    default:
      return String(v);
  }
}

const labelKey = (pointer: string) => `phys.${pointer.slice(1).replaceAll('/', '.')}` as MessageKey;

function setPointer(p: Physics, pointer: string, value: number | boolean): Physics {
  const next = structuredClone(p) as unknown as Record<string, unknown>;
  const keys = pointer.split('/').slice(1);
  let o = next;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[keys.at(-1)!] = value;
  return next as unknown as Physics;
}

/** Changes between two physics documents, as propose_physics pointer/value pairs. */
export function physicsDiff(from: Physics, to: Physics, controls: PhysicsControl[]): Array<{ pointer: string; value: number | boolean }> {
  return controls
    .filter((c) => controlValue(from, c.pointer) !== controlValue(to, c.pointer))
    .map((c) => ({ pointer: c.pointer, value: c.unit === 'bool' ? controlValue(to, c.pointer) === 1 : controlValue(to, c.pointer) }));
}

function ActorPreview({ graphics, docs, palettes }: { graphics: string; docs: Record<string, unknown>; palettes: readonly Triple[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    const f = builtinFrame(graphics);
    if (f && ref.current) {
      ref.current.width = f.w;
      ref.current.height = f.h;
      drawMetasprite(ref.current, f.entries, f.tile, palettes);
      return;
    }
    const g = docs[graphics] as GraphicsDoc | undefined;
    if (!g?.preview) return;
    let live = true;
    let made: string | null = null;
    void window.blum.chroma.asset(g.preview).then((b) => {
      if (!live || !b) return;
      made = URL.createObjectURL(new Blob([b as BlobPart], { type: 'image/png' }));
      setUrl(made);
    });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [graphics, docs, palettes]);
  if (url) return <img className="pixel-img actor-preview" src={url} alt="" />;
  return <canvas ref={ref} className="pixel-canvas actor-preview" />;
}

function HeroTab({ physics, onProposal }: { physics: Physics; onProposal: (p: Proposal) => void }) {
  const { t, pick, locale, toast, info } = useApp();
  const [draft, setDraft] = useState(physics);
  useEffect(() => setDraft(physics), [physics]);
  const controls = physicsControls(info!.features);
  const changes = physicsDiff(physics, draft, controls);

  const propose = async () => {
    const r = await window.blum.directors.manual('movement', 'propose_physics', { changes, reason: t('rebond.reasonSliders') });
    if (r.ok) (play('success'), onProposal(r.value), toast(t('editor.proposed'), 'success'));
    else (play('error'), toast(pick(r), 'danger'));
  };
  const preset = async (id: string) => {
    const r = await window.blum.directors.offline('movement', id);
    if (r.ok) (onProposal(r.value), toast(t('editor.proposed'), 'success'));
    else toast(pick(r), 'danger');
  };

  return (
    <div className="stack">
      <div className="row">
        <span className="label">{t('rebond.presets')}</span>
        {Object.keys(PHYSICS_PRESETS).map((id) => (
          <Button key={id} onClick={() => void preset(id)} testid={`preset-${id}`}>
            {t(`offline.${id}` as MessageKey)}
          </Button>
        ))}
      </div>
      <div className="phys-groups">
        {GROUPS.map((g) => {
          const list = controls.filter((c) => c.group === g);
          if (!list.length) return null;
          return (
            <section key={g} className="phys-group" data-testid={`phys-${g}`}>
              <h3 className="gold">{t(`physg.${g}` as MessageKey)}</h3>
              {list.map((c) =>
                c.unit === 'bool' ? (
                  <Toggle key={c.pointer} on={controlValue(draft, c.pointer) === 1} onChange={(v) => setDraft(setPointer(draft, c.pointer, v))} label={t(labelKey(c.pointer))} />
                ) : (
                  <SliderPixel
                    key={c.pointer}
                    label={t(labelKey(c.pointer))}
                    value={controlValue(draft, c.pointer)}
                    min={c.min}
                    max={c.max}
                    format={(v) => formatControl(c, v, locale)}
                    onChange={(v) => setDraft(setPointer(draft, c.pointer, v))}
                  />
                ),
              )}
            </section>
          );
        })}
      </div>
      <div className="row">
        <Button variant="primary" onClick={() => void propose()} disabled={!changes.length} testid="physics-propose">
          {t('rebond.proposeN', { n: changes.length })}
        </Button>
        <Button onClick={() => setDraft(physics)} disabled={!changes.length} sound="back">
          {t('editor.reset')}
        </Button>
        <Button icon="tune" onClick={() => go('play?tune=1')} testid="physics-live">
          {t('rebond.live')}
        </Button>
      </div>
      <p className="muted small">{t('rebond.liveHint')}</p>
    </div>
  );
}

function EnemyTab({ docs, onProposal, pals }: { docs: Record<string, unknown>; onProposal: (p: Proposal) => void; pals: readonly Triple[] }) {
  const { t, pick, toast, info } = useApp();
  const enemies = Object.entries(docs).filter(([p, v]) => /^actors\/[a-z0-9-]+\.json$/.test(p) && (v as { kind?: string }).kind === 'enemy') as Array<[string, EnemyActor]>;
  const patterns = enemyPatternChoices(info!.features);
  const [form, setForm] = useState(() => newEnemyInput('walker', 'ennemi-1'));
  const library = Object.entries(docs).filter(([p, v]) => /^graphics\/[a-z0-9-]+\.json$/.test(p) && (v as GraphicsDoc).role === 'enemy') as Array<[string, GraphicsDoc]>;
  const edit = (id: string, a: EnemyActor) => {
    const { schemaVersion: _s, kind: _k, ...rest } = a;
    setForm({ ...rest, id, turnAtLedge: a.turnAtLedge });
  };
  const graphics = form.graphics ?? `builtin:${form.pattern}`;
  const extra = (k: 'period' | 'jump' | 'amplitude' | 'shotSpeed') => {
    const d = (ENEMY_DEFAULTS as Record<string, Record<string, number>>)[form.pattern]?.[k];
    if (d === undefined) return null;
    const [lo, hi] = ENEMY_LIMITS[k];
    return <SliderPixel key={k} label={t(`rebond.${k}` as MessageKey)} value={form[k] ?? d} min={lo} max={hi} onChange={(v) => setForm({ ...form, [k]: v })} />;
  };
  const propose = async () => {
    const r = await window.blum.directors.manual('movement', 'propose_enemy', form);
    if (r.ok) (play('success'), onProposal(r.value), toast(t('editor.proposed'), 'success'));
    else (play('error'), toast(pick(r), 'danger'));
  };
  return (
    <div className="stack">
      <div className="library">
        {enemies.map(([p, a]) => (
          <button key={p} type="button" className={`lib-item ${form.id === p.slice(7, -5) ? 'on' : ''}`} onClick={() => edit(p.slice(7, -5), a)}>
            <ActorPreview graphics={a.graphics} docs={docs} palettes={pals} />
            <span className="label">{a.name.fr}</span>
            <span className="dim">{PATTERN_FR[a.pattern]}</span>
          </button>
        ))}
        <button type="button" className="lib-item" onClick={() => setForm(newEnemyInput('walker', `ennemi-${enemies.length + 1}`))} data-testid="enemy-new">
          <span className="label">{t('rebond.newEnemy')}</span>
        </button>
      </div>
      <div className="row">
        <ActorPreview graphics={graphics} docs={docs} palettes={pals} />
        <input className="field name-field" maxLength={24} value={form.name.fr} onChange={(e) => setForm({ ...form, name: { ...form.name, fr: e.target.value } })} aria-label={t('chroma.name')} />
        <span className="digits dim">{form.id}</span>
      </div>
      <div className="row" role="radiogroup">
        {patterns.map((p) => (
          <Radio key={p} on={form.pattern === p} onSelect={() => setForm({ ...newEnemyInput(p, form.id), name: form.name })} label={t(`pattern.${p}` as MessageKey)} testid={`pattern-${p}`} />
        ))}
      </div>
      <SliderPixel label={t('rebond.speed')} value={form.speed} min={ENEMY_LIMITS.speed[0]} max={ENEMY_LIMITS.speed[1]} format={(v) => `${(v / 256).toFixed(2)} px`} onChange={(v) => setForm({ ...form, speed: v })} />
      <SliderPixel label={t('rebond.hp')} value={form.hp} min={1} max={8} onChange={(v) => setForm({ ...form, hp: v })} />
      <SliderPixel label={t('rebond.damage')} value={form.damage} min={1} max={4} onChange={(v) => setForm({ ...form, damage: v })} />
      {(['period', 'jump', 'amplitude', 'shotSpeed'] as const).map(extra)}
      {form.pattern === 'walker' ? <Toggle on={!!form.turnAtLedge} onChange={(v) => setForm({ ...form, turnAtLedge: v })} label={t('rebond.turnAtLedge')} /> : null}
      <div className="row">
        <span className="label">{t('rebond.graphics')}</span>
        <Radio on={!form.graphics || form.graphics.startsWith('builtin:')} onSelect={() => setForm({ ...form, graphics: undefined })} label={t('rebond.builtin')} />
        {library.map(([p, g]) => (
          <Radio key={p} on={form.graphics === p} onSelect={() => setForm({ ...form, graphics: p })} label={g.name} />
        ))}
      </div>
      <div className="row">
        <Button variant="primary" onClick={() => void propose()} testid="enemy-propose">
          {t('editor.propose')}
        </Button>
      </div>
    </div>
  );
}

function BossTab({ docs, onProposal, pals }: { docs: Record<string, unknown>; onProposal: (p: Proposal) => void; pals: readonly Triple[] }) {
  const { t, pick, toast } = useApp();
  const bosses = Object.entries(docs).filter(([p, v]) => /^actors\/[a-z0-9-]+\.json$/.test(p) && (v as { kind?: string }).kind === 'boss') as Array<[string, BossActor]>;
  const story = docs['story.json'] as Story | undefined;
  const levels = Object.values(docs).filter((v) => (v as { grid?: unknown }).grid) as Level[];
  const library = Object.entries(docs).filter(([p, v]) => /^graphics\/[a-z0-9-]+\.json$/.test(p) && (v as GraphicsDoc).role === 'boss') as Array<[string, GraphicsDoc]>;
  const firstName = story?.worlds.find((w) => w.boss)?.boss ?? 'Boss';
  const [form, setForm] = useState({ id: 'boss-1', name: firstName, hp: 6, damage: 1, graphics: 'builtin:boss', script: DEFAULT_BOSS_TEXT, level: levels[0]?.id ?? '' });
  const parsed = useMemo(() => parseBossScript(form.script), [form.script]);
  const edit = (id: string, a: BossActor) => {
    const s = docs[`scripts/${a.script}.json`] as BossScript | undefined;
    const placed = levels.find((l) => l.entities.some((e) => e.actor === id));
    setForm({ id, name: a.name.fr, hp: a.hp, damage: a.damage, graphics: a.graphics, script: s ? formatBossScript(s) : DEFAULT_BOSS_TEXT, level: placed?.id ?? '' });
  };
  const propose = async () => {
    const level = levels.find((l) => l.id === form.level);
    const place = level ? { level: level.id, col: Math.max(0, level.width - 6), row: 10 } : undefined;
    const r = await window.blum.directors.manual('movement', 'propose_boss', { id: form.id, name: { fr: form.name }, hp: form.hp, damage: form.damage, graphics: form.graphics, script: form.script, ...(place ? { place } : {}) });
    if (r.ok) (play('success'), onProposal(r.value), toast(t('editor.proposed'), 'success'));
    else (play('error'), toast(pick(r), 'danger'));
  };
  return (
    <div className="stack">
      <div className="library">
        {bosses.map(([p, a]) => (
          <button key={p} type="button" className={`lib-item ${form.id === p.slice(7, -5) ? 'on' : ''}`} onClick={() => edit(p.slice(7, -5), a)}>
            <ActorPreview graphics={a.graphics} docs={docs} palettes={pals} />
            <span className="label">{a.name.fr}</span>
            <span className="dim">{t('rebond.hpN', { n: a.hp })}</span>
          </button>
        ))}
      </div>
      <div className="row">
        <ActorPreview graphics={form.graphics} docs={docs} palettes={pals} />
        <input className="field name-field" maxLength={24} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label={t('chroma.name')} />
        <input className="field digits" style={{ width: 120 }} maxLength={32} value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} aria-label={t('rebond.bossId')} />
      </div>
      <SliderPixel label={t('rebond.hp')} value={form.hp} min={1} max={32} onChange={(v) => setForm({ ...form, hp: v })} />
      <SliderPixel label={t('rebond.damage')} value={form.damage} min={1} max={4} onChange={(v) => setForm({ ...form, damage: v })} />
      <div className="row">
        <span className="label">{t('rebond.graphics')}</span>
        <Radio on={form.graphics === 'builtin:boss'} onSelect={() => setForm({ ...form, graphics: 'builtin:boss' })} label={t('rebond.builtin')} />
        {library.map(([p, g]) => (
          <Radio key={p} on={form.graphics === p} onSelect={() => setForm({ ...form, graphics: p })} label={g.name} />
        ))}
      </div>
      <label className="stack">
        <span className="label">{t('rebond.script')}</span>
        <textarea className="field digits boss-script" rows={9} value={form.script} onChange={(e) => setForm({ ...form, script: e.target.value })} spellCheck={false} data-testid="boss-script" />
      </label>
      {parsed.errors.length ? (
        <p className="warn-line" data-testid="boss-script-error">
          {parsed.errors[0]!.fr}
        </p>
      ) : (
        <p className="muted small">{t('rebond.scriptOk', { n: parsed.script!.phases.length })}</p>
      )}
      <p className="muted small">{t('rebond.scriptHelp', { ops: BOSS_OPS.join(', ') })}</p>
      <div className="row">
        <span className="label">{t('rebond.placeIn')}</span>
        {levels.map((l) => (
          <Radio key={l.id} on={form.level === l.id} onSelect={() => setForm({ ...form, level: l.id })} label={l.name.fr} />
        ))}
      </div>
      <div className="row">
        <Button variant="primary" onClick={() => void propose()} disabled={!!parsed.errors.length} testid="boss-propose">
          {t('editor.propose')}
        </Button>
      </div>
    </div>
  );
}

export function MovementPanel({ onProposal }: { onProposal: (p: Proposal) => void }) {
  const { t, project } = useApp();
  const tabOfHash = () => /[?&]tab=(enemies|bosses)/.exec(location.hash)?.[1] ?? 'hero';
  const [tab, setTab] = useState(tabOfHash);
  // `#/director/movement?tab=bosses` opens a tab (links, smoke captures) even when the panel is already shown
  useEffect(() => {
    const on = () => setTab(tabOfHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  if (!project) return null;
  const docs = project.docs;
  const physics = docs['physics.json'] as Physics;
  const pal = docs['graphics/palettes.json'] as Palettes | undefined;
  const pals = (pal?.sets[0]?.sprites ?? [[0x0f, 0x16, 0x30]]) as readonly Triple[];
  return (
    <Frame title={t('rebond.panel')} className="scroll span-2" testid="movement-panel">
      <div className="stack">
        <Tabs
          tabs={[
            { id: 'hero', label: t('rebond.tabHero') },
            { id: 'enemies', label: t('rebond.tabEnemies') },
            { id: 'bosses', label: t('rebond.tabBosses') },
          ]}
          active={tab}
          onChange={setTab}
        />
        {tab === 'hero' ? <HeroTab physics={physics} onProposal={onProposal} /> : null}
        {tab === 'enemies' ? <EnemyTab docs={docs} onProposal={onProposal} pals={pals} /> : null}
        {tab === 'bosses' ? <BossTab docs={docs} onProposal={onProposal} pals={pals} /> : null}
      </div>
    </Frame>
  );
}
