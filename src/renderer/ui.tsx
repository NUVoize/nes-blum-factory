import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Proposal } from '../core/project/proposal';
import { NES_PALETTE, nesHex } from '../core/nes/palette';
import { useApp } from './app-context';
import { PixelIcon, type IconName } from './icons';
import { blip, play } from './sounds';
import buildPortrait from './ui-kit/portraits/director-build.png';
import levelPortrait from './ui-kit/portraits/director-level.png';
import movementPortrait from './ui-kit/portraits/director-movement.png';
import storyPortrait from './ui-kit/portraits/director-story.png';
import visualPortrait from './ui-kit/portraits/director-visual.png';

export const PORTRAITS: Record<string, string> = {
  story: storyPortrait,
  visual: visualPortrait,
  movement: movementPortrait,
  level: levelPortrait,
  build: buildPortrait,
};

export const DIRECTOR_NAMES: Record<string, string> = { story: 'PLUME', visual: 'CHROMA', movement: 'REBOND', level: 'TABLEAU', build: 'BOULON' };

export function Frame({
  variant = 'stone',
  title,
  children,
  className = '',
  testid,
}: {
  variant?: 'stone' | 'gilded' | 'inset';
  title?: string;
  children: ReactNode;
  className?: string;
  testid?: string;
}) {
  return (
    <section className={`frame ${variant} ${className}`} data-testid={testid}>
      <div className="frame-body">
        {title ? <div className="title-bar">{title}</div> : null}
        {children}
      </div>
    </section>
  );
}

export function Button({
  children,
  onClick,
  variant = 'normal',
  big,
  icon,
  disabled,
  testid,
  title,
  sound = 'select',
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: 'normal' | 'primary' | 'danger';
  big?: boolean;
  icon?: IconName;
  disabled?: boolean;
  testid?: string;
  title?: string;
  sound?: 'select' | 'back' | 'coin' | null;
}) {
  return (
    <button
      type="button"
      className={`btn ${variant === 'normal' ? '' : variant} ${big ? 'big' : ''}`}
      onClick={() => {
        if (sound) play(sound);
        onClick?.();
      }}
      onMouseEnter={() => !disabled && play('cursor')}
      disabled={disabled}
      data-testid={testid}
      title={title}
    >
      {icon ? <PixelIcon name={icon} size={16} /> : null}
      {children}
    </button>
  );
}

export function Toggle({ on, onChange, label, testid }: { on: boolean; onChange: (v: boolean) => void; label: string; testid?: string }) {
  return (
    <button type="button" className={`toggle ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => (play('cursor'), onChange(!on))} data-testid={testid}>
      {label}
    </button>
  );
}

/** One choice among several (W1 P2-2): drawn as a radio, not as a checkbox. */
export function Radio({ on, onSelect, label, testid }: { on: boolean; onSelect: () => void; label: string; testid?: string }) {
  return (
    <button type="button" role="radio" className={`toggle radio ${on ? 'on' : ''}`} aria-checked={on} onClick={() => (play('cursor'), onSelect())} data-testid={testid}>
      {label}
    </button>
  );
}

export function SliderPixel({
  value,
  min,
  max,
  step = 1,
  label,
  format = (v: number) => String(v),
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="slider">
      <span className="label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="gold">{format(value)}</span>
    </label>
  );
}

export interface MenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  testid?: string;
}

/** Keyboard-driven menu with the blinking cursor (arrows + Enter). */
export function Menu({ items, onSelect, autoFocus }: { items: MenuItem[]; onSelect: (id: string) => void; autoFocus?: boolean }) {
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      play('cursor');
      setSel((s) => (s + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const it = items[sel];
      if (it && !it.disabled) (play('select'), onSelect(it.id));
    }
  };
  return (
    <ul className="menu" tabIndex={0} ref={ref} onKeyDown={onKey} role="menu">
      {items.map((it, i) => (
        <li key={it.id} role="none">
          <button
            type="button"
            role="menuitem"
            className={`menu-item ${i === sel ? 'selected' : ''}`}
            disabled={it.disabled}
            onMouseEnter={() => setSel(i)}
            onClick={() => (play('select'), onSelect(it.id))}
            data-testid={it.testid}
            tabIndex={-1}
          >
            {it.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: Array<{ id: string; label: string }>; active: string; onChange: (id: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tb) => (
        <button key={tb.id} type="button" role="tab" aria-selected={tb.id === active} className={`tab ${tb.id === active ? 'active' : ''}`} onClick={() => (play('cursor'), onChange(tb.id))}>
          {tb.label}
        </button>
      ))}
    </div>
  );
}

export function Portrait({ director, small }: { director: string; small?: boolean }) {
  return <img className={`portrait ${small ? 'small' : ''}`} src={PORTRAITS[director]} alt={DIRECTOR_NAMES[director]} draggable={false} />;
}

/** Portrait + typewriter text, skippable by click (PLAN §9.4). Reduced motion shows the text at once. */
export function DialogBox({ director, text, testid }: { director: string; text: string; testid?: string }) {
  const reduce = typeof matchMedia !== 'undefined' && (matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('smoke'));
  const [shown, setShown] = useState(reduce ? text.length : 0);
  useEffect(() => {
    if (reduce) {
      setShown(text.length);
      return;
    }
    setShown(0);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setShown(i);
      if (i % 3 === 0) blip(director);
      if (i >= text.length) clearInterval(id);
    }, 22);
    return () => clearInterval(id);
  }, [text, director, reduce]);
  const done = shown >= text.length;
  return (
    <div className="dialog" data-testid={testid} onClick={() => setShown(text.length)}>
      <Portrait director={director} />
      <div>
        <div className="speaker" style={{ color: `var(--c-dir-${director})` }}>
          {DIRECTOR_NAMES[director]}
        </div>
        <p className="text">
          {text.slice(0, shown)}
          {done ? <span className="caret" aria-hidden="true" /> : null}
        </p>
      </div>
    </div>
  );
}

/** Segmented budget bar, like a life bar. */
export function BudgetMeter({ label, used, max, cells = 16, testid }: { label: string; used: number; max: number; cells?: number; testid?: string }) {
  const ratio = max > 0 ? used / max : 0;
  const on = Math.min(cells, Math.round(ratio * cells));
  const state = ratio > 1 ? 'over' : ratio > 0.85 ? 'warn' : '';
  return (
    <div className={`budget ${state}`} data-testid={testid}>
      <div className="label">
        <span>{label}</span>
        <span className="gold">
          {used}/{max}
        </span>
      </div>
      <div className="cells" style={{ gridTemplateColumns: `repeat(${cells}, 1fr)` }}>
        {Array.from({ length: cells }, (_, i) => (
          <span key={i} className={`cell ${i < on ? 'on' : ''}`} />
        ))}
      </div>
    </div>
  );
}

export function PaletteSwatch({ index }: { index: number }) {
  return (
    <span className="swatch">
      <span className="chip" style={{ background: NES_PALETTE[index] }} />
      {nesHex(index)}
    </span>
  );
}

export function ToastStack() {
  const { toasts } = useApp();
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className={`toast ${x.kind === 'info' ? '' : x.kind}`}>
          {x.text}
        </div>
      ))}
    </div>
  );
}

/** Proposal card (PLAN §4.3 step 5): summary, warnings, raw ops, approve / reject. */
export function ProposalCard({
  proposal,
  onApprove,
  onReject,
  busy,
  testid,
}: {
  proposal: Proposal;
  onApprove?: () => void;
  onReject?: () => void;
  busy?: boolean;
  testid?: string;
}) {
  const { t, pick } = useApp();
  const [raw, setRaw] = useState(false);
  const badge =
    proposal.state === 'pending' ? (
      <span className="badge">{t('proposal.pending')}</span>
    ) : proposal.state === 'approved' ? (
      <span className="badge success">{t('proposal.approved')}</span>
    ) : (
      <span className="badge muted">{t('proposal.rejected')}</span>
    );
  return (
    <Frame variant={proposal.state === 'pending' ? 'gilded' : 'inset'} className="proposal" testid={testid}>
      <div className="proposal">
        <div className="head">
          <h3 style={{ color: `var(--c-dir-${proposal.director})` }}>{DIRECTOR_NAMES[proposal.director]}</h3>
          {badge}
        </div>
        <p>{pick(proposal.summary)}</p>
        {proposal.warnings.map((w, i) => (
          <p key={i} className="gold">
            {pick(w)}
          </p>
        ))}
        {raw ? <pre>{JSON.stringify(proposal.ops, null, 1)}</pre> : null}
        <div className="actions">
          {proposal.state === 'pending' ? (
            <>
              <Button variant="primary" onClick={onApprove} disabled={busy} sound="coin" testid="approve">
                {t('proposal.approve')}
              </Button>
              <Button variant="danger" onClick={onReject} disabled={busy} sound="back" testid="reject">
                {t('proposal.reject')}
              </Button>
            </>
          ) : null}
          <Button onClick={() => setRaw((r) => !r)} sound={null}>
            {raw ? t('proposal.hideRaw') : t('proposal.showRaw')}
          </Button>
        </div>
      </div>
    </Frame>
  );
}

/** Original cartridge shape: a seed packet with a flower window (no NES/SNES cart silhouette, PLAN §9.1). */
export function SeedPacket({ color = 'var(--c-bloom)', label }: { color?: string; label: string }) {
  return (
    <svg className="packet" viewBox="0 0 28 36" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="2" y="3" width="24" height="32" fill="var(--p-black)" />
      <rect x="1" y="2" width="24" height="32" fill={color} />
      <rect x="1" y="2" width="24" height="4" fill="var(--p-cream)" />
      {Array.from({ length: 6 }, (_, i) => (
        <rect key={i} x={2 + i * 4} y="5" width="2" height="1" fill="var(--p-steel-500)" />
      ))}
      <rect x="5" y="9" width="16" height="14" fill="var(--p-navy-800)" />
      <rect x="12" y="17" width="2" height="6" fill="var(--p-leaf-500)" />
      <rect x="14" y="19" width="3" height="2" fill="var(--p-leaf-500)" />
      <rect x="10" y="12" width="6" height="5" fill="var(--p-bloom-300)" />
      <rect x="12" y="13" width="2" height="2" fill="var(--p-gold-300)" />
      <rect x="4" y="26" width="18" height="5" fill="var(--p-cream)" />
      <text
        x="13"
        y="30"
        textAnchor="middle"
        fontSize="3"
        fontFamily="'Press Start 2P'"
        fill="var(--p-navy-900)"
        {...(label.length > 5 ? { textLength: 16, lengthAdjust: 'spacingAndGlyphs' } : {})}
      >
        {label.slice(0, 10)}
      </text>
    </svg>
  );
}
