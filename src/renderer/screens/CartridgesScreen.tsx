import { useEffect, useState } from 'react';
import type { ProjectSummary } from '../../shared/api';
import { go, useApp } from '../app-context';
import { play } from '../sounds';
import { Button, Frame, SeedPacket } from '../ui';

const PACKET_COLORS = ['var(--c-bloom)', 'var(--c-dir-story)', 'var(--c-success)', 'var(--c-info)', 'var(--c-accent)'];

export function CartridgesScreen() {
  const { t, pick, setProject, toast } = useApp();
  const [list, setList] = useState<ProjectSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    void window.blum.projects.list().then(setList);
    setName(t('cart.defaultName'));
  }, [t]);

  const open = async (dir: string) => {
    const r = await window.blum.projects.open(dir);
    if (r.ok) {
      setProject(r.value);
      go('hub');
    } else (play('error'), toast(pick(r), 'danger'));
  };

  const create = async () => {
    const r = await window.blum.projects.create(name);
    if (r.ok) {
      play('success');
      setProject(r.value);
      go('hub');
    } else (play('error'), toast(pick(r), 'danger'));
  };

  /** « Ta première cartouche »: a new project, then the five-step tour (M6). */
  const first = async () => {
    const r = await window.blum.projects.create(t('cart.firstName'));
    if (r.ok) {
      play('success');
      setProject(r.value);
      go('first');
    } else (play('error'), toast(pick(r), 'danger'));
  };

  /** The sample game BLUM: a fresh copy in the projects folder (M6). */
  const sample = async () => {
    const r = await window.blum.projects.openSample();
    if (r.ok) {
      play('success');
      setProject(r.value);
      go('hub');
    } else (play('error'), toast(pick(r), 'danger'));
  };

  const importZip = async () => {
    const r = await window.blum.projects.importZip();
    if (r.ok) {
      setProject(r.value);
      go('hub');
    } else toast(pick(r), 'danger');
  };

  return (
    <main className="screen" data-testid="screen-cartridges" style={{ gridTemplateRows: 'auto 1fr' }}>
      <div className="topbar">
        <Button icon="back" onClick={() => go('title')} sound="back">
          {t('nav.back')}
        </Button>
        <h1 className="grow shadow gold">{t('cart.title')}</h1>
        <Button icon="load" onClick={() => void importZip()}>
          {t('cart.import')}
        </Button>
        <Button icon="settings" onClick={() => go('settings')}>
          {t('nav.settings')}
        </Button>
      </div>
      <Frame title={t('cart.shelf')} className="scroll">
        {creating ? (
          <div className="stack" style={{ maxWidth: 520 }}>
            <label className="stack">
              <span className="label">{t('cart.nameLabel')}</span>
              <input className="field" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} autoFocus data-testid="new-project-title" onKeyDown={(e) => e.key === 'Enter' && void create()} />
            </label>
            <div className="row">
              <Button variant="primary" onClick={() => void create()} testid="create-project" disabled={!name.trim()}>
                {t('cart.create')}
              </Button>
              <Button onClick={() => setCreating(false)} sound="back">
                {t('nav.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="cart-grid">
            <button type="button" className="cart" onClick={() => (play('select'), setCreating(true))} data-testid="new-project">
              <SeedPacket color="var(--p-steel-500)" label="+" />
              <span className="name">{t('cart.new')}</span>
            </button>
            <button type="button" className="cart" onClick={() => void first()} data-testid="first-cartridge">
              <SeedPacket color="var(--c-dir-story)" label="1" />
              <span className="name">{t('cart.first')}</span>
            </button>
            <button type="button" className="cart" onClick={() => void sample()} data-testid="open-sample">
              <SeedPacket color="var(--c-success)" label="BLUM" />
              <span className="name">{t('cart.sample')}</span>
              <span className="muted">{t('cart.sampleHint')}</span>
            </button>
            <button type="button" className="cart" onClick={() => (play('select'), go('play?rom=sebring'))} data-testid="open-sebring">
              <SeedPacket color="var(--c-dir-visual)" label="SEBRING" />
              <span className="name">{t('cart.sebring')}</span>
              <span className="muted">{t('cart.sebringHint')}</span>
            </button>
            <button type="button" className="cart" onClick={() => (play('select'), go('play?rom=legend'))} data-testid="open-legend">
              <SeedPacket color="var(--c-dir-story)" label="LEGEND" />
              <span className="name">{t('cart.legend')}</span>
              <span className="muted">{t('cart.legendHint')}</span>
            </button>
            {list.map((p, i) => (
              <button key={p.dir} type="button" className="cart" onClick={() => void open(p.dir)} disabled={!p.ok} title={p.dir}>
                <SeedPacket color={PACKET_COLORS[i % PACKET_COLORS.length]} label={p.title} />
                <span className="name">{p.title}</span>
                <span className="muted">{p.worlds === 1 ? t('cart.world1') : t('cart.worlds', { n: p.worlds })}</span>
              </button>
            ))}
          </div>
        )}
        {!creating && list.length === 0 ? (
          <p className="dim" style={{ marginTop: 16 }} data-testid="cart-empty">
            {t('cart.empty')}
          </p>
        ) : null}
      </Frame>
    </main>
  );
}
