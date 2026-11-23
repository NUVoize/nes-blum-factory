import type { MessageKey } from '../../shared/i18n';
import { useApp } from '../app-context';
import { Button, Frame } from '../ui';

/** One help section: a title and paragraphs, all from the dictionaries. */
function Section({ heading, lines, testid, strong }: { heading?: MessageKey; lines: MessageKey[]; testid: string; strong?: MessageKey }) {
  const { t } = useApp();
  return (
    <section className="help-section" data-testid={testid}>
      {heading ? <h3 className="gold">{t(heading)}</h3> : null}
      {lines.map((k) => (
        <p key={k} className={k === strong ? 'help-strong' : undefined}>
          {t(k)}
        </p>
      ))}
    </section>
  );
}

// Help page (MILESTONES M6): flashing guide (flash carts, chip programmers, the PRG-RAM rule), unblocking
// the zip, the SmartScreen and Smart App Control notes, Mesen, the key, the controls. Hardware names only in « Compatibilité ».
export function HelpScreen() {
  const { t } = useApp();
  return (
    <main className="screen" data-testid="screen-help" style={{ gridTemplateRows: 'auto 1fr' }}>
      <div className="topbar">
        <Button icon="back" onClick={() => history.back()} sound="back">
          {t('nav.back')}
        </Button>
        <h1 className="grow shadow gold">{t('help.title')}</h1>
      </div>
      <div className="cols scroll">
        <Frame title={t('help.flash.title')} testid="help-flash">
          <div className="stack">
            <Section lines={['help.flash.intro', 'help.flash.cart', 'help.flash.chip', 'help.flash.ram', 'help.flash.format']} strong="help.flash.ram" testid="help-flash-body" />
            <Section heading="help.hw.title" lines={['help.hw.text']} testid="help-hw" />
          </div>
        </Frame>
        <Frame title={t('help.unblock.title')} testid="help-install">
          <div className="stack">
            <Section lines={['help.unblock.text']} testid="help-unblock" />
            <Section heading="help.smart.title" lines={['help.smart.text']} testid="help-smartscreen" />
            <Section heading="help.sac.title" lines={['help.sac.text']} testid="help-sac" />
            <Section heading="help.key.title" lines={['help.key.text']} testid="help-key" />
          </div>
        </Frame>
        <Frame title={t('help.play.title')} testid="help-play">
          <div className="stack">
            <Section lines={['play.keys', 'play.pad']} testid="help-controls" />
            <section className="help-section" data-testid="help-mesen">
              <h3 className="gold">{t('help.mesen.title')}</h3>
              <p>{t('help.mesen.text')}</p>
              <p className="digits sky selectable">{t('help.mesen.link')}</p>
            </section>
            <Section heading="help.sample.title" lines={['help.sample.text']} testid="help-sample" />
            <Section heading="help.sebring.title" lines={['help.sebring.text']} testid="help-sebring" />
            <Section heading="help.legend.title" lines={['help.legend.text']} testid="help-legend" />
          </div>
        </Frame>
      </div>
    </main>
  );
}
