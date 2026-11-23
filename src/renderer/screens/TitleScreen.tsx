import { useEffect } from 'react';
import { APP_TITLE } from '../../shared/app-info';
import { go, useApp } from '../app-context';
import { play } from '../sounds';
import logo from '../ui-kit/logo/logo.png';

export function TitleScreen() {
  const { t, locale, updateSettings, info } = useApp();

  useEffect(() => {
    const start = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        play('select');
        go('cartridges');
      }
    };
    window.addEventListener('keydown', start);
    // Gamepad Start (button 9) also starts.
    let raf = 0;
    const poll = () => {
      const pads = navigator.getGamepads?.() ?? [];
      if (pads.some((p) => p?.buttons[9]?.pressed)) go('cartridges');
      else raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => {
      window.removeEventListener('keydown', start);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <main className="screen title-screen" data-testid="screen-title" onClick={() => go('cartridges')}>
      <h1 data-testid="app-title" className="sr-only">
        {APP_TITLE}
      </h1>
      <img className="logo" src={logo} alt={APP_TITLE} draggable={false} />
      <p className="sub">{t('title.subtitle')}</p>
      <p className="press blink shadow">{t('title.pressStart')}</p>
      <p className="dim">{t('title.hint')}</p>
      <nav className="foot" aria-label={t('title.language')} onClick={(e) => e.stopPropagation()}>
        {(['fr', 'en'] as const).map((l) => (
          <button key={l} type="button" className={`chip-btn ${l === locale ? 'active' : ''}`} onClick={() => void updateSettings({ locale: l })}>
            {t(l === 'fr' ? 'lang.fr' : 'lang.en')}
          </button>
        ))}
        <span className="chip-btn muted">{t('title.version', { v: info?.version ?? '' })}</span>
      </nav>
    </main>
  );
}
