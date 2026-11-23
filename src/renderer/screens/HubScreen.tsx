import type { Palettes } from '../../core/schema/misc';
import { DIRECTOR_IDS } from '../../core/project/proposal';
import { STORY_LIMITS } from '../../core/schema/story';
import type { MessageKey } from '../../shared/i18n';
import { go, useApp } from '../app-context';
import { BudgetMeter, Button, DIRECTOR_NAMES, Frame, Portrait } from '../ui';
import { play } from '../sounds';

export function HubScreen() {
  const { t, pick, project, setProject, toast } = useApp();
  if (!project) {
    return (
      <main className="screen" data-testid="screen-hub">
        <Frame title={t('hub.noProject')}>
          <Button onClick={() => go('cartridges')}>{t('cart.title')}</Button>
        </Frame>
      </main>
    );
  }
  const pal = project.docs['graphics/palettes.json'] as Palettes | undefined;
  const set = pal?.sets[0];

  const exportZip = async () => {
    const r = await window.blum.projects.exportZip();
    toast(r.ok ? t('hub.exported', { path: r.value.path }) : pick(r), r.ok ? 'success' : 'danger');
  };
  const close = async () => {
    await window.blum.projects.close();
    setProject(null);
    play('back');
    go('cartridges');
  };

  return (
    <main className="screen hub" data-testid="screen-hub">
      <div className="topbar">
        <h1 className="grow shadow gold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {project.manifest.title}
        </h1>
        <Button icon="play" onClick={() => go('play?rom=project')} testid="hub-play">
          {t('hub.play')}
        </Button>
        <Button icon="build" onClick={() => go('director/build')} testid="hub-build">
          {t('hub.build')}
        </Button>
        <Button icon="story" onClick={() => go('first')} testid="hub-first">
          {t('hub.first')}
        </Button>
        <Button icon="history" onClick={() => go('history')}>
          {t('nav.history')}
        </Button>
        <Button icon="export" onClick={() => void exportZip()}>
          {t('hub.export')}
        </Button>
        <Button icon="settings" onClick={() => go('settings')}>
          {t('nav.settings')}
        </Button>
        <Button onClick={() => go('help')} testid="hub-help">
          {t('nav.help')}
        </Button>
        <Button icon="close" onClick={() => void close()} sound="back">
          {t('hub.close')}
        </Button>
      </div>
      <div className="hub-main">
        <Frame title={t('hub.floor')} className="scroll">
          <div className="floor">
            {DIRECTOR_IDS.map((id) => (
              <button key={id} type="button" className="station" onClick={() => (play('select'), go(`director/${id}`))} data-testid={`station-${id}`}>
                <Frame variant="stone">
                  <Portrait director={id} />
                  <span className="dir-name" style={{ color: `var(--c-dir-${id})` }}>
                    {DIRECTOR_NAMES[id]}
                  </span>
                  <span className="role">{t(`dir.${id}.role` as MessageKey)}</span>
                </Frame>
              </button>
            ))}
            <div className="conveyor" aria-hidden="true" />
          </div>
          <p className="dim" style={{ marginTop: 16 }}>
            {t('hub.tip')}
          </p>
          {project.readOnly ? <p className="gold">{t('hub.readOnly', { why: project.issues[0] ? pick(project.issues[0]) : '' })}</p> : null}
        </Frame>
        <Frame title={t('hub.budget')} className="scroll">
          <div className="stack">
            <BudgetMeter label={t('budget.worlds')} used={project.worlds} max={STORY_LIMITS.worlds} cells={8} />
            <BudgetMeter label={t('budget.stages')} used={project.stages} max={STORY_LIMITS.worlds * STORY_LIMITS.stagesPerWorld} cells={16} />
            <BudgetMeter label={t('budget.bgPalettes')} used={set?.bg.length ?? 0} max={4} cells={4} />
            <BudgetMeter label={t('budget.spritePalettes')} used={set?.sprites.length ?? 0} max={4} cells={4} />
            <dl className="kv stacked">
              <dt>{t('hub.cartridge')}</dt>
              <dd className="digits">{t('hub.cartridgeValue')}</dd>
              <dt>{t('hub.pending')}</dt>
              <dd className="digits">{project.pending}</dd>
            </dl>
          </div>
        </Frame>
      </div>
    </main>
  );
}
