import { useState } from 'react';
import type { Proposal } from '../../core/project/proposal';
import { go, useApp } from '../app-context';
import { BloomMark } from '../BloomMark';
import { ICON_NAMES, PixelIcon } from '../icons';
import { BudgetMeter, Button, DialogBox, Frame, Menu, PaletteSwatch, Portrait, ProposalCard, SeedPacket, SliderPixel, Tabs, Toggle } from '../ui';

// #/gallery: every design-system component on one page (M1 scope).
const SAMPLE: Proposal = {
  id: '01JZZZZZZZZZZZZZZZZZZZZZZZ',
  director: 'movement',
  state: 'pending',
  createdAt: '2026-10-19T12:00:00.000Z',
  tool: 'propose_physics',
  summary: { fr: 'Mouvements : saut plus haut, chute plus douce.', en: 'Movement: higher jump, softer fall.' },
  ops: [{ op: 'patch', doc: 'physics.json', pointer: '/jumpVelocity', value: 1280 }],
  warnings: [{ fr: 'La sortie du niveau 2 semble plus facile.', en: 'The stage 2 exit looks easier.' }],
};

export function GalleryScreen() {
  const { t, toast } = useApp();
  const [tab, setTab] = useState('a');
  const [on, setOn] = useState(true);
  const [v, setV] = useState(40);
  return (
    <main className="screen" data-testid="screen-gallery" style={{ gridTemplateRows: 'auto 1fr' }}>
      <div className="topbar">
        <Button icon="back" onClick={() => go('title')} sound="back">
          {t('nav.back')}
        </Button>
        <h1 className="grow shadow gold">{t('gallery.title')}</h1>
      </div>
      <div className="gallery-grid scroll">
        <Frame title={t('gallery.frames')} testid="gallery-frame">
          <div className="stack">
            <Frame variant="gilded">
              <p>{t('gallery.gilded')}</p>
            </Frame>
            <Frame variant="inset">
              <p>{t('gallery.inset')}</p>
            </Frame>
          </div>
        </Frame>
        <Frame title={t('gallery.buttons')}>
          <div className="row">
            <Button>{t('gallery.normal')}</Button>
            <Button variant="primary">{t('proposal.approve')}</Button>
            <Button variant="danger">{t('proposal.reject')}</Button>
            <Button disabled>{t('gallery.disabled')}</Button>
            <Button icon="build" big>
              {t('hub.build')}
            </Button>
          </div>
        </Frame>
        <Frame title={t('gallery.menu')}>
          <Menu
            items={[
              { id: 'a', label: t('gallery.menuA') },
              { id: 'b', label: t('gallery.menuB') },
              { id: 'c', label: t('gallery.menuC'), disabled: true },
            ]}
            onSelect={(id) => toast(id)}
          />
        </Frame>
        <Frame title={t('gallery.tabs')}>
          <div className="stack">
            <Tabs
              tabs={[
                { id: 'a', label: t('gallery.tabA') },
                { id: 'b', label: t('gallery.tabB') },
              ]}
              active={tab}
              onChange={setTab}
            />
            <Toggle on={on} onChange={setOn} label={t('gallery.toggle')} />
            <SliderPixel label={t('settings.volume')} value={v} min={0} max={100} step={5} format={(x) => `${x} %`} onChange={setV} />
            <input className="field" placeholder={t('dir.placeholder')} />
          </div>
        </Frame>
        <Frame title={t('gallery.dialog')} testid="gallery-dialog">
          <DialogBox director="story" text={t('dir.story.hello')} />
        </Frame>
        <Frame title={t('gallery.proposal')} testid="gallery-proposal">
          <ProposalCard proposal={SAMPLE} onApprove={() => toast(t('proposal.appliedToast'), 'success')} onReject={() => toast(t('proposal.rejected'))} />
        </Frame>
        <Frame title={t('gallery.budget')} testid="gallery-budget">
          <div className="stack">
            <BudgetMeter label={t('budget.bgTiles')} used={180} max={256} />
            <BudgetMeter label={t('budget.spriteTiles')} used={60} max={64} />
            <BudgetMeter label={t('budget.bgPalettes')} used={5} max={4} cells={4} />
          </div>
        </Frame>
        <Frame title={t('gallery.palette')}>
          <div className="row">
            {[0x0f, 0x16, 0x27, 0x30, 0x21, 0x1a, 0x24, 0x38].map((c) => (
              <PaletteSwatch key={c} index={c} />
            ))}
          </div>
        </Frame>
        <Frame title={t('gallery.portraits')}>
          <div className="row">
            {(['story', 'visual', 'movement', 'level', 'build'] as const).map((d) => (
              <Portrait key={d} director={d} small />
            ))}
          </div>
        </Frame>
        <Frame title={t('gallery.icons')}>
          <div className="icon-row">
            {ICON_NAMES.map((n) => (
              <span key={n} title={n}>
                <PixelIcon name={n} size={32} />
              </span>
            ))}
            <BloomMark size={32} />
          </div>
        </Frame>
        <Frame title={t('gallery.cartridge')}>
          <div className="row">
            <SeedPacket label="BLUM" />
            <SeedPacket color="var(--c-info)" label="NUAGE" />
          </div>
        </Frame>
        <Frame title={t('gallery.toasts')}>
          <div className="row">
            <Button onClick={() => toast(t('gallery.toastInfo'))}>{t('gallery.info')}</Button>
            <Button onClick={() => toast(t('proposal.appliedToast'), 'success')}>{t('gallery.success')}</Button>
            <Button onClick={() => toast(t('gallery.toastError'), 'danger')}>{t('gallery.error')}</Button>
          </div>
        </Frame>
      </div>
    </main>
  );
}
